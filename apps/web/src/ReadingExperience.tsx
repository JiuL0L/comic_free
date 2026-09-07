import { useEffect, useRef, useState } from "react";

import {
  LIBRARY_ITEMS_PATH,
  LOCAL_CORE_ORIGIN,
  FIXTURE_SOURCE_PLUGIN,
  READING_PROVIDERS_PATH,
  READER_SESSIONS_PATH,
  catalogBrowseUrl,
  catalogCoverUrl,
  catalogSearchUrl,
  comicChaptersUrl,
  comicDetailsUrl,
  parseApiErrorResponse,
  parseCatalogChaptersResponse,
  parseCatalogBrowseResponse,
  parseCatalogSearchResponse,
  parseComicDetailsResponse,
  parseLibraryItemResponse,
  parseDeleteLibraryItemResponse,
  parseLibraryItemsResponse,
  parseReaderSessionResponse,
  parseReadingProvidersResponse,
  readerPageUrl,
  sourceBindingRefreshUrl,
  type CatalogChaptersResponse,
  type CatalogBrowseResponse,
  type CatalogSearchItem,
  type ComicDetailsResponse,
  type LibraryItem,
  type ReaderSessionResponse,
  type ReadingProvider,
} from "@comic-free/contracts";

import "./reading.css";

class RequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}
async function requestJson<T>(
  url: string,
  init: RequestInit | undefined,
  parse: (value: unknown) => T,
): Promise<T> {
  const response = await fetch(url, init);
  const value = (await response.json()) as unknown;
  if (!response.ok) {
    try {
      const error = parseApiErrorResponse(value).error;
      throw new RequestError(error.message, error.retryable);
    } catch (parseError) {
      if (parseError instanceof RequestError) throw parseError;
      throw new RequestError(`Local Core returned HTTP ${response.status}.`, false);
    }
  }
  return parse(value);
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

type SearchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { error: RequestError; kind: "failed" }
  | { items: CatalogSearchItem[]; kind: "success" };

type DetailsState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { error: string; kind: "failed" }
  | {
      chapters: CatalogChaptersResponse["items"];
      comic: ComicDetailsResponse["comic"];
      kind: "success";
    };

type LibraryState =
  | { kind: "loading" }
  | { error: string; kind: "failed" }
  | { items: LibraryItem[]; kind: "loaded" };

type ActionState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "success" }
  | { error: string; kind: "failed" };

type ReadingProvidersState = {
  items: ReadingProvider[];
  kind: "loading" | "empty" | "success" | "error";
  message: string | null;
};

const reasonLabels: Record<string, string> = {
  comic_provider_unreachable: "Comic Provider unreachable",
  disabled: "Source Plugin disabled",
  incompatible: "Source Plugin incompatible",
  missing: "Source Plugin missing",
  plugin_host_unavailable: "Plugin Host unavailable",
  refresh_failed: "Source Plugin refresh failed",
  unresolved_catalog_item: "Catalog item cannot be resolved",
  unknown: "Source Binding unavailable",
};

function providerOptionValue(provider: ReadingProvider): string {
  return provider.sourcePluginKey === FIXTURE_SOURCE_PLUGIN.key && provider.comicProviderKey === "fixture.provider"
    ? FIXTURE_SOURCE_PLUGIN.key
    : JSON.stringify([provider.sourcePluginKey, provider.comicProviderKey]);
}

const displayedProviderLanguages = [
  ["zh-Hans", "简体中文"],
  ["zh-Hant", "繁体中文"],
  ["en", "英语"],
] as const;

const providerLanguageLabels = new Map<string, string>(displayedProviderLanguages);
const providerLanguageOrder = new Map<string, number>(
  displayedProviderLanguages.map(([language], index) => [language, index]),
);

function displayedProviders(providers: ReadingProvider[]): ReadingProvider[] {
  return providers
    .filter((provider) => providerLanguageLabels.has(provider.language))
    .sort(
      (left, right) =>
        (providerLanguageOrder.get(left.language) ?? Number.MAX_SAFE_INTEGER) -
        (providerLanguageOrder.get(right.language) ?? Number.MAX_SAFE_INTEGER),
    );
}

function providerLabel(provider: ReadingProvider): string {
  return `${provider.sourcePluginName} / ${provider.name}（${providerLanguageLabels.get(provider.language) ?? provider.language}）`;
}

export type ReadingSection = "discover" | "library" | "reader";

interface ReadingExperienceProps {
  visibleSection: ReadingSection | null;
  onOpenReader: () => void;
  switchDirection: "left" | "right";
}

