import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import path from "node:path";

import { CatalogStore } from "./catalog-store.ts";
import { ReadingStore } from "./reading-store.ts";

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
          providers: [
            { key: "fixture.provider", language: "en", name: "Fixture Provider" },
          ],
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
          providers: [
            { key: "fixture.provider", language: "en", name: "Fixture Provider" },
          ],
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
          providers: [
            { key: "fixture.provider", language: "en", name: "Fixture Provider" },
          ],
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
      providers: [
        { key: "fixture.provider", language: "en", name: "Fixture Provider" },
      ],
    });
    store.close();
  } finally {
    await temporary.remove();
  }
});

test("a Source Plugin change updates one entry without overwriting refresh failure evidence", async () => {
  const temporary = await temporaryDatabase();
  const store = new CatalogStore(temporary.databasePath);

  try {
    store.recordFailedRefresh({
      message: "The retained catalog could not be refreshed.",
      observedAt: "2026-09-04T12:00:00.000Z",
      reasonCode: "refresh_failed",
    });

    store.recordPluginChange({
      bindingsRefreshRequired: true,
      name: "MangaDex",
      observedAt: "2026-09-04T12:05:00.000Z",
      pluginKey: "eu.kanade.tachiyomi.extension.all.mangadex",
      providers: [
        { key: "2499283573021220255", language: "en", name: "MangaDex" },
      ],
      reasonCode: null,
      status: "healthy",
      version: "1.4.212",
    }, "https://extensions.example/repo/index.pb", "update");

    assert.deepEqual(store.readCatalog(), {
      entries: [
        {
          bindingsRefreshRequired: true,
          name: "MangaDex",
          observedAt: "2026-09-04T12:05:00.000Z",
          pluginKey: "eu.kanade.tachiyomi.extension.all.mangadex",
          providers: [
            { key: "2499283573021220255", language: "en", name: "MangaDex" },
          ],
          reasonCode: null,
          status: "healthy",
          version: "1.4.212",
        },
      ],
      lastRefresh: {
        message: "The retained catalog could not be refreshed.",
        observedAt: "2026-09-04T12:00:00.000Z",
        reasonCode: "refresh_failed",
        status: "failed",
      },
    });
  } finally {
    store.close();
    await temporary.remove();
  }
});

