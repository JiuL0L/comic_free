export const HEALTH_API_VERSION = "v1" as const;
export const LOCAL_CORE_SERVICE = "comic-free-local-core" as const;
export const LOCAL_CORE_HOST = "127.0.0.1" as const;
export const LOCAL_CORE_PORT = 3210;
export const LOCAL_CORE_ORIGIN = `http://${LOCAL_CORE_HOST}:${LOCAL_CORE_PORT}`;
export const CORE_HEALTH_PATH = "/api/v1/health" as const;
export const CORE_HEALTH_URL = `${LOCAL_CORE_ORIGIN}${CORE_HEALTH_PATH}`;
export const PLUGIN_HOST_STATUS_PATH = "/api/v1/plugin-host/status" as const;
export const PLUGIN_HOST_STATUS_URL = `${LOCAL_CORE_ORIGIN}${PLUGIN_HOST_STATUS_PATH}`;
export const SOURCE_PLUGINS_PATH = "/api/v1/source-plugins" as const;
export const SOURCE_PLUGINS_URL = `${LOCAL_CORE_ORIGIN}${SOURCE_PLUGINS_PATH}`;
export const SOURCE_PLUGINS_REFRESH_PATH = "/api/v1/source-plugins/refresh" as const;
export const SOURCE_PLUGINS_REFRESH_URL = `${LOCAL_CORE_ORIGIN}${SOURCE_PLUGINS_REFRESH_PATH}`;
export const WEB_UI_HOST = "127.0.0.1" as const;
export const WEB_UI_PORT = 5173;
export const WEB_UI_ORIGIN = `http://${WEB_UI_HOST}:${WEB_UI_PORT}`;
export const WEB_UI_URL = `${WEB_UI_ORIGIN}/`;

export interface HealthResponse {
  apiVersion: typeof HEALTH_API_VERSION;
  service: typeof LOCAL_CORE_SERVICE;
  status: "ready";
}

export const PLUGIN_HOST_STATES = [
  "not_configured",
  "starting",
  "ready",
  "stopping",
  "stopped",
  "invalid_path",
  "port_occupied",
  "startup_timeout",
  "early_exit",
  "unexpected_exit",
  "shutdown_failed",
] as const;

export type PluginHostState = (typeof PLUGIN_HOST_STATES)[number];

export interface PluginHostStatusResponse {
  apiVersion: typeof HEALTH_API_VERSION;
  internalPort: number | null;
  message: string;
  retryable: boolean;
  state: PluginHostState;
}

export interface ErrorResponse {
  error: {
    code: string;
    context?: Record<string, unknown>;
    message: string;
    retryable: boolean;
  };
}

export const SOURCE_PLUGIN_STATUSES = [
  "healthy",
  "disabled",
  "missing",
  "incompatible",
  "plugin_host_unavailable",
  "comic_provider_unreachable",
  "unknown",
  "confirmed_removed",
] as const;

export type SourcePluginStatus = (typeof SOURCE_PLUGIN_STATUSES)[number];

export const SOURCE_PLUGIN_REASON_CODES = [
  "disabled",
  "missing",
  "incompatible",
  "plugin_host_unavailable",
  "comic_provider_unreachable",
  "unknown",
  "confirmed_removed",
] as const;

export type SourcePluginReasonCode = (typeof SOURCE_PLUGIN_REASON_CODES)[number];

export const CATALOG_REFRESH_REASON_CODES = [
  "plugin_host_unavailable",
  "comic_provider_unreachable",
  "refresh_failed",
  "unknown",
] as const;

export type CatalogRefreshReasonCode = (typeof CATALOG_REFRESH_REASON_CODES)[number];
export type CatalogRefreshStatus = "never" | "healthy" | "failed";

export interface SourcePluginCatalogEntry {
  bindingsRefreshRequired: boolean;
  name: string;
  observedAt: string;
  pluginKey: string;
  reasonCode: SourcePluginReasonCode | null;
  status: SourcePluginStatus;
  version: string | null;
}

export interface CatalogRefreshState {
  message: string | null;
  observedAt: string | null;
  reasonCode: CatalogRefreshReasonCode | null;
  status: CatalogRefreshStatus;
}

export interface SourcePluginCatalogResponse {
  entries: SourcePluginCatalogEntry[];
  lastRefresh: CatalogRefreshState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, context: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`Invalid ${context}: expected a JSON object.`);
  return value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`Invalid ${field}: expected a non-empty string.`);
  }
  return value;
}

function requireTimestamp(value: unknown, field: string): string {
  const timestamp = requireString(value, field);
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new TypeError(`Invalid ${field}: expected an ISO timestamp.`);
  }
  return timestamp;
}

function requireNullableString(value: unknown, field: string): string | null {
  return value === null ? null : requireString(value, field);
}

function requireEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new TypeError(`Invalid ${field}: unsupported value "${String(value)}".`);
  }
  return value as T;
}

function requireLiteral<K extends keyof HealthResponse>(
  value: Record<string, unknown>,
  field: K,
  expected: HealthResponse[K],
): void {
  if (value[field] !== expected) {
    throw new TypeError(
      `Invalid health response field "${field}": expected "${expected}".`,
    );
  }
}

