import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  parseLibraryItemsResponse,
  parseUpdateProgressRequest,
  type LibraryItem,
  type SourceBindingAvailability,
  type SourceBindingReasonCode,
  type UpdateProgressRequest,
} from "@comic-free/contracts";

export interface RetainContext extends UpdateProgressRequest {
  comicKey: string;
  comicProviderKey: string;
  coverRef: string;
  sourcePluginKey: string;
  title: string;
}

interface LibraryRow {
  availability: SourceBindingAvailability;
  binding_id: string;
  binding_updated_at: string;
  chapter_key: string;
  chapter_label: string;
  comic_provider_key: string;
  cover_ref: string;
  created_at: string;
  durable_comic_key: string;
  id: string;
  observed_at: string;
  page_count: number;
  page_index: number;
  progress_updated_at: string;
  reason_code: SourceBindingReasonCode | null;
  snapshot_updated_at: string;
  source_plugin_key: string;
  title: string;
}

const LIBRARY_SELECT = `
  SELECT
    item.id,
    item.created_at,
    snapshot.title,
    snapshot.cover_ref,
    snapshot.updated_at AS snapshot_updated_at,
    binding.id AS binding_id,
    binding.source_plugin_key,
    binding.comic_provider_key,
    binding.durable_comic_key,
    binding.availability,
    binding.reason_code,
    binding.observed_at,
    binding.updated_at AS binding_updated_at,
    progress.durable_chapter_key AS chapter_key,
    progress.chapter_label,
    progress.page_index,
    progress.page_count,
    progress.updated_at AS progress_updated_at
  FROM library_items AS item
  JOIN last_known_snapshots AS snapshot ON snapshot.library_item_id = item.id
  JOIN source_bindings AS binding ON binding.library_item_id = item.id
  JOIN reading_progress AS progress ON progress.library_item_id = item.id
`;

function requireText(value: string, field: string): string {
  if (value.trim() === "") throw new TypeError(`Invalid ${field}: expected a non-empty string.`);
  return value;
}

export class ReadingStore {
  readonly #database: DatabaseSync;
  readonly #now: () => string;
  #closed = false;

