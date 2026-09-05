import type {
  CatalogSearchItem,
  ComicDetailsResponse,
} from "@comic-free/contracts";

import {
  ReadingAdapterError,
  type ReadingAdapter,
  type ReadingChapter,
  type ReadingPage,
  type ResolvedChapter,
} from "./reading-adapter.ts";

const COMIC_KEY_PREFIX = "suwayomi:comic:v1:";
const CHAPTER_KEY_PREFIX = "suwayomi:chapter:v1:";
const DEFAULT_MAX_PAGE_BYTES = 20 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface SuwayomiGraphqlTransport {
  request: (
    operation: string,
    variables: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<unknown>;
}

export interface SuwayomiReadingAdapterOptions {
  comicProviderKey: string;
  graphql?: SuwayomiGraphqlTransport;
  maxPageBytes?: number;
  pageFetch?: FetchLike;
  requestTimeoutMs?: number;
  sourceId: string;
  sourcePluginKey: string;
  sourcePluginName: string;
  suwayomiOrigin: string | (() => string | null);
}

interface DurableComicReference {
  title: string;
  url: string;
}

interface DurableChapterReference {
  label: string;
  url: string;
}

interface SuwayomiManga {
  id: number;
  title: string;
  url: string;
}

interface SuwayomiMangaDetails extends SuwayomiManga {
  description: string;
}

interface SuwayomiChapter {
  id: number;
  label: string;
  url: string;
}

class SuwayomiResponseError extends Error {
  constructor(readonly kind: "graphql" | "host" | "invalid") {
    super(kind);
    this.name = "SuwayomiResponseError";
  }
}

const SEARCH_OPERATION = `
  mutation ComicFreeSearch($input: FetchSourceMangaInput!) {
    fetchSourceManga(input: $input) {
      hasNextPage
      mangas { id title url thumbnailUrl }
    }
  }
`;

const DETAILS_OPERATION = `
  mutation ComicFreeDetails($input: FetchMangaInput!) {
    fetchManga(input: $input) {
      manga { id title description url thumbnailUrl }
    }
  }
`;

const CHAPTERS_OPERATION = `
  mutation ComicFreeChapters($input: FetchChaptersInput!) {
    fetchChapters(input: $input) {
      chapters { id name url chapterNumber scanlator }
    }
  }
`;

const PAGES_OPERATION = `
  mutation ComicFreePages($input: FetchChapterPagesInput!) {
    fetchChapterPages(input: $input) {
      chapter { id name pageCount }
      pages
    }
  }
`;

export class FetchSuwayomiGraphqlTransport implements SuwayomiGraphqlTransport {
  readonly #fetch: FetchLike;
  readonly #origin: () => string | null;
  readonly #timeoutMs: number;

  constructor(
    origin: string | (() => string | null),
    requestFetch: FetchLike = fetch,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ) {
    this.#origin = originProvider(origin);
    this.#fetch = requestFetch;
    this.#timeoutMs = positiveInteger(timeoutMs, "Suwayomi request timeout");
  }

  async request(
    operation: string,
    variables: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const origin = this.#origin();
    if (!origin) throw new SuwayomiResponseError("host");
    try {
      const response = await this.#fetch(`${validatedLoopbackOrigin(origin)}/api/graphql`, {
        body: JSON.stringify({ query: operation, variables }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: combinedSignal(signal, this.#timeoutMs),
      });
      if (!response.ok) throw new SuwayomiResponseError("host");
      return await response.json();
    } catch (error) {
      if (error instanceof SuwayomiResponseError) throw error;
      throw new SuwayomiResponseError("host");
    }
  }
}

export class SuwayomiReadingAdapter implements ReadingAdapter {
  readonly sourcePlugin: Readonly<{ key: string; name: string }>;
  readonly #comicProviderKey: string;
  readonly #graphql: SuwayomiGraphqlTransport;
  readonly #maxPageBytes: number;
  readonly #origin: () => string | null;
  readonly #pageFetch: FetchLike;
  readonly #requestTimeoutMs: number;
  readonly #sourceId: string;

  constructor(options: SuwayomiReadingAdapterOptions) {
    this.sourcePlugin = Object.freeze({
      key: requiredString(options.sourcePluginKey, "Source Plugin key"),
      name: requiredString(options.sourcePluginName, "Source Plugin name"),
    });
    this.#comicProviderKey = requiredString(
      options.comicProviderKey,
      "Comic Provider key",
    );
    this.#sourceId = requiredString(options.sourceId, "Suwayomi source id");
    this.#origin = originProvider(options.suwayomiOrigin);
    this.#pageFetch = options.pageFetch ?? fetch;
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      "Suwayomi request timeout",
    );
    this.#maxPageBytes = positiveInteger(
      options.maxPageBytes ?? DEFAULT_MAX_PAGE_BYTES,
      "maximum page size",
    );
    this.#graphql =
      options.graphql ??
      new FetchSuwayomiGraphqlTransport(
        this.#origin,
        this.#pageFetch,
        options.requestTimeoutMs,
      );
  }

  async search(query: string): Promise<CatalogSearchItem[]> {
    return this.#normalize(async () => {
      const mangas = await this.#searchMangas(requiredString(query, "search query"));
      return mangas.map((manga) => this.#catalogItem(manga));
    });
  }

  async getDetails(comicKey: string): Promise<ComicDetailsResponse["comic"]> {
    return this.#normalize(async () => {
      const reference = decodeReference<DurableComicReference>(
        comicKey,
        COMIC_KEY_PREFIX,
        "comic",
      );
      const runtimeManga = await this.#resolveManga(reference);
      const details = parseDetailsResponse(
        await this.#graphql.request(DETAILS_OPERATION, { input: { id: runtimeManga.id } }),
      );
      if (normalizeProviderUrl(details.url) !== normalizeProviderUrl(reference.url)) {
        throw unresolvedComic();
      }
      return this.#details(comicKey, details);
    });
  }

  async getChapters(comicKey: string): Promise<ReadingChapter[]> {
    return this.#normalize(async () => {
      const reference = decodeReference<DurableComicReference>(
        comicKey,
        COMIC_KEY_PREFIX,
        "comic",
      );
      const runtimeManga = await this.#resolveManga(reference);
      const chapters = await this.#fetchChapters(runtimeManga.id);
      return chapters.map((chapter) => ({
        chapterKey: encodeReference(CHAPTER_KEY_PREFIX, {
          label: chapter.label,
          url: chapter.url,
        }),
        label: chapter.label,
      }));
    });
  }

  async resolveChapter(
    comicKey: string,
    chapterKey: string,
  ): Promise<ResolvedChapter> {
    return this.#normalize(async () => {
      const comicReference = decodeReference<DurableComicReference>(
        comicKey,
        COMIC_KEY_PREFIX,
        "comic",
      );
      const chapterReference = decodeReference<DurableChapterReference>(
        chapterKey,
        CHAPTER_KEY_PREFIX,
        "chapter",
      );
      const runtimeManga = await this.#resolveManga(comicReference);
      const [details, chapters] = await Promise.all([
        this.#graphql
          .request(DETAILS_OPERATION, { input: { id: runtimeManga.id } })
          .then(parseDetailsResponse),
        this.#fetchChapters(runtimeManga.id),
      ]);
      const runtimeChapter = chapters.find(
        (candidate) =>
          normalizeProviderUrl(candidate.url) ===
          normalizeProviderUrl(chapterReference.url),
      );
      if (!runtimeChapter) {
        throw new ReadingAdapterError(
          "chapter_not_found",
          "The chapter could not be re-resolved from its durable Comic Provider identity.",
          true,
        );
      }
      const pageKeys = parsePagesResponse(
        await this.#graphql.request(PAGES_OPERATION, {
          input: { chapterId: runtimeChapter.id },
        }),
      );
      if (pageKeys.length === 0) {
        throw new ReadingAdapterError(
          "unsafe_page_reference",
          "The Comic Provider returned no readable pages for this chapter.",
          true,
        );
      }
      return {
        chapter: { chapterKey, label: runtimeChapter.label },
        comic: this.#details(comicKey, details),
        pageKeys,
      };
    });
  }

  async readPage(pageKey: string, signal?: AbortSignal): Promise<ReadingPage> {
    return this.#normalize(async () => {
      const origin = this.#origin();
      if (!origin) throw new SuwayomiResponseError("host");
      const allowedOrigin = validatedLoopbackOrigin(origin);
      let url: URL;
      try {
        url = new URL(pageKey, `${allowedOrigin}/`);
      } catch {
        throw new ReadingAdapterError(
          "unsafe_page_reference",
          "The resolved page reference is invalid.",
          false,
        );
      }
      if (url.origin !== allowedOrigin) {
        throw new ReadingAdapterError(
          "unsafe_page_reference",
          "The resolved page reference is outside the configured Plugin Host.",
          false,
        );
      }
      const pageSignal = combinedSignal(signal, this.#requestTimeoutMs);
      try {
        const response = await this.#pageFetch(url, {
          method: "GET",
          redirect: "error",
          signal: pageSignal,
        });
        if (!response.ok) {
          throw new ReadingAdapterError(
            "comic_provider_unreachable",
            `The Comic Provider page request failed with HTTP ${response.status}.`,
            response.status >= 500,
          );
        }
        const contentType = response.headers.get("content-type")?.trim() ?? "";
        if (!isImageContentType(contentType)) {
          throw new ReadingAdapterError(
            "invalid_page_type",
            "The Comic Provider returned a non-image page response.",
            false,
          );
        }
        const bytes = await readBoundedBody(response, this.#maxPageBytes);
        return { bytes, contentType };
      } catch (error) {
        if (pageSignal.aborted && !(error instanceof ReadingAdapterError)) {
          throw new ReadingAdapterError(
            "page_timeout",
            `The Comic Provider page request timed out after ${this.#requestTimeoutMs} ms.`,
            true,
          );
        }
        throw error;
      }
    });
  }

  async #searchMangas(query: string): Promise<SuwayomiManga[]> {
    return parseSearchResponse(
      await this.#graphql.request(SEARCH_OPERATION, {
        input: { page: 1, query, source: this.#sourceId, type: "SEARCH" },
      }),
    );
  }

  async #resolveManga(reference: DurableComicReference): Promise<SuwayomiManga> {
    const candidates = await this.#searchMangas(reference.title);
    const match = candidates.find(
      (candidate) =>
        normalizeProviderUrl(candidate.url) === normalizeProviderUrl(reference.url),
    );
    if (!match) throw unresolvedComic();
    return match;
  }

  async #fetchChapters(runtimeMangaId: number): Promise<SuwayomiChapter[]> {
    return parseChaptersResponse(
      await this.#graphql.request(CHAPTERS_OPERATION, {
        input: { mangaId: runtimeMangaId },
      }),
    );
  }

  #catalogItem(manga: SuwayomiManga): CatalogSearchItem {
    const comicKey = encodeReference(COMIC_KEY_PREFIX, {
      title: manga.title,
      url: manga.url,
    });
    return {
      comicKey,
      coverRef: `comic-free-cover:${comicKey}`,
      sourcePluginKey: this.sourcePlugin.key,
      sourcePluginName: this.sourcePlugin.name,
      title: manga.title,
    };
  }

  #details(
    comicKey: string,
    details: SuwayomiMangaDetails,
  ): ComicDetailsResponse["comic"] {
    return {
      comicKey,
      comicProviderKey: this.#comicProviderKey,
      coverRef: `comic-free-cover:${comicKey}`,
      description:
        details.description.trim() ||
        "No description was provided by the Comic Provider.",
      sourcePluginKey: this.sourcePlugin.key,
      sourcePluginName: this.sourcePlugin.name,
      title: details.title,
    };
  }

  async #normalize<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ReadingAdapterError) throw error;
      if (error instanceof SuwayomiResponseError) {
        if (error.kind === "host") {
          throw new ReadingAdapterError(
            "plugin_host_unavailable",
            "The configured Plugin Host is unavailable.",
            true,
          );
        }
        if (error.kind === "graphql") {
          throw new ReadingAdapterError(
            "comic_provider_unreachable",
            "The Plugin Host could not complete the Comic Provider request.",
            true,
          );
        }
        throw new ReadingAdapterError(
          "unknown",
          "The Plugin Host returned an invalid response.",
          false,
        );
      }
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new ReadingAdapterError(
        "plugin_host_unavailable",
        "The configured Plugin Host is unavailable.",
        true,
      );
    }
  }
}

