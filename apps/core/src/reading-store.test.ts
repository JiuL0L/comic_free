import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { ReadingStore, type RetainContext } from "./reading-store.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const TEST_ROOT = path.join(
  ROOT,
  ".local-data",
  "test-output",
  "02-deterministic-reading",
);
const FIXED_TIME = "2026-09-04T12:00:00.000Z";

const CONTEXT: RetainContext = {
  chapterKey: "chapter/one",
  chapterLabel: "Chapter 1 · The Local Beginning",
  comicKey: "comic/deterministic-adventure",
  comicProviderKey: "fixture.provider",
  coverRef: "fixture-cover/deterministic-adventure",
  pageCount: 3,
  pageIndex: 1,
  sourcePluginKey: "fixture:reader",
  title: "Deterministic Adventure",
};

function createTestDirectory(): string {
  mkdirSync(TEST_ROOT, { recursive: true });
  return mkdtempSync(path.join(TEST_ROOT, "reading-store-"));
}

function removeTestDirectory(directory: string): void {
  const relative = path.relative(TEST_ROOT, path.resolve(directory));
  assert.notEqual(relative, "");
  assert.equal(relative.startsWith(".."), false);
  rmSync(directory, { recursive: true, force: true });
}

test("retains all four local records transactionally and reopens the same state", () => {
  const directory = createTestDirectory();
  const databasePath = path.join(directory, "comic-free.sqlite");
  let store = new ReadingStore(databasePath, () => FIXED_TIME);

  try {
    const retained = store.retain(CONTEXT);
    assert.equal(retained.snapshot.title, "Deterministic Adventure");
    assert.equal(retained.sourceBinding.durableComicKey, CONTEXT.comicKey);
    assert.equal(retained.progress.chapterKey, CONTEXT.chapterKey);
    assert.equal(retained.progress.pageIndex, 1);

    store.close();
    store = new ReadingStore(databasePath, () => "2026-09-04T13:00:00.000Z");
    assert.deepEqual(store.list(), [retained]);
  } finally {
    store.close();
    removeTestDirectory(directory);
  }
});
test("rolls back the whole retain operation when any record cannot be written", () => {
  const directory = createTestDirectory();
  const databasePath = path.join(directory, "comic-free.sqlite");
  const store = new ReadingStore(databasePath, () => FIXED_TIME);

  try {
    const setup = new DatabaseSync(databasePath);
    setup.exec(`
      CREATE TRIGGER reject_source_binding
      BEFORE INSERT ON source_bindings
      BEGIN
        SELECT RAISE(ABORT, 'fixture rollback');
      END;
    `);
    setup.close();

    assert.throws(() => store.retain(CONTEXT), /fixture rollback/);
    assert.deepEqual(store.list(), []);
  } finally {
    store.close();
    removeTestDirectory(directory);
  }
});

test("source failure and rejected progress preserve retained state", () => {
  const directory = createTestDirectory();
  const databasePath = path.join(directory, "comic-free.sqlite");
  const store = new ReadingStore(databasePath, () => FIXED_TIME);

  try {
    const retained = store.retain(CONTEXT);
    assert.throws(
      () =>
        store.updateProgress(retained.id, {
          chapterKey: CONTEXT.chapterKey,
          chapterLabel: CONTEXT.chapterLabel,
          pageCount: CONTEXT.pageCount,
          pageIndex: 3,
        }),
      /pageIndex/,
    );
    assert.deepEqual(store.get(retained.id), retained);

    const unavailable = store.markBindingUnavailable(
      retained.sourceBinding.id,
      "comic_provider_unreachable",
    );
    assert.equal(unavailable?.sourceBinding.availability, "unavailable");
    assert.equal(
      unavailable?.sourceBinding.reasonCode,
      "comic_provider_unreachable",
    );
    assert.deepEqual(unavailable?.snapshot, retained.snapshot);
    assert.deepEqual(unavailable?.progress, retained.progress);
  } finally {
    store.close();
    removeTestDirectory(directory);
  }
});

