import { readFile } from "node:fs/promises";

import type {
  CatalogRefreshReasonCode,
} from "@comic-free/contracts";

import type {
  FailedCatalogRefresh,
  SourcePluginObservation,
  SuccessfulCatalogRefresh,
} from "./catalog-store.ts";

export type CatalogRefreshResult =
  | ({ outcome: "success" } & SuccessfulCatalogRefresh)
  | ({ outcome: "failure" } & FailedCatalogRefresh);

export interface CatalogAdapter {
  refresh: () => Promise<CatalogRefreshResult>;
}

interface FixtureFileResult {
  delayMs?: number;
  entries?: SourcePluginObservation[];
  message?: string;
  observedAt?: string;
  outcome?: "success" | "failure";
  reasonCode?: CatalogRefreshReasonCode;
}

const defaultEntries: SourcePluginObservation[] = [
  {
    pluginKey: "fixture:reader",
    name: "Comic Free Fixture Reader",
    version: "1.0.0",
    status: "healthy",
    reasonCode: null,
    removalEvidence: "none",
    reportedObsolete: false,
  },
];

function parseFixtureResult(value: unknown): CatalogRefreshResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Catalog fixture must contain a JSON object.");
  }
  const fixture = value as FixtureFileResult;
  const observedAt = fixture.observedAt ?? new Date().toISOString();

  if (fixture.outcome === "success" && Array.isArray(fixture.entries)) {
    return { outcome: "success", observedAt, entries: fixture.entries };
  }
  if (
    fixture.outcome === "failure" &&
    typeof fixture.reasonCode === "string" &&
    typeof fixture.message === "string"
  ) {
    return {
      outcome: "failure",
      observedAt,
      reasonCode: fixture.reasonCode,
      message: fixture.message,
    };
  }
  throw new TypeError("Catalog fixture does not describe a valid refresh outcome.");
}

export class FixtureCatalogAdapter implements CatalogAdapter {
  readonly #fixturePath: string | undefined;

  constructor(fixturePath?: string) {
    this.#fixturePath = fixturePath;
  }

  async refresh(): Promise<CatalogRefreshResult> {
    if (!this.#fixturePath) {
      return {
        outcome: "success",
        observedAt: new Date().toISOString(),
        entries: defaultEntries,
      };
    }

    const contents = await readFile(this.#fixturePath, "utf8");
    const value = JSON.parse(contents) as unknown;
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      typeof (value as FixtureFileResult).delayMs === "number"
    ) {
      await new Promise((resolve) => setTimeout(resolve, (value as FixtureFileResult).delayMs));
    }
    return parseFixtureResult(value);
  }
}
