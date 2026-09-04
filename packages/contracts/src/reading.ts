import { LOCAL_CORE_ORIGIN } from "./index.ts";

export const CATALOG_SEARCH_PATH = "/api/v1/catalog/search" as const;
export const LIBRARY_ITEMS_PATH = "/api/v1/library-items" as const;
export const READING_SOURCE_PLUGIN_PATH = "/api/v1/reading/source-plugin" as const;
export const READER_SESSIONS_PATH = "/api/v1/reader-sessions" as const;

export const FIXTURE_SOURCE_PLUGIN = Object.freeze({
  key: "fixture:reader",
  name: "Comic Free Fixture Reader",
});

export const SOURCE_BINDING_REASON_CODES = [
  "disabled",
  "missing",
  "incompatible",
  "plugin_host_unavailable",
  "comic_provider_unreachable",
  "refresh_failed",
  "unresolved_catalog_item",
  "unknown",
] as const;

export type SourceBindingReasonCode = (typeof SOURCE_BINDING_REASON_CODES)[number];

export interface ApiErrorResponse {
  error: {
    code: string;
    context?: Record<string, string | number | boolean>;
    message: string;
    retryable: boolean;
  };
}

export interface CatalogSearchItem {
  comicKey: string;
  coverRef: string;
  sourcePluginKey: string;
  sourcePluginName: string;
  title: string;
}

export interface CatalogSearchResponse {
  items: CatalogSearchItem[];
}

export interface ReadingSourcePluginResponse {
  sourcePlugin: {
    key: string;
    name: string;
  };
}

export interface ComicDetailsResponse {
  comic: CatalogSearchItem & {
    comicProviderKey: string;
    description: string;
  };
}

export interface CatalogChaptersResponse {
  items: Array<{
    chapterKey: string;
    label: string;
  }>;
}

export type CreateReaderSessionRequest =
  | {
      chapterKey: string;
      comicKey: string;
      sourcePluginKey: string;
    }
  | { libraryItemId: string };

export interface ReaderSessionResponse {
  session: {
    chapterKey: string;
    chapterLabel: string;
    comicKey: string;
    id: string;
    pageCount: number;
    pageIndex: number;
    pageUrl: string;
    sourcePluginKey: string;
    sourcePluginName: string;
    title: string;
  };
}

export interface RetainLibraryItemRequest {
  pageIndex: number;
  sessionId: string;
}

export interface UpdateProgressRequest {
  chapterKey: string;
  chapterLabel: string;
  pageCount: number;
  pageIndex: number;
}

export interface LibraryItem {
  createdAt: string;
  id: string;
  progress: UpdateProgressRequest & { updatedAt: string };
  snapshot: {
    coverRef: string;
    title: string;
    updatedAt: string;
  };
  sourceBinding: {
    availability: "available" | "unavailable";
    comicProviderKey: string;
    durableComicKey: string;
    id: string;
    observedAt: string;
    reasonCode: SourceBindingReasonCode | null;
    sourcePluginKey: string;
    updatedAt: string;
  };
}

export interface LibraryItemsResponse {
  items: LibraryItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`Invalid ${context}: expected a JSON object.`);
  return value;
}

function exactFields(
  value: Record<string, unknown>,
  expected: readonly string[],
  context: string,
): void {
  const unexpected = Object.keys(value).find((key) => !expected.includes(key));
  if (unexpected) throw new TypeError(`Invalid ${context}: unexpected field "${unexpected}".`);
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`Invalid ${field}: expected a non-empty string.`);
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  const result = string(value, field);
  if (Number.isNaN(Date.parse(result))) {
    throw new TypeError(`Invalid ${field}: expected an ISO timestamp.`);
  }
  return result;
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new TypeError(`Invalid ${field}: expected an integer >= ${minimum}.`);
  }
  return value as number;
}

function enumValue<T extends string>(
  value: unknown,
  field: string,
  choices: readonly T[],
): T {
  if (typeof value !== "string" || !choices.includes(value as T)) {
    throw new TypeError(`Invalid ${field}: unsupported value "${String(value)}".`);
  }
  return value as T;
}

