import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  parseDailyReaderSettings,
  type DailyReaderSettings,
  type SettingsResponse,
} from "@comic-free/contracts";

export const DEFAULT_DAILY_READER_SETTINGS: DailyReaderSettings = {
  approvedSha256: null,
  jarPath: null,
  port: 4568,
  proxyUrl: null,
};

export const INVALID_SAVED_SETTINGS_WARNING =
  "Saved daily reader settings could not be read. Comic Free is using safe defaults until you save valid settings.";

export interface RecoveredDailyReaderSettings {
  settings: DailyReaderSettings;
  warning?: string;
}

export class SettingsStore {
  readonly #directory: string;
  readonly #filePath: string;

  constructor(dataDirectory: string) {
    this.#directory = path.resolve(dataDirectory);
    this.#filePath = path.join(this.#directory, "settings.json");
  }

  async read(): Promise<DailyReaderSettings> {
    let source: string;
    try {
      source = await readFile(this.#filePath, "utf8");
    } catch (error: unknown) {
      if (isMissingFile(error)) return { ...DEFAULT_DAILY_READER_SETTINGS };
      throw error;
    }
    try {
      return parseDailyReaderSettings(JSON.parse(source) as unknown);
    } catch {
      throw new TypeError("Saved daily reader settings are invalid. Correct settings.json or save valid setup values.");
    }
  }

  async readRecovering(): Promise<RecoveredDailyReaderSettings> {
    try {
      return { settings: await this.read() };
    } catch (error) {
      if (error instanceof TypeError) {
        return {
          settings: { ...DEFAULT_DAILY_READER_SETTINGS },
          warning: INVALID_SAVED_SETTINGS_WARNING,
        };
      }
      throw error;
    }
  }

  async write(settings: DailyReaderSettings): Promise<void> {
    const validated = parseDailyReaderSettings(settings);
    await mkdir(this.#directory, { recursive: true });
    const temporaryPath = path.join(this.#directory, `.settings-${process.pid}-${randomUUID()}.tmp`);
    let renamed = false;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(validated)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.#filePath);
      renamed = true;
    } finally {
      if (!renamed) await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

export class SettingsService {
  readonly #store: SettingsStore;
  readonly #runningSettings: DailyReaderSettings;

  constructor(store: SettingsStore, runningSettings: DailyReaderSettings) {
    this.#store = store;
    this.#runningSettings = parseDailyReaderSettings(runningSettings);
  }

  async read(): Promise<SettingsResponse> {
    const recovered = await this.#store.readRecovering();
    return this.#response(recovered.settings, recovered.warning);
  }

  async save(settings: DailyReaderSettings): Promise<SettingsResponse> {
    const validated = parseDailyReaderSettings(settings);
    await this.#store.write(validated);
    return this.#response(validated);
  }

  #response(settings: DailyReaderSettings, warning?: string): SettingsResponse {
    return {
      restartRequired: !sameSettings(settings, this.#runningSettings),
      settings,
      ...(warning === undefined ? {} : { warning }),
    };
  }
}

export interface LoadedDailyReaderSettings {
  effectiveSettings: DailyReaderSettings;
  persistedSettings: DailyReaderSettings;
  warning?: string;
}

export async function loadEffectiveSettings(
  dataDirectory: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<LoadedDailyReaderSettings> {
  const recovered = await new SettingsStore(dataDirectory).readRecovering();
  const persistedSettings = recovered.settings;
  const candidate = {
    approvedSha256: environmentValue(environment.COMIC_FREE_SUWAYOMI_APPROVED_SHA256) ?? persistedSettings.approvedSha256,
    jarPath: environmentValue(environment.COMIC_FREE_SUWAYOMI_JAR) ?? persistedSettings.jarPath,
    port: environmentPort(environment.COMIC_FREE_SUWAYOMI_PORT) ?? persistedSettings.port,
    proxyUrl: environmentValue(environment.COMIC_FREE_SUWAYOMI_PROXY) ?? persistedSettings.proxyUrl,
  };
  return {
    effectiveSettings: parseDailyReaderSettings(candidate),
    persistedSettings,
    ...(recovered.warning === undefined ? {} : { warning: recovered.warning }),
  };
}

function environmentValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function environmentPort(value: string | undefined): number | undefined {
  const trimmed = environmentValue(value);
  if (trimmed === undefined) return undefined;
  if (!/^\d+$/.test(trimmed)) throw new TypeError("COMIC_FREE_SUWAYOMI_PORT must be an integer.");
  return Number(trimmed);
}

function sameSettings(left: DailyReaderSettings, right: DailyReaderSettings): boolean {
  return left.approvedSha256 === right.approvedSha256 && left.jarPath === right.jarPath && left.port === right.port && left.proxyUrl === right.proxyUrl;
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