export function ReadingExperience({
  visibleSection,
  onOpenReader,
  switchDirection,
}: ReadingExperienceProps) {
  const readerIsVisible = visibleSection === "reader";
  const [providers, setProviders] = useState<ReadingProvidersState>({
    items: [],
    kind: "loading",
    message: null,
  });
  const [providerRefreshAttempt, setProviderRefreshAttempt] = useState(0);
  const [providerSelection, setProviderSelection] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ kind: "idle" });
  const [catalogAction, setCatalogAction] = useState<"browse" | "search">("browse");
  const [details, setDetails] = useState<DetailsState>({ kind: "idle" });
  const [reader, setReader] = useState<ReaderSessionResponse["session"] | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [imageAttempt, setImageAttempt] = useState(0);
  const [imageState, setImageState] = useState<
    | { kind: "loading" }
    | { height: number; kind: "ready"; width: number }
    | { kind: "failed" }
  >({ kind: "loading" });
  const [pageLoadStates, setPageLoadStates] = useState<Record<number, "failed" | "ready">>({});
  const [readingMode, setReadingMode] = useState<"page" | "scroll">(
    () => window.localStorage.getItem("comic-free-reading-mode") === "page" ? "page" : "scroll",
  );
  const [fitWidth, setFitWidth] = useState(
    () => window.localStorage.getItem("comic-free-fit-width") !== "false",
  );
  const [retainedId, setRetainedIdState] = useState<string | null>(null);
  const retainedIdRef = useRef<string | null>(null);
  const setRetainedId = (value: string | null | ((current: string | null) => string | null)) => {
    // A scroll callback can run before React replaces its event listener.
    retainedIdRef.current = typeof value === "function" ? value(retainedIdRef.current) : value;
    setRetainedIdState(retainedIdRef.current);
  };
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [libraryAttempt, setLibraryAttempt] = useState(0);
  const [library, setLibrary] = useState<LibraryState>({ kind: "loading" });
  const [resumeStates, setResumeStates] = useState<Record<string, ActionState>>({});
  const [refreshStates, setRefreshStates] = useState<Record<string, ActionState>>({});

  const [deleteTarget, setDeleteTarget] = useState<LibraryItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const readingGeneration = useRef(0);
  const searchRequest = useRef(0);
  const detailsRequest = useRef(0);
  const readerRequest = useRef(0);
  const deletedIds = useRef(new Set<string>());
  const libraryItems = useRef<LibraryItem[]>([]);
  const activeReaderId = useRef<string | null>(null);
  const progressRequest = useRef(0);
  const progressQueue = useRef(Promise.resolve());
  const scrollReady = useRef(false);
  const scrollAnchorPending = useRef(false);
  const scrollAnchorPage = useRef(0);
  const viewedPage = useRef(0);
  const pageLoadStatesRef = useRef(pageLoadStates);
  const [anchorVersion, setAnchorVersion] = useState(0);
  const [scrollTrackingVersion, setScrollTrackingVersion] = useState(0);

  useEffect(() => { window.localStorage.setItem("comic-free-reading-mode", readingMode); }, [readingMode]);
  useEffect(() => { window.localStorage.setItem("comic-free-fit-width", String(fitWidth)); }, [fitWidth]);
  useEffect(() => { if (library.kind === "loaded") libraryItems.current = library.items; }, [library]);
  useEffect(() => { pageLoadStatesRef.current = pageLoadStates; }, [pageLoadStates]);

  useEffect(() => {
    if (deleteTarget) deleteDialog.current?.showModal();
    else deleteDialog.current?.close();
  }, [deleteTarget]);

  const deleteItem = async () => {
    if (!deleteTarget || deleting) return;
    const target = deleteTarget;
    readingGeneration.current += 1;
    setDeleting(true);
    setDeleteError(null);
    try {
      const response = await requestJson(
        `${LOCAL_CORE_ORIGIN}${LIBRARY_ITEMS_PATH}/${encodeURIComponent(target.id)}`,
        { method: "DELETE" },
        parseDeleteLibraryItemResponse,
      );
      if (response.deletedId !== target.id) throw new Error("Unexpected deletion response. Reload Library to check its state.");
      deletedIds.current.add(target.id);
      readingGeneration.current += 1;
      if (reader?.sourcePluginKey === target.sourceBinding.sourcePluginKey && reader.comicKey === target.sourceBinding.durableComicKey) activeReaderId.current = null;
      progressRequest.current += 1;
      setLibrary(current => current.kind === "loaded"
        ? { kind: "loaded", items: current.items.filter(item => item.id !== target.id) }
        : current);
      setRetainedId(current => current === target.id ? null : current);
      setReader(current => current?.sourcePluginKey === target.sourceBinding.sourcePluginKey && current.comicKey === target.sourceBinding.durableComicKey ? null : current);
      setDeleteMessage(`Deleted ${target.snapshot.title} and its local Reading Progress.`);
      setDeleteTarget(null);
      setLibraryAttempt(value => value + 1);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Deletion failed. Please retry.");
    } finally {
      setDeleting(false);
    }
  };

  const selectedProvider = providers.items.find(
    (provider) => providerOptionValue(provider) === providerSelection,
  );

  useEffect(() => {
    const controller = new AbortController();
    void requestJson(
      `${LOCAL_CORE_ORIGIN}${READING_PROVIDERS_PATH}`,
      { signal: controller.signal },
      parseReadingProvidersResponse,
    ).then(
      (response) => {
        if (controller.signal.aborted) return;
        const items = displayedProviders(response.items);
        setProviders((current) => {
          const retainedItems = response.state === "error" && items.length === 0 ? current.items : items;
          return {
            items: retainedItems,
            kind: response.state === "success" && retainedItems.length === 0 ? "empty" : response.state,
            message: response.message,
          };
        });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setProviders((current) => ({
            ...current,
            kind: "error",
            message:
              error instanceof Error
                ? error.message
                : "Installed Comic Providers could not be loaded.",
          }));
        }
      },
    );
    return () => controller.abort();
  }, [providerRefreshAttempt]);

  useEffect(() => {
    const interval = window.setInterval(
      () => setProviderRefreshAttempt((attempt) => attempt + 1),
      10_000,
    );
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLibrary({ kind: "loading" });
    void requestJson(
      `${LOCAL_CORE_ORIGIN}${LIBRARY_ITEMS_PATH}`,
      { signal: controller.signal },
      parseLibraryItemsResponse,
    ).then(
      (response) => {
        if (!controller.signal.aborted) setLibrary({ kind: "loaded", items: response.items.filter(item => !deletedIds.current.has(item.id)) });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setLibrary({
            kind: "failed",
            error: error instanceof Error ? error.message : "The Library could not be loaded.",
          });
        }
      },
    );
    return () => controller.abort();
  }, [libraryAttempt]);

  const beginReaderRequest = () => {
    const request = ++readerRequest.current;
    setResumeStates((states) => {
      let changed = false;
      const next = { ...states };
      for (const [itemId, state] of Object.entries(states)) {
        if (state.kind === "pending") {
          delete next[itemId];
          changed = true;
        }
      }
      return changed ? next : states;
    });
    return request;
  };

  const runSearch = async () => {
    if (!selectedProvider || !selectedProvider.available) return;
    const generation = readingGeneration.current;
    const request = ++searchRequest.current;
    detailsRequest.current += 1;
    beginReaderRequest();
    setCatalogAction("search");
    setSearch({ kind: "loading" });
    setDetails({ kind: "idle" });
    setReader(null);
    try {
      const response = await requestJson(
        catalogSearchUrl(
          selectedProvider.sourcePluginKey,
          query,
          selectedProvider.comicProviderKey,
        ),
        undefined,
        parseCatalogSearchResponse,
      );
      if (generation !== readingGeneration.current || request !== searchRequest.current) return;
      setSearch(
        response.items.length === 0
          ? { kind: "empty" }
          : { kind: "success", items: response.items },
      );
    } catch (error) {
      if (generation !== readingGeneration.current || request !== searchRequest.current) return;
      setSearch({
        kind: "failed",
        error:
          error instanceof RequestError
            ? error
            : new RequestError("The catalog search failed.", true),
      });
    }
  };

  const browseProvider = async (provider: ReadingProvider) => {
    if (!provider.available) return;
    const generation = readingGeneration.current;
    const request = ++searchRequest.current;
    detailsRequest.current += 1;
    beginReaderRequest();
    setCatalogAction("browse");
    setSearch({ kind: "loading" });
    setDetails({ kind: "idle" });
    setReader(null);
    try {
      const items: CatalogSearchItem[] = [];
      const seen = new Set<string>();
      let page: number | null = 1;
      while (page !== null) {
        const response: CatalogBrowseResponse = await requestJson(
          catalogBrowseUrl(provider.sourcePluginKey, page, provider.comicProviderKey),
          undefined,
          parseCatalogBrowseResponse,
        );
        if (generation !== readingGeneration.current || request !== searchRequest.current) return;
        for (const item of response.items) {
          const key = `${item.sourcePluginKey}:${item.comicKey}`;
          if (!seen.has(key)) {
            seen.add(key);
            items.push(item);
          }
        }
        if (response.nextPage !== null && response.nextPage <= page) {
          throw new RequestError("The source catalog returned an invalid next page.", false);
        }
        page = response.nextPage;
      }
      setSearch(items.length === 0 ? { kind: "empty" } : { kind: "success", items });
    } catch (error) {
      if (generation !== readingGeneration.current || request !== searchRequest.current) return;
      setSearch({
        kind: "failed",
        error: error instanceof RequestError
          ? error
          : new RequestError("The source catalog could not be loaded.", true),
      });
    }
  };

  const openDetails = async (item: CatalogSearchItem) => {
    const generation = readingGeneration.current;
    const request = ++detailsRequest.current;
    beginReaderRequest();
    setDetails({ kind: "loading" });
    try {
      const [comic, chapters] = await Promise.all([
        requestJson(
          comicDetailsUrl(item.sourcePluginKey, item.comicKey),
          undefined,
          parseComicDetailsResponse,
        ),
        requestJson(
          comicChaptersUrl(item.sourcePluginKey, item.comicKey),
          undefined,
          parseCatalogChaptersResponse,
        ),
      ]);
      if (generation !== readingGeneration.current || request !== detailsRequest.current) return;
      setDetails({ kind: "success", comic: comic.comic, chapters: chapters.items });
    } catch (error) {
      if (generation !== readingGeneration.current || request !== detailsRequest.current) return;
      setDetails({
        kind: "failed",
        error: error instanceof Error ? error.message : "Comic details could not be loaded.",
      });
    }
  };

  const saveProgress = async (
    libraryItemId: string,
    session: ReaderSessionResponse["session"],
    nextPageIndex: number,
    rollback?: () => void,
  ) => {
    const request = ++progressRequest.current;
    const write = progressQueue.current.then(() => requestJson(
        `${LOCAL_CORE_ORIGIN}${LIBRARY_ITEMS_PATH}/${encodeURIComponent(libraryItemId)}/progress`,
        json("PUT", {
          chapterKey: session.chapterKey,
          chapterLabel: session.chapterLabel,
          pageCount: session.pageCount,
          pageIndex: nextPageIndex,
        }),
        parseLibraryItemResponse,
      ));
    progressQueue.current = write.then(() => undefined, () => undefined);
    try {
      await write;
      if (activeReaderId.current !== session.id || request !== progressRequest.current) return;
      setSaveMessage("阅读进度已保存");
      setLibraryAttempt((value) => value + 1);
    } catch (error) {
      if (activeReaderId.current !== session.id || request !== progressRequest.current) return;
      rollback?.();
      setSaveMessage(error instanceof Error ? `阅读进度未保存：${error.message}` : "阅读进度未保存，请重试。");
      setLibraryAttempt((value) => value + 1);
    }
  };

  const loadReaderDetails = async (session: ReaderSessionResponse["session"]) => {
    const generation = readingGeneration.current;
    const request = ++detailsRequest.current;
    setDetails({ kind: "loading" });
    try {
      const [comic, chapters] = await Promise.all([
        requestJson(comicDetailsUrl(session.sourcePluginKey, session.comicKey), undefined, parseComicDetailsResponse),
        requestJson(comicChaptersUrl(session.sourcePluginKey, session.comicKey), undefined, parseCatalogChaptersResponse),
      ]);
      if (generation !== readingGeneration.current || request !== detailsRequest.current || activeReaderId.current !== session.id) return;
      setDetails({ kind: "success", comic: comic.comic, chapters: chapters.items });
    } catch (error) {
      if (generation !== readingGeneration.current || request !== detailsRequest.current || activeReaderId.current !== session.id) return;
      setDetails({ kind: "failed", error: error instanceof Error ? error.message : "无法加载章节列表。" });
    }
  };

  const acceptSession = (session: ReaderSessionResponse["session"]) => {
    const existing = libraryItems.current.find((item) =>
      !deletedIds.current.has(item.id)
      && item.sourceBinding.sourcePluginKey === session.sourcePluginKey
      && item.sourceBinding.durableComicKey === session.comicKey,
    );
    activeReaderId.current = session.id;
    scrollReady.current = false;
    scrollAnchorPending.current = true;
    scrollAnchorPage.current = session.pageIndex;
    viewedPage.current = session.pageIndex;
    setReader(session);
    setPageIndex(session.pageIndex);
    setImageAttempt(0);
    setImageState({ kind: "loading" });
    setPageLoadStates({});
    setRetainedId(existing?.id ?? null);
    setSaveMessage(null);
    if (existing) void saveProgress(existing.id, session, session.pageIndex);
  };

  const openChapter = async (chapterKey: string) => {
    if (details.kind !== "success") return;
    const generation = readingGeneration.current;
    const request = beginReaderRequest();
    try {
      const response = await requestJson(
        `${LOCAL_CORE_ORIGIN}${READER_SESSIONS_PATH}`,
        json("POST", {
          chapterKey,
          comicKey: details.comic.comicKey,
          sourcePluginKey: details.comic.sourcePluginKey,
        }),
        parseReaderSessionResponse,
      );
      if (generation !== readingGeneration.current || request !== readerRequest.current) return;
      acceptSession(response.session);
      onOpenReader();
    } catch (error) {
      if (generation !== readingGeneration.current || request !== readerRequest.current) return;
      setDetails({
        kind: "failed",
        error: error instanceof Error ? error.message : "The chapter could not be opened.",
      });
    }
  };

  const resume = async (item: LibraryItem) => {
    const generation = readingGeneration.current;
    const request = beginReaderRequest();
    setResumeStates((states) => ({ ...states, [item.id]: { kind: "pending" } }));
    try {
      const response = await requestJson(
        `${LOCAL_CORE_ORIGIN}${READER_SESSIONS_PATH}`,
        json("POST", { libraryItemId: item.id }),
        parseReaderSessionResponse,
      );
      if (generation !== readingGeneration.current || request !== readerRequest.current) return;
      acceptSession(response.session);
      setRetainedId(item.id);
      void loadReaderDetails(response.session);
      setResumeStates((states) => ({ ...states, [item.id]: { kind: "success" } }));
      onOpenReader();
    } catch (error) {
      if (generation !== readingGeneration.current || request !== readerRequest.current) return;
      setResumeStates((states) => ({
        ...states,
        [item.id]: {
          kind: "failed",
          error: error instanceof Error ? error.message : "Reading could not resume.",
        },
      }));
      setLibraryAttempt((value) => value + 1);
    }
  };

  const refreshSourceBinding = async (item: LibraryItem) => {
    const generation = readingGeneration.current;
    const bindingId = item.sourceBinding.id;
    setRefreshStates((states) => ({ ...states, [bindingId]: { kind: "pending" } }));
    try {
      const response = await requestJson(
        sourceBindingRefreshUrl(bindingId),
        json("POST", {}),
        parseLibraryItemResponse,
      );
      if (generation !== readingGeneration.current) return;
      setLibrary((current) =>
        current.kind === "loaded"
          ? {
              kind: "loaded",
              items: current.items.map((candidate) =>
                candidate.id === response.item.id ? response.item : candidate,
              ),
            }
          : current,
      );
      setRefreshStates((states) => ({ ...states, [bindingId]: { kind: "success" } }));
      setResumeStates((states) => {
        const nextStates = { ...states };
        delete nextStates[item.id];
        return nextStates;
      });
      setLibraryAttempt((value) => value + 1);
    } catch (error) {
      if (generation !== readingGeneration.current) return;
      setRefreshStates((states) => ({
        ...states,
        [bindingId]: {
          kind: "failed",
          error: error instanceof Error ? error.message : "The Source Binding could not be refreshed.",
        },
      }));
      setLibraryAttempt((value) => value + 1);
    }
  };

  const renewReaderSession = async () => {
    if (!reader) return;
    const libraryItemId = retainedId;
    const generation = readingGeneration.current;
    const request = beginReaderRequest();
    try {
      const response = await requestJson(
        `${LOCAL_CORE_ORIGIN}${READER_SESSIONS_PATH}`,
        json(
          "POST",
          libraryItemId
            ? { libraryItemId }
            : {
                chapterKey: reader.chapterKey,
                comicKey: reader.comicKey,
                sourcePluginKey: reader.sourcePluginKey,
              },
        ),
        parseReaderSessionResponse,
      );
      if (generation !== readingGeneration.current || request !== readerRequest.current) return;
      acceptSession(response.session);
      if (libraryItemId) setRetainedId(libraryItemId);
    } catch (error) {
      if (generation !== readingGeneration.current || request !== readerRequest.current) return;
      setSaveMessage(
        error instanceof Error ? error.message : "The reader session could not be renewed.",
      );
    }
  };

  const retain = async () => {
    if (!reader) return;
    const generation = readingGeneration.current;
    const sessionId = reader.id;
    try {
      const response = await requestJson(
        `${LOCAL_CORE_ORIGIN}${LIBRARY_ITEMS_PATH}`,
        json("POST", { pageIndex, sessionId: reader.id }),
        parseLibraryItemResponse,
      );
      if (generation !== readingGeneration.current || activeReaderId.current !== sessionId) return;
      libraryItems.current = [
        ...libraryItems.current.filter((item) => item.id !== response.item.id),
        response.item,
      ];
      setLibrary((current) => current.kind === "loaded"
        ? { kind: "loaded", items: libraryItems.current }
        : current);
      setRetainedId(response.item.id);
      setSaveMessage("已加入书架");
      if (response.item.progress.chapterKey !== reader.chapterKey || response.item.progress.pageIndex !== viewedPage.current) {
        void saveProgress(response.item.id, reader, viewedPage.current);
      }
      setLibraryAttempt((value) => value + 1);
    } catch (error) {
      if (generation !== readingGeneration.current || activeReaderId.current !== sessionId) return;
      setSaveMessage(error instanceof Error ? error.message : "The comic could not be retained.");
    }
  };

  const movePage = async (nextPageIndex: number) => {
    if (!reader || activeReaderId.current !== reader.id || nextPageIndex < 0 || nextPageIndex >= reader.pageCount) return;
    const previousPageIndex = pageIndex;
    viewedPage.current = nextPageIndex;
    setPageIndex(nextPageIndex);
    if (readingMode === "page") setImageState({ kind: "loading" });
    setSaveMessage(null);
    const libraryItemId = retainedIdRef.current;
    if (!libraryItemId) return;
    await saveProgress(libraryItemId, reader, nextPageIndex, readingMode === "page" ? () => {
      setPageIndex(previousPageIndex);
      setImageState({ kind: "loading" });
    } : undefined);
  };

  const requestScrollAnchor = (nextPageIndex: number) => {
    scrollReady.current = false;
    scrollAnchorPending.current = true;
    scrollAnchorPage.current = nextPageIndex;
    viewedPage.current = nextPageIndex;
    setAnchorVersion((version) => version + 1);
  };

  const navigateScroll = (nextPageIndex: number) => {
    if (!reader || nextPageIndex < 0 || nextPageIndex >= reader.pageCount) return;
    requestScrollAnchor(nextPageIndex);
    void movePage(nextPageIndex);
  };

  useEffect(() => {
    if (!readerIsVisible || !reader || readingMode !== "scroll" || !scrollReady.current) return;
    let frame: number | null = null;
    const trackVisiblePage = () => {
      frame = null;
      if (!scrollReady.current) return;
      const line = window.innerHeight * 0.15;
      const currentPage = Array.from(document.querySelectorAll<HTMLElement>(".reader-page[data-page-index]"))
        .map((element) => ({ element, index: Number(element.dataset.pageIndex) }))
        .filter(({ element, index }) => pageLoadStatesRef.current[index] === "ready" && element.getBoundingClientRect().top <= line)
        .reduce<number | null>((current, candidate) => current === null || candidate.index > current ? candidate.index : current, null);
      if (currentPage === null || currentPage === viewedPage.current) return;
      viewedPage.current = currentPage;
      scrollAnchorPage.current = currentPage;
      void movePage(currentPage);
    };
    const scheduleVisiblePage = () => {
      frame ??= window.requestAnimationFrame(trackVisiblePage);
    };
    window.addEventListener("scroll", scheduleVisiblePage, { passive: true });
    window.addEventListener("resize", scheduleVisiblePage);
    scheduleVisiblePage();
    return () => {
      window.removeEventListener("scroll", scheduleVisiblePage);
      window.removeEventListener("resize", scheduleVisiblePage);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [readerIsVisible, scrollTrackingVersion, pageLoadStates, reader, readingMode, retainedId]);

  useEffect(() => {
    if (!readerIsVisible || !reader || readingMode !== "scroll") return;
    if (!scrollAnchorPending.current) return;
    scrollReady.current = false;
    const targetPage = scrollAnchorPage.current;
    const layoutReady = Array.from({ length: targetPage + 1 }, (_, index) => pageLoadStates[index])
      .every((state) => state === "ready" || state === "failed");
    if (!layoutReady) return;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-reader-page][data-page-index='${targetPage}']`)?.scrollIntoView({ block: "start", behavior: "auto" });
      scrollReady.current = true;
      scrollAnchorPending.current = false;
      setScrollTrackingVersion(version => version + 1);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [readerIsVisible, anchorVersion, pageLoadStates, reader?.id, readingMode]);

  useEffect(() => {
    if (!readerIsVisible || !reader) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if ((document.activeElement as HTMLElement | null)?.closest("#settings, #library")) return;
      if (["ArrowDown", "ArrowRight", "PageDown"].includes(event.key)) {
        event.preventDefault();
        if (readingMode === "scroll") navigateScroll(Math.min(scrollAnchorPage.current + 1, reader.pageCount - 1));
        else void movePage(pageIndex + 1);
      }
      if (["ArrowUp", "ArrowLeft", "PageUp"].includes(event.key)) {
        event.preventDefault();
        if (readingMode === "scroll") navigateScroll(Math.max(scrollAnchorPage.current - 1, 0));
        else void movePage(pageIndex - 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [readerIsVisible, pageIndex, reader, readingMode, retainedId]);

  return (
    <>
      <section
        id="discover"
        className="reading-panel app-view-panel"
        aria-labelledby="find-comic-heading"
        data-switch-direction={switchDirection}
        hidden={visibleSection !== "discover"}
      >
        <p className="eyebrow">READ / COMIC CATALOG</p>
        <h2 id="find-comic-heading">找漫画</h2>
        <div className="search-controls">
          <label>
            漫画来源
            <select
              aria-label="漫画来源"
              value={providerSelection}
              onChange={(event) => {
                readingGeneration.current += 1;
                const value = event.target.value;
                setProviderSelection(value);
                setSearch({ kind: "idle" });
                setDetails({ kind: "idle" });
                setReader(null);
                const provider = providers.items.find((candidate) => providerOptionValue(candidate) === value);
                if (provider?.available) void browseProvider(provider);
              }}
            >
              <option value="">选择漫画来源</option>
              {providers.items.map((provider) => (
                <option
                  key={JSON.stringify([provider.sourcePluginKey, provider.comicProviderKey])}
                  disabled={!provider.available}
                  value={providerOptionValue(provider)}
                >
                  {providerLabel(provider)}{provider.available ? "" : " — 不可用"}
                </option>
              ))}
            </select>
          </label>
          <label>
            搜索关键词
            <input
              aria-label="搜索关键词"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && query.trim()) void runSearch();
              }}
            />
          </label>
          <button type="button" disabled={!selectedProvider?.available || !query.trim() || search.kind === "loading"} onClick={() => void runSearch()}>
            搜索漫画
          </button>
        </div>

        {providers.kind === "loading" && providers.items.length === 0 && (
          <p className="reading-notice">正在加载漫画来源…</p>
        )}
        {providers.kind === "empty" && (
          <p className="reading-notice">暂无可用的漫画来源。</p>
        )}
        {providers.kind === "error" && (
          <div className="reading-notice error" role="alert">
            <span>{providers.message ?? "漫画来源加载失败。"}</span>
            <button type="button" onClick={() => setProviderRefreshAttempt((attempt) => attempt + 1)}>
              重试来源加载
            </button>
          </div>
        )}

        {search.kind === "loading" && <p className="reading-notice">{catalogAction === "browse" ? `正在加载 ${selectedProvider ? providerLabel(selectedProvider) : "漫画来源"} 的漫画…` : `正在搜索 ${selectedProvider ? providerLabel(selectedProvider) : "漫画来源"}…`}</p>}
        {search.kind === "empty" && <p className="reading-notice">{catalogAction === "browse" ? "这个来源暂时没有可显示的漫画。" : "没有找到匹配的漫画。"}</p>}
        {search.kind === "failed" && (
          <div className="reading-notice error" role="alert">
            <span>{search.error.message}</span>
            {search.error.retryable && <button type="button" onClick={() => catalogAction === "browse" && selectedProvider ? void browseProvider(selectedProvider) : void runSearch()}>{catalogAction === "browse" ? "重新加载" : "重新搜索"}</button>}
          </div>
        )}
        {search.kind === "success" && (
          <ul className="result-list">
            {search.items.map((item) => (
              <li key={`${item.sourcePluginKey}:${item.comicKey}`}>
                <button
                  className="comic-cover-card"
                  type="button"
                  aria-label={`查看详情：${item.title}`}
                  onClick={() => void openDetails(item)}
                >
                  <span className="comic-cover-frame">
                    <img
                      alt={`${item.title} 封面`}
                      loading="lazy"
                      src={catalogCoverUrl(item.sourcePluginKey, item.comicKey)}
                      onError={(event) => event.currentTarget.parentElement?.classList.add("failed")}
                    />
                    <span className="comic-cover-fallback">封面暂不可用</span>
                  </span>
                  <span className="comic-cover-copy">
                  <strong>{item.title}</strong>
                  <span>{item.sourcePluginName}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {details.kind === "loading" && <p className="reading-notice">正在加载漫画详情…</p>}
        {details.kind === "failed" && <p className="reading-notice error" role="alert">{details.error}</p>}
        {details.kind === "success" && (
          <article className="comic-details">
            <p className="eyebrow">{details.comic.sourcePluginName}</p>
            <h3>{details.comic.title}</h3>
            <p>{details.comic.description}</p>
            {details.chapters.map((chapter) => (
              <button key={chapter.chapterKey} type="button" onClick={() => void openChapter(chapter.chapterKey)}>
                阅读 {chapter.label}
              </button>
            ))}
          </article>
        )}
      </section>

      <section
        id="reader"
        className={`reader app-view-panel ${fitWidth ? "fit-width" : "fit-page"}`}
        role="region"
        aria-label="阅读器"
        data-switch-direction={switchDirection}
        hidden={!readerIsVisible}
      >
        {!reader && <p className="reading-notice">请先在“找漫画”中选择漫画，再选择要阅读的章节。</p>}
        {reader && (
          <>
          <div className="reader-context">
            <div>
              <p className="eyebrow">{reader.sourcePluginName}</p>
              <h2>{reader.title}</h2>
              <p>{reader.chapterLabel}</p>
            </div>
            <strong>第 {pageIndex + 1} / {reader.pageCount} 页</strong>
          </div>
          <div className={`page-frame ${readingMode === "scroll" ? "vertical-pages" : ""}`}>
            {readingMode === "page" && imageState.kind === "loading" && <p>正在加载页面…</p>}
            {readingMode === "page" && <img
              alt={`${reader.title}，第 ${pageIndex + 1} / ${reader.pageCount} 页`}
              key={`${reader.id}:${pageIndex}:${imageAttempt}`}
              src={`${readerPageUrl(reader.id, pageIndex)}?attempt=${imageAttempt}`}
              onError={() => setImageState({ kind: "failed" })}
              onLoad={(event) => setImageState({ kind: "ready", height: event.currentTarget.naturalHeight, width: event.currentTarget.naturalWidth })}
            />}
            {readingMode === "page" && imageState.kind === "ready" && <p>已渲染 {imageState.width} × {imageState.height}</p>}
            {readingMode === "scroll" && Array.from({ length: reader.pageCount }, (_, index) => (
              <div key={`${reader.id}:${index}`} className="reader-page-wrap">
                <div className="reader-page-marker" data-reader-page data-page-index={index} aria-hidden="true" />
                <figure className="reader-page" data-page-index={index}>
                <img
                  alt={`${reader.title}，第 ${index + 1} / ${reader.pageCount} 页`}
                  loading={index <= scrollAnchorPage.current + 1 ? "eager" : "lazy"}
                  src={`${readerPageUrl(reader.id, index)}?attempt=${imageAttempt}`}
                  onLoad={() => setPageLoadStates(states => ({ ...states, [index]: "ready" }))}
                  onError={() => setPageLoadStates(states => ({ ...states, [index]: "failed" }))}
                />
                {pageLoadStates[index] === "failed" && <figcaption role="alert">此页未加载，可重试或刷新阅读会话。<button type="button" onClick={() => setImageAttempt(value => value + 1)}>重试页面</button><button type="button" onClick={() => void renewReaderSession()}>刷新阅读会话</button></figcaption>}
                </figure>
              </div>
            ))}
            {readingMode === "page" && imageState.kind === "failed" && (
              <div className="reading-notice error" role="alert">
                <span>页面未加载，但阅读上下文已保留。</span>
                <button type="button" onClick={() => { setImageState({ kind: "loading" }); setImageAttempt((value) => value + 1); }}>
                  重试页面
                </button>
                <button type="button" onClick={() => void renewReaderSession()}>
                  刷新阅读会话
                </button>
              </div>
            )}
          </div>
          <div className="reader-tools">
            <button type="button" aria-pressed={readingMode === "scroll"} onClick={() => { setReadingMode("scroll"); requestScrollAnchor(pageIndex); }}>连续滚动</button>
            <button type="button" aria-pressed={readingMode === "page"} onClick={() => setReadingMode("page")}>左右翻页</button>
            <button type="button" aria-pressed={fitWidth} onClick={() => { setFitWidth(value => !value); if (readingMode === "scroll") requestScrollAnchor(pageIndex); }}>{fitWidth ? "适合宽度" : "适合页面"}</button>
          </div>
          <div className="reader-actions">
            <button type="button" disabled={pageIndex === 0} onClick={() => readingMode === "scroll" ? navigateScroll(pageIndex - 1) : void movePage(pageIndex - 1)}>上一页</button>
            <button type="button" disabled={Boolean(retainedId) || deleting} onClick={() => void retain()}>{retainedId ? "已加入书架" : "加入书架"}</button>
            <button type="button" disabled={pageIndex === reader.pageCount - 1} onClick={() => readingMode === "scroll" ? navigateScroll(pageIndex + 1) : void movePage(pageIndex + 1)}>下一页</button>
          </div>
          {details.kind === "success" && (() => { const chapterIndex = details.chapters.findIndex(chapter => chapter.chapterKey === reader.chapterKey); return <div className="reader-chapters"><button type="button" disabled={chapterIndex <= 0} onClick={() => void openChapter(details.chapters[chapterIndex - 1]!.chapterKey)}>上一话</button><button type="button" disabled={chapterIndex < 0 || chapterIndex >= details.chapters.length - 1} onClick={() => void openChapter(details.chapters[chapterIndex + 1]!.chapterKey)}>下一话</button></div>; })()}
          {saveMessage && <p className="save-message" role="status">{saveMessage}</p>}
          {retainedId && saveMessage?.startsWith("阅读进度未保存") && <button type="button" onClick={() => void saveProgress(retainedId, reader, pageIndex)}>重试保存当前位置</button>}
          </>
        )}
      </section>

      <section
        id="library"
        className="library-panel app-view-panel"
        role="region"
        aria-label="书架"
        data-switch-direction={switchDirection}
        hidden={visibleSection !== "library"}
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">LOCAL / RETAINED STATE</p>
            <h2>书架</h2>
          </div>
          <button type="button" disabled={library.kind === "loading"} onClick={() => setLibraryAttempt((value) => value + 1)}>刷新书架</button>
        </div>
        {deleteMessage && <p role="status" className="reading-notice">{deleteMessage}</p>}
        <dialog ref={deleteDialog} role="alertdialog" aria-label="Delete Library Item" aria-describedby="delete-library-description" onCancel={event => { event.preventDefault(); if (!deleting) setDeleteTarget(null); }}>
          <h3>Delete Library Item</h3>
          <p id="delete-library-description">Delete “{deleteTarget?.snapshot.title}” from your Library? Its local Source Binding, Last Known Snapshot and Reading Progress will be permanently removed.</p>
          {deleteError && <p role="alert" className="reading-notice error">{deleteError}</p>}
          <div className="reader-actions">
            <button type="button" autoFocus disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancel</button>
            <button type="button" disabled={deleting} onClick={() => void deleteItem()}>{deleting ? "Deleting…" : "Confirm deletion"}</button>
          </div>
        </dialog>
        {library.kind === "loading" && <p className="reading-notice">正在加载书架…</p>}
        {library.kind === "failed" && <p className="reading-notice error" role="alert">{library.error}</p>}
        {library.kind === "loaded" && library.items.length === 0 && <p className="reading-notice">书架还是空的。</p>}
        {library.kind === "loaded" && library.items.length > 0 && (
          <ul className="library-list">
            {library.items.toSorted((left, right) => right.progress.updatedAt.localeCompare(left.progress.updatedAt)).map((item) => {
              const resumeState = resumeStates[item.id] ?? { kind: "idle" as const };
              const refreshState = refreshStates[item.sourceBinding.id] ?? { kind: "idle" as const };
              return (
              <li key={item.id}>
                <div>
                  <h3>{item.snapshot.title}</h3>
                  <p>{item.progress.chapterLabel}</p>
                  <p>第 {item.progress.pageIndex + 1} / {item.progress.pageCount} 页</p>
                  <span className={`availability ${item.sourceBinding.availability}`}>
                    {item.sourceBinding.availability === "available"
                      ? "可阅读"
                      : item.sourceBinding.availability === "refresh_required"
                        ? "需要刷新来源绑定"
                        : reasonLabels[item.sourceBinding.reasonCode ?? "unknown"]}
                  </span>
                  {resumeState.kind === "pending" && (
                    <p className="action-state" role="status">正在恢复阅读…</p>
                  )}
                  {resumeState.kind === "success" && (
                    <p className="action-state success" role="status">已恢复阅读。</p>
                  )}
                  {resumeState.kind === "failed" && (
                    <p className="action-state error" role="alert">{resumeState.error}</p>
                  )}
                  {refreshState.kind === "pending" && (
                    <p className="action-state" role="status">正在刷新来源绑定…</p>
                  )}
                  {refreshState.kind === "success" && (
                    <p className="action-state success" role="status">来源绑定已刷新，可以恢复阅读。</p>
                  )}
                  {refreshState.kind === "failed" && (
                    <p className="action-state error" role="alert">{refreshState.error}</p>
                  )}
                </div>
                <div className="library-actions">
                  {item.sourceBinding.availability === "available" && (
                    <button
                      type="button"
                      disabled={deleting || resumeState.kind === "pending"}
                      onClick={() => void resume(item)}
                    >
                      {resumeState.kind === "pending"
                        ? "正在恢复阅读…"
                        : resumeState.kind === "failed"
                          ? "重试恢复"
                          : "继续阅读"}
                    </button>
                  )}
                  {item.sourceBinding.availability !== "available" && (
                    <button
                      type="button"
                      disabled={deleting || refreshState.kind === "pending"}
                      onClick={() => void refreshSourceBinding(item)}
                    >
                      {refreshState.kind === "pending"
                        ? "正在刷新来源绑定…"
                        : refreshState.kind === "failed"
                          ? "重试刷新"
                      : "刷新来源绑定"}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={() => { setDeleteError(null); setDeleteTarget(item); }}
                  >
                    从书架删除
                  </button>
                </div>
              </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
