import { useEffect, useRef, useState } from "react";

import {
  LIBRARY_ITEMS_PATH,
  LOCAL_CORE_ORIGIN,
  FIXTURE_SOURCE_PLUGIN,
  READING_PROVIDERS_PATH,
  READER_SESSIONS_PATH,
  catalogSearchUrl,
  comicChaptersUrl,
  comicDetailsUrl,
  parseApiErrorResponse,
  parseCatalogChaptersResponse,
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

function providerLabel(provider: ReadingProvider): string {
  return `${provider.sourcePluginName} / ${provider.name} (${provider.language})`;
}

export function ReadingExperience() {
  const [providers, setProviders] = useState<ReadingProvidersState>({
    items: [],
    kind: "loading",
    message: null,
  });
  const [providerRefreshAttempt, setProviderRefreshAttempt] = useState(0);
  const [providerSelection, setProviderSelection] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ kind: "idle" });
  const [details, setDetails] = useState<DetailsState>({ kind: "idle" });
  const [reader, setReader] = useState<ReaderSessionResponse["session"] | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [imageAttempt, setImageAttempt] = useState(0);
  const [imageState, setImageState] = useState<
    | { kind: "loading" }
    | { height: number; kind: "ready"; width: number }
    | { kind: "failed" }
  >({ kind: "loading" });
  const [retainedId, setRetainedId] = useState<string | null>(null);
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
  const deletedIds = useRef(new Set<string>());

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
        setProviders((current) => ({
          items:
            response.state === "error" && response.items.length === 0
              ? current.items
              : response.items,
          kind: response.state,
          message: response.message,
        }));
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

  const runSearch = async () => {
    if (!selectedProvider || !selectedProvider.available) return;
    const generation = readingGeneration.current;
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
      if (generation !== readingGeneration.current) return;
      setSearch(
        response.items.length === 0
          ? { kind: "empty" }
          : { kind: "success", items: response.items },
      );
    } catch (error) {
      if (generation !== readingGeneration.current) return;
      setSearch({
        kind: "failed",
        error:
          error instanceof RequestError
            ? error
            : new RequestError("The catalog search failed.", true),
      });
    }
  };

  const openDetails = async (item: CatalogSearchItem) => {
    const generation = readingGeneration.current;
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
      if (generation !== readingGeneration.current) return;
      setDetails({ kind: "success", comic: comic.comic, chapters: chapters.items });
    } catch (error) {
      if (generation !== readingGeneration.current) return;
      setDetails({
        kind: "failed",
        error: error instanceof Error ? error.message : "Comic details could not be loaded.",
      });
    }
  };

  const acceptSession = (session: ReaderSessionResponse["session"]) => {
    setReader(session);
    setPageIndex(session.pageIndex);
    setImageAttempt(0);
    setImageState({ kind: "loading" });
    setRetainedId(null);
    setSaveMessage(null);
  };

  const openChapter = async (chapterKey: string) => {
    if (details.kind !== "success") return;
    const generation = readingGeneration.current;
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
      if (generation !== readingGeneration.current) return;
      acceptSession(response.session);
    } catch (error) {
      if (generation !== readingGeneration.current) return;
      setDetails({
        kind: "failed",
        error: error instanceof Error ? error.message : "The chapter could not be opened.",
      });
    }
  };

  const resume = async (item: LibraryItem) => {
    const generation = readingGeneration.current;
    setResumeStates((states) => ({ ...states, [item.id]: { kind: "pending" } }));
    try {
      const response = await requestJson(
        `${LOCAL_CORE_ORIGIN}${READER_SESSIONS_PATH}`,
        json("POST", { libraryItemId: item.id }),
        parseReaderSessionResponse,
      );
      if (generation !== readingGeneration.current) return;
      acceptSession(response.session);
      setRetainedId(item.id);
      setResumeStates((states) => ({ ...states, [item.id]: { kind: "success" } }));
    } catch (error) {
      if (generation !== readingGeneration.current) return;
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
      if (generation !== readingGeneration.current) return;
      acceptSession(response.session);
      if (libraryItemId) setRetainedId(libraryItemId);
    } catch (error) {
      if (generation !== readingGeneration.current) return;
      setSaveMessage(
        error instanceof Error ? error.message : "The reader session could not be renewed.",
      );
    }
  };

  const retain = async () => {
    if (!reader) return;
    const generation = readingGeneration.current;
    try {
      const response = await requestJson(
        `${LOCAL_CORE_ORIGIN}${LIBRARY_ITEMS_PATH}`,
        json("POST", { pageIndex, sessionId: reader.id }),
        parseLibraryItemResponse,
      );
      if (generation !== readingGeneration.current) return;
      setRetainedId(response.item.id);
      setSaveMessage("Saved to Library");
      setLibraryAttempt((value) => value + 1);
    } catch (error) {
      if (generation !== readingGeneration.current) return;
      setSaveMessage(error instanceof Error ? error.message : "The comic could not be retained.");
    }
  };

  const movePage = async (nextPageIndex: number) => {
    if (!reader || nextPageIndex < 0 || nextPageIndex >= reader.pageCount) return;
    const previousPageIndex = pageIndex;
    setPageIndex(nextPageIndex);
    setImageState({ kind: "loading" });
    setSaveMessage(null);
    if (!retainedId) return;
    const generation = readingGeneration.current;
    try {
      await requestJson(
        `${LOCAL_CORE_ORIGIN}${LIBRARY_ITEMS_PATH}/${encodeURIComponent(retainedId)}/progress`,
        json("PUT", {
          chapterKey: reader.chapterKey,
          chapterLabel: reader.chapterLabel,
          pageCount: reader.pageCount,
          pageIndex: nextPageIndex,
        }),
        parseLibraryItemResponse,
      );
      if (generation !== readingGeneration.current) return;
      setSaveMessage("Reading Progress saved");
      setLibraryAttempt((value) => value + 1);
    } catch (error) {
      if (generation !== readingGeneration.current) return;
      setPageIndex(previousPageIndex);
      setImageState({ kind: "loading" });
      setSaveMessage(
        error instanceof Error ? error.message : "Reading Progress could not be saved.",
      );
      setLibraryAttempt((value) => value + 1);
    }
  };

  return (
    <>
      <section className="reading-panel" aria-labelledby="find-comic-heading">
        <p className="eyebrow">READ / COMIC CATALOG</p>
        <h2 id="find-comic-heading">Find a comic</h2>
        <div className="search-controls">
          <label>
            Comic Provider
            <select
              aria-label="Comic Provider"
              value={providerSelection}
              onChange={(event) => {
                readingGeneration.current += 1;
                setProviderSelection(event.target.value);
                setSearch({ kind: "idle" });
                setDetails({ kind: "idle" });
                setReader(null);
              }}
            >
              <option value="">Choose a Comic Provider</option>
              {providers.items.map((provider) => (
                <option
                  key={JSON.stringify([provider.sourcePluginKey, provider.comicProviderKey])}
                  disabled={!provider.available}
                  value={providerOptionValue(provider)}
                >
                  {providerLabel(provider)}{provider.available ? "" : " — unavailable"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Search query
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && query.trim()) void runSearch();
              }}
            />
          </label>
          <button type="button" disabled={!selectedProvider?.available || !query.trim() || search.kind === "loading"} onClick={() => void runSearch()}>
            Search catalog
          </button>
        </div>

        {providers.kind === "loading" && providers.items.length === 0 && (
          <p className="reading-notice">Loading installed Comic Providers…</p>
        )}
        {providers.kind === "empty" && (
          <p className="reading-notice">No installed Comic Providers are available.</p>
        )}
        {providers.kind === "error" && (
          <div className="reading-notice error" role="alert">
            <span>{providers.message ?? "Installed Comic Providers could not be loaded."}</span>
            <button type="button" onClick={() => setProviderRefreshAttempt((attempt) => attempt + 1)}>
              Retry Comic Providers
            </button>
          </div>
        )}

        {search.kind === "loading" && <p className="reading-notice">Searching {selectedProvider ? providerLabel(selectedProvider) : "Comic Provider"}…</p>}
        {search.kind === "empty" && <p className="reading-notice">No comics matched this search.</p>}
        {search.kind === "failed" && (
          <div className="reading-notice error" role="alert">
            <span>{search.error.message}</span>
            {search.error.retryable && <button type="button" onClick={() => void runSearch()}>Retry search</button>}
          </div>
        )}
        {search.kind === "success" && (
          <ul className="result-list">
            {search.items.map((item) => (
              <li key={`${item.sourcePluginKey}:${item.comicKey}`}>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.sourcePluginName}</span>
                </div>
                <button type="button" onClick={() => void openDetails(item)}>Open details</button>
              </li>
            ))}
          </ul>
        )}

        {details.kind === "loading" && <p className="reading-notice">Loading comic details…</p>}
        {details.kind === "failed" && <p className="reading-notice error" role="alert">{details.error}</p>}
        {details.kind === "success" && (
          <article className="comic-details">
            <p className="eyebrow">{details.comic.sourcePluginName}</p>
            <h3>{details.comic.title}</h3>
            <p>{details.comic.description}</p>
            {details.chapters.map((chapter) => (
              <button key={chapter.chapterKey} type="button" onClick={() => void openChapter(chapter.chapterKey)}>
                Read {chapter.label}
              </button>
            ))}
          </article>
        )}
      </section>

      {reader && (
        <section className="reader" role="region" aria-label="Reader">
          <div className="reader-context">
            <div>
              <p className="eyebrow">{reader.sourcePluginName}</p>
              <h2>{reader.title}</h2>
              <p>{reader.chapterLabel}</p>
            </div>
            <strong>Page {pageIndex + 1} of {reader.pageCount}</strong>
          </div>
          <div className="page-frame">
            {imageState.kind === "loading" && <p>Loading page…</p>}
            <img
              alt={`${reader.title} — page ${pageIndex + 1} of ${reader.pageCount}`}
              key={`${reader.id}:${pageIndex}:${imageAttempt}`}
              src={`${readerPageUrl(reader.id, pageIndex)}?attempt=${imageAttempt}`}
              onError={() => setImageState({ kind: "failed" })}
              onLoad={(event) =>
                setImageState({
                  kind: "ready",
                  height: event.currentTarget.naturalHeight,
                  width: event.currentTarget.naturalWidth,
                })
              }
            />
            {imageState.kind === "ready" && <p>Rendered {imageState.width} × {imageState.height}</p>}
            {imageState.kind === "failed" && (
              <div className="reading-notice error" role="alert">
                <span>The page could not be loaded. Your reader context was preserved.</span>
                <button type="button" onClick={() => { setImageState({ kind: "loading" }); setImageAttempt((value) => value + 1); }}>
                  Retry page
                </button>
                <button type="button" onClick={() => void renewReaderSession()}>
                  Renew reader session
                </button>
              </div>
            )}
          </div>
          <div className="reader-actions">
            <button type="button" disabled={pageIndex === 0} onClick={() => void movePage(pageIndex - 1)}>Previous page</button>
            <button type="button" disabled={Boolean(retainedId) || deleting} onClick={() => void retain()}>Retain in Library</button>
            <button type="button" disabled={pageIndex === reader.pageCount - 1} onClick={() => void movePage(pageIndex + 1)}>Next page</button>
          </div>
          {saveMessage && <p className="save-message" role="status">{saveMessage}</p>}
        </section>
      )}

      <section className="library-panel" role="region" aria-label="Your Library">
        <div className="section-heading">
          <div>
            <p className="eyebrow">LOCAL / RETAINED STATE</p>
            <h2>Your Library</h2>
          </div>
          <button type="button" disabled={library.kind === "loading"} onClick={() => setLibraryAttempt((value) => value + 1)}>Reload Library</button>
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
        {library.kind === "loading" && <p className="reading-notice">Loading your Library…</p>}
        {library.kind === "failed" && <p className="reading-notice error" role="alert">{library.error}</p>}
        {library.kind === "loaded" && library.items.length === 0 && <p className="reading-notice">Your Library is empty.</p>}
        {library.kind === "loaded" && library.items.length > 0 && (
          <ul className="library-list">
            {library.items.map((item) => {
              const resumeState = resumeStates[item.id] ?? { kind: "idle" as const };
              const refreshState = refreshStates[item.sourceBinding.id] ?? { kind: "idle" as const };
              return (
              <li key={item.id}>
                <div>
                  <h3>{item.snapshot.title}</h3>
                  <p>{item.progress.chapterLabel}</p>
                  <p>Page {item.progress.pageIndex + 1} of {item.progress.pageCount}</p>
                  <span className={`availability ${item.sourceBinding.availability}`}>
                    {item.sourceBinding.availability === "available"
                      ? "Available"
                      : item.sourceBinding.availability === "refresh_required"
                        ? "Source Binding refresh required"
                        : reasonLabels[item.sourceBinding.reasonCode ?? "unknown"]}
                  </span>
                  {resumeState.kind === "pending" && (
                    <p className="action-state" role="status">Resuming reading…</p>
                  )}
                  {resumeState.kind === "success" && (
                    <p className="action-state success" role="status">Reading resumed.</p>
                  )}
                  {resumeState.kind === "failed" && (
                    <p className="action-state error" role="alert">{resumeState.error}</p>
                  )}
                  {refreshState.kind === "pending" && (
                    <p className="action-state" role="status">Refreshing Source Binding…</p>
                  )}
                  {refreshState.kind === "success" && (
                    <p className="action-state success" role="status">Source Binding refreshed. Resume reading when ready.</p>
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
                        ? "Resuming reading…"
                        : resumeState.kind === "failed"
                          ? "Retry Resume"
                          : "Resume reading"}
                    </button>
                  )}
                  {item.sourceBinding.availability !== "available" && (
                    <button
                      type="button"
                      disabled={deleting || refreshState.kind === "pending"}
                      onClick={() => void refreshSourceBinding(item)}
                    >
                      {refreshState.kind === "pending"
                        ? "Refreshing Source Binding…"
                        : refreshState.kind === "failed"
                          ? "Retry refresh"
                      : "Refresh Source Binding"}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={() => { setDeleteError(null); setDeleteTarget(item); }}
                  >
                    Delete from Library
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