function parseSearchResponse(value: unknown): SuwayomiManga[] {
  const data = graphqlData(value);
  const result = object(data.fetchSourceManga, "fetchSourceManga");
  if (!Array.isArray(result.mangas)) throw new SuwayomiResponseError("invalid");
  return result.mangas.map((candidate) => manga(candidate));
}

function parseDetailsResponse(value: unknown): SuwayomiMangaDetails {
  const data = graphqlData(value);
  const result = object(data.fetchManga, "fetchManga");
  const candidate = object(result.manga, "fetchManga.manga");
  return {
    ...manga(candidate),
    description: optionalString(candidate.description),
  };
}

function parseChaptersResponse(value: unknown): SuwayomiChapter[] {
  const data = graphqlData(value);
  const result = object(data.fetchChapters, "fetchChapters");
  if (!Array.isArray(result.chapters)) throw new SuwayomiResponseError("invalid");
  return result.chapters.map((candidate) => {
    const chapter = object(candidate, "chapter");
    return {
      id: runtimeId(chapter.id),
      label: requiredString(chapter.name, "chapter name"),
      url: providerUrl(chapter.url),
    };
  });
}

function parsePagesResponse(value: unknown): string[] {
  const data = graphqlData(value);
  const result = object(data.fetchChapterPages, "fetchChapterPages");
  if (!Array.isArray(result.pages)) throw new SuwayomiResponseError("invalid");
  return result.pages.map((page) => requiredString(page, "page reference"));
}

