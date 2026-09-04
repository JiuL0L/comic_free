import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import type { Readable } from "node:stream";

import {
  HEALTH_API_VERSION,
  type PluginHostStatusResponse,
} from "@comic-free/contracts";

export interface PluginHostManagerOptions {
  approvedArtifactSha256?: string;
  artifactPath: string;
  command: string;
  commandArguments: string[];
  environment?: Record<string, string>;
  internalPort: number;
  logRoot: string;
  readinessUrl: string;
  runtimeRoot: string;
  shutdownTimeoutMs: number;
  shutdownToken: string;
  shutdownUrl: string;
  startupTimeoutMs: number;
}

export class PluginHostManager {
  readonly #options: PluginHostManagerOptions;
  #child: ChildProcess | null = null;
  #logsClosed: Promise<void> | null = null;
  #status: PluginHostStatusResponse;
  #stopping = false;

  constructor(options: PluginHostManagerOptions) {
    this.#options = options;
    this.#status = {
      apiVersion: HEALTH_API_VERSION,
      internalPort: null,
      message: "The Plugin Host is stopped.",
      retryable: false,
      state: "stopped",
    };
  }

  status(): PluginHostStatusResponse {
    return { ...this.#status };
  }

  async start(): Promise<void> {
    const artifact = await stat(this.#options.artifactPath).catch(() => null);
    if (!artifact?.isFile()) {
      const message = "The configured Plugin Host artifact path does not exist or is not a file.";
      this.#status = {
        apiVersion: HEALTH_API_VERSION,
        internalPort: null,
        message,
        retryable: false,
        state: "invalid_path",
      };
      throw new Error(message);
    }
    if (this.#options.approvedArtifactSha256) {
      const actualSha256 = await sha256(this.#options.artifactPath);
      if (actualSha256 !== this.#options.approvedArtifactSha256.toLowerCase()) {
        const message = "The configured Plugin Host artifact does not match the approved SHA-256.";
        this.#status = {
          apiVersion: HEALTH_API_VERSION,
          internalPort: null,
          message,
          retryable: false,
          state: "invalid_path",
        };
        throw new Error(message);
      }
    }
    try {
      await assertLoopbackPortAvailable(this.#options.internalPort);
    } catch {
      const message = `Plugin Host port ${this.#options.internalPort} is already in use on 127.0.0.1.`;
      this.#status = {
        apiVersion: HEALTH_API_VERSION,
        internalPort: this.#options.internalPort,
        message,
        retryable: true,
        state: "port_occupied",
      };
      throw new Error(message);
    }

    await Promise.all([
      mkdir(this.#options.runtimeRoot, { recursive: true }),
      mkdir(this.#options.logRoot, { recursive: true }),
    ]);
    this.#status = {
      apiVersion: HEALTH_API_VERSION,
      internalPort: this.#options.internalPort,
      message: "The Plugin Host is starting.",
      retryable: false,
      state: "starting",
    };
    this.#stopping = false;

    const child = spawn(this.#options.command, this.#options.commandArguments, {
      cwd: this.#options.runtimeRoot,
      detached: true,
      env: { ...process.env, ...this.#options.environment },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.#child = child;
    this.#logsClosed = captureStructuredLogs(child, this.#options.logRoot);
    const launchFailure = new Promise<never>((_, reject) => {
      child.once("error", (error) => {
        const message = `The Plugin Host process could not start: ${error.message}`;
        this.#status = {
          apiVersion: HEALTH_API_VERSION,
          internalPort: null,
          message,
          retryable: true,
          state: "early_exit",
        };
        reject(new Error(message));
      });
    });

    child.once("exit", (code, signal) => {
      if (this.#stopping) return;
      const exitedBeforeReadiness = this.#status.state === "starting";
      this.#status = {
        apiVersion: HEALTH_API_VERSION,
        internalPort: null,
        message: exitedBeforeReadiness
          ? `The Plugin Host exited before readiness (${describeExit(code, signal)}).`
          : `The Plugin Host exited unexpectedly (${describeExit(code, signal)}).`,
        retryable: true,
        state: exitedBeforeReadiness ? "early_exit" : "unexpected_exit",
      };
    });

    try {
      await Promise.race([this.#waitForReadiness(child), launchFailure]);
    } catch (error) {
      if (this.#status.state === "starting") {
        this.#status = {
          apiVersion: HEALTH_API_VERSION,
          internalPort: this.#options.internalPort,
          message: `The Plugin Host did not become ready within ${this.#options.startupTimeoutMs} ms.`,
          retryable: true,
          state: "startup_timeout",
        };
      }
      throw error;
    }
    this.#status = {
      apiVersion: HEALTH_API_VERSION,
      internalPort: this.#options.internalPort,
      message: "Suwayomi is ready.",
      retryable: false,
      state: "ready",
    };
  }

  async stop(): Promise<void> {
    const child = this.#child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;

    this.#stopping = true;
    this.#status = {
      apiVersion: HEALTH_API_VERSION,
      internalPort: this.#options.internalPort,
      message: "The Plugin Host is stopping safely.",
      retryable: false,
      state: "stopping",
    };
    const exit = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    let shutdownFailure: string | null = null;
    try {
      const shutdownResponse = await fetch(this.#options.shutdownUrl, {
        headers: { Authorization: `Bearer ${this.#options.shutdownToken}` },
        method: "POST",
        signal: AbortSignal.timeout(Math.min(this.#options.shutdownTimeoutMs, 2_000)),
      });
      if (shutdownResponse.status !== 202) {
        shutdownFailure =
          `The Plugin Host rejected application shutdown with HTTP ${shutdownResponse.status}.`;
      }
    } catch (error) {
      shutdownFailure =
        error instanceof Error
          ? `The Plugin Host application shutdown request failed: ${error.message}`
          : "The Plugin Host application shutdown request failed.";
    }
    if (shutdownFailure) {
      await this.#failShutdown(child, exit, shutdownFailure);
    }

    const stopped = await Promise.race([
      exit.then(() => true),
      delay(this.#options.shutdownTimeoutMs).then(() => false),
    ]);
    if (!stopped) {
      await this.#failShutdown(
        child,
        exit,
        "The Plugin Host did not complete its application shutdown in time.",
      );
    }
    await this.#logsClosed;

    this.#child = null;
    this.#status = {
      apiVersion: HEALTH_API_VERSION,
      internalPort: null,
      message: "The Plugin Host stopped after completing application shutdown.",
      retryable: false,
      state: "stopped",
    };
  }

  async #failShutdown(
    child: ChildProcess,
    exit: Promise<void>,
    reason: string,
  ): Promise<never> {
    child.kill("SIGKILL");
    await Promise.race([exit, delay(1_000)]);
    await this.#logsClosed;
    this.#child = null;
    this.#status = {
      apiVersion: HEALTH_API_VERSION,
      internalPort: null,
      message: `${reason} Comic Free used an abrupt fallback.`,
      retryable: true,
      state: "shutdown_failed",
    };
    throw new Error(this.#status.message);
  }

  async #waitForReadiness(child: ChildProcess): Promise<void> {
    const deadline = Date.now() + this.#options.startupTimeoutMs;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`The Plugin Host exited before readiness (${describeExit(child.exitCode, child.signalCode)}).`);
      }
      try {
        const response = await fetch(this.#options.readinessUrl, {
          body: JSON.stringify({ query: "query ComicFreeReadiness { __typename }" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
          signal: AbortSignal.timeout(500),
        });
        const payload = (await response.json()) as { data?: { __typename?: unknown } };
        if (response.ok && payload.data?.__typename === "Query") return;
      } catch {
        // Connection refusal is expected while the child starts.
      }
      await delay(100);
    }
    throw new Error("The Plugin Host did not become ready before the startup deadline.");
  }
}

