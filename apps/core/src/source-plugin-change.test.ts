import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type { SourcePluginChangeRequest } from "@comic-free/contracts";

import { CatalogStore } from "./catalog-store.ts";
import {
  FIXTURE_CHAPTER_KEY,
  FIXTURE_COMIC_KEY,
  FixtureReadingAdapter,
} from "./reading-adapter.ts";
import { ReadingService, ReadingServiceError } from "./reading-service.ts";
import { ReadingStore, type RetainContext } from "./reading-store.ts";
import {
  FixtureSourcePluginChangeAdapter,
  SourcePluginChangeError,
  SourcePluginChangeService,
} from "./source-plugin-change.ts";

const TEST_ROOT = path.resolve(
  import.meta.dirname,
  "../../../.local-data/test-output/06-source-plugin-changes",
);
const STORE_URL = "https://fixtures.comic-free.invalid/repo/index.pb";
const PACKAGE_NAME = "fixture:reader";
const FIXED_TIME = "2026-09-04T12:00:00.000Z";
const RETAIN_CONTEXT: RetainContext = {
  chapterKey: "chapter/one",
  chapterLabel: "Chapter 1",
  comicKey: "comic/retained",
  comicProviderKey: "fixture.provider",
  coverRef: "fixture-cover/retained",
  pageCount: 3,
  pageIndex: 1,
  sourcePluginKey: PACKAGE_NAME,
  title: "Retained Comic",
};

function createDirectory(): string {
  mkdirSync(TEST_ROOT, { recursive: true });
  return mkdtempSync(path.join(TEST_ROOT, "service-"));
}

function removeDirectory(directory: string): void {
  const relative = path.relative(TEST_ROOT, path.resolve(directory));
  assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  rmSync(directory, { force: true, recursive: true });
}

function request(
  action: SourcePluginChangeRequest["action"],
  expectedVersion: string | null,
): SourcePluginChangeRequest {
  return {
    action,
    approval: { approved: true },
    source: {
      expectedVersion,
      kind: "extension_store",
      packageName: PACKAGE_NAME,
      storeUrl: STORE_URL,
    },
  };
}

