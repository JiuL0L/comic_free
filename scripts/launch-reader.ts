import { access } from "node:fs/promises";
import { spawn, type SpawnOptions } from "node:child_process";
import path from "node:path";

import {
  CORE_HEALTH_URL,
  parseHealthResponse,
  parseSettingsResponse,
  SETTINGS_URL,
  WEB_UI_URL,
} from "@comic-free/contracts";

import { loadEffectiveSettings } from "../apps/core/src/settings.ts";
import { startDevelopment, type DevelopmentController } from "./dev-supervisor.ts";

export const REQUIRED_NODE_MAJOR = 26;
export const REQUIRED_PNPM_MAJOR = 10;
export const REQUIRED_JAVA_MAJOR = 21;

export interface CommandResult {
  output: string;
}

export type CommandRunner = (command: string, args: readonly string[]) => Promise<CommandResult>;

export interface LaunchPrerequisiteOptions {
  commandRunner?: CommandRunner;
  nodeVersion?: string;
}

export interface HostPrerequisiteOptions {
  commandRunner?: CommandRunner;
  fileExists?: (filePath: string) => Promise<void>;
  jarPath: string | null;
}

export interface ReaderLaunchDependencies {
  commandRunner?: CommandRunner;
  fetch?: typeof globalThis.fetch;
  fileExists?: (filePath: string) => Promise<void>;
  nodeVersion?: string;
  openBrowser?: () => void;
  reportWarning?: (message: string) => void;
  startDevelopment?: (root: string, env: NodeJS.ProcessEnv) => Promise<DevelopmentController>;
}

