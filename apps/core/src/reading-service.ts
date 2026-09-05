import { ReadingProviderRegistry, comicIdentity } from "./reading-provider-registry.ts";
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
import type { CatalogStore } from "./catalog-store.ts";
import type { ReadingStore } from "./reading-store.ts";

export type ReadingFailureLayer =
  | "comic-provider"
  | "local-core"
  | "plugin-host"
  | "source-plugin";

function failureLayerForReason(reason: string | null): ReadingFailureLayer {
  if (reason === "plugin_host_unavailable") return "plugin-host";
  if (["disabled", "missing", "incompatible"].includes(reason ?? "")) {
    return "source-plugin";
  }
  if (reason === "comic_provider_unreachable") return "comic-provider";
  return "local-core";
}

export class ReadingServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly status: number,
    readonly failureLayer?: ReadingFailureLayer,
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
  readonly #adapter: ReadingAdapter | ReadingProviderRegistry;
  readonly #store: ReadingStore;
  readonly #catalogStore: CatalogStore | undefined;
  readonly #comicProviderGenerations = new Map<string, number>();
  readonly #comicGenerations = new Map<string, number>();
  readonly #sourcePluginGenerations = new Map<string, number>();
  readonly #sessions = new Map<string, ReaderSessionRecord>();

  constructor(adapter: ReadingAdapter | ReadingProviderRegistry, store: ReadingStore, catalogStore?: CatalogStore) {
    this.#adapter = adapter;
    this.#store = store;
    this.#catalogStore = catalogStore;
  }

  #requirePlugin(sourcePluginKey: string): void {
    if (this.#adapter instanceof ReadingProviderRegistry ? !this.#adapter.hasPlugin(sourcePluginKey) : sourcePluginKey !== this.#adapter.sourcePlugin.key) {
      throw new ReadingServiceError(
        "source_plugin_not_found",
        "The selected Source Plugin does not exist.",
        false,
        404,
      );
    }
  }

  #requireReading(sourcePluginKey: string, comicKey?: string, refreshing = false): void {
    this.#requirePlugin(sourcePluginKey);
    const plugin = this.#catalogStore?.readCatalog().entries.find(entry => entry.pluginKey === sourcePluginKey);
    if (plugin && plugin.status !== "healthy") {
      throw new ReadingServiceError("source_plugin_unavailable", `Reading is unavailable because the Source Plugin is ${plugin.reasonCode ?? plugin.status}.`, true, 409, failureLayerForReason(plugin.reasonCode));
    }
    if (comicKey && !refreshing) {
      this.#requireAvailableBinding(this.#store.getBySourceIdentity(sourcePluginKey, comicKey));
    }
  }

  #providerKey(sourcePluginKey: string, comicKey?: string): string | undefined {
    return (comicKey ? this.#store.getBySourceIdentity(sourcePluginKey, comicKey)?.sourceBinding.comicProviderKey : undefined) ?? (comicKey ? comicIdentity(comicKey)?.provider : undefined) ?? (this.#adapter instanceof ReadingProviderRegistry ? undefined : this.#adapter.comicProviderKey);
  }

  #readingPolicyRevision(sourcePluginKey: string, comicKey?: string, providerKey?: string): string {
    const plugin = this.#catalogStore?.readCatalog().entries.find(entry => entry.pluginKey === sourcePluginKey);
    return JSON.stringify([this.#sourcePluginGenerations.get(sourcePluginKey) ?? 0, this.#comicProviderGenerations.get(JSON.stringify([sourcePluginKey, providerKey ?? this.#providerKey(sourcePluginKey, comicKey)])) ?? 0, this.#comicGenerations.get(JSON.stringify([sourcePluginKey, comicKey])) ?? 0, plugin]);
  }

  async #read<T>(sourcePluginKey: string, comicKey: string | undefined, operation: (adapter: ReadingAdapter) => Promise<T>, refreshing = false, providerKey?: string): Promise<T> {
    if (this.#adapter instanceof ReadingProviderRegistry) await this.#adapter.refresh();
    this.#requireReading(sourcePluginKey, comicKey, refreshing);
    const adapter = this.#adapter instanceof ReadingProviderRegistry ? this.#adapter.get(sourcePluginKey, comicKey, providerKey) : this.#adapter;
    if (providerKey && adapter.comicProviderKey !== providerKey) throw new TypeError("Unknown Comic Provider.");
    providerKey ??= this.#providerKey(sourcePluginKey, comicKey) ?? adapter.comicProviderKey;
    const revision = this.#readingPolicyRevision(sourcePluginKey, comicKey, providerKey);
    let value: T;
    try {
      value = await operation(adapter);
    } catch (error) {
      // A result from an earlier Source Plugin generation must not overwrite a newer policy.
      this.#requireReading(sourcePluginKey, comicKey, refreshing);
      if (revision === this.#readingPolicyRevision(sourcePluginKey, comicKey, providerKey)) this.#recordFailure(sourcePluginKey, comicKey, error, providerKey);
      throw error;
    }
    this.#requireReading(sourcePluginKey, comicKey, refreshing);
    if (revision !== this.#readingPolicyRevision(sourcePluginKey, comicKey, providerKey)) {
      throw new ReadingServiceError("source_binding_refresh_required", "The Source Plugin changed while reading. Retry with a new reader session or refresh the binding.", true, 409);
    }
    return value;
  }

  #recordFailure(sourcePluginKey: string, comicKey: string | undefined, error: unknown, selectedProviderKey?: string): void {
    if (!(error instanceof ReadingAdapterError)) return;
    const pluginFailure = ["disabled", "missing", "incompatible", "plugin_host_unavailable"].includes(error.code);
    const providerFailure = error.code === "comic_provider_unreachable";
    if (!pluginFailure && !providerFailure) return;
    const providerKey = selectedProviderKey ?? this.#providerKey(sourcePluginKey, comicKey);
    if (providerFailure && !providerKey) return;
    for (const item of this.#store.list()) {
      if (item.sourceBinding.sourcePluginKey === sourcePluginKey && (pluginFailure || item.sourceBinding.comicProviderKey === providerKey)) {
        this.#store.markBindingUnavailable(item.sourceBinding.id, error.code as SourceBindingReasonCode);
      }
    }
    if (pluginFailure) this.invalidateSourcePlugin(sourcePluginKey);
    else {
      const scope = JSON.stringify([sourcePluginKey, providerKey]);
      this.#comicProviderGenerations.set(scope, (this.#comicProviderGenerations.get(scope) ?? 0) + 1);
      for (const [id, session] of this.#sessions) {
        if (session.sourcePluginKey === sourcePluginKey && session.comicProviderKey === providerKey) this.#sessions.delete(id);
      }
    }
  }

  #invalidateComic(sourcePluginKey: string, comicKey: string): void {
    const scope = JSON.stringify([sourcePluginKey, comicKey]);
    this.#comicGenerations.set(scope, (this.#comicGenerations.get(scope) ?? 0) + 1);
    for (const [id, session] of this.#sessions) {
      if (session.sourcePluginKey === sourcePluginKey && session.comicKey === comicKey) this.#sessions.delete(id);
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
      failureLayerForReason(item.sourceBinding.reasonCode),
    );
  }

  async search(sourcePluginKey: string, query: string, comicProviderKey?: string): Promise<CatalogSearchItem[]> {
    return this.#read(sourcePluginKey, undefined, adapter => adapter.search(query), false, comicProviderKey);
  }

  async getProviders() {
    if (this.#adapter instanceof ReadingProviderRegistry) return this.#adapter.refresh();
    return {state: "success" as const, message: null, items: [{sourcePluginKey: this.#adapter.sourcePlugin.key, sourcePluginName: this.#adapter.sourcePlugin.name, comicProviderKey: this.#adapter.comicProviderKey ?? "legacy", name: this.#adapter.sourcePlugin.name, language: "en", available: true}]};
  }

  getSourcePlugin(): { sourcePlugin: { key: string; name: string } } {
    if (this.#adapter instanceof ReadingProviderRegistry) throw new ReadingServiceError("provider_selection_required", "Select a Comic Provider from the reading providers list.", false, 400);
    return {sourcePlugin: this.#adapter.sourcePlugin};
  }

  async getDetails(sourcePluginKey: string, comicKey: string) {
    return this.#read(sourcePluginKey, comicKey, adapter => adapter.getDetails(comicKey));
  }

  async getChapters(
    sourcePluginKey: string,
    comicKey: string,
  ): Promise<ReadingChapter[]> {
    return this.#read(sourcePluginKey, comicKey, adapter => adapter.getChapters(comicKey));
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

    const resolution = await this.#read(sourcePluginKey, comicKey, adapter => adapter.resolveChapter(comicKey, chapterKey));
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
    return this.#read(session.sourcePluginKey, session.comicKey, adapter => {
      if (this.#sessions.get(sessionId) !== session) throw new ReadingServiceError("reader_session_not_found", "The reader session expired while resolving the current Comic Provider. Reopen the chapter.", true, 404);
      return adapter.readPage(pageKey);
    });
  }

  invalidateProvider(sourcePluginKey: string, comicProviderKey: string, reason: SourceBindingReasonCode): void {
    const scope = JSON.stringify([sourcePluginKey, comicProviderKey]);
    this.#comicProviderGenerations.set(scope, (this.#comicProviderGenerations.get(scope) ?? 0) + 1);
    for (const item of this.#store.list()) {
      if (item.sourceBinding.sourcePluginKey === sourcePluginKey && item.sourceBinding.comicProviderKey === comicProviderKey && item.sourceBinding.availability === "available") this.#store.markBindingUnavailable(item.sourceBinding.id, reason);
    }
    for (const [id, session] of this.#sessions) if (session.sourcePluginKey === sourcePluginKey && session.comicProviderKey === comicProviderKey) this.#sessions.delete(id);
  }

  invalidateSourcePlugin(sourcePluginKey: string): number {
    this.#sourcePluginGenerations.set(sourcePluginKey, (this.#sourcePluginGenerations.get(sourcePluginKey) ?? 0) + 1);
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
    this.#requireReading(session.sourcePluginKey, session.comicKey);
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

  async refreshBinding(sourceBindingId: string): Promise<LibraryItem> {
    const item = this.#store.getByBindingId(sourceBindingId);
    if (!item) {
      throw new ReadingServiceError("source_binding_not_found", "The requested Source Binding does not exist.", false, 404);
    }
    const { sourcePluginKey, durableComicKey, comicProviderKey } = item.sourceBinding;
    if (this.#adapter instanceof ReadingProviderRegistry) await this.#adapter.refresh();
    this.#requireReading(sourcePluginKey, durableComicKey, true);
    try {
      const resolution = await this.#read(sourcePluginKey, durableComicKey, adapter => adapter.resolveChapter(durableComicKey, item.progress.chapterKey), true);
      if (resolution.comic.sourcePluginKey !== sourcePluginKey || resolution.comic.comicProviderKey !== comicProviderKey || resolution.comic.comicKey !== durableComicKey || resolution.chapter.chapterKey !== item.progress.chapterKey) {
        throw new ReadingServiceError("unresolved_catalog_item", "The original comic or chapter identity could not be resolved. The saved progress is unchanged.", true, 409);
      }
      const current = this.#store.getByBindingId(sourceBindingId);
      if (!current || JSON.stringify(current) !== JSON.stringify(item)) {
        throw new ReadingServiceError("source_binding_changed", "The binding or saved progress changed during refresh. Retry the refresh.", true, 409);
      }
      requirePageIndex(item.progress.pageIndex, resolution.pageKeys.length);
      this.#requireReading(sourcePluginKey, durableComicKey, true);
      this.#invalidateComic(sourcePluginKey, durableComicKey);
      const refreshed = this.#store.markBindingAvailable(sourceBindingId);
      if (!refreshed) throw new ReadingServiceError("source_binding_not_found", "The Source Binding no longer exists.", false, 404);
      this.#catalogStore?.clearBindingsRefreshRequiredWhenAllAvailable(sourcePluginKey);
      return refreshed;
    } catch (error) {
      const current = this.#store.getByBindingId(sourceBindingId);
      // Keep concurrent disable, failure, deletion and progress changes authoritative.
      if (current && JSON.stringify(current) === JSON.stringify(item)) {
        this.#requireReading(sourcePluginKey, durableComicKey, true);
        if (!(error instanceof ReadingServiceError && ["source_binding_changed", "source_binding_refresh_required"].includes(error.code))) {
          const code = normalizeReadingError(error).code;
          this.#store.markBindingUnavailable(sourceBindingId, ["chapter_not_found", "catalog_item_not_found", "unresolved_catalog_item"].includes(code) ? "unresolved_catalog_item" : "refresh_failed");
          this.#invalidateComic(sourcePluginKey, durableComicKey);
        }
      }
      throw error;
    }
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
    const current = this.#store.get(libraryItemId);
    if (!current) {
      throw new ReadingServiceError(
        "library_item_not_found",
        "The requested Library Item does not exist.",
        false,
        404,
      );
    }
    this.#requireReading(current.sourceBinding.sourcePluginKey, current.sourceBinding.durableComicKey);
    return this.#store.updateProgress(libraryItemId, input) as LibraryItem;
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
    this.#invalidateComic(item.sourceBinding.sourcePluginKey, item.sourceBinding.durableComicKey);
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
