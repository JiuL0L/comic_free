import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  parseSourcePluginCatalogResponse,
  type CatalogRefreshReasonCode,
  type NormalizedComicProvider,
  type SourceBindingReasonCode,
  type SourcePluginChangeAction,
  type SourcePluginCatalogResponse,
  type SourcePluginCatalogEntry,
  type SourcePluginReasonCode,
  type SourcePluginStatus,
} from "@comic-free/contracts";

type ObservedStatus = Exclude<SourcePluginStatus, "confirmed_removed">;

export interface SourcePluginObservation {
  name: string;
  pluginKey: string;
  providers?: NormalizedComicProvider[];
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
  locally_disabled: number;
  name: string;
  observed_at: string;
  plugin_key: string;
  providers_json: string;
  reason_code: SourcePluginReasonCode | null;
  status: SourcePluginStatus;
  store_url: string | null;
  version: string | null;
}

function bindingReason(status: SourcePluginStatus): SourceBindingReasonCode {
  switch (status) {
    case "disabled":
      return "disabled";
    case "missing":
    case "confirmed_removed":
      return "missing";
    case "incompatible":
      return "incompatible";
    case "plugin_host_unavailable":
      return "plugin_host_unavailable";
    case "comic_provider_unreachable":
      return "comic_provider_unreachable";
    case "unknown":
    case "healthy":
      return "unknown";
  }
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
    if (!migration) {
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

    const providersMigration = this.#database
      .prepare("SELECT version FROM schema_migrations WHERE version = 4")
      .get();
    if (!providersMigration) {
      this.#transaction(() => {
        this.#database.exec(
          "ALTER TABLE source_plugin_catalog ADD COLUMN providers_json TEXT NOT NULL DEFAULT '[]'",
        );
        this.#database
          .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (4, ?)")
          .run(new Date().toISOString());
      });
    }

    const sourceMigration = this.#database
      .prepare("SELECT version FROM schema_migrations WHERE version = 5")
      .get();
    if (!sourceMigration) {
      this.#transaction(() => {
        this.#database.exec(
          "ALTER TABLE source_plugin_catalog ADD COLUMN store_url TEXT",
        );
        this.#database
          .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (5, ?)")
          .run(new Date().toISOString());
      });
    }

    const localPolicyMigration = this.#database
      .prepare("SELECT version FROM schema_migrations WHERE version = 6")
      .get();
    if (!localPolicyMigration) {
      this.#transaction(() => {
        this.#database.exec(
          "ALTER TABLE source_plugin_catalog ADD COLUMN locally_disabled INTEGER NOT NULL DEFAULT 0 CHECK (locally_disabled IN (0, 1))",
        );
        this.#database
          .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (6, ?)")
          .run(new Date().toISOString());
      });
    }
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

  #hasSourceBindings(): boolean {
    return Boolean(
      this.#database
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'source_bindings'",
        )
        .get(),
    );
  }

  #synchronizeBindings(change: SourcePluginCatalogEntry): void {
    if (!this.#hasSourceBindings()) return;
    if (change.status === "healthy") {
      if (!change.bindingsRefreshRequired) return;
      this.#database
        .prepare(`
          UPDATE source_bindings
          SET availability = 'refresh_required', reason_code = NULL,
              observed_at = ?, updated_at = ?
          WHERE source_plugin_key = ?
        `)
        .run(change.observedAt, change.observedAt, change.pluginKey);
      return;
    }
    this.#database
      .prepare(`
        UPDATE source_bindings
        SET availability = 'unavailable', reason_code = ?,
            observed_at = ?, updated_at = ?
        WHERE source_plugin_key = ?
      `)
      .run(
        bindingReason(change.status),
        change.observedAt,
        change.observedAt,
        change.pluginKey,
      );
  }

  recordSuccessfulRefresh(refresh: SuccessfulCatalogRefresh): void {
    const existingStatement = this.#database.prepare(
      "SELECT status, bindings_refresh_required, providers_json, locally_disabled FROM source_plugin_catalog WHERE plugin_key = ?",
    );
    const upsertStatement = this.#database.prepare(`
      INSERT INTO source_plugin_catalog (
        plugin_key, name, version, status, reason_code, observed_at,
        bindings_refresh_required, providers_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(plugin_key) DO UPDATE SET
        name = excluded.name,
        version = excluded.version,
        status = excluded.status,
        reason_code = excluded.reason_code,
        observed_at = excluded.observed_at,
        bindings_refresh_required = excluded.bindings_refresh_required,
        providers_json = excluded.providers_json
    `);

    this.#transaction(() => {
      for (const observation of refresh.entries) {
        const existing = existingStatement.get(observation.pluginKey) as
          | {
              bindings_refresh_required: number;
              locally_disabled: number;
              providers_json: string;
              status: SourcePluginStatus;
            }
          | undefined;
        const status: SourcePluginStatus =
          observation.removalEvidence === "confirmed"
            ? "confirmed_removed"
            : observation.status;
        const reasonCode: SourcePluginReasonCode | null =
          status === "confirmed_removed" ? "confirmed_removed" : observation.reasonCode;
        const recovered =
          existing?.locally_disabled !== 1 &&
          status === "healthy" &&
          existing !== undefined &&
          existing.status !== "healthy";
        const bindingsRefreshRequired =
          existing?.locally_disabled === 1
            ? 0
            : existing?.bindings_refresh_required === 1 || recovered
              ? 1
              : 0;
        const providers =
          observation.providers ??
          (existing
            ? (JSON.parse(existing.providers_json) as NormalizedComicProvider[])
            : []);

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
          JSON.stringify(providers),
        );
        const effectiveStatus =
          status === "confirmed_removed"
            ? "confirmed_removed"
            : existing?.locally_disabled === 1
              ? "disabled"
              : status;
        this.#synchronizeBindings({
          bindingsRefreshRequired: recovered,
          name: observation.name,
          observedAt: refresh.observedAt,
          pluginKey: observation.pluginKey,
          providers,
          reasonCode: effectiveStatus === "disabled" ? "disabled" : reasonCode,
          status: effectiveStatus,
          version: observation.version,
        });
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

  readTrustedPlugin(pluginKey: string, storeUrl: string): SourcePluginCatalogEntry | null {
    const trusted = this.#database
      .prepare(
        "SELECT 1 FROM source_plugin_catalog WHERE plugin_key = ? AND store_url = ?",
      )
      .get(pluginKey, storeUrl);
    if (!trusted) return null;
    return this.readCatalog().entries.find((entry) => entry.pluginKey === pluginKey) ?? null;
  }

  recordPluginChange(
    change: SourcePluginCatalogEntry,
    storeUrl: string,
    action: SourcePluginChangeAction,
  ): void {
    this.#transaction(() => {
      if (action === "disable") {
        const result = this.#database
          .prepare(`
            UPDATE source_plugin_catalog
            SET locally_disabled = 1, observed_at = ?, bindings_refresh_required = 0
            WHERE plugin_key = ? AND store_url = ?
          `)
          .run(change.observedAt, change.pluginKey, storeUrl);
        if (result.changes !== 1) {
          throw new Error("The approved local Source Plugin record is missing.");
        }
        const underlying = this.#database
          .prepare("SELECT status FROM source_plugin_catalog WHERE plugin_key = ?")
          .get(change.pluginKey) as { status: SourcePluginStatus };
        this.#synchronizeBindings(
          underlying.status === "confirmed_removed"
            ? {
                ...change,
                reasonCode: "confirmed_removed",
                status: "confirmed_removed",
              }
            : change,
        );
        return;
      }
      this.#database
        .prepare(`
          INSERT INTO source_plugin_catalog (
            plugin_key, name, version, status, reason_code, observed_at,
            bindings_refresh_required, providers_json, store_url, locally_disabled
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
          ON CONFLICT(plugin_key) DO UPDATE SET
            name = excluded.name,
            version = excluded.version,
            status = excluded.status,
            reason_code = excluded.reason_code,
            observed_at = excluded.observed_at,
            bindings_refresh_required = excluded.bindings_refresh_required,
            providers_json = excluded.providers_json,
            store_url = excluded.store_url,
            locally_disabled = CASE
              WHEN ? = 'restore' THEN 0
              ELSE locally_disabled
            END
        `)
        .run(
          change.pluginKey,
          change.name,
          change.version,
          change.status,
          change.reasonCode,
          change.observedAt,
          change.bindingsRefreshRequired ? 1 : 0,
          JSON.stringify(change.providers),
          storeUrl,
          action,
        );
      const remainsLocallyDisabled = Boolean(
        this.#database
          .prepare(
            "SELECT 1 FROM source_plugin_catalog WHERE plugin_key = ? AND locally_disabled = 1",
          )
          .get(change.pluginKey),
      );
      this.#synchronizeBindings(
        remainsLocallyDisabled
          ? {
              ...change,
              bindingsRefreshRequired: false,
              reasonCode: "disabled",
              status: "disabled",
            }
          : change,
      );
    });
  }

  clearBindingsRefreshRequiredWhenAllAvailable(pluginKey: string): void {
    this.#database.prepare(`UPDATE source_plugin_catalog SET bindings_refresh_required = 0 WHERE plugin_key = ? AND NOT EXISTS (SELECT 1 FROM source_bindings WHERE source_plugin_key = ? AND availability != 'available')`).run(pluginKey, pluginKey);
  }

  readCatalog(): SourcePluginCatalogResponse {
    const entries = this.#database
      .prepare(`
        SELECT plugin_key, name, version, status, reason_code, observed_at,
               bindings_refresh_required, providers_json, store_url, locally_disabled
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
        providers: JSON.parse(entry.providers_json) as unknown,
        name: entry.name,
        version: entry.version,
        status:
          entry.status === "confirmed_removed"
            ? "confirmed_removed"
            : entry.locally_disabled === 1
              ? "disabled"
              : entry.status,
        reasonCode:
          entry.status === "confirmed_removed"
            ? "confirmed_removed"
            : entry.locally_disabled === 1
              ? "disabled"
              : entry.reason_code,
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
