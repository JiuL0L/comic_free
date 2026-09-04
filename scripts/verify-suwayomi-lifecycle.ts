import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { createSuwayomiPluginHost } from "../apps/core/src/suwayomi-plugin-host.ts";

const jarPath = process.env.COMIC_FREE_SUWAYOMI_JAR?.trim();
const approvedArtifactSha256 =
  process.env.COMIC_FREE_SUWAYOMI_APPROVED_SHA256?.trim();
if (!jarPath || !approvedArtifactSha256) {
  throw new Error(
    "Set COMIC_FREE_SUWAYOMI_JAR and COMIC_FREE_SUWAYOMI_APPROVED_SHA256 " +
      "to an explicitly approved local artifact before running this opt-in check.",
  );
}

const internalPort = Number.parseInt(
  process.env.COMIC_FREE_SUWAYOMI_PORT ?? "4568",
  10,
);
const dataRoot = path.resolve(
  process.env.COMIC_FREE_SUWAYOMI_LIFECYCLE_DATA_DIR ??
    ".local-data/test-output/04-manage-suwayomi-safely/real-suwayomi",
);
const graphqlUrl = `http://127.0.0.1:${internalPort}/api/graphql`;

const observations: Array<Record<string, unknown>> = [];
for (let run = 1; run <= 2; run += 1) {
  const manager = await createSuwayomiPluginHost({
    approvedArtifactSha256,
    dataRoot,
    internalPort,
    jarPath,
  });
  try {
    await manager.start();
    const databaseProbe = await graphql(
      graphqlUrl,
      "query ComicFreeDatabaseProbe { mangas(first: 1) { totalCount } }",
    );
    observations.push({
      databaseProbe,
      ready: manager.status(),
      run,
    });
  } finally {
    await manager.stop();
  }

  const databaseFiles = await findFiles(dataRoot, /\.mv\.db$/i);
  const lockFiles = await findFiles(dataRoot, /\.lock\.db$/i);
  if (databaseFiles.length === 0) {
    throw new Error("Suwayomi reached readiness but no H2 database file was created.");
  }
  if (lockFiles.length !== 0) {
    throw new Error(`H2 lock files remained after application shutdown: ${lockFiles.join(", ")}`);
  }
  observations.at(-1)!.databaseFiles = await Promise.all(
    databaseFiles.map(async (file) => ({
      bytes: (await stat(file)).size,
      path: path.relative(dataRoot, file),
    })),
  );
  observations.at(-1)!.stopped = manager.status();
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
      result: "database-safe shutdown and clean H2 reopen verified",
    },
    null,
    2,
  ),
);

async function graphql(url: string, query: string): Promise<unknown> {
  const response = await fetch(url, {
    body: JSON.stringify({ query }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(5_000),
  });
  const body = (await response.json()) as {
    data?: unknown;
    errors?: Array<{ message?: unknown }>;
  };
  if (!response.ok || body.errors?.length || body.data === undefined) {
    const messages = body.errors?.map((error) => String(error.message)).join("; ");
    throw new Error(
      `Suwayomi database probe failed with HTTP ${response.status}: ${messages ?? "no data"}`,
    );
  }
  return body.data;
}

async function findFiles(root: string, pattern: RegExp): Promise<string[]> {
  const result: string[] = [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...(await findFiles(entryPath, pattern)));
    if (entry.isFile() && pattern.test(entry.name)) result.push(entryPath);
  }
  return result;
}