function catalogItem(value: unknown, context: string): CatalogSearchItem {
  const item = record(value, context);
  exactFields(
    item,
    ["comicKey", "coverRef", "sourcePluginKey", "sourcePluginName", "title"],
    context,
  );
  return {
    comicKey: string(item.comicKey, `${context}.comicKey`),
    coverRef: string(item.coverRef, `${context}.coverRef`),
    sourcePluginKey: string(item.sourcePluginKey, `${context}.sourcePluginKey`),
    sourcePluginName: string(item.sourcePluginName, `${context}.sourcePluginName`),
    title: string(item.title, `${context}.title`),
  };
}

export function parseCatalogSearchResponse(value: unknown): CatalogSearchResponse {
  const response = record(value, "catalog search response");
  exactFields(response, ["items"], "catalog search response");
  if (!Array.isArray(response.items)) {
    throw new TypeError("Invalid items: expected an array.");
  }
  return {
    items: response.items.map((item, index) => catalogItem(item, `items[${index}]`)),
  };
}

export function parseReadingSourcePluginResponse(
  value: unknown,
): ReadingSourcePluginResponse {
  const response = record(value, "reading Source Plugin response");
  exactFields(response, ["sourcePlugin"], "reading Source Plugin response");
  const sourcePlugin = record(response.sourcePlugin, "sourcePlugin");
  exactFields(sourcePlugin, ["key", "name"], "sourcePlugin");
  return {
    sourcePlugin: {
      key: string(sourcePlugin.key, "sourcePlugin.key"),
      name: string(sourcePlugin.name, "sourcePlugin.name"),
    },
  };
}

export function parseComicDetailsResponse(value: unknown): ComicDetailsResponse {
  const response = record(value, "comic details response");
  exactFields(response, ["comic"], "comic details response");
  const comic = record(response.comic, "comic");
  exactFields(
    comic,
    [
      "comicKey",
      "comicProviderKey",
      "coverRef",
      "description",
      "sourcePluginKey",
      "sourcePluginName",
      "title",
    ],
    "comic",
  );
  return {
    comic: {
      comicKey: string(comic.comicKey, "comic.comicKey"),
      comicProviderKey: string(comic.comicProviderKey, "comic.comicProviderKey"),
      coverRef: string(comic.coverRef, "comic.coverRef"),
      description: string(comic.description, "comic.description"),
      sourcePluginKey: string(comic.sourcePluginKey, "comic.sourcePluginKey"),
      sourcePluginName: string(comic.sourcePluginName, "comic.sourcePluginName"),
      title: string(comic.title, "comic.title"),
    },
  };
}

export function parseCatalogChaptersResponse(value: unknown): CatalogChaptersResponse {
  const response = record(value, "catalog chapters response");
  exactFields(response, ["items"], "catalog chapters response");
  if (!Array.isArray(response.items)) throw new TypeError("Invalid items: expected an array.");
  return {
    items: response.items.map((candidate, index) => {
      const item = record(candidate, `items[${index}]`);
      exactFields(item, ["chapterKey", "label"], `items[${index}]`);
      return {
        chapterKey: string(item.chapterKey, `items[${index}].chapterKey`),
        label: string(item.label, `items[${index}].label`),
      };
    }),
  };
}

export function parseCreateReaderSessionRequest(value: unknown): CreateReaderSessionRequest {
  const request = record(value, "reader session request");
  if ("libraryItemId" in request) {
    exactFields(request, ["libraryItemId"], "reader session request");
    return { libraryItemId: string(request.libraryItemId, "libraryItemId") };
  }
  exactFields(
    request,
    ["chapterKey", "comicKey", "sourcePluginKey"],
    "reader session request",
  );
  return {
    chapterKey: string(request.chapterKey, "chapterKey"),
    comicKey: string(request.comicKey, "comicKey"),
    sourcePluginKey: string(request.sourcePluginKey, "sourcePluginKey"),
  };
}

export function parseRetainLibraryItemRequest(value: unknown): RetainLibraryItemRequest {
  const request = record(value, "retain Library Item request");
  exactFields(request, ["pageIndex", "sessionId"], "retain Library Item request");
  return {
    pageIndex: integer(request.pageIndex, "pageIndex"),
    sessionId: string(request.sessionId, "sessionId"),
  };
}

