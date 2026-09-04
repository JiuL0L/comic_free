import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  parseSourcePluginCatalogResponse,
  type CatalogRefreshReasonCode,
  type SourcePluginCatalogResponse,
  type SourcePluginReasonCode,
  type SourcePluginStatus,
} from "@comic-free/contracts";

type ObservedStatus = Exclude<SourcePluginStatus, "confirmed_removed">;

export interface SourcePluginObservation {
  name: string;
  pluginKey: string;
  reasonCode: Exclude<SourcePluginReasonCode, "confirmed_removed"> | null;
  removalEvidence: "none" | "confirmed";
  reportedObsolete: boolean;
  status: ObservedStatus;
  version: string | null;
}

export interface SuccessfulCatalogRefresh {
  entries: SourcePluginObservation[];
  observedAt: string;
}

export interface FailedCatalogRefresh {
  message: string;
  observedAt: string;
  reasonCode: CatalogRefreshReasonCode;
}

interface PluginRow {
  bindings_refresh_required: number;
  name: string;
  observed_at: string;
  plugin_key: string;
  reason_code: SourcePluginReasonCode | null;
  status: SourcePluginStatus;
  version: string | null;
}

interface RefreshRow {
  message: string | null;
  observed_at: string;
  reason_code: CatalogRefreshReasonCode | null;
  status: "healthy" | "failed";
}

export class CatalogStore {
  readonly #database: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.#database = new DatabaseSync(databasePath);
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#migrate();
  }

  #migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const migration = this.#database
      .prepare("SELECT version FROM schema_migrations WHERE version = 1")
      .get();
    if (migration) return;

    this.#transaction(() => {
      this.#database.exec(`
        CREATE TABLE source_plugin_catalog (
          plugin_key TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          version TEXT,
          status TEXT NOT NULL,
          reason_code TEXT,
          observed_at TEXT NOT NULL,
          bindings_refresh_required INTEGER NOT NULL DEFAULT 0 CHECK (bindings_refresh_required IN (0, 1))
        );
        CREATE TABLE catalog_refresh_state (
          singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
          status TEXT NOT NULL CHECK (status IN ('healthy', 'failed')),
          observed_at TEXT NOT NULL,
          reason_code TEXT,
          message TEXT
        );
      `);
      this.#database
        .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)")
        .run(new Date().toISOString());
    });
  }

  #transaction(action: () => void): void {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      action();
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  recordSuccessfulRefresh(refresh: SuccessfulCatalogRefresh): void {
    const existingStatement = this.#database.prepare(
      "SELECT status, bindings_refresh_required FROM source_plugin_catalog WHERE plugin_key = ?",
    );
    const upsertStatement = this.#database.prepare(`
      INSERT INTO source_plugin_catalog (
        plugin_key, name, version, status, reason_code, observed_at, bindings_refresh_required
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(plugin_key) DO UPDATE SET
        name = excluded.name,
        version = excluded.version,
        status = excluded.status,
        reason_code = excluded.reason_code,
        observed_at = excluded.observed_at,
        bindings_refresh_required = excluded.bindings_refresh_required
    `);

    this.#transaction(() => {
      for (const observation of refresh.entries) {
        const existing = existingStatement.get(observation.pluginKey) as
          | { bindings_refresh_required: number; status: SourcePluginStatus }
          | undefined;
        const status: SourcePluginStatus =
          observation.removalEvidence === "confirmed"
            ? "confirmed_removed"
            : observation.status;
        const reasonCode: SourcePluginReasonCode | null =
          status === "confirmed_removed" ? "confirmed_removed" : observation.reasonCode;
        const recovered =
          status === "healthy" && existing !== undefined && existing.status !== "healthy";
        const bindingsRefreshRequired =
          existing?.bindings_refresh_required === 1 || recovered ? 1 : 0;

        // reportedObsolete is intentionally not translated into confirmed removal.
        void observation.reportedObsolete;
        upsertStatement.run(
          observation.pluginKey,
          observation.name,
          observation.version,
          status,
          reasonCode,
          refresh.observedAt,
          bindingsRefreshRequired,
        );
      }

      this.#database
        .prepare(`
          INSERT INTO catalog_refresh_state (
            singleton_id, status, observed_at, reason_code, message
          ) VALUES (1, 'healthy', ?, NULL, NULL)
          ON CONFLICT(singleton_id) DO UPDATE SET
            status = excluded.status,
            observed_at = excluded.observed_at,
            reason_code = excluded.reason_code,
            message = excluded.message
        `)
        .run(refresh.observedAt);
    });
  }

  recordFailedRefresh(refresh: FailedCatalogRefresh): void {
    this.#database
      .prepare(`
        INSERT INTO catalog_refresh_state (
          singleton_id, status, observed_at, reason_code, message
        ) VALUES (1, 'failed', ?, ?, ?)
        ON CONFLICT(singleton_id) DO UPDATE SET
          status = excluded.status,
          observed_at = excluded.observed_at,
          reason_code = excluded.reason_code,
          message = excluded.message
      `)
      .run(refresh.observedAt, refresh.reasonCode, refresh.message);
  }

  readCatalog(): SourcePluginCatalogResponse {
    const entries = this.#database
      .prepare(`
        SELECT plugin_key, name, version, status, reason_code, observed_at,
               bindings_refresh_required
        FROM source_plugin_catalog
        ORDER BY name COLLATE NOCASE, plugin_key
      `)
      .all() as unknown as PluginRow[];
    const refresh = this.#database
      .prepare(`
        SELECT status, observed_at, reason_code, message
        FROM catalog_refresh_state
        WHERE singleton_id = 1
      `)
      .get() as unknown as RefreshRow | undefined;

    return parseSourcePluginCatalogResponse({
      entries: entries.map((entry) => ({
        pluginKey: entry.plugin_key,
        name: entry.name,
        version: entry.version,
        status: entry.status,
        reasonCode: entry.reason_code,
        observedAt: entry.observed_at,
        bindingsRefreshRequired: entry.bindings_refresh_required === 1,
      })),
      lastRefresh: refresh
        ? {
            status: refresh.status,
            observedAt: refresh.observed_at,
            reasonCode: refresh.reason_code,
            message: refresh.message,
          }
        : {
            status: "never",
            observedAt: null,
            reasonCode: null,
            message: null,
          },
    });
  }

  close(): void {
    this.#database.close();
  }
}