function describeExit(code: number | null, signal: NodeJS.Signals | null): string {
  return code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function sha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function assertLoopbackPortAvailable(port: number): Promise<void> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen({ exclusive: true, host: "127.0.0.1", port }, () => {
      probe.close((error) => (error ? reject(error) : resolve()));
    });
  });
}

function captureStructuredLogs(child: ChildProcess, logRoot: string): Promise<void> {
  const output = createWriteStream(path.join(logRoot, "plugin-host.jsonl"), {
    encoding: "utf8",
    flags: "a",
  });
  const pending: Record<"stderr" | "stdout", string> = { stderr: "", stdout: "" };

  const attach = (streamName: "stderr" | "stdout", stream: Readable | null) => {
    stream?.on("data", (chunk: Buffer | string) => {
      pending[streamName] += chunk.toString();
      const lines = pending[streamName].split(/\r?\n/);
      pending[streamName] = lines.pop() ?? "";
      for (const line of lines) writeStructuredLine(output, streamName, line);
    });
  };
  attach("stdout", child.stdout);
  attach("stderr", child.stderr);

  return new Promise((resolve) => {
    child.once("close", () => {
      for (const streamName of ["stdout", "stderr"] as const) {
        if (pending[streamName]) {
          writeStructuredLine(output, streamName, pending[streamName]);
        }
      }
      output.end(resolve);
    });
  });
}

function writeStructuredLine(
  output: NodeJS.WritableStream,
  stream: "stderr" | "stdout",
  line: string,
): void {
  if (!line) return;
  const message = /\b(?:proxy-authorization|authorization|set-cookie|cookie)\b/i.test(
    line,
  )
    ? "[REDACTED]"
    : line.length > 4_096
      ? `${line.slice(0, 4_096)} [TRUNCATED]`
      : line;
  output.write(
    `${JSON.stringify({
      component: "plugin-host",
      message,
      stream,
      timestamp: new Date().toISOString(),
    })}\n`,
  );
}
