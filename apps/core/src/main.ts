import path from "node:path";

import {
  LOCAL_CORE_HOST,
  LOCAL_CORE_PORT,
  type PluginHostStatusResponse,
} from "@comic-free/contracts";

import { createLocalCoreServer } from "./server.ts";
import type { PluginHostManager } from "./plugin-host-manager.ts";
import { createSuwayomiPluginHost } from "./suwayomi-plugin-host.ts";

const dataDirectory = path.resolve(process.env.COMIC_FREE_DATA_DIR ?? ".local-data");
const configuredJarPath = process.env.COMIC_FREE_SUWAYOMI_JAR?.trim();
const approvedSha256 = process.env.COMIC_FREE_SUWAYOMI_APPROVED_SHA256?.trim();
let pluginHost: PluginHostManager | null = null;
let pluginHostFallback = initialPluginHostStatus(configuredJarPath, approvedSha256);

if (configuredJarPath && approvedSha256) {
  try {
    pluginHost = await createSuwayomiPluginHost({
      approvedArtifactSha256: approvedSha256,
      dataRoot: path.join(dataDirectory, "suwayomi", "managed"),
      internalPort: Number.parseInt(process.env.COMIC_FREE_SUWAYOMI_PORT ?? "4568", 10),
      jarPath: configuredJarPath,
    });
  } catch (error) {
    pluginHostFallback = {
      apiVersion: "v1",
      internalPort: null,
      message: safeErrorMessage(error, "The Plugin Host configuration is invalid."),
      retryable: false,
      state: "invalid_path",
    };
  }
}

const server = createLocalCoreServer({
  pluginHostStatus: () => pluginHost?.status() ?? pluginHostFallback,
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Local Core could not start: port ${LOCAL_CORE_PORT} is already in use on ${LOCAL_CORE_HOST}.`,
    );
  } else {
    console.error(`Local Core could not start: ${error.message}`);
  }
  process.exitCode = 1;
});

server.listen({ host: LOCAL_CORE_HOST, port: LOCAL_CORE_PORT, exclusive: true }, () => {
  console.log(`Listening on http://${LOCAL_CORE_HOST}:${LOCAL_CORE_PORT}`);
  void pluginHost?.start().catch((error: unknown) => {
    writeLocalCoreFailure("plugin_host_start_failed", error);
  });
});

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  let exitCode = 0;
  try {
    await pluginHost?.stop();
  } catch (error) {
    exitCode = 1;
    writeLocalCoreFailure("plugin_host_shutdown_failed", error);
  }
  server.close(() => process.exit(exitCode));
};
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());

function initialPluginHostStatus(
  jarPath: string | undefined,
  digest: string | undefined,
): PluginHostStatusResponse {
  if (!jarPath && !digest) {
    return {
      apiVersion: "v1",
      internalPort: null,
      message: "No approved Suwayomi JAR is configured.",
      retryable: false,
      state: "not_configured",
    };
  }
  if (!jarPath || !digest) {
    return {
      apiVersion: "v1",
      internalPort: null,
      message: "Both the Suwayomi JAR path and its approved SHA-256 are required.",
      retryable: false,
      state: "invalid_path",
    };
  }
  return {
    apiVersion: "v1",
    internalPort: null,
    message: "Preparing the approved Suwayomi Plugin Host.",
    retryable: false,
    state: "starting",
  };
}

function safeErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  return message.replace(
    /\b((?:proxy-)?authorization|cookie|set-cookie)\s*:\s*.*$/gi,
    "$1: [REDACTED]",
  );
}

function writeLocalCoreFailure(event: string, error: unknown): void {
  console.error(
    JSON.stringify({
      component: "local-core",
      event,
      message: safeErrorMessage(error, "Unknown Local Core failure."),
      timestamp: new Date().toISOString(),
    }),
  );
}