test("enforces foreign keys and deletes a Library Item only through an explicit call", () => {
  const directory = createTestDirectory();
  const databasePath = path.join(directory, "comic-free.sqlite");
  const store = new ReadingStore(databasePath, () => FIXED_TIME);

  try {
    const database = new DatabaseSync(databasePath);
    database.exec("PRAGMA foreign_keys = ON");
    assert.throws(
      () =>
        database
          .prepare(
            "INSERT INTO reading_progress (library_item_id, durable_chapter_key, chapter_label, page_index, page_count, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run("missing", "chapter/one", "Chapter 1", 0, 1, FIXED_TIME),
      /FOREIGN KEY/,
    );
    database.close();

    const retained = store.retain(CONTEXT);
    assert.equal(store.delete(retained.id), true);
    assert.deepEqual(store.list(), []);
    assert.equal(store.delete(retained.id), false);
  } finally {
    store.close();
    removeTestDirectory(directory);
  }
});

test("a failed deletion rolls back and a successful deletion cascades only target records", () => {
  const directory = createTestDirectory();
  const databasePath = path.join(directory, "comic-free.sqlite");
  const store = new ReadingStore(databasePath, () => FIXED_TIME);

  const counts = (libraryItemId: string) => {
    const database = new DatabaseSync(databasePath);
    const result = database
      .prepare(`
        SELECT
          (SELECT COUNT(*) FROM library_items WHERE id = ?) AS libraryItems,
          (SELECT COUNT(*) FROM last_known_snapshots WHERE library_item_id = ?) AS snapshots,
          (SELECT COUNT(*) FROM source_bindings WHERE library_item_id = ?) AS bindings,
          (SELECT COUNT(*) FROM reading_progress WHERE library_item_id = ?) AS progress
      `)
      .get(libraryItemId, libraryItemId, libraryItemId, libraryItemId) as {
      bindings: number;
      libraryItems: number;
      progress: number;
      snapshots: number;
    };
    database.close();
    return {
      bindings: Number(result.bindings),
      libraryItems: Number(result.libraryItems),
      progress: Number(result.progress),
      snapshots: Number(result.snapshots),
    };
  };

  try {
    const target = store.retain(CONTEXT);
    const other = store.retain({
      ...CONTEXT,
      comicKey: "comic/unrelated",
      title: "Unrelated Comic",
    });
    const setup = new DatabaseSync(databasePath);
    setup.exec(`
      CREATE TRIGGER reject_library_delete
      BEFORE DELETE ON library_items
      WHEN OLD.id = '${target.id}'
      BEGIN
        SELECT RAISE(ABORT, 'fixture delete rollback');
      END;
    `);
    setup.close();

    assert.throws(() => store.delete(target.id), /fixture delete rollback/);
    assert.deepEqual(counts(target.id), {
      libraryItems: 1,
      snapshots: 1,
      bindings: 1,
      progress: 1,
    });
    assert.deepEqual(counts(other.id), {
      libraryItems: 1,
      snapshots: 1,
      bindings: 1,
      progress: 1,
    });

    const cleanup = new DatabaseSync(databasePath);
    cleanup.exec("DROP TRIGGER reject_library_delete");
    cleanup.close();
    assert.equal(store.delete(target.id), true);
    assert.deepEqual(counts(target.id), {
      libraryItems: 0,
      snapshots: 0,
      bindings: 0,
      progress: 0,
    });
    assert.deepEqual(counts(other.id), {
      libraryItems: 1,
      snapshots: 1,
      bindings: 1,
      progress: 1,
    });
  } finally {
    store.close();
    removeTestDirectory(directory);
  }
});

test("deletion cascades only its local records across every Source Binding availability", () => {
  const directory = createTestDirectory();
  const databasePath = path.join(directory, "comic-free.sqlite");
  let store = new ReadingStore(databasePath, () => FIXED_TIME);

  try {
    for (const availability of ["available", "unavailable", "refresh_required"] as const) {
      const target = store.retain({
        ...CONTEXT,
        comicKey: `comic/delete-${availability}`,
        title: `Delete ${availability}`,
      });
      const unrelated = store.retain({
        ...CONTEXT,
        comicKey: `comic/keep-${availability}`,
        title: `Keep ${availability}`,
      });
      if (availability === "unavailable") {
        store.markBindingUnavailable(target.sourceBinding.id, "comic_provider_unreachable");
      }
      if (availability === "refresh_required") {
        store.markSourcePluginBindingsRefreshRequired("fixture:reader");
      }

      assert.equal(store.delete(target.id), true);
      assert.equal(store.get(target.id), null);
      assert.deepEqual(store.get(unrelated.id)?.snapshot.title, unrelated.snapshot.title);
    }

    store.close();
    store = new ReadingStore(databasePath, () => "2026-09-04T13:00:00.000Z");
    assert.deepEqual(
      store.list().map((item) => item.snapshot.title),
      ["Keep available", "Keep refresh_required", "Keep unavailable"],
    );
  } finally {
    store.close();
    removeTestDirectory(directory);
  }
});

test("Source Plugin changes preserve local reading state while bindings require recovery", () => {
  const directory = createTestDirectory();
  const databasePath = path.join(directory, "comic-free.sqlite");
  let store = new ReadingStore(databasePath, () => FIXED_TIME);

  try {
    const retained = store.retain(CONTEXT);

    assert.equal(
      store.markSourcePluginBindingsUnavailable("fixture:reader", "disabled"),
      1,
    );
    const disabled = store.get(retained.id);
    assert.equal(disabled?.sourceBinding.availability, "unavailable");
    assert.equal(disabled?.sourceBinding.reasonCode, "disabled");
    assert.deepEqual(disabled?.snapshot, retained.snapshot);
    assert.deepEqual(disabled?.progress, retained.progress);

    assert.equal(store.markSourcePluginBindingsRefreshRequired("fixture:reader"), 1);
    const restored = store.get(retained.id);
    assert.equal(restored?.sourceBinding.availability, "refresh_required");
    assert.equal(restored?.sourceBinding.reasonCode, null);
    assert.deepEqual(restored?.snapshot, retained.snapshot);
    assert.deepEqual(restored?.progress, retained.progress);

    store.close();
    store = new ReadingStore(databasePath, () => "2026-09-04T13:00:00.000Z");
    assert.equal(
      store.get(retained.id)?.sourceBinding.availability,
      "refresh_required",
    );
  } finally {
    store.close();
    removeTestDirectory(directory);
  }
});