function graphqlData(value: unknown): Record<string, unknown> {
  const envelope = object(value, "GraphQL response");
  if (Array.isArray(envelope.errors) && envelope.errors.length > 0) {
    throw new SuwayomiResponseError("graphql");
  }
  return object(envelope.data, "GraphQL data");
}

function manga(value: unknown): SuwayomiManga {
  const candidate = object(value, "manga");
  return {
    id: runtimeId(candidate.id),
    title: requiredString(candidate.title, "manga title"),
    url: providerUrl(candidate.url),
  };
}

function object(value: unknown, _context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SuwayomiResponseError("invalid");
  }
  return value as Record<string, unknown>;
}

function runtimeId(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new SuwayomiResponseError("invalid");
  }
  return value;
}

function providerUrl(value: unknown): string {
  return normalizeProviderUrl(requiredString(value, "provider URL"));
}

function normalizeProviderUrl(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 1 ? trimmed.replace(/\/+$/, "") : trimmed;
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function encodeReference(prefix: string, value: object): string {
  return `${prefix}${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;
}

function decodeReference<T extends DurableComicReference | DurableChapterReference>(
  key: string,
  prefix: string,
  label: "chapter" | "comic",
): T {
  if (!key.startsWith(prefix)) {
    throw new ReadingAdapterError(
      label === "comic" ? "catalog_item_not_found" : "chapter_not_found",
      `The ${label} key does not belong to the configured Source Plugin.`,
      false,
    );
  }
  try {
    const value = JSON.parse(
      Buffer.from(key.slice(prefix.length), "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    return {
      ...(label === "comic" ? { title: requiredString(value.title, "comic title") } : {
        label: requiredString(value.label, "chapter label"),
      }),
      url: providerUrl(value.url),
    } as T;
  } catch (error) {
    if (error instanceof ReadingAdapterError) throw error;
    throw new ReadingAdapterError(
      label === "comic" ? "catalog_item_not_found" : "chapter_not_found",
      `The ${label} key is invalid.`,
      false,
    );
  }
}

function unresolvedComic(): ReadingAdapterError {
  return new ReadingAdapterError(
    "unresolved_catalog_item",
    "The comic could not be re-resolved from its durable Comic Provider identity.",
    true,
  );
}

function originProvider(
  origin: string | (() => string | null),
): () => string | null {
  return typeof origin === "function" ? origin : () => origin;
}

function validatedLoopbackOrigin(origin: string): string {
  const url = new URL(origin);
  if (
    url.protocol !== "http:" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new SuwayomiResponseError("host");
  }
  return url.origin;
}

function combinedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function isImageContentType(contentType: string): boolean {
  return /^image\/[a-z0-9.+-]+(?:\s*;.*)?$/i.test(contentType);
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<Buffer> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > maximumBytes) {
    throw pageTooLarge(maximumBytes);
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw pageTooLarge(maximumBytes);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

function pageTooLarge(maximumBytes: number): ReadingAdapterError {
  return new ReadingAdapterError(
    "page_too_large",
    `The Comic Provider page exceeds the ${maximumBytes}-byte proxy limit.`,
    false,
  );
}
