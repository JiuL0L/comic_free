import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  SOURCE_PLUGIN_CHANGES_PATH,
  parseErrorResponse,
  parseSourcePluginChangeResponse,
} from "@comic-free/contracts";

import { FixtureCatalogAdapter } from "./catalog-adapter.ts";
import { CatalogStore } from "./catalog-store.ts";
import { ReadingStore } from "./reading-store.ts";
import { createLocalCoreServer } from "./server.ts";
import {
  FixtureSourcePluginChangeAdapter,
  SourcePluginChangeService,
} from "./source-plugin-change.ts";

const OUTPUT_ROOT = path.resolve(
  import.meta.dirname,
  "../../../.local-data/test-output/06-source-plugin-changes",
);

test("the Local Core enforces approval and exposes safe Source Plugin change outcomes", async () => {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const directory = await mkdtemp(path.join(OUTPUT_ROOT, "http-"));
  const relative = path.relative(OUTPUT_ROOT, directory);
  assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  const databasePath = path.join(directory, "comic-free.sqlite");
  const catalogStore = new CatalogStore(databasePath);
  const readingStore = new ReadingStore(databasePath);
  const sourcePluginChangeService = new SourcePluginChangeService(
    new FixtureSourcePluginChangeAdapter(),
    catalogStore,
    { logger: () => undefined },
  );
  const server = createLocalCoreServer({
    adapter: new FixtureCatalogAdapter(),
    catalogStore,
    sourcePluginChangeService,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}${SOURCE_PLUGIN_CHANGES_PATH}`;
    const source = {
      expectedVersion: "1.0.0",
      kind: "extension_store",
      packageName: "fixture:reader",
      storeUrl: "https://fixtures.comic-free.invalid/repo/index.pb",
    };

    const unapproved = await fetch(url, {
      body: JSON.stringify({ action: "install", approval: { approved: false }, source }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(unapproved.status, 400);
    assert.match(parseErrorResponse(await unapproved.json()).error.message, /approval/i);

    const installed = await fetch(url, {
      body: JSON.stringify({ action: "install", approval: { approved: true }, source }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(installed.status, 200);
    const response = parseSourcePluginChangeResponse(await installed.json());
    assert.equal(response.change.plugin.status, "healthy");
    assert.equal(response.change.plugin.providers[0]?.key, "fixture.provider");

    const missing = await fetch(url, {
      body: JSON.stringify({
        action: "install",
        approval: { approved: true },
        source: { ...source, packageName: "missing.secret=must-not-leak" },
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(missing.status, 404);
    const missingError = parseErrorResponse(await missing.json()).error;
    assert.equal(missingError.code, "source_plugin_not_found");
    assert.equal(JSON.stringify(missingError).includes("must-not-leak"), false);

    const unsupported = await fetch(url);
    assert.equal(unsupported.status, 405);
    assert.equal(unsupported.headers.get("allow"), "POST");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    readingStore.close();
    catalogStore.close();
    await rm(directory, { recursive: true, force: true });
  }
});
