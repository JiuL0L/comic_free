import { randomUUID } from "node:crypto";

import {
  readerPageUrl,
  type CatalogSearchItem,
  type LibraryItem,
  type ReaderSessionResponse,
  type RetainLibraryItemRequest,
  type SourceBindingReasonCode,
  type UpdateProgressRequest,
} from "@comic-free/contracts";

import {
  ReadingAdapterError,
  type ReadingAdapter,
  type ReadingChapter,
  type ReadingPage,
} from "./reading-adapter.ts";
import type { ReadingStore } from "./reading-store.ts";

export class ReadingServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly status: number,
  ) {
    super(message);
    this.name = "ReadingServiceError";
  }
}

type ReaderSessionRecord = ReaderSessionResponse["session"] & {
  comicProviderKey: string;
  coverRef: string;
  pageKeys: string[];
};

function requirePageIndex(pageIndex: number, pageCount: number): void {
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) {
    throw new ReadingServiceError(
      "invalid_page_index",
      `Page index must be between 0 and ${pageCount - 1}.`,
      false,
      400,
    );
  }
}

export class ReadingService {
  readonly #adapter: ReadingAdapter;
  readonly #store: ReadingStore;
  readonly #sessions = new Map<string, ReaderSessionRecord>();

  constructor(adapter: ReadingAdapter, store: ReadingStore) {
    this.#adapter = adapter;
    this.#store = store;
  }