  constructor(databasePath: string, now: () => string = () => new Date().toISOString()) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.#database = new DatabaseSync(databasePath);
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#now = now;
    this.#migrate();
  }

  #migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    const migrated = this.#database
      .prepare("SELECT 1 FROM schema_migrations WHERE version = 2")
      .get();
    if (!migrated) {
      this.#transaction(() => {
        this.#database.exec(`
        CREATE TABLE IF NOT EXISTS library_items (
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS last_known_snapshots (
          library_item_id TEXT PRIMARY KEY REFERENCES library_items(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          cover_ref TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS source_bindings (
          id TEXT PRIMARY KEY,
          library_item_id TEXT NOT NULL UNIQUE REFERENCES library_items(id) ON DELETE CASCADE,
          source_plugin_key TEXT NOT NULL,
          comic_provider_key TEXT NOT NULL,
          durable_comic_key TEXT NOT NULL,
          availability TEXT NOT NULL CHECK (availability IN ('available', 'unavailable')),
          reason_code TEXT,
          observed_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (source_plugin_key, comic_provider_key, durable_comic_key),
          CHECK (
            (availability = 'available' AND reason_code IS NULL) OR
            (availability = 'unavailable' AND reason_code IS NOT NULL)
          )
        );
        CREATE TABLE IF NOT EXISTS reading_progress (
          library_item_id TEXT PRIMARY KEY REFERENCES library_items(id) ON DELETE CASCADE,
          durable_chapter_key TEXT NOT NULL,
          chapter_label TEXT NOT NULL,
          page_index INTEGER NOT NULL CHECK (page_index >= 0),
          page_count INTEGER NOT NULL CHECK (page_count > 0),
          updated_at TEXT NOT NULL,
          CHECK (page_index < page_count)
        );
        `);
        this.#database
          .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?)")
          .run(this.#now());
      });
    }

    const expandedAvailability = this.#database
      .prepare("SELECT 1 FROM schema_migrations WHERE version = 3")
      .get();
    if (expandedAvailability) return;

    this.#transaction(() => {
      this.#database.exec(`
        ALTER TABLE source_bindings RENAME TO source_bindings_v2;
        CREATE TABLE source_bindings (
          id TEXT PRIMARY KEY,
          library_item_id TEXT NOT NULL UNIQUE REFERENCES library_items(id) ON DELETE CASCADE,
          source_plugin_key TEXT NOT NULL,
          comic_provider_key TEXT NOT NULL,
          durable_comic_key TEXT NOT NULL,
          availability TEXT NOT NULL CHECK (availability IN ('available', 'unavailable', 'refresh_required')),
          reason_code TEXT,
          observed_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (source_plugin_key, comic_provider_key, durable_comic_key),
          CHECK (
            (availability = 'unavailable' AND reason_code IS NOT NULL) OR
            (availability IN ('available', 'refresh_required') AND reason_code IS NULL)
          )
        );
        INSERT INTO source_bindings (
          id, library_item_id, source_plugin_key, comic_provider_key,
          durable_comic_key, availability, reason_code, observed_at, updated_at
        )
        SELECT
          id, library_item_id, source_plugin_key, comic_provider_key,
          durable_comic_key, availability, reason_code, observed_at, updated_at
        FROM source_bindings_v2;
        DROP TABLE source_bindings_v2;
      `);
      this.#database
        .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (3, ?)")
        .run(this.#now());
    });
  }

  #transaction<T>(action: () => T): T {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #map(row: LibraryRow): LibraryItem {
    const [item] = parseLibraryItemsResponse({
      items: [
        {
          createdAt: row.created_at,
          id: row.id,
          progress: {
            chapterKey: row.chapter_key,
            chapterLabel: row.chapter_label,
            pageCount: row.page_count,
            pageIndex: row.page_index,
            updatedAt: row.progress_updated_at,
          },
          snapshot: {
            coverRef: row.cover_ref,
            title: row.title,
            updatedAt: row.snapshot_updated_at,
          },
          sourceBinding: {
            availability: row.availability,
            comicProviderKey: row.comic_provider_key,
            durableComicKey: row.durable_comic_key,
            id: row.binding_id,
            observedAt: row.observed_at,
            reasonCode: row.reason_code,
            sourcePluginKey: row.source_plugin_key,
            updatedAt: row.binding_updated_at,
          },
        },
      ],
    }).items;
    if (!item) throw new Error("The SQLite row could not be mapped to a Library Item.");
    return item;
  }

  retain(context: RetainContext): LibraryItem {
    const progress = parseUpdateProgressRequest({
      chapterKey: context.chapterKey,
      chapterLabel: context.chapterLabel,
      pageCount: context.pageCount,
      pageIndex: context.pageIndex,
    });
    requireText(context.comicKey, "comicKey");
    requireText(context.comicProviderKey, "comicProviderKey");
    requireText(context.coverRef, "coverRef");
    requireText(context.sourcePluginKey, "sourcePluginKey");
    requireText(context.title, "title");

    const existing = this.#database
      .prepare(`
        SELECT library_item_id
        FROM source_bindings
        WHERE source_plugin_key = ? AND comic_provider_key = ? AND durable_comic_key = ?
      `)
      .get(context.sourcePluginKey, context.comicProviderKey, context.comicKey) as
      | { library_item_id: string }
      | undefined;
    if (existing) return this.get(existing.library_item_id) as LibraryItem;

    const libraryItemId = randomUUID();
    const sourceBindingId = randomUUID();
    const now = this.#now();
    this.#transaction(() => {
      this.#database
        .prepare("INSERT INTO library_items (id, created_at) VALUES (?, ?)")
        .run(libraryItemId, now);
      this.#database
        .prepare(`
          INSERT INTO last_known_snapshots (library_item_id, title, cover_ref, updated_at)
          VALUES (?, ?, ?, ?)
        `)
        .run(libraryItemId, context.title, context.coverRef, now);
      this.#database
        .prepare(`
          INSERT INTO source_bindings (
            id, library_item_id, source_plugin_key, comic_provider_key,
            durable_comic_key, availability, reason_code, observed_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'available', NULL, ?, ?)
        `)
        .run(
          sourceBindingId,
          libraryItemId,
          context.sourcePluginKey,
          context.comicProviderKey,
          context.comicKey,
          now,
          now,
        );
      this.#database
        .prepare(`
          INSERT INTO reading_progress (
            library_item_id, durable_chapter_key, chapter_label,
            page_index, page_count, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(
          libraryItemId,
          progress.chapterKey,
          progress.chapterLabel,
          progress.pageIndex,
          progress.pageCount,
          now,
        );
    });
    return this.get(libraryItemId) as LibraryItem;
  }

  get(libraryItemId: string): LibraryItem | null {
    const row = this.#database
      .prepare(`${LIBRARY_SELECT} WHERE item.id = ?`)
      .get(libraryItemId) as unknown as LibraryRow | undefined;
    return row ? this.#map(row) : null;
  }

  getBySourceIdentity(
    sourcePluginKey: string,
    durableComicKey: string,
  ): LibraryItem | null {
    const row = this.#database
      .prepare(
        `${LIBRARY_SELECT}
         WHERE binding.source_plugin_key = ? AND binding.durable_comic_key = ?
         LIMIT 1`,
      )
      .get(sourcePluginKey, durableComicKey) as unknown as LibraryRow | undefined;
    return row ? this.#map(row) : null;
  }

  list(): LibraryItem[] {
    const rows = this.#database
      .prepare(`${LIBRARY_SELECT} ORDER BY snapshot.title COLLATE NOCASE, item.id`)
      .all() as unknown as LibraryRow[];
    return rows.map((row) => this.#map(row));
  }

  updateProgress(
    libraryItemId: string,
    input: UpdateProgressRequest,
  ): LibraryItem | null {
    const progress = parseUpdateProgressRequest(input);
    const result = this.#database
      .prepare(`
        UPDATE reading_progress
        SET durable_chapter_key = ?, chapter_label = ?, page_index = ?,
            page_count = ?, updated_at = ?
        WHERE library_item_id = ?
      `)
      .run(
        progress.chapterKey,
        progress.chapterLabel,
        progress.pageIndex,
        progress.pageCount,
        this.#now(),
        libraryItemId,
      );
    return result.changes === 0 ? null : this.get(libraryItemId);
  }

  markBindingUnavailable(
    sourceBindingId: string,
    reasonCode: SourceBindingReasonCode,
  ): LibraryItem | null {
    const now = this.#now();
    const result = this.#database
      .prepare(`
        UPDATE source_bindings
        SET availability = 'unavailable', reason_code = ?, observed_at = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(reasonCode, now, now, sourceBindingId);
    if (result.changes === 0) return null;
    const row = this.#database
      .prepare("SELECT library_item_id FROM source_bindings WHERE id = ?")
      .get(sourceBindingId) as { library_item_id: string };
    return this.get(row.library_item_id);
  }

  markSourcePluginBindingsUnavailable(
    sourcePluginKey: string,
    reasonCode: SourceBindingReasonCode,
  ): number {
    requireText(sourcePluginKey, "sourcePluginKey");
    const now = this.#now();
    return Number(
      this.#database
        .prepare(`
          UPDATE source_bindings
          SET availability = 'unavailable', reason_code = ?, observed_at = ?, updated_at = ?
          WHERE source_plugin_key = ?
        `)
        .run(reasonCode, now, now, sourcePluginKey).changes,
    );
  }

  markSourcePluginBindingsRefreshRequired(sourcePluginKey: string): number {
    requireText(sourcePluginKey, "sourcePluginKey");
    const now = this.#now();
    return Number(
      this.#database
        .prepare(`
          UPDATE source_bindings
          SET availability = 'refresh_required', reason_code = NULL,
              observed_at = ?, updated_at = ?
          WHERE source_plugin_key = ?
        `)
        .run(now, now, sourcePluginKey).changes,
    );
  }

  delete(libraryItemId: string): boolean {
    return (
      this.#database.prepare("DELETE FROM library_items WHERE id = ?").run(libraryItemId)
        .changes === 1
    );
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#database.close();
  }
}