test("fixture adapter covers install, update, disable, and restore without losing reading state", async () => {
  const directory = createDirectory();
  const databasePath = path.join(directory, "comic-free.sqlite");
  const catalogStore = new CatalogStore(databasePath);
  const readingStore = new ReadingStore(databasePath, () => FIXED_TIME);
  const readingService = new ReadingService(new FixtureReadingAdapter(), readingStore);
  const logs: Array<Record<string, unknown>> = [];
  const service = new SourcePluginChangeService(
    new FixtureSourcePluginChangeAdapter({
      restartRequiredActions: ["update"],
    }),
    catalogStore,
    {
      logger: (entry) => logs.push(entry),
      now: () => FIXED_TIME,
      timeoutMs: 1_000,
      invalidateSourcePlugin: (pluginKey) => {
        readingService.invalidateSourcePlugin(pluginKey);
      },
    },
  );

  try {
    catalogStore.recordFailedRefresh({
      message: "The catalog refresh failed before this approved operation.",
      observedAt: "2026-09-04T11:59:00.000Z",
      reasonCode: "refresh_failed",
    });

    const installed = await service.change(request("install", "1.0.0"));
    assert.equal(installed.change.outcome, "successful");
    assert.equal(installed.change.plugin.providers[0]?.name, "Fixture Provider");
    assert.equal(installed.catalog.lastRefresh.status, "failed");
    const readerSession = (
      await readingService.createSession({
        chapterKey: FIXTURE_CHAPTER_KEY,
        comicKey: FIXTURE_COMIC_KEY,
        sourcePluginKey: PACKAGE_NAME,
      })
    ).session;

    const retained = readingStore.retain(RETAIN_CONTEXT);
    const updated = await service.change(request("update", "1.1.0"));
    assert.equal(updated.change.outcome, "restart_required");
    assert.equal(updated.change.plugin.version, "1.1.0");
    assert.equal(
      readingStore.get(retained.id)?.sourceBinding.availability,
      "refresh_required",
    );
    await assert.rejects(
      readingService.readPage(readerSession.id, 0),
      (error: unknown) =>
        error instanceof ReadingServiceError &&
        error.code === "reader_session_not_found",
    );

    const disabled = await service.change(request("disable", null));
    assert.equal(disabled.change.plugin.status, "disabled");
    const unavailable = readingStore.get(retained.id);
    assert.equal(unavailable?.sourceBinding.availability, "unavailable");
    assert.equal(unavailable?.sourceBinding.reasonCode, "disabled");
    assert.deepEqual(unavailable?.snapshot, retained.snapshot);
    assert.deepEqual(unavailable?.progress, retained.progress);

    const restored = await service.change(request("restore", "1.1.0"));
    assert.equal(restored.change.plugin.status, "healthy");
    const refreshRequired = readingStore.get(retained.id);
    assert.equal(refreshRequired?.sourceBinding.availability, "refresh_required");
    assert.equal(refreshRequired?.sourceBinding.reasonCode, null);
    assert.deepEqual(refreshRequired?.snapshot, retained.snapshot);
    assert.deepEqual(refreshRequired?.progress, retained.progress);

    assert.deepEqual(
      logs.map((entry) => entry.event),
      [
        "source_plugin_change_pending",
        "source_plugin_change_completed",
        "source_plugin_change_pending",
        "source_plugin_change_completed",
        "source_plugin_change_pending",
        "source_plugin_change_completed",
        "source_plugin_change_pending",
        "source_plugin_change_completed",
      ],
    );
    assert.equal(JSON.stringify(logs).includes("downloadedCode"), false);
  } finally {
    readingStore.close();
    catalogStore.close();
    removeDirectory(directory);
  }
});

test("a Source Plugin change has a bounded timeout and a safe error", async () => {
  const directory = createDirectory();
  const databasePath = path.join(directory, "comic-free.sqlite");
  const catalogStore = new CatalogStore(databasePath);
  const readingStore = new ReadingStore(databasePath);
  const service = new SourcePluginChangeService(
    new FixtureSourcePluginChangeAdapter({ delayMs: 100 }),
    catalogStore,
    { logger: () => undefined, timeoutMs: 5 },
  );

  try {
    await assert.rejects(
      service.change(request("install", "1.0.0")),
      (error: unknown) =>
        error instanceof SourcePluginChangeError &&
        error.code === "source_plugin_change_timeout" &&
        error.retryable &&
        error.status === 504,
    );
    assert.equal(catalogStore.readCatalog().entries.length, 0);
  } finally {
    readingStore.close();
    catalogStore.close();
    removeDirectory(directory);
  }
});

test("catalog removal and recovery synchronize Source Binding availability", () => {
  const directory = createDirectory();
  const databasePath = path.join(directory, "comic-free.sqlite");
  const catalogStore = new CatalogStore(databasePath);
  const readingStore = new ReadingStore(databasePath, () => FIXED_TIME);
  try {
    const retained = readingStore.retain(RETAIN_CONTEXT);
    catalogStore.recordPluginChange({
      bindingsRefreshRequired: false,
      name: "Comic Free Fixture Reader",
      observedAt: FIXED_TIME,
      pluginKey: PACKAGE_NAME,
      providers: [],
      reasonCode: "confirmed_removed",
      status: "confirmed_removed",
      version: "1.0.0",
    }, STORE_URL, "update");
    assert.equal(
      readingStore.get(retained.id)?.sourceBinding.reasonCode,
      "missing",
    );

    catalogStore.recordPluginChange({
      bindingsRefreshRequired: true,
      name: "Comic Free Fixture Reader",
      observedAt: FIXED_TIME,
      pluginKey: PACKAGE_NAME,
      providers: [],
      reasonCode: null,
      status: "healthy",
      version: "1.0.0",
    }, STORE_URL, "update");
    assert.equal(
      readingStore.get(retained.id)?.sourceBinding.availability,
      "refresh_required",
    );
  } finally {
    readingStore.close();
    catalogStore.close();
    removeDirectory(directory);
  }
});