export function parseUpdateProgressRequest(value: unknown): UpdateProgressRequest {
  const request = record(value, "Reading Progress request");
  exactFields(
    request,
    ["chapterKey", "chapterLabel", "pageCount", "pageIndex"],
    "Reading Progress request",
  );
  const pageCount = integer(request.pageCount, "pageCount", 1);
  const pageIndex = integer(request.pageIndex, "pageIndex");
  if (pageIndex >= pageCount) {
    throw new TypeError(`Invalid pageIndex: expected a value below pageCount (${pageCount}).`);
  }
  return {
    chapterKey: string(request.chapterKey, "chapterKey"),
    chapterLabel: string(request.chapterLabel, "chapterLabel"),
    pageCount,
    pageIndex,
  };
}

export function parseReaderSessionResponse(value: unknown): ReaderSessionResponse {
  const response = record(value, "reader session response");
  exactFields(response, ["session"], "reader session response");
  const session = record(response.session, "session");
  exactFields(
    session,
    [
      "chapterKey",
      "chapterLabel",
      "comicKey",
      "id",
      "pageCount",
      "pageIndex",
      "pageUrl",
      "sourcePluginKey",
      "sourcePluginName",
      "title",
    ],
    "session",
  );
  const pageCount = integer(session.pageCount, "session.pageCount", 1);
  const pageIndex = integer(session.pageIndex, "session.pageIndex");
  if (pageIndex >= pageCount) {
    throw new TypeError("Invalid session.pageIndex: expected a value below pageCount.");
  }
  const pageUrl = string(session.pageUrl, "session.pageUrl");
  if (!pageUrl.startsWith(`${LOCAL_CORE_ORIGIN}${READER_SESSIONS_PATH}/`)) {
    throw new TypeError("Invalid session.pageUrl: expected a Local Core reader-session URL.");
  }
  return {
    session: {
      chapterKey: string(session.chapterKey, "session.chapterKey"),
      chapterLabel: string(session.chapterLabel, "session.chapterLabel"),
      comicKey: string(session.comicKey, "session.comicKey"),
      id: string(session.id, "session.id"),
      pageCount,
      pageIndex,
      pageUrl,
      sourcePluginKey: string(session.sourcePluginKey, "session.sourcePluginKey"),
      sourcePluginName: string(session.sourcePluginName, "session.sourcePluginName"),
      title: string(session.title, "session.title"),
    },
  };
}

function libraryItem(value: unknown, context: string): LibraryItem {
  const item = record(value, context);
  exactFields(item, ["createdAt", "id", "progress", "snapshot", "sourceBinding"], context);
  const snapshot = record(item.snapshot, `${context}.snapshot`);
  exactFields(snapshot, ["coverRef", "title", "updatedAt"], `${context}.snapshot`);
  const sourceBinding = record(item.sourceBinding, `${context}.sourceBinding`);
  exactFields(
    sourceBinding,
    [
      "availability",
      "comicProviderKey",
      "durableComicKey",
      "id",
      "observedAt",
      "reasonCode",
      "sourcePluginKey",
      "updatedAt",
    ],
    `${context}.sourceBinding`,
  );
  const progress = record(item.progress, `${context}.progress`);
  exactFields(
    progress,
    ["chapterKey", "chapterLabel", "pageCount", "pageIndex", "updatedAt"],
    `${context}.progress`,
  );
  const availability = enumValue(
    sourceBinding.availability,
    `${context}.sourceBinding.availability`,
    ["available", "unavailable"] as const,
  );
  const reasonCode =
    sourceBinding.reasonCode === null
      ? null
      : enumValue(
          sourceBinding.reasonCode,
          `${context}.sourceBinding.reasonCode`,
          SOURCE_BINDING_REASON_CODES,
        );
  if ((availability === "available") !== (reasonCode === null)) {
    throw new TypeError(
      `Invalid ${context}.sourceBinding.reasonCode: available requires null and unavailable requires a reason.`,
    );
  }
  const parsedProgress = parseUpdateProgressRequest({
    chapterKey: progress.chapterKey,
    chapterLabel: progress.chapterLabel,
    pageCount: progress.pageCount,
    pageIndex: progress.pageIndex,
  });
  return {
    createdAt: timestamp(item.createdAt, `${context}.createdAt`),
    id: string(item.id, `${context}.id`),
    progress: {
      ...parsedProgress,
      updatedAt: timestamp(progress.updatedAt, `${context}.progress.updatedAt`),
    },
    snapshot: {
      coverRef: string(snapshot.coverRef, `${context}.snapshot.coverRef`),
      title: string(snapshot.title, `${context}.snapshot.title`),
      updatedAt: timestamp(snapshot.updatedAt, `${context}.snapshot.updatedAt`),
    },
    sourceBinding: {
      availability,
      comicProviderKey: string(
        sourceBinding.comicProviderKey,
        `${context}.sourceBinding.comicProviderKey`,
      ),
      durableComicKey: string(
        sourceBinding.durableComicKey,
        `${context}.sourceBinding.durableComicKey`,
      ),
      id: string(sourceBinding.id, `${context}.sourceBinding.id`),
      observedAt: timestamp(sourceBinding.observedAt, `${context}.sourceBinding.observedAt`),
      reasonCode,
      sourcePluginKey: string(
        sourceBinding.sourcePluginKey,
        `${context}.sourceBinding.sourcePluginKey`,
      ),
      updatedAt: timestamp(sourceBinding.updatedAt, `${context}.sourceBinding.updatedAt`),
    },
  };
}

