export const SETTINGS_PATH = "/api/v1/settings" as const;
export const SETTINGS_URL = `http://127.0.0.1:3210${SETTINGS_PATH}`;

export interface DailyReaderSettings {
  approvedSha256: string | null;
  jarPath: string | null;
  port: number;
  proxyUrl: string | null;
}

export interface SettingsResponse {
  restartRequired: boolean;
  settings: DailyReaderSettings;
  warning?: string;
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`Invalid ${context}: expected a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function exactFields(value: Record<string, unknown>, fields: readonly string[], context: string): void {
  const unexpected = Object.keys(value).find((key) => !fields.includes(key));
  if (unexpected) throw new TypeError(`Invalid ${context}: unexpected field "${unexpected}".`);
  const missing = fields.find((field) => !(field in value));
  if (missing) throw new TypeError(`Invalid ${context}: missing field "${missing}".`);
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`Invalid ${field}: expected a non-empty string or null.`);
  }
  return value.trim();
}

export function parseDailyReaderSettings(value: unknown): DailyReaderSettings {
  const settings = record(value, "settings");
  exactFields(settings, ["approvedSha256", "jarPath", "port", "proxyUrl"], "settings");
  const approvedSha256 = nullableString(settings.approvedSha256, "approvedSha256");
  const jarPath = nullableString(settings.jarPath, "jarPath");
  if ((jarPath === null) !== (approvedSha256 === null)) {
    throw new TypeError("Invalid settings: both jarPath and approvedSha256 must be configured together.");
  }
  if (approvedSha256 !== null && !/^[a-f\d]{64}$/i.test(approvedSha256)) {
    throw new TypeError("Invalid approvedSha256: expected exactly 64 hexadecimal characters.");
  }
  if (!Number.isInteger(settings.port) || (settings.port as number) < 1_024 || (settings.port as number) > 65_535) {
    throw new TypeError("Invalid port: expected an integer from 1024 through 65535 for a loopback Plugin Host.");
  }
  const proxyUrl = nullableString(settings.proxyUrl, "proxyUrl");
  if (proxyUrl !== null) {
    let proxy: URL;
    try {
      proxy = new URL(proxyUrl);
    } catch {
      throw new TypeError("Invalid proxyUrl: expected an HTTP proxy URL.");
    }
    if (proxy.protocol !== "http:" || !proxy.hostname || proxy.username || proxy.password || proxy.pathname !== "/" || proxy.search || proxy.hash) {
      throw new TypeError("Invalid proxyUrl: expected an HTTP proxy URL without credentials, path, query, or fragment.");
    }
  }
  return { approvedSha256, jarPath, port: settings.port as number, proxyUrl };
}

export function parseSettingsUpdateRequest(value: unknown): DailyReaderSettings {
  return parseDailyReaderSettings(value);
}

export function parseSettingsResponse(value: unknown): SettingsResponse {
  const response = record(value, "settings response");
  const fields = ["restartRequired", "settings", "warning"] as const;
  const unexpected = Object.keys(response).find((key) => !fields.includes(key as typeof fields[number]));
  if (unexpected) throw new TypeError(`Invalid settings response: unexpected field "${unexpected}".`);
  if (typeof response.restartRequired !== "boolean") {
    throw new TypeError("Invalid restartRequired: expected a boolean.");
  }
  if (response.warning !== undefined && (typeof response.warning !== "string" || response.warning.trim() === "")) {
    throw new TypeError("Invalid warning: expected a non-empty string when present.");
  }
  return {
    restartRequired: response.restartRequired,
    settings: parseDailyReaderSettings(response.settings),
    ...(response.warning === undefined ? {} : { warning: response.warning }),
  };
}