function majorVersion(value: string, label: string): number {
  const match = value.match(/(?:^|[\s\"v])(\d+)(?:\.|\s|\")/i);
  if (!match?.[1]) {
    throw new Error(`Could not determine ${label} version from "${value.trim()}".`);
  }
  return Number.parseInt(match[1], 10);
}

function assertMajorVersion(value: string, expected: number, label: string): void {
  const major = majorVersion(value, label);
  if (major !== expected) {
    throw new Error(`${label} ${expected}.x is required; found ${value.trim() || "an unknown version"}.`);
  }
}

export const runCommand: CommandRunner = (command, args) => new Promise((resolve, reject) => {
  const isWindowsCommandScript = process.platform === "win32" && command.toLowerCase().endsWith(".cmd");
  const executable = isWindowsCommandScript ? (process.env.ComSpec ?? "cmd.exe") : command;
  const commandArgs = isWindowsCommandScript ? ["/d", "/s", "/c", command, ...args] : [...args];
  const child = spawn(executable, commandArgs, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  child.once("error", (error) => reject(new Error(`Could not run ${command}: ${error.message}`)));
  child.once("exit", (code) => {
    if (code === 0) {
      resolve({ output });
      return;
    }
    reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}.`));
  });
});

export async function verifyLaunchPrerequisites({
  commandRunner = runCommand,
  nodeVersion = process.versions.node,
}: LaunchPrerequisiteOptions): Promise<void> {
  assertMajorVersion(nodeVersion, REQUIRED_NODE_MAJOR, "Node.js");
  const pnpm = await commandRunner(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["--version"]);
  assertMajorVersion(pnpm.output, REQUIRED_PNPM_MAJOR, "pnpm");
}

export async function verifyConfiguredHostPrerequisites({
  commandRunner = runCommand,
  fileExists = access,
  jarPath,
}: HostPrerequisiteOptions): Promise<void> {
  if (!jarPath) {
    throw new Error("A configured Suwayomi Plugin Host requires a JAR path.");
  }
  await fileExists(jarPath);

  const [java, javac, jar] = await Promise.all([
    commandRunner("java", ["-version"]),
    commandRunner("javac", ["-version"]),
    commandRunner("jar", ["--version"]),
  ]);
  assertMajorVersion(java.output, REQUIRED_JAVA_MAJOR, "Java");
  assertMajorVersion(javac.output, REQUIRED_JAVA_MAJOR, "javac");
  assertMajorVersion(jar.output, REQUIRED_JAVA_MAJOR, "jar");
}

export async function hasReadyComicFree(
  request: typeof globalThis.fetch = globalThis.fetch,
): Promise<boolean> {
  try {
    const signal = AbortSignal.timeout(2_000);
    const [core, settings, web] = await Promise.all([
      request(CORE_HEALTH_URL, { signal }),
      request(SETTINGS_URL, { signal }),
      request(WEB_UI_URL, { signal }),
    ]);
    if (!core.ok || !settings.ok || !web.ok) return false;
    parseHealthResponse(await core.json());
    parseSettingsResponse(await settings.json());
    return true;
  } catch {
    return false;
  }
}

/** Opens only the fixed local WebUI origin; no user-controlled text enters cmd.exe. */
export function openDefaultBrowser(): void {
  if (process.platform !== "win32") {
    throw new Error("Start-Comic-Free.cmd is supported on Windows only.");
  }
  const options: SpawnOptions = {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  };
  const browser = spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "start", "", WEB_UI_URL], options);
  browser.once("error", (error) => {
    console.error(`Comic Free is ready, but the default browser could not be opened: ${error.message}`);
  });
  browser.unref();
}

export async function launchReader(
  root = path.resolve(import.meta.dirname, ".."),
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: ReaderLaunchDependencies = {},
): Promise<"existing" | "started"> {
  const dataDirectory = path.resolve(root, environment.COMIC_FREE_DATA_DIR?.trim() || ".local-data");
  const { effectiveSettings } = await loadEffectiveSettings(dataDirectory, environment);
  const hostConfigured = Boolean(effectiveSettings.jarPath || effectiveSettings.approvedSha256);
  await verifyLaunchPrerequisites({
    ...(dependencies.commandRunner ? { commandRunner: dependencies.commandRunner } : {}),
    ...(dependencies.nodeVersion ? { nodeVersion: dependencies.nodeVersion } : {}),
  });
  if (hostConfigured) {
    try {
      await verifyConfiguredHostPrerequisites({
        ...(dependencies.commandRunner ? { commandRunner: dependencies.commandRunner } : {}),
        ...(dependencies.fileExists ? { fileExists: dependencies.fileExists } : {}),
        jarPath: effectiveSettings.jarPath,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The configured Plugin Host prerequisites could not be checked.";
      (dependencies.reportWarning ?? console.warn)(
        `Plugin Host preflight warning: ${message} Comic Free will open Settings so you can correct this configuration.`,
      );
    }
  }

  const openBrowser = dependencies.openBrowser ?? openDefaultBrowser;
  if (await hasReadyComicFree(dependencies.fetch)) {
    openBrowser();
    return "existing";
  }

  const controller = await (dependencies.startDevelopment ?? startDevelopment)(root, {
    ...environment,
    COMIC_FREE_DATA_DIR: dataDirectory,
  });
  openBrowser();

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () => shutdownPromise ??= controller.stop();
  const requestShutdown = () => void shutdown().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(`Comic Free shutdown failed: ${error instanceof Error ? error.message : "Unknown shutdown failure."}`);
      process.exit(1);
    },
  );
  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);
  process.on("message", (message) => {
    if (message === "shutdown") requestShutdown();
  });

  try {
    await controller.unexpectedExit;
    return "started";
  } catch (error) {
    await shutdown().catch((cleanupError: unknown) => {
      console.error(`Comic Free cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : "Unknown cleanup failure."}`);
    });
    throw error;
  }
}

async function main(): Promise<void> {
  const outcome = await launchReader();
  if (outcome === "existing") {
    console.log(`Comic Free is already ready: ${WEB_UI_URL}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown startup failure.";
    console.error(`Comic Free startup failed: ${message}`);
    process.exitCode = 1;
  });
}
