import { setTimeout as delay } from "node:timers/promises";

import {
  parseSourcePluginChangeResponse,
  type NormalizedComicProvider,
  type SourcePluginChangeAction,
  type SourcePluginChangeRequest,
  type SourcePluginChangeResponse,
  type SourcePluginCatalogEntry,
  type SourcePluginReasonCode,
  type SourcePluginStatus,
} from "@comic-free/contracts";

import type { CatalogStore } from "./catalog-store.ts";

export interface SourcePluginChangeAdapterResult {
  name: string;
  pluginKey: string;
  providers: NormalizedComicProvider[];
  reasonCode: SourcePluginReasonCode | null;
  restartRequired: boolean;
  status: SourcePluginStatus;
  version: string | null;
}

export interface SourcePluginChangeAdapter {
  change: (
    request: SourcePluginChangeRequest,
    signal: AbortSignal,
    currentPlugin?: SourcePluginCatalogEntry | null,
  ) => Promise<SourcePluginChangeAdapterResult>;
}

export class SourcePluginChangeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly status: number,
  ) {
    super(message);
    this.name = "SourcePluginChangeError";
  }
}

export class SourcePluginChangeAdapterError extends SourcePluginChangeError {
  constructor(code: string, message: string, retryable: boolean, status = 502) {
    super(code, message, retryable, status);
    this.name = "SourcePluginChangeAdapterError";
  }
}

export interface SourcePluginChangeLogEntry {
  action: SourcePluginChangeAction;
  component: "local-core";
  event:
    | "source_plugin_change_pending"
    | "source_plugin_change_completed"
    | "source_plugin_change_failed";
  expectedVersion: string | null;
  packageName: string;
  sourceKind: "extension_store";
  storeUrl: string;
  timestamp: string;
  [key: string]: unknown;
}

interface SourcePluginChangeServiceOptions {
  clock?: () => number;
  invalidateSourcePlugin?: (pluginKey: string) => void;
  logger?: (entry: SourcePluginChangeLogEntry) => void;
  now?: () => string;
  timeoutMs?: number;
}

