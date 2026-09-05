import path from "node:path";

import { parseSourcePluginChangeRequest } from "@comic-free/contracts";

import { createSuwayomiPluginHost } from "../apps/core/src/suwayomi-plugin-host.ts";
import { SuwayomiSourcePluginChangeAdapter } from "../apps/core/src/suwayomi-source-plugin-change.ts";

const approved = process.env.COMIC_FREE_SOURCE_PLUGIN_CHANGE_APPROVED === "true";
const jarPath = process.env.COMIC_FREE_SUWAYOMI_JAR?.trim();
const approvedArtifactSha256 =
  process.env.COMIC_FREE_SUWAYOMI_APPROVED_SHA256?.trim();
const storeUrl = process.env.COMIC_FREE_SOURCE_PLUGIN_STORE_URL?.trim();
const packageName = process.env.COMIC_FREE_SOURCE_PLUGIN_PACKAGE?.trim();
const expectedVersion = process.env.COMIC_FREE_SOURCE_PLUGIN_VERSION?.trim();
const proxyUrl = process.env.COMIC_FREE_SUWAYOMI_PROXY?.trim();

if (
  !approved ||
  !jarPath ||
  !approvedArtifactSha256 ||
  !storeUrl ||
  !packageName ||
  !expectedVersion
) {
  throw new Error(
    "This opt-in check requires COMIC_FREE_SOURCE_PLUGIN_CHANGE_APPROVED=true plus " +
      "the exact Suwayomi JAR path/SHA-256, extension store URL, package, and version. " +
      "Set them only after the user explicitly approves that named third-party code operation.",
  );
}

const internalPort = Number.parseInt(
  process.env.COMIC_FREE_SUWAYOMI_PORT ?? "4569",
  10,
);
const dataRoot = path.resolve(
  process.env.COMIC_FREE_SOURCE_PLUGIN_DATA_DIR ??
    ".local-data/test-output/06-source-plugin-changes/real-suwayomi",
);
const request = parseSourcePluginChangeRequest({
  action: "install",
  approval: { approved: true },
  source: {
    expectedVersion,
    kind: "extension_store",
    packageName,
    storeUrl,
  },
});

const observations: Array<Record<string, unknown>> = [];
for (let run = 1; run <= 2; run += 1) {
  const manager = await createSuwayomiPluginHost({
    approvedArtifactSha256,
    dataRoot,
    internalPort,
    jarPath,
    ...(proxyUrl ? { proxyUrl } : {}),
  });
  try {
    await manager.start();
    const adapter = new SuwayomiSourcePluginChangeAdapter(() => manager.status());
    if (run === 1) {
      const result = await adapter.change(request, AbortSignal.timeout(120_000));
      if (
        result.status !== "healthy" ||
        result.version !== expectedVersion ||
        result.providers.length === 0
      ) {
        throw new Error(
          "The approved Source Plugin did not report the expected installed version.",
        );
      }
      observations.push({
        installed: result,
        pluginHost: manager.status(),
        run,
      });
    } else {
      const result = await adapter.inspect(request, AbortSignal.timeout(120_000));
      if (
        !result.installed ||
        result.version !== expectedVersion ||
        result.providers.length === 0
      ) {
        throw new Error(
          "The approved Source Plugin did not survive the required Plugin Host restart.",
        );
      }
      observations.push({
        afterRestart: result,
        pluginHost: manager.status(),
        run,
      });
    }
  } finally {
    await manager.stop();
  }
}

console.log(
  JSON.stringify(
    {
      artifact: {
        approvedSha256: approvedArtifactSha256.toLowerCase(),
        jarPath: path.resolve(jarPath),
      },
      dataRoot,
      observations,
      source: { expectedVersion, packageName, storeUrl },
      result: "approved Source Plugin installation survived a safe Plugin Host restart",
    },
    null,
    2,
  ),
);