test("catalog refresh cannot clear an explicitly approved local disable", async () => {
  const temporary = await temporaryDatabase();
  const store = new CatalogStore(temporary.databasePath);
  const readingStore = new ReadingStore(temporary.databasePath);
  const storeUrl = "https://fixtures.comic-free.invalid/repo/index.pb";

  try {
    const retained = readingStore.retain({
      chapterKey: "chapter/one",
      chapterLabel: "Chapter 1",
      comicKey: "comic/retained",
      comicProviderKey: "fixture.provider",
      coverRef: "fixture-cover/retained",
      pageCount: 3,
      pageIndex: 1,
      sourcePluginKey: "fixture:reader",
      title: "Retained Comic",
    });
    const healthy = {
      bindingsRefreshRequired: false,
      name: "Fixture Reader",
      observedAt: "2026-09-04T12:00:00.000Z",
      pluginKey: "fixture:reader",
      providers: [
        { key: "fixture.provider", language: "en", name: "Fixture Provider" },
      ],
      reasonCode: null,
      status: "healthy" as const,
      version: "1.0.0",
    };
    store.recordPluginChange(healthy, storeUrl, "install");
    store.recordPluginChange(
      {
        ...healthy,
        observedAt: "2026-09-04T12:01:00.000Z",
        reasonCode: "disabled",
        status: "disabled",
      },
      storeUrl,
      "disable",
    );
    store.recordSuccessfulRefresh({
      observedAt: "2026-09-04T12:02:00.000Z",
      entries: [
        {
          name: healthy.name,
          pluginKey: healthy.pluginKey,
          providers: healthy.providers,
          reasonCode: null,
          removalEvidence: "none",
          reportedObsolete: false,
          status: "healthy",
          version: healthy.version,
        },
      ],
    });
    assert.equal(store.readCatalog().entries[0]?.status, "disabled");

    store.recordPluginChange(
      {
        ...healthy,
        bindingsRefreshRequired: true,
        observedAt: "2026-09-04T12:02:30.000Z",
      },
      storeUrl,
      "update",
    );
    assert.equal(store.readCatalog().entries[0]?.status, "disabled");

    store.recordSuccessfulRefresh({
      observedAt: "2026-09-04T12:02:40.000Z",
      entries: [
        {
          name: healthy.name,
          pluginKey: healthy.pluginKey,
          providers: healthy.providers,
          reasonCode: "missing",
          removalEvidence: "confirmed",
          reportedObsolete: true,
          status: "missing",
          version: healthy.version,
        },
      ],
    });
    assert.equal(store.readCatalog().entries[0]?.status, "confirmed_removed");
    assert.equal(readingStore.get(retained.id)?.sourceBinding.reasonCode, "missing");

    store.recordPluginChange(
      {
        ...healthy,
        observedAt: "2026-09-04T12:02:45.000Z",
        reasonCode: "disabled",
        status: "disabled",
      },
      storeUrl,
      "disable",
    );
    assert.equal(store.readCatalog().entries[0]?.status, "confirmed_removed");
    assert.equal(readingStore.get(retained.id)?.sourceBinding.reasonCode, "missing");

    store.recordSuccessfulRefresh({
      observedAt: "2026-09-04T12:02:50.000Z",
      entries: [
        {
          name: healthy.name,
          pluginKey: healthy.pluginKey,
          providers: healthy.providers,
          reasonCode: null,
          removalEvidence: "none",
          reportedObsolete: false,
          status: "healthy",
          version: healthy.version,
        },
      ],
    });
    assert.equal(store.readCatalog().entries[0]?.status, "disabled");

    store.recordPluginChange(
      {
        ...healthy,
        bindingsRefreshRequired: true,
        observedAt: "2026-09-04T12:03:00.000Z",
      },
      storeUrl,
      "restore",
    );
    assert.equal(store.readCatalog().entries[0]?.status, "healthy");
  } finally {
    readingStore.close();
    store.close();
    await temporary.remove();
  }
});

test("catalog and Source Binding changes roll back together", async () => {
  const temporary = await temporaryDatabase();
  const catalogStore = new CatalogStore(temporary.databasePath);
  const readingStore = new ReadingStore(
    temporary.databasePath,
    () => "2026-09-04T12:00:00.000Z",
  );

  try {
    const retained = readingStore.retain({
      chapterKey: "chapter/one",
      chapterLabel: "Chapter 1",
      comicKey: "comic/retained",
      comicProviderKey: "fixture.provider",
      coverRef: "fixture-cover/retained",
      pageCount: 3,
      pageIndex: 1,
      sourcePluginKey: "fixture:reader",
      title: "Retained Comic",
    });
    catalogStore.recordPluginChange(
      {
        bindingsRefreshRequired: false,
        name: "Fixture Reader",
        observedAt: "2026-09-04T12:01:00.000Z",
        pluginKey: "fixture:reader",
        providers: [],
        reasonCode: null,
        status: "healthy",
        version: "1.0.0",
      },
      "https://fixtures.comic-free.invalid/repo/index.pb",
      "install",
    );
    const database = new DatabaseSync(temporary.databasePath);
    database.exec(`
      CREATE TRIGGER reject_plugin_binding_change
      BEFORE UPDATE ON source_bindings
      BEGIN
        SELECT RAISE(ABORT, 'fixture binding rollback');
      END;
    `);
    database.close();

    assert.throws(
      () =>
        catalogStore.recordPluginChange({
          bindingsRefreshRequired: false,
          name: "Fixture Reader",
          observedAt: "2026-09-04T12:05:00.000Z",
          pluginKey: "fixture:reader",
          providers: [],
          reasonCode: "disabled",
          status: "disabled",
          version: "1.0.0",
        }, "https://fixtures.comic-free.invalid/repo/index.pb", "disable"),
      /fixture binding rollback/,
    );
    assert.equal(catalogStore.readCatalog().entries[0]?.status, "healthy");
    assert.deepEqual(readingStore.get(retained.id), retained);
  } finally {
    readingStore.close();
    catalogStore.close();
    await temporary.remove();
  }
});
