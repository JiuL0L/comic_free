export const HEALTH_API_VERSION = "v1" as const;
export const LOCAL_CORE_SERVICE = "comic-free-local-core" as const;
export const LOCAL_CORE_HOST = "127.0.0.1" as const;
export const LOCAL_CORE_PORT = 3210;
export const LOCAL_CORE_ORIGIN = `http://${LOCAL_CORE_HOST}:${LOCAL_CORE_PORT}`;
export const CORE_HEALTH_PATH = "/api/v1/health" as const;
export const CORE_HEALTH_URL = `${LOCAL_CORE_ORIGIN}${CORE_HEALTH_PATH}`;
export const WEB_UI_HOST = "127.0.0.1" as const;
export const WEB_UI_PORT = 5173;
export const WEB_UI_ORIGIN = `http://${WEB_UI_HOST}:${WEB_UI_PORT}`;
export const WEB_UI_URL = `${WEB_UI_ORIGIN}/`;

export interface HealthResponse {
  apiVersion: typeof HEALTH_API_VERSION;
  service: typeof LOCAL_CORE_SERVICE;
  status: "ready";
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

export * from "./reading.ts";