export function parseLibraryItemResponse(value: unknown): { item: LibraryItem } {
  const response = record(value, "Library Item response");
  exactFields(response, ["item"], "Library Item response");
  return { item: libraryItem(response.item, "item") };
}

export function parseLibraryItemsResponse(value: unknown): LibraryItemsResponse {
  const response = record(value, "Library Items response");
  exactFields(response, ["items"], "Library Items response");
  if (!Array.isArray(response.items)) throw new TypeError("Invalid items: expected an array.");
  return {
    items: response.items.map((item, index) => libraryItem(item, `items[${index}]`)),
  };
}

export function parseApiErrorResponse(value: unknown): ApiErrorResponse {
  const response = record(value, "API error response");
  exactFields(response, ["error"], "API error response");
  const error = record(response.error, "error");
  exactFields(error, ["code", "context", "message", "retryable"], "error");
  if (typeof error.retryable !== "boolean") {
    throw new TypeError("Invalid error.retryable: expected a boolean.");
  }
  const context = error.context === undefined ? undefined : record(error.context, "error.context");
  if (
    context &&
    Object.values(context).some(
      (candidate) =>
        typeof candidate !== "string" &&
        typeof candidate !== "number" &&
        typeof candidate !== "boolean",
    )
  ) {
    throw new TypeError("Invalid error.context: values must be strings, numbers, or booleans.");
  }
  return {
    error: {
      code: string(error.code, "error.code"),
      ...(context ? { context: context as Record<string, string | number | boolean> } : {}),
      message: string(error.message, "error.message"),
      retryable: error.retryable,
    },
  };
}

export function catalogSearchUrl(sourcePluginKey: string, query: string): string {
  const url = new URL(`${LOCAL_CORE_ORIGIN}${CATALOG_SEARCH_PATH}`);
  url.searchParams.set("sourcePluginKey", sourcePluginKey);
  url.searchParams.set("q", query);
  return url.href;
}

export function comicDetailsUrl(sourcePluginKey: string, comicKey: string): string {
  const url = new URL(
    `${LOCAL_CORE_ORIGIN}/api/v1/catalog/comics/${encodeURIComponent(comicKey)}`,
  );
  url.searchParams.set("sourcePluginKey", sourcePluginKey);
  return url.href;
}

export function comicChaptersUrl(sourcePluginKey: string, comicKey: string): string {
  const url = new URL(
    `${LOCAL_CORE_ORIGIN}/api/v1/catalog/comics/${encodeURIComponent(comicKey)}/chapters`,
  );
  url.searchParams.set("sourcePluginKey", sourcePluginKey);
  return url.href;
}

export function readerPageUrl(sessionId: string, pageIndex: number): string {
  return `${LOCAL_CORE_ORIGIN}${READER_SESSIONS_PATH}/${encodeURIComponent(sessionId)}/pages/${pageIndex}`;
}
