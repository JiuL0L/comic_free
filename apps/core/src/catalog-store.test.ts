import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import path from "node:path";

import { CatalogStore } from "./catalog-store.ts";

const OUTPUT_ROOT = path.resolve(
  import.meta.dirname,
  "../../../.local-data/test-output/03-source-plugin-catalog",
);

async function temporaryDatabase(): Promise<{ databasePath: string; remove: () => Promise<void> }> {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const directory = await mkdtemp(path.join(OUTPUT_ROOT, "store-"));
  const relative = path.relative(OUTPUT_ROOT, directory);
  assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative));

  return {
    databasePath: path.join(directory, "comic-free.sqlite"),
    remove: () => rm(directory, { recursive: true, force: true }),
  };
}

test("a failed refresh retains the Last Known Catalog across a SQLite reopen", async () => {
  const temporary = await temporaryDatabase();

  try {
    const store = new CatalogStore(temporary.databasePath);
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
    store.recordFailedRefresh({
      observedAt: "2026-09-04T12:05:00.000Z",
      reasonCode: "plugin_host_unavailable",
      message: "The Plugin Host is not running.",
    });
    store.close();

    const reopened = new CatalogStore(temporary.databasePath);
    assert.deepEqual(reopened.readCatalog(), {
      entries: [
        {
          pluginKey: "fixture:reader",
          name: "Fixture Reader",
          version: "1.0.0",
          status: "healthy",
          reasonCode: null,
          observedAt: "2026-09-04T12:00:00.000Z",
          bindingsRefreshRequired: false,
        },
      ],
      lastRefresh: {
        status: "failed",
        observedAt: "2026-09-04T12:05:00.000Z",
        reasonCode: "plugin_host_unavailable",
        message: "The Plugin Host is not running.",
      },
    });
    reopened.close();
  } finally {
    await temporary.remove();
  }
});

test("only confirmed evidence removes a plugin and recovery requires binding refresh", async () => {
  const temporary = await temporaryDatabase();

  try {
    const store = new CatalogStore(temporary.databasePath);
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
    store.recordSuccessfulRefresh({
      observedAt: "2026-09-04T12:02:00.000Z",
      entries: [],
    });
    assert.equal(store.readCatalog().entries[0]?.status, "healthy");

    store.recordSuccessfulRefresh({
      observedAt: "2026-09-04T12:05:00.000Z",
      entries: [
        {
          pluginKey: "fixture:reader",
          name: "Fixture Reader",
          version: "1.0.0",
          status: "missing",
          reasonCode: "missing",
          removalEvidence: "none",
          reportedObsolete: true,
        },
      ],
    });
    assert.equal(store.readCatalog().entries[0]?.status, "missing");

    store.recordSuccessfulRefresh({
      observedAt: "2026-09-04T12:10:00.000Z",
      entries: [
        {
          pluginKey: "fixture:reader",
          name: "Fixture Reader",
          version: "1.0.0",
          status: "missing",
          reasonCode: "missing",
          removalEvidence: "confirmed",
          reportedObsolete: true,
        },
      ],
    });
    assert.equal(store.readCatalog().entries[0]?.status, "confirmed_removed");

    store.recordSuccessfulRefresh({
      observedAt: "2026-09-04T12:15:00.000Z",
      entries: [
        {
          pluginKey: "fixture:reader",
          name: "Fixture Reader",
          version: "1.0.1",
          status: "healthy",
          reasonCode: null,
          removalEvidence: "none",
          reportedObsolete: true,
        },
      ],
    });
    assert.deepEqual(store.readCatalog().entries[0], {
      pluginKey: "fixture:reader",
      name: "Fixture Reader",
      version: "1.0.1",
      status: "healthy",
      reasonCode: null,
      observedAt: "2026-09-04T12:15:00.000Z",
      bindingsRefreshRequired: true,
    });
    store.close();
  } finally {
    await temporary.remove();
  }
});
