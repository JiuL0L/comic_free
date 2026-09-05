import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { FixtureReadingAdapter } from "./reading-adapter.ts";
import { ReadingService, ReadingServiceError } from "./reading-service.ts";
import { ReadingStore } from "./reading-store.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const TEST_ROOT = path.join(ROOT, ".local-data", "test-output", "ticket-10");

function createTestDirectory(): string {
  mkdirSync(TEST_ROOT, { recursive: true });
  return mkdtempSync(path.join(TEST_ROOT, "reading-service-"));
}

function removeTestDirectory(directory: string): void {
  const relative = path.relative(TEST_ROOT, path.resolve(directory));
  assert.notEqual(relative, "");
  assert.equal(relative.startsWith(".."), false);
  rmSync(directory, { recursive: true, force: true });
}

test("deletion prevents in-flight resume and catalog session creation from yielding valid sessions", async () => {
  const directory = createTestDirectory();
  const store = new ReadingStore(path.join(directory, "comic-free.sqlite"));
  const adapter = new FixtureReadingAdapter();
  const service = new ReadingService(adapter, store);

  try {
    const initial = await service.createSession({
      chapterKey: "chapter/one",
      comicKey: "comic/deterministic-adventure",
      sourcePluginKey: "fixture:reader",
    });
    const item = service.retain({ pageIndex: 1, sessionId: initial.session.id });

    let releaseResolution: (() => void) | undefined;
    const originalResolve = adapter.resolveChapter.bind(adapter);
    adapter.resolveChapter = async (...args) => {
      await new Promise<void>((resolve) => {
        releaseResolution = resolve;
      });
      return originalResolve(...args);
    };

    const pendingResume = service.createSession({ libraryItemId: item.id });
    await new Promise<void>((resolve) => setImmediate(resolve));
    service.deleteLibraryItem(item.id);
    releaseResolution?.();

    await assert.rejects(
      pendingResume,
      (error: unknown) => error instanceof ReadingServiceError && error.code === "library_item_not_found",
    );

    adapter.resolveChapter = originalResolve;
    const reopened = await service.createSession({
      chapterKey: "chapter/one",
      comicKey: "comic/deterministic-adventure",
      sourcePluginKey: "fixture:reader",
    });
    const retainedAgain = service.retain({ pageIndex: 1, sessionId: reopened.session.id });
    let releaseCatalogResolution: (() => void) | undefined;
    adapter.resolveChapter = async (...args) => {
      await new Promise<void>((resolve) => {
        releaseCatalogResolution = resolve;
      });
      return originalResolve(...args);
    };
    const pendingCatalog = service.createSession({
      chapterKey: "chapter/one",
      comicKey: "comic/deterministic-adventure",
      sourcePluginKey: "fixture:reader",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    service.deleteLibraryItem(retainedAgain.id);
    releaseCatalogResolution?.();
    await assert.rejects(
      pendingCatalog,
      (error: unknown) => error instanceof ReadingServiceError && error.code === "library_item_not_found",
    );
    assert.throws(
      () => service.retain({ pageIndex: 1, sessionId: initial.session.id }),
      (error: unknown) => error instanceof ReadingServiceError && error.code === "reader_session_not_found",
    );
  } finally {
    store.close();
    removeTestDirectory(directory);
  }
});
