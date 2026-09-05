import assert from "node:assert/strict";
import test from "node:test";

import {
  catalogSearchUrl,
  parseReadingSourcePluginResponse,
  parseReadingProviderSelection,
  parseReadingProvidersResponse,
  parseRefreshSourceBindingRequest,
  parseCatalogSearchResponse,
  parseCreateReaderSessionRequest,
  parseDeleteLibraryItemResponse,
  parseLibraryItemId,
  parseLibraryItemsResponse,
  parseUpdateProgressRequest,
} from "./index.ts";

test("reading providers expose exact stable identities and availability", () => {
  const response = parseReadingProvidersResponse({
    items: [
      {
        available: true,
        comicProviderKey: "mangadex:en",
        language: "en",
        name: "MangaDex",
        sourcePluginKey: "mihon:mangadex",
        sourcePluginName: "Mihon MangaDex",
      },
    ],
    message: null,
    state: "success",
  });
  assert.equal(response.items[0]?.comicProviderKey, "mangadex:en");
  assert.equal(response.items[0]?.available, true);
  assert.throws(
    () => parseReadingProvidersResponse({ items: [], message: null, state: "success", upstreamUrl: "https://example.invalid" }),
    /unexpected field/i,
  );
  assert.throws(
    () => parseReadingProvidersResponse({ items: [{ available: "yes" }], message: null, state: "success" }),
    /expected a boolean/i,
  );
});

test("reading provider selections reject missing, blank, and unknown fields", () => {
  assert.deepEqual(
    parseReadingProviderSelection({
      comicProviderKey: "mangadex:en",
      sourcePluginKey: "mihon:mangadex",
    }),
    { comicProviderKey: "mangadex:en", sourcePluginKey: "mihon:mangadex" },
  );
  assert.deepEqual(parseReadingProviderSelection({ sourcePluginKey: "fixture:reader" }), {
    sourcePluginKey: "fixture:reader",
  });
  for (const value of [
    {},
    { sourcePluginKey: "" },
    { sourcePluginKey: "fixture:reader", comicProviderKey: "" },
    { sourcePluginKey: "fixture:reader", upstreamUrl: "https://example.invalid" },
  ]) {
    assert.throws(() => parseReadingProviderSelection(value), TypeError);
  }
});

test("catalog search URL includes the selected Comic Provider when present", () => {
  const url = new URL(catalogSearchUrl("mihon:mangadex", "adventure", "mangadex:en"));
  assert.equal(url.searchParams.get("sourcePluginKey"), "mihon:mangadex");
  assert.equal(url.searchParams.get("comicProviderKey"), "mangadex:en");
  assert.equal(new URL(catalogSearchUrl("fixture:reader", "adventure")).searchParams.has("comicProviderKey"), false);
});

test("reading Source Plugin responses expose only stable Comic Free identity", () => {
  assert.deepEqual(
    parseReadingSourcePluginResponse({
      sourcePlugin: {
        key: "mihon:eu.kanade.tachiyomi.extension.all.mangadex:en",
        name: "MangaDex (English)",
      },
    }),
    {
      sourcePlugin: {
        key: "mihon:eu.kanade.tachiyomi.extension.all.mangadex:en",
        name: "MangaDex (English)",
      },
    },
  );
  assert.throws(
    () =>
      parseReadingSourcePluginResponse({
        sourcePlugin: {
          graphqlUrl: "http://127.0.0.1:4568/api/graphql",
          key: "plugin",
          name: "Plugin",
        },
      }),
    /unexpected field/i,
  );
});

test("accepts normalized fixture catalog results with plugin-scoped durable keys", () => {
  const result = parseCatalogSearchResponse({
    items: [
      {
        comicKey: "comic/deterministic-adventure",
        coverRef: "fixture-cover/deterministic-adventure",
        sourcePluginKey: "fixture:reader",
        sourcePluginName: "Comic Free Fixture",
        title: "Deterministic Adventure",
      },
    ],
  });

  assert.equal(result.items[0]?.comicKey, "comic/deterministic-adventure");
  assert.equal(result.items[0]?.sourcePluginName, "Comic Free Fixture");
});
test("reader-session requests reject caller-supplied upstream URLs", () => {
  assert.throws(
    () =>
      parseCreateReaderSessionRequest({
        chapterKey: "chapter/one",
        comicKey: "comic/deterministic-adventure",
        sourcePluginKey: "fixture:reader",
        upstreamUrl: "https://example.invalid/page.png",
      }),
    /unexpected field/i,
  );
});

test("progress requests reject negative and out-of-range page indexes", () => {
  assert.throws(
    () =>
      parseUpdateProgressRequest({
        chapterKey: "chapter/one",
        chapterLabel: "Chapter 1 · The Local Beginning",
        pageCount: 3,
        pageIndex: -1,
      }),
    /pageIndex/,
  );
  assert.throws(
    () =>
      parseUpdateProgressRequest({
        chapterKey: "chapter/one",
        chapterLabel: "Chapter 1 · The Local Beginning",
        pageCount: 3,
        pageIndex: 3,
      }),
    /pageIndex/,
  );
});

test("Library Item identifiers and delete responses require exact UUID contracts", () => {
  const id = "1a1e91f0-635d-4dd6-a291-57614b458903";
  assert.equal(parseLibraryItemId(id), id);
  assert.deepEqual(parseDeleteLibraryItemResponse({ deletedId: id }), { deletedId: id });
  assert.throws(() => parseLibraryItemId("deleted"), /UUID/);
  assert.throws(
    () => parseDeleteLibraryItemResponse({ deletedId: id, item: {} }),
    /unexpected field/i,
  );
});

test("library responses retain snapshot, binding reason, and readable progress", () => {
  const response = parseLibraryItemsResponse({
    items: [
      {
        createdAt: "2026-09-04T00:00:00.000Z",
        id: "library-1",
        progress: {
          chapterKey: "chapter/one",
          chapterLabel: "Chapter 1 · The Local Beginning",
          pageCount: 3,
          pageIndex: 1,
          updatedAt: "2026-09-04T00:00:00.000Z",
        },
        snapshot: {
          coverRef: "fixture-cover/deterministic-adventure",
          title: "Deterministic Adventure",
          updatedAt: "2026-09-04T00:00:00.000Z",
        },
        sourceBinding: {
          availability: "unavailable",
          comicProviderKey: "fixture.provider",
          durableComicKey: "comic/deterministic-adventure",
          id: "binding-1",
          observedAt: "2026-09-04T00:00:00.000Z",
          reasonCode: "comic_provider_unreachable",
          sourcePluginKey: "fixture:reader",
          updatedAt: "2026-09-04T00:00:00.000Z",
        },
      },
    ],
  });

  assert.equal(response.items[0]?.sourceBinding.availability, "unavailable");
  assert.equal(response.items[0]?.progress.pageIndex, 1);
});

test("binding refresh accepts only an explicit empty request", () => {
  assert.deepEqual(parseRefreshSourceBindingRequest({}), {});
  for (const value of [null, [], "", { comicKey: "replacement" }, { pageIndex: 0 }, { upstreamUrl: "https://example.invalid" }]) {
    assert.throws(() => parseRefreshSourceBindingRequest(value), TypeError);
  }
});
