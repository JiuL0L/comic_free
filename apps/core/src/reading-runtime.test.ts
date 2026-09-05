import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { PluginHostStatusResponse } from "@comic-free/contracts";

import { CatalogStore } from "./catalog-store.ts";
import { ReadingStore } from "./reading-store.ts";
import { createReadingRuntime } from "./reading-runtime.ts";
import { createLocalCoreServer } from "./server.ts";

const PACKAGE_NAME = "eu.kanade.tachiyomi.extension.all.mangadex";
const STORE_URL = "https://extensions.example/repo/index.pb";
const PROVIDER = { key: "provider:v1:MangaDex:en", language: "en", name: "MangaDex" };

test("Host discovery refreshes persisted plugin metadata when its providers are unchanged", async () => {
  const testTempRoot = path.resolve(os.tmpdir());
  const tempDirectory = mkdtempSync(path.join(testTempRoot, "comic-free-runtime-"));
  const relativeTempDirectory = path.relative(testTempRoot, tempDirectory);
  assert(relativeTempDirectory && !relativeTempDirectory.startsWith("..") && !path.isAbsolute(relativeTempDirectory));
  const database = path.join(tempDirectory, "state.sqlite");
  const catalogStore = new CatalogStore(database);
  const readingStore = new ReadingStore(database);
  catalogStore.recordPluginChange({
    bindingsRefreshRequired: false,
    name: "MangaDex (old)",
    observedAt: "2026-09-05T12:00:00.000Z",
    pluginKey: PACKAGE_NAME,
    providers: [PROVIDER],
    reasonCode: null,
    status: "healthy",
    version: "1.4.212",
  }, STORE_URL, "install");

  let observedName = "MangaDex";
  let observedVersion = "1.4.212";
  const pluginHost = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { query: string };
    assert.match(body.query, /ComicFreeInstalledProviders/);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: { extensions: { nodes: [{
      hasUpdate: false,
      isInstalled: true,
      isObsolete: false,
      name: observedName,
      pkgName: PACKAGE_NAME,
      source: { nodes: [{ id: "2499283573021220255", lang: "en", name: "MangaDex" }], totalCount: 1 },
      storeIndexUrl: STORE_URL,
      versionName: observedVersion,
    }], totalCount: 1 } } }));
  });

  await new Promise<void>((resolve, reject) => { pluginHost.once("error", reject); pluginHost.listen(0, "127.0.0.1", resolve); });
  const hostAddress = pluginHost.address();
  assert(hostAddress && typeof hostAddress === "object");
  const pluginHostStatus = (): PluginHostStatusResponse => ({ apiVersion: "v1", internalPort: hostAddress.port, message: "Ready.", retryable: false, state: "ready" });
  const runtime = createReadingRuntime({ catalogStore, readingStore, pluginHostStatus });
  const core = createLocalCoreServer({ catalogStore, ...runtime });

  try {
    await new Promise<void>(resolve => core.listen(0, "127.0.0.1", resolve));
    const address = core.address();
    assert(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;

    assert.equal((await fetch(`${origin}/api/v1/reading/providers`)).status, 200);
    let catalog = await fetch(`${origin}/api/v1/source-plugins`);
    assert.equal(catalog.status, 200);
    let entry = (await catalog.json()).entries[0];
    assert.equal(entry.name, "MangaDex");
    assert.equal(entry.version, "1.4.212");

    observedVersion = "1.4.213";
    assert.equal((await fetch(`${origin}/api/v1/reading/providers`)).status, 200);
    catalog = await fetch(`${origin}/api/v1/source-plugins`);
    assert.equal(catalog.status, 200);
    entry = (await catalog.json()).entries[0];
    assert.equal(entry.name, "MangaDex");
    assert.equal(entry.version, "1.4.213");
  } finally {
    await new Promise<void>(resolve => core.close(() => resolve()));
    await new Promise<void>(resolve => pluginHost.close(() => resolve()));
    readingStore.close();
    catalogStore.close();
    const cleanupDirectory = path.resolve(tempDirectory);
    const cleanupRelative = path.relative(testTempRoot, cleanupDirectory);
    assert(path.isAbsolute(cleanupDirectory) && cleanupRelative && !cleanupRelative.startsWith("..") && !path.isAbsolute(cleanupRelative));
    rmSync(cleanupDirectory, { force: true, recursive: true });
  }
});
