import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";

import {
  CORE_HEALTH_URL,
  LOCAL_CORE_HOST,
  LOCAL_CORE_PORT,
  parseHealthResponse,
  WEB_UI_HOST,
  WEB_UI_PORT,
  WEB_UI_URL,
} from "@comic-free/contracts";

interface WaitForHttpReadyOptions {
  child: ChildProcess;
  name: string;
  timeoutMs: number;
  url: string;
  validate?: (response: Response) => Promise<void>;
}

interface ChildCommand {
  args: string[];
  command: string;
  name: string;
}

export interface DevelopmentController {
  unexpectedExit: Promise<never>;
  stop: () => Promise<void>;
}

function describeExit(code: number | null, signal: NodeJS.Signals | null): string {
  return code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`;
}

export async function ensurePortAvailable(
  name: string,
  host: string,
  port: number,
): Promise<void> {
  const probe = createServer();

  await new Promise<void>((resolve, reject) => {
    probe.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        reject(
          new Error(
            `${name} port ${port} is already in use on ${host}. ` +
              `Stop the process using it, then run pnpm dev again.`,
          ),
        );
        return;
      }

      reject(error);
    });
    probe.listen({ host, port, exclusive: true }, () => {
      probe.close((error) => (error ? reject(error) : resolve()));
    });
  });
}

export function waitForHttpReady({
  child,
  name,
  timeoutMs,
  url,
  validate,
}: WaitForHttpReadyOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    let timer: NodeJS.Timeout | undefined;
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      child.off("exit", onExit);
      error ? reject(error) : resolve();
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(
        new Error(
          `${name} exited before readiness (${describeExit(code, signal)}). ` +
            `Review the ${name} output above, fix the reported cause, and retry.`,
        ),
      );
    };

    const attempt = async () => {
      if (settled) return;

      try {
        const response = await fetch(url);
        if (response.ok) {
          await validate?.(response);
          finish();
          return;
        }
      } catch {
        // Startup races and connection refusals are expected until the deadline.
      }

      if (Date.now() >= deadline) {
        finish(
          new Error(
            `${name} did not become ready within ${timeoutMs} ms at ${url}. ` +
              `Review the ${name} output above and retry.`,
          ),
        );
        return;
      }

      timer = setTimeout(attempt, 100);
    };

    child.once("exit", onExit);
    void attempt();
  });
}

function prefixOutput(child: ChildProcess, name: string): void {
  child.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(`[${name}] ${chunk.toString("utf8")}`);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[${name}] ${chunk.toString("utf8")}`);
  });
}

function startChild(root: string, spec: ChildCommand): ChildProcess {
  const child = spawn(spec.command, spec.args, {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  prefixOutput(child, spec.name);
  return child;
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;

  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill();
  await exited;
}

export async function startDevelopment(
  root = path.resolve(import.meta.dirname, ".."),
): Promise<DevelopmentController> {
  await ensurePortAvailable("Local Core", LOCAL_CORE_HOST, LOCAL_CORE_PORT);
  await ensurePortAvailable("Browser WebUI", WEB_UI_HOST, WEB_UI_PORT);

  const core = startChild(root, {
    name: "Local Core",
    command: process.execPath,
    args: ["--import", "tsx", "apps/core/src/main.ts"],
  });
  let web: ChildProcess | undefined;
  let stopping = false;

  try {
    await waitForHttpReady({
      child: core,
      name: "Local Core",
      timeoutMs: 10_000,
      url: CORE_HEALTH_URL,
      validate: async (response) => {
        parseHealthResponse(await response.json());
      },
    });

    web = startChild(root, {
      name: "Browser WebUI",
      command: process.execPath,
      args: [
        path.join(root, "node_modules", "vite", "bin", "vite.js"),
        "--config",
        path.join(root, "apps", "web", "vite.config.ts"),
      ],
    });

    await waitForHttpReady({
      child: web,
      name: "Browser WebUI",
      timeoutMs: 10_000,
      url: WEB_UI_URL,
    });
  } catch (error) {
    stopping = true;
    await Promise.allSettled([stopChild(core), ...(web ? [stopChild(web)] : [])]);
    throw error;
  }

  let rejectUnexpected!: (error: Error) => void;
  const unexpectedExit = new Promise<never>((_, reject) => {
    rejectUnexpected = reject;
  });
  const reportUnexpectedExit = (name: string) =>
    (code: number | null, signal: NodeJS.Signals | null) => {
      if (!stopping) {
        rejectUnexpected(
          new Error(
            `${name} exited unexpectedly (${describeExit(code, signal)}). ` +
              `Review the ${name} output above, fix the reported cause, and retry.`,
          ),
        );
      }
    };

  core.once("exit", reportUnexpectedExit("Local Core"));
  web.once("exit", reportUnexpectedExit("Browser WebUI"));

  return {
    unexpectedExit,
    stop: async () => {
      if (stopping) return;
      stopping = true;
      await Promise.allSettled([stopChild(web), stopChild(core)]);
    },
  };
}