export function parseHealthResponse(value: unknown): HealthResponse {
  if (!isRecord(value)) {
    throw new TypeError("Invalid health response: expected a JSON object.");
  }

  requireLiteral(value, "apiVersion", HEALTH_API_VERSION);
  requireLiteral(value, "service", LOCAL_CORE_SERVICE);
  requireLiteral(value, "status", "ready");

  return value as unknown as HealthResponse;
}

export function createHealthResponse(): HealthResponse {
  return parseHealthResponse({
    apiVersion: HEALTH_API_VERSION,
    service: LOCAL_CORE_SERVICE,
    status: "ready",
  });
}

export function parsePluginHostStatusResponse(value: unknown): PluginHostStatusResponse {
  if (!isRecord(value)) {
    throw new TypeError("Invalid Plugin Host status response: expected a JSON object.");
  }
  if (value.apiVersion !== HEALTH_API_VERSION) {
    throw new TypeError(`Invalid apiVersion: expected "${HEALTH_API_VERSION}".`);
  }
  if (typeof value.message !== "string" || value.message.trim() === "") {
    throw new TypeError("Invalid message: expected a non-empty string.");
  }
  if (typeof value.retryable !== "boolean") {
    throw new TypeError("Invalid retryable: expected a boolean.");
  }
  if (
    typeof value.state !== "string" ||
    !PLUGIN_HOST_STATES.includes(value.state as PluginHostState)
  ) {
    throw new TypeError(`Invalid state: unsupported value "${String(value.state)}".`);
  }
  const internalPort = value.internalPort === null ? null : Number(value.internalPort);
  if (
    internalPort !== null &&
    (!Number.isInteger(internalPort) || internalPort < 1 || internalPort > 65_535)
  ) {
    throw new TypeError("Invalid internalPort: expected an integer from 1 through 65535.");
  }

  return {
    apiVersion: HEALTH_API_VERSION,
    internalPort,
    message: value.message,
    retryable: value.retryable,
    state: value.state as PluginHostState,
  };
}

export function parseErrorResponse(value: unknown): ErrorResponse {
  const response = requireRecord(value, "error response");
  const error = requireRecord(response.error, "error response.error");
  if (typeof error.retryable !== "boolean") {
    throw new TypeError("Invalid error response.error.retryable: expected a boolean.");
  }

  const parsed = {
    code: requireString(error.code, "error response.error.code"),
    message: requireString(error.message, "error response.error.message"),
    retryable: error.retryable,
  };

  return {
    error:
      error.context === undefined
        ? parsed
        : {
            ...parsed,
            context: requireRecord(error.context, "error response.error.context"),
          },
  };
}

export function parseSourcePluginCatalogResponse(
  value: unknown,
): SourcePluginCatalogResponse {
  const response = requireRecord(value, "Source Plugin catalog response");
  if (!Array.isArray(response.entries)) {
    throw new TypeError("Invalid entries: expected an array.");
  }

  const entries = response.entries.map((candidate, index): SourcePluginCatalogEntry => {
    const entry = requireRecord(candidate, `entries[${index}]`);
    const status = requireEnum(entry.status, `entries[${index}].status`, SOURCE_PLUGIN_STATUSES);
    const reasonCode =
      entry.reasonCode === null
        ? null
        : requireEnum(
            entry.reasonCode,
            `entries[${index}].reasonCode`,
            SOURCE_PLUGIN_REASON_CODES,
          );

    if ((status === "healthy") !== (reasonCode === null)) {
      throw new TypeError(
        `Invalid entries[${index}].reasonCode: healthy entries require null and unavailable entries require a reason.`,
      );
    }
    if (typeof entry.bindingsRefreshRequired !== "boolean") {
      throw new TypeError(
        `Invalid entries[${index}].bindingsRefreshRequired: expected a boolean.`,
      );
    }

    return {
      pluginKey: requireString(entry.pluginKey, `entries[${index}].pluginKey`),
      name: requireString(entry.name, `entries[${index}].name`),
      version: requireNullableString(entry.version, `entries[${index}].version`),
      status,
      reasonCode,
      observedAt: requireTimestamp(entry.observedAt, `entries[${index}].observedAt`),
      bindingsRefreshRequired: entry.bindingsRefreshRequired,
    };
  });

  const refresh = requireRecord(response.lastRefresh, "lastRefresh");
  const status = requireEnum(
    refresh.status,
    "lastRefresh.status",
    ["never", "healthy", "failed"] as const,
  );
  const observedAt =
    refresh.observedAt === null
      ? null
      : requireTimestamp(refresh.observedAt, "lastRefresh.observedAt");
  const reasonCode =
    refresh.reasonCode === null
      ? null
      : requireEnum(refresh.reasonCode, "lastRefresh.reasonCode", CATALOG_REFRESH_REASON_CODES);
  const message = requireNullableString(refresh.message, "lastRefresh.message");

  if (status === "never" && (observedAt !== null || reasonCode !== null || message !== null)) {
    throw new TypeError("Invalid lastRefresh: never requires null observation fields.");
  }
  if (status === "healthy" && (observedAt === null || reasonCode !== null || message !== null)) {
    throw new TypeError("Invalid lastRefresh: healthy requires a timestamp and no failure fields.");
  }
  if (status === "failed" && (observedAt === null || reasonCode === null || message === null)) {
    throw new TypeError("Invalid lastRefresh: failed requires timestamp, reasonCode, and message.");
  }

  return {
    entries,
    lastRefresh: { status, observedAt, reasonCode, message },
  };
}

export * from "./reading.ts";
