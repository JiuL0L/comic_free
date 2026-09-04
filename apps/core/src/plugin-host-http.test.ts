import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import path from "node:path";

import {
  PLUGIN_HOST_STATUS_PATH,
  parsePluginHostStatusResponse,
} from "@comic-free/contracts";

import { FixtureCatalogAdapter } from "./catalog-adapter.ts";
import { CatalogStore } from "./catalog-store.ts";
import { createLocalCoreServer } from "./server.ts";

const OUTPUT_ROOT = path.resolve(
  import.meta.dirname,
  "../../../.local-data/test-output/04-manage-suwayomi-safely",
);

test("the Local Core exposes Plugin Host readiness without exposing GraphQL", async () => {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const testRoot = await mkdtemp(path.join(OUTPUT_ROOT, "http-"));
  const catalogStore = new CatalogStore(path.join(testRoot, "comic-free.sqlite"));
  const server = createLocalCoreServer({
    adapter: new FixtureCatalogAdapter(),
    catalogStore,
    pluginHostStatus: () => ({
      apiVersion: "v1",
      internalPort: 4568,
      message: "Suwayomi is ready.",
      retryable: false,
      state: "ready",
    }),
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert(address && typeof address === "object");
    const response = await fetch(
      `http://127.0.0.1:${address.port}${PLUGIN_HOST_STATUS_PATH}`,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(parsePluginHostStatusResponse(await response.json()), {
      apiVersion: "v1",
      internalPort: 4568,
      message: "Suwayomi is ready.",
      retryable: false,
      state: "ready",
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    catalogStore.close();
    await rm(testRoot, { force: true, recursive: true });
  }
});
