import { useEffect, useState } from "react";

import {
  FIXTURE_SOURCE_PLUGIN,
  LIBRARY_ITEMS_PATH,
  LOCAL_CORE_ORIGIN,
  READER_SESSIONS_PATH,
  catalogSearchUrl,
  comicChaptersUrl,
  comicDetailsUrl,
  parseApiErrorResponse,
  parseCatalogChaptersResponse,
  parseCatalogSearchResponse,
  parseComicDetailsResponse,
  parseLibraryItemResponse,
  parseLibraryItemsResponse,
  parseReaderSessionResponse,
  readerPageUrl,
  type CatalogChaptersResponse,
  type CatalogSearchItem,
  type ComicDetailsResponse,
  type LibraryItem,
  type ReaderSessionResponse,
} from "@comic-free/contracts";

import "./reading.css";

const SOURCE_PLUGINS = [FIXTURE_SOURCE_PLUGIN] as const;

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

export function ReadingExperience() {
  const [sourcePluginKey, setSourcePluginKey] = useState("");
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

  useEffect(() => {
    const controller = new AbortController();
    setLibrary({ kind: "loading" });
    void requestJson(
      `${LOCAL_CORE_ORIGIN}${LIBRARY_ITEMS_PATH}`,
      { signal: controller.signal },
      parseLibraryItemsResponse,
    ).then(
      (response) => setLibrary({ kind: "loaded", items: response.items }),
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
    if (!sourcePluginKey) return;
    setSearch({ kind: "loading" });
    setDetails({ kind: "idle" });
    setReader(null);
    try {
      const response = await requestJson(
        catalogSearchUrl(sourcePluginKey, query),
        undefined,
        parseCatalogSearchResponse,
      );
      setSearch(
        response.items.length === 0
          ? { kind: "empty" }
          : { kind: "success", items: response.items },
      );
    } catch (error) {
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
      setDetails({ kind: "success", comic: comic.comic, chapters: chapters.items });
    } catch (error) {
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
      acceptSession(response.session);
    } catch (error) {
      setDetails({
        kind: "failed",
        error: error instanceof Error ? error.message : "The chapter could not be opened.",
      });
    }
  };

  const resume = async (item: LibraryItem) => {
    try {
      const response = await requestJson(
        `${LOCAL_CORE_ORIGIN}${READER_SESSIONS_PATH}`,
        json("POST", { libraryItemId: item.id }),
        parseReaderSessionResponse,
      );
      acceptSession(response.session);
      setRetainedId(item.id);
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Reading could not resume.");
    }
  };

  const retain = async () => {
    if (!reader) return;
    try {
      const response = await requestJson(
        `${LOCAL_CORE_ORIGIN}${LIBRARY_ITEMS_PATH}`,
        json("POST", { pageIndex, sessionId: reader.id }),
        parseLibraryItemResponse,
      );
      setRetainedId(response.item.id);
      setSaveMessage("Saved to Library");
      setLibraryAttempt((value) => value + 1);
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "The comic could not be retained.");
    }
  };

  const movePage = async (nextPageIndex: number) => {
    if (!reader || nextPageIndex < 0 || nextPageIndex >= reader.pageCount) return;
    setPageIndex(nextPageIndex);
    setImageState({ kind: "loading" });
    setSaveMessage(null);
    if (!retainedId) return;
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
      setSaveMessage("Reading Progress saved");
      setLibraryAttempt((value) => value + 1);
    } catch (error) {
      setSaveMessage(
        error instanceof Error ? error.message : "Reading Progress could not be saved.",
      );
    }
  };

  return (
    <>
      <section className="reading-panel" aria-labelledby="find-comic-heading">
        <p className="eyebrow">READ / DETERMINISTIC CATALOG</p>
        <h2 id="find-comic-heading">Find a comic</h2>
        <div className="search-controls">
          <label>
            Source Plugin
            <select
              aria-label="Source Plugin"
              value={sourcePluginKey}
              onChange={(event) => {
                setSourcePluginKey(event.target.value);
                setSearch({ kind: "idle" });
                setDetails({ kind: "idle" });
                setReader(null);
              }}
            >
              <option value="">Choose a Source Plugin</option>
              {SOURCE_PLUGINS.map((plugin) => (
                <option key={plugin.key} value={plugin.key}>{plugin.name}</option>
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
          <button type="button" disabled={!sourcePluginKey || !query.trim() || search.kind === "loading"} onClick={() => void runSearch()}>
            Search catalog
          </button>
        </div>

        {search.kind === "loading" && <p className="reading-notice">Searching {SOURCE_PLUGINS.find((plugin) => plugin.key === sourcePluginKey)?.name ?? "Source Plugin"}…</p>}
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
              </div>
            )}
          </div>
          <div className="reader-actions">
            <button type="button" disabled={pageIndex === 0} onClick={() => void movePage(pageIndex - 1)}>Previous page</button>
            <button type="button" disabled={Boolean(retainedId)} onClick={() => void retain()}>Retain in Library</button>
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
        {library.kind === "loading" && <p className="reading-notice">Loading your Library…</p>}
        {library.kind === "failed" && <p className="reading-notice error" role="alert">{library.error}</p>}
        {library.kind === "loaded" && library.items.length === 0 && <p className="reading-notice">Your Library is empty.</p>}
        {library.kind === "loaded" && library.items.length > 0 && (
          <ul className="library-list">
            {library.items.map((item) => (
              <li key={item.id}>
                <div>
                  <h3>{item.snapshot.title}</h3>
                  <p>{item.progress.chapterLabel}</p>
                  <p>Page {item.progress.pageIndex + 1} of {item.progress.pageCount}</p>
                  <span className={item.sourceBinding.availability === "available" ? "availability available" : "availability unavailable"}>
                    {item.sourceBinding.availability === "available"
                      ? "Available"
                      : reasonLabels[item.sourceBinding.reasonCode ?? "unknown"]}
                  </span>
                </div>
                <button type="button" disabled={item.sourceBinding.availability !== "available"} onClick={() => void resume(item)}>Resume reading</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
