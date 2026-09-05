import assert from "node:assert/strict";
import test from "node:test";

import {
  parseReadingSourcePluginResponse,
  parseCatalogSearchResponse,
  parseCreateReaderSessionRequest,
  parseLibraryItemsResponse,
  parseUpdateProgressRequest,
} from "./index.ts";

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