function safeStoreUrl(value: string): string {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function successfulMessage(
  action: SourcePluginChangeAction,
  name: string,
  restartRequired: boolean,
): string {
  const verb =
    action === "install"
      ? "installed"
      : action === "update"
        ? "updated"
        : action === "disable"
          ? "disabled"
          : "restored";
  return restartRequired
    ? `${name} was ${verb}. Restart the Plugin Host to finish.`
    : `${name} was ${verb}.`;
}

export class SourcePluginChangeService {
  readonly #adapter: SourcePluginChangeAdapter;
  readonly #catalogStore: CatalogStore;
  readonly #clock: () => number;
  readonly #invalidateSourcePlugin: (pluginKey: string) => void;
  readonly #logger: (entry: SourcePluginChangeLogEntry) => void;
  readonly #now: () => string;
  readonly #timeoutMs: number;
  #queue: Promise<void> = Promise.resolve();

  constructor(
    adapter: SourcePluginChangeAdapter,
    catalogStore: CatalogStore,
    options: SourcePluginChangeServiceOptions = {},
  ) {
    this.#adapter = adapter;
    this.#catalogStore = catalogStore;
    this.#clock = options.clock ?? Date.now;
    this.#invalidateSourcePlugin = options.invalidateSourcePlugin ?? (() => undefined);
    this.#logger = options.logger ?? ((entry) => console.log(JSON.stringify(entry)));
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 1 || this.#timeoutMs > 120_000) {
      throw new TypeError("Source Plugin change timeout must be from 1 through 120000 ms.");
    }
  }

  change(request: SourcePluginChangeRequest): Promise<SourcePluginChangeResponse> {
    const deadline = this.#clock() + this.#timeoutMs;
    let expired = false;
    let started = false;
    const operation = this.runExclusive(() => {
      started = true;
      if (expired) {
        throw new SourcePluginChangeError(
          "source_plugin_change_timeout",
          `The Source Plugin change exceeded the ${this.#timeoutMs} ms deadline while waiting for another operation.`,
          true,
          504,
        );
      }
      return this.#changeOnce(request, deadline);
    });
    return new Promise<SourcePluginChangeResponse>((resolve, reject) => {
      const queueTimeout = setTimeout(() => {
        if (started) return;
        expired = true;
        const error = new SourcePluginChangeError(
          "source_plugin_change_timeout",
          `The Source Plugin change exceeded the ${this.#timeoutMs} ms deadline while waiting for another operation.`,
          true,
          504,
        );
        this.#logger({
          action: request.action,
          code: error.code,
          component: "local-core",
          event: "source_plugin_change_failed",
          expectedVersion: request.source.expectedVersion,
          packageName: request.source.packageName,
          sourceKind: request.source.kind,
          storeUrl: safeStoreUrl(request.source.storeUrl),
          timestamp: this.#now(),
        });
        reject(error);
      }, this.#timeoutMs);
      operation.then(resolve, reject).finally(() => clearTimeout(queueTimeout));
    });
  }

  runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.#queue.then(operation);
    const operationDone = queued.then(
      () => undefined,
      () => undefined,
    );
    this.#queue = operationDone;
    return queued;
  }

  async #changeOnce(
    request: SourcePluginChangeRequest,
    deadline: number,
  ): Promise<SourcePluginChangeResponse> {
    const startedAt = this.#now();
    const logContext = {
      action: request.action,
      component: "local-core" as const,
      expectedVersion: request.source.expectedVersion,
      packageName: request.source.packageName,
      sourceKind: request.source.kind,
      storeUrl: safeStoreUrl(request.source.storeUrl),
    };
    this.#logger({
      ...logContext,
      event: "source_plugin_change_pending",
      timestamp: startedAt,
    });

    const controller = new AbortController();
    const remainingMs = deadline - this.#clock();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, remainingMs));
    try {
      if (remainingMs <= 0) {
        throw new SourcePluginChangeError(
          "source_plugin_change_timeout",
          `The Source Plugin change exceeded the ${this.#timeoutMs} ms deadline while waiting for another operation.`,
          true,
          504,
        );
      }
      const currentPlugin =
        request.action === "disable"
          ? this.#catalogStore.readTrustedPlugin(
              request.source.packageName,
              request.source.storeUrl,
            )
          : null;
      if (request.action === "disable" && !currentPlugin) {
        throw new SourcePluginChangeError(
          "source_plugin_not_found",
          "Comic Free has no approved local record for this Source Plugin and extension store.",
          false,
          404,
        );
      }
      const result = await this.#adapter.change(
        request,
        controller.signal,
        currentPlugin,
      );
      if (
        request.action !== "disable" &&
        result.version !== request.source.expectedVersion
      ) {
        throw new SourcePluginChangeError(
          "source_plugin_version_mismatch",
          "The Source Plugin version returned by the Plugin Host did not match the approved version.",
          false,
          409,
        );
      }

      const completedAt = this.#now();
      const bindingsRefreshRequired =
        result.status === "healthy" && request.action !== "install";
      const catalogEntry: SourcePluginCatalogEntry = {
        bindingsRefreshRequired,
        name: result.name,
        observedAt: completedAt,
        pluginKey: result.pluginKey,
        providers: result.providers,
        reasonCode: result.reasonCode,
        status: result.status,
        version: result.version,
      };
      try {
        this.#catalogStore.recordPluginChange(
          catalogEntry,
          request.source.storeUrl,
          request.action,
        );
      } catch {
        throw new SourcePluginChangeError(
          "source_plugin_state_persist_failed",
          "The Plugin Host reported the change, but Comic Free could not save local state. Refresh the Source Plugin catalog before continuing.",
          true,
          500,
        );
      }
      const catalog = this.#catalogStore.readCatalog();
      const effectivePlugin =
        catalog.entries.find((entry) => entry.pluginKey === result.pluginKey) ??
        catalogEntry;
      if (
        effectivePlugin.status !== "healthy" ||
        effectivePlugin.bindingsRefreshRequired
      ) {
        this.#invalidateSourcePlugin(effectivePlugin.pluginKey);
      }
      const response = parseSourcePluginChangeResponse({
        catalog,
        change: {
          action: request.action,
          completedAt,
          message: successfulMessage(
            request.action,
            result.name,
            result.restartRequired,
          ),
          outcome: result.restartRequired ? "restart_required" : "successful",
          plugin: {
            name: effectivePlugin.name,
            pluginKey: effectivePlugin.pluginKey,
            providers: effectivePlugin.providers,
            status: effectivePlugin.status,
            version: effectivePlugin.version,
          },
          source: request.source,
        },
      });
      this.#logger({
        ...logContext,
        event: "source_plugin_change_completed",
        outcome: response.change.outcome,
        timestamp: completedAt,
      });
      return response;
    } catch (error) {
      const normalized =
        controller.signal.aborted
          ? new SourcePluginChangeError(
              "source_plugin_change_timeout",
              `The Source Plugin change exceeded the ${this.#timeoutMs} ms deadline.`,
              true,
              504,
            )
          : error instanceof SourcePluginChangeError
            ? error
            : new SourcePluginChangeError(
                "source_plugin_change_failed",
                "The Local Core could not complete the Source Plugin change.",
                true,
                502,
              );
      this.#logger({
        ...logContext,
        code: normalized.code,
        event: "source_plugin_change_failed",
        timestamp: this.#now(),
      });
      throw normalized;
    } finally {
      clearTimeout(timeout);
    }
  }
}