test("serializes catalog refresh with concurrent Source Plugin changes", async () => {
  const directory = createDirectory();
  const databasePath = path.join(directory, "comic-free.sqlite");
  const catalogStore = new CatalogStore(databasePath);
  const readingStore = new ReadingStore(databasePath);
  let active = 0;
  let maxActive = 0;
  const service = new SourcePluginChangeService(
    {
      change: async (input) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return {
          name: "Fixture Reader",
          pluginKey: input.source.packageName,
          providers: [],
          reasonCode: null,
          restartRequired: false,
          status: "healthy",
          version: input.source.expectedVersion,
        };
      },
    },
    catalogStore,
    { logger: () => undefined },
  );

  try {
    await Promise.all([
      service.runExclusive(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
      }),
      service.change(request("install", "1.0.0")),
      service.change(request("update", "1.0.0")),
    ]);
    assert.equal(maxActive, 1);
  } finally {
    readingStore.close();
    catalogStore.close();
    removeDirectory(directory);
  }
});

test("reports a recoverable local persistence failure after a Plugin Host change", async () => {
  const directory = createDirectory();
  const databasePath = path.join(directory, "comic-free.sqlite");
  const catalogStore = new CatalogStore(databasePath);
  const readingStore = new ReadingStore(databasePath, () => FIXED_TIME);
  const service = new SourcePluginChangeService(
    new FixtureSourcePluginChangeAdapter(),
    catalogStore,
    { logger: () => undefined },
  );

  try {
    const retained = readingStore.retain(RETAIN_CONTEXT);
    await service.change(request("install", "1.0.0"));
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TRIGGER reject_plugin_binding_persist
      BEFORE UPDATE ON source_bindings
      BEGIN
        SELECT RAISE(ABORT, 'fixture persistence failure');
      END;
    `);
    database.close();

    await assert.rejects(
      service.change(request("disable", null)),
      (error: unknown) =>
        error instanceof SourcePluginChangeError &&
        error.code === "source_plugin_state_persist_failed" &&
        error.retryable &&
        error.status === 500,
    );
    assert.equal(catalogStore.readCatalog().entries[0]?.status, "healthy");
    assert.deepEqual(readingStore.get(retained.id), retained);
  } finally {
    readingStore.close();
    catalogStore.close();
    removeDirectory(directory);
  }
});

test("a queued Source Plugin change returns its timeout before the blocker finishes", async () => {
  const directory = createDirectory();
  const catalogStore = new CatalogStore(path.join(directory, "comic-free.sqlite"));
  let adapterCalls = 0;
  const service = new SourcePluginChangeService(
    {
      change: async (input) => {
        adapterCalls += 1;
        return {
          name: "Fixture Reader",
          pluginKey: input.source.packageName,
          providers: [],
          reasonCode: null,
          restartRequired: false,
          status: "healthy",
          version: input.source.expectedVersion,
        };
      },
    },
    catalogStore,
    { logger: () => undefined, timeoutMs: 10 },
  );

  try {
    const blocker = service.runExclusive(
      () => new Promise<void>((resolve) => setTimeout(resolve, 100)),
    );
    const startedAt = Date.now();
    await assert.rejects(
      service.change(request("install", "1.0.0")),
      (error: unknown) =>
        error instanceof SourcePluginChangeError &&
        error.code === "source_plugin_change_timeout",
    );
    assert(Date.now() - startedAt < 80);
    await blocker;
    assert.equal(adapterCalls, 0);
  } finally {
    catalogStore.close();
    removeDirectory(directory);
  }
});
