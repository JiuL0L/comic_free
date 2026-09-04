import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import path from "node:path";

import {
  SOURCE_PLUGINS_PATH,
  SOURCE_PLUGINS_REFRESH_PATH,
  parseSourcePluginCatalogResponse,
} from "@comic-free/contracts";

import type { CatalogAdapter } from "./catalog-adapter.ts";
import { CatalogStore } from "./catalog-store.ts";
import { createLocalCoreServer } from "./server.ts";

const OUTPUT_ROOT = path.resolve(
  import.meta.dirname,
  "../../../.local-data/test-output/03-source-plugin-catalog",
);

test("the REST boundary retains catalog entries when the next refresh fails", async () => {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const directory = await mkdtemp(path.join(OUTPUT_ROOT, "http-"));
  const relative = path.relative(OUTPUT_ROOT, directory);
  assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative));

  let refreshCount = 0;
  const adapter: CatalogAdapter = {
    refresh: async () => {
      refreshCount += 1;
      if (refreshCount === 1) {
        return {
          outcome: "success",
          observedAt: "2026-09-04T12:00:00.000Z",
          entries: [
            {
              pluginKey: "fixture:reader",
              name: "Fixture Reader",
              version: "1.0.0",
              status: "healthy",
              reasonCode: null,
              removalEvidence: "none",
              reportedObsolete: false,
            },
          ],
        };
      }
      return {
        outcome: "failure",
        observedAt: "2026-09-04T12:05:00.000Z",
        reasonCode: "refresh_failed",
        message: "Catalog refresh failed in the fixture.",
      };
    },
  };
  const store = new CatalogStore(path.join(directory, "comic-free.sqlite"));
  const server = createLocalCoreServer({ adapter, catalogStore: store });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;

    const initial = parseSourcePluginCatalogResponse(
      await (await fetch(`${origin}${SOURCE_PLUGINS_PATH}`)).json(),
    );
    assert.deepEqual(initial, {
      entries: [],
      lastRefresh: {
        status: "never",
        observedAt: null,
        reasonCode: null,
        message: null,
      },
    });

    await fetch(`${origin}${SOURCE_PLUGINS_REFRESH_PATH}`, { method: "POST" });
    const retained = parseSourcePluginCatalogResponse(
      await (
        await fetch(`${origin}${SOURCE_PLUGINS_REFRESH_PATH}`, { method: "POST" })
      ).json(),
    );

    assert.equal(retained.entries.length, 1);
    assert.equal(retained.entries[0]?.status, "healthy");
    assert.equal(retained.lastRefresh.status, "failed");
    assert.equal(retained.lastRefresh.reasonCode, "refresh_failed");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an unexpected adapter error returns an error envelope and keeps the catalog readable", async () => {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const directory = await mkdtemp(path.join(OUTPUT_ROOT, "http-error-"));
  const relative = path.relative(OUTPUT_ROOT, directory);
  assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative));

  const adapter: CatalogAdapter = {
    refresh: async () => {
      throw new Error("fixture secret must not cross the REST boundary");
    },
  };
  const store = new CatalogStore(path.join(directory, "comic-free.sqlite"));
  store.recordSuccessfulRefresh({
    observedAt: "2026-09-04T12:00:00.000Z",
    entries: [
      {
        pluginKey: "fixture:reader",
        name: "Fixture Reader",
        version: "1.0.0",
        status: "healthy",
        reasonCode: null,
        removalEvidence: "none",
        reportedObsolete: false,
      },
    ],
  });
  const server = createLocalCoreServer({ adapter, catalogStore: store });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;

    const failed = await fetch(`${origin}${SOURCE_PLUGINS_REFRESH_PATH}`, {
      method: "POST",
    });
    assert.equal(failed.status, 502);
    assert.deepEqual(await failed.json(), {
      error: {
        code: "source_plugin_refresh_failed",
        message: "The Source Plugin catalog refresh failed unexpectedly.",
        retryable: true,
      },
    });

    const retained = parseSourcePluginCatalogResponse(
      await (await fetch(`${origin}${SOURCE_PLUGINS_PATH}`)).json(),
    );
    assert.equal(retained.entries[0]?.name, "Fixture Reader");
    assert.equal(retained.lastRefresh.status, "failed");
    assert.equal(retained.lastRefresh.reasonCode, "unknown");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