  #requirePlugin(sourcePluginKey: string): void {
    if (sourcePluginKey !== this.#adapter.sourcePlugin.key) {
      throw new ReadingServiceError(
        "source_plugin_not_found",
        "The selected Source Plugin does not exist.",
        false,
        404,
      );
    }
  }

  #requireAvailableBinding(item: LibraryItem | null): void {
    if (!item || item.sourceBinding.availability === "available") return;
    if (item.sourceBinding.availability === "refresh_required") {
      throw new ReadingServiceError(
        "source_binding_refresh_required",
        "Reading is unavailable until this restored Source Binding is explicitly refreshed.",
        true,
        409,
      );
    }
    throw new ReadingServiceError(
      "source_binding_unavailable",
      `Reading is unavailable because the Source Binding is ${item.sourceBinding.reasonCode ?? "unknown"}.`,
      true,
      409,
    );
  }

  async search(sourcePluginKey: string, query: string): Promise<CatalogSearchItem[]> {
    this.#requirePlugin(sourcePluginKey);
    return this.#adapter.search(query);
  }

  getSourcePlugin(): { sourcePlugin: { key: string; name: string } } {
    return {
      sourcePlugin: {
        key: this.#adapter.sourcePlugin.key,
        name: this.#adapter.sourcePlugin.name,
      },
    };
  }

  async getDetails(sourcePluginKey: string, comicKey: string) {
    this.#requirePlugin(sourcePluginKey);
    return this.#adapter.getDetails(comicKey);
  }

  async getChapters(
    sourcePluginKey: string,
    comicKey: string,
  ): Promise<ReadingChapter[]> {
    this.#requirePlugin(sourcePluginKey);
    return this.#adapter.getChapters(comicKey);
  }

  async createSession(
    input:
      | { chapterKey: string; comicKey: string; sourcePluginKey: string }
      | { libraryItemId: string },
  ): Promise<ReaderSessionResponse> {
    let sourcePluginKey: string;
    let comicKey: string;
    let chapterKey: string;
    let existingLibraryItemId: string | undefined;
    let pageIndex = 0;

    if ("libraryItemId" in input) {
      const item = this.#store.get(input.libraryItemId);
      if (!item) {
        throw new ReadingServiceError(
          "library_item_not_found",
          "The requested Library Item does not exist.",
          false,
          404,
        );
      }
      this.#requireAvailableBinding(item);
      sourcePluginKey = item.sourceBinding.sourcePluginKey;
      comicKey = item.sourceBinding.durableComicKey;
      chapterKey = item.progress.chapterKey;
      existingLibraryItemId = item.id;
      pageIndex = item.progress.pageIndex;
    } else {
      sourcePluginKey = input.sourcePluginKey;
      comicKey = input.comicKey;
      chapterKey = input.chapterKey;
      const item = this.#store.getBySourceIdentity(sourcePluginKey, comicKey);
      this.#requireAvailableBinding(item);
      existingLibraryItemId = item?.id;
    }

    this.#requirePlugin(sourcePluginKey);
    const resolution = await this.#adapter.resolveChapter(comicKey, chapterKey);
    if (existingLibraryItemId && !this.#store.get(existingLibraryItemId)) {
      throw new ReadingServiceError(
        "library_item_not_found",
        "The requested Library Item does not exist.",
        false,
        404,
      );
    }
    requirePageIndex(pageIndex, resolution.pageKeys.length);
    const id = randomUUID();
    const session: ReaderSessionRecord = {
      chapterKey: resolution.chapter.chapterKey,
      chapterLabel: resolution.chapter.label,
      comicKey: resolution.comic.comicKey,
      comicProviderKey: resolution.comic.comicProviderKey,
      coverRef: resolution.comic.coverRef,
      id,
      pageCount: resolution.pageKeys.length,
      pageIndex,
      pageKeys: resolution.pageKeys,
      pageUrl: readerPageUrl(id, pageIndex),
      sourcePluginKey: resolution.comic.sourcePluginKey,
      sourcePluginName: resolution.comic.sourcePluginName,
      title: resolution.comic.title,
    };
    this.#sessions.set(id, session);
    return { session: this.#publicSession(session) };
  }

  #publicSession(session: ReaderSessionRecord): ReaderSessionResponse["session"] {
    return {
      chapterKey: session.chapterKey,
      chapterLabel: session.chapterLabel,
      comicKey: session.comicKey,
      id: session.id,
      pageCount: session.pageCount,
      pageIndex: session.pageIndex,
      pageUrl: readerPageUrl(session.id, session.pageIndex),
      sourcePluginKey: session.sourcePluginKey,
      sourcePluginName: session.sourcePluginName,
      title: session.title,
    };
  }

  async readPage(sessionId: string, pageIndex: number): Promise<ReadingPage> {
    const session = this.#sessions.get(sessionId);
    if (!session) {
      throw new ReadingServiceError(
        "reader_session_not_found",
        "The reader session is missing or expired. Reopen the chapter to continue.",
        true,
        404,
      );
    }
    requirePageIndex(pageIndex, session.pageCount);
    const pageKey = session.pageKeys[pageIndex];
    if (!pageKey) {
      throw new ReadingServiceError(
        "page_not_found",
        "The page could not be resolved from this reader session.",
        false,
        404,
      );
    }
    return this.#adapter.readPage(pageKey);
  }

  invalidateSourcePlugin(sourcePluginKey: string): number {
    let invalidated = 0;
    for (const [sessionId, session] of this.#sessions) {
      if (session.sourcePluginKey === sourcePluginKey) {
        this.#sessions.delete(sessionId);
        invalidated += 1;
      }
    }
    return invalidated;
  }

  retain(input: RetainLibraryItemRequest): LibraryItem {
    const session = this.#sessions.get(input.sessionId);
    if (!session) {
      throw new ReadingServiceError(
        "reader_session_not_found",
        "The reader session is missing or expired. Reopen the chapter before retaining it.",
        true,
        404,
      );
    }
    requirePageIndex(input.pageIndex, session.pageCount);
    return this.#store.retain({
      chapterKey: session.chapterKey,
      chapterLabel: session.chapterLabel,
      comicKey: session.comicKey,
      comicProviderKey: session.comicProviderKey,
      coverRef: session.coverRef,
      pageCount: session.pageCount,
      pageIndex: input.pageIndex,
      sourcePluginKey: session.sourcePluginKey,
      title: session.title,
    });
  }

  listLibrary(): LibraryItem[] {
    return this.#store.list();
  }

  deleteLibraryItem(libraryItemId: string): void {
    const item = this.#store.get(libraryItemId);
    if (!item || !this.#store.delete(libraryItemId)) {
      throw new ReadingServiceError(
        "library_item_not_found",
        "The requested Library Item does not exist.",
        false,
        404,
      );
    }
    for (const [sessionId, session] of this.#sessions) {
      if (
        session.sourcePluginKey === item.sourceBinding.sourcePluginKey &&
        session.comicKey === item.sourceBinding.durableComicKey
      ) {
        this.#sessions.delete(sessionId);
      }
    }
  }

  updateProgress(libraryItemId: string, input: UpdateProgressRequest): LibraryItem {
    const item = this.#store.updateProgress(libraryItemId, input);
    if (!item) {
      throw new ReadingServiceError(
        "library_item_not_found",
        "The requested Library Item does not exist.",
        false,
        404,
      );
    }
    return item;
  }

  markBindingUnavailable(
    sourceBindingId: string,
    reasonCode: SourceBindingReasonCode,
  ): LibraryItem {
    const item = this.#store.markBindingUnavailable(sourceBindingId, reasonCode);
    if (!item) {
      throw new ReadingServiceError(
        "source_binding_not_found",
        "The requested Source Binding does not exist.",
        false,
        404,
      );
    }
    this.invalidateSourcePlugin(item.sourceBinding.sourcePluginKey);
    return item;
  }
}

export function normalizeReadingError(error: unknown): ReadingServiceError {
  if (error instanceof ReadingServiceError) return error;
  if (error instanceof ReadingAdapterError) {
    const notFound = [
      "catalog_item_not_found",
      "chapter_not_found",
      "page_not_found",
    ].includes(error.code);
    const upstreamStatus =
      error.code === "page_timeout"
        ? 504
        : ["invalid_page_type", "page_too_large", "unsafe_page_reference"].includes(
              error.code,
            )
          ? 502
          : 503;
    return new ReadingServiceError(
      error.code,
      error.message,
      error.retryable,
      notFound ? 404 : upstreamStatus,
    );
  }
  return new ReadingServiceError(
    "local_core_failure",
    "The Local Core could not complete the reading request.",
    true,
    500,
  );
}