interface FixtureSourcePluginChangeAdapterOptions {
  delayMs?: number;
  restartRequiredActions?: SourcePluginChangeAction[];
}

export class FixtureSourcePluginChangeAdapter implements SourcePluginChangeAdapter {
  readonly #delayMs: number;
  readonly #restartRequiredActions: ReadonlySet<SourcePluginChangeAction>;
  #disabled = false;
  #installed = false;
  #version: string | null = null;

  constructor(options: FixtureSourcePluginChangeAdapterOptions = {}) {
    this.#delayMs = options.delayMs ?? 0;
    this.#restartRequiredActions = new Set(options.restartRequiredActions ?? []);
  }

  async change(
    request: SourcePluginChangeRequest,
    signal: AbortSignal,
    currentPlugin?: SourcePluginCatalogEntry | null,
  ): Promise<SourcePluginChangeAdapterResult> {
    if (
      request.source.packageName !== "fixture:reader" ||
      request.source.storeUrl !== "https://fixtures.comic-free.invalid/repo/index.pb"
    ) {
      throw new SourcePluginChangeAdapterError(
        "source_plugin_not_found",
        "The approved Source Plugin was not found in the selected extension store.",
        false,
        404,
      );
    }
    if (this.#delayMs > 0) {
      await delay(this.#delayMs, undefined, { signal });
    }

    if (request.action === "disable") {
      if (!currentPlugin) {
        throw new SourcePluginChangeAdapterError(
          "source_plugin_not_found",
          "Comic Free has no approved local Source Plugin record to disable.",
          false,
          404,
        );
      }
      this.#disabled = true;
    } else {
      this.#installed = true;
      this.#disabled = false;
      this.#version = request.source.expectedVersion;
    }

    const healthy = this.#installed && !this.#disabled;
    return {
      name: currentPlugin?.name ?? "Comic Free Fixture Reader",
      pluginKey: request.source.packageName,
      providers: currentPlugin?.providers ?? (this.#installed
        ? [{ key: "fixture.provider", language: "en", name: "Fixture Provider" }, { key: "fixture.provider.zh-Hant", language: "zh-Hant", name: "Fixture Provider" }]
        : []),
      reasonCode: healthy ? null : "disabled",
      restartRequired: this.#restartRequiredActions.has(request.action),
      status: healthy ? "healthy" : "disabled",
      version: currentPlugin?.version ?? this.#version,
    };
  }
}
