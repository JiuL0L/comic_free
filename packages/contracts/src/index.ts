export const HEALTH_API_VERSION = "v1" as const;
export const LOCAL_CORE_SERVICE = "comic-free-local-core" as const;
export const LOCAL_CORE_HOST = "127.0.0.1" as const;
export const LOCAL_CORE_PORT = 3210;
export const LOCAL_CORE_ORIGIN = `http://${LOCAL_CORE_HOST}:${LOCAL_CORE_PORT}`;
export const CORE_HEALTH_PATH = "/api/v1/health" as const;
export const CORE_HEALTH_URL = `${LOCAL_CORE_ORIGIN}${CORE_HEALTH_PATH}`;
export const PLUGIN_HOST_STATUS_PATH = "/api/v1/plugin-host/status" as const;
export const PLUGIN_HOST_STATUS_URL = `${LOCAL_CORE_ORIGIN}${PLUGIN_HOST_STATUS_PATH}`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
