import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";

import {
  CATALOG_BROWSE_PATH,
  CATALOG_SEARCH_PATH,
  FIXTURE_SOURCE_PLUGIN,
  LIBRARY_ITEMS_PATH,
  READER_SESSIONS_PATH,
  parseApiErrorResponse,
  parseCatalogBrowseResponse,
  parseCatalogChaptersResponse,
  parseCatalogSearchResponse,
  parseComicDetailsResponse,
  parseLibraryItemResponse,
  parseLibraryItemsResponse,
  parseDeleteLibraryItemResponse,
  parseReaderSessionResponse,
  catalogCoverUrl,
} from "@comic-free/contracts";

import {
  FIXTURE_CHAPTER_KEY,
  FIXTURE_COMIC_KEY,
  FixtureReadingAdapter,
} from "./reading-adapter.ts";
import { createReadingHttpHandler } from "./reading-http.ts";
import { ReadingService } from "./reading-service.ts";
import { ReadingStore } from "./reading-store.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const TEST_ROOT = path.join(
  ROOT,
  ".local-data",
  "test-output",
  "02-deterministic-reading",
);

interface RunningReadingServer {
  baseUrl: string;
  store: ReadingStore;
  stop: () => Promise<void>;
}

function createTestDirectory(): string {
  mkdirSync(TEST_ROOT, { recursive: true });
  return mkdtempSync(path.join(TEST_ROOT, "reading-http-"));
}

function removeTestDirectory(directory: string): void {
  const relative = path.relative(TEST_ROOT, path.resolve(directory));
  assert.notEqual(relative, "");
  assert.equal(relative.startsWith(".."), false);
  rmSync(directory, { recursive: true, force: true });
}

async function startReadingServer(databasePath: string): Promise<RunningReadingServer> {
  const store = new ReadingStore(databasePath, () => "2026-09-04T12:00:00.000Z");
  const service = new ReadingService(new FixtureReadingAdapter(), store);
  const handle = createReadingHttpHandler(service);
  const server = createServer((request, response) => void handle(request, response));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    store,
    stop: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      store.close();
    },
  };
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function responseJson(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>;
}

test("REST journey reads exact session bytes, retains progress, and survives restart", async () => {
  const directory = createTestDirectory();
  const databasePath = path.join(directory, "comic-free.sqlite");
  let running = await startReadingServer(databasePath);

  try {
    const searchUrl = new URL(`${running.baseUrl}${CATALOG_SEARCH_PATH}`);
    searchUrl.searchParams.set("sourcePluginKey", FIXTURE_SOURCE_PLUGIN.key);
    searchUrl.searchParams.set("q", "adventure");
    const search = parseCatalogSearchResponse(
      await responseJson(await fetch(searchUrl)),
    );
    assert.equal(search.items.length, 1);

    const browseUrl = new URL(`${running.baseUrl}${CATALOG_BROWSE_PATH}`);
    browseUrl.searchParams.set("sourcePluginKey", FIXTURE_SOURCE_PLUGIN.key);
    browseUrl.searchParams.set("page", "1");
    const browseResponse = await fetch(browseUrl, { signal: AbortSignal.timeout(1_000) });
    assert.equal(browseResponse.status, 200);
    const browse = parseCatalogBrowseResponse(await responseJson(browseResponse));
    assert.equal(browse.items.length, 1);
    assert.equal(browse.nextPage, null);

    const coverResponse = await fetch(
      `${running.baseUrl}/api/v1/catalog/comics/${encodeURIComponent(FIXTURE_COMIC_KEY)}/cover?sourcePluginKey=${encodeURIComponent(FIXTURE_SOURCE_PLUGIN.key)}`,
      { signal: AbortSignal.timeout(1_000) },
    );
    const coverBytes = Buffer.from(await coverResponse.arrayBuffer());
    assert.equal(coverResponse.status, 200);
    assert.equal(coverResponse.headers.get("content-type"), "image/svg+xml; charset=utf-8");
    assert.match(coverBytes.toString("utf8"), /PAGE ONE/);

    const encodedComic = encodeURIComponent(FIXTURE_COMIC_KEY);
    const details = parseComicDetailsResponse(
      await responseJson(
        await fetch(
          `${running.baseUrl}/api/v1/catalog/comics/${encodedComic}?sourcePluginKey=${encodeURIComponent(FIXTURE_SOURCE_PLUGIN.key)}`,
        ),
      ),
    );
    assert.equal(details.comic.title, "Deterministic Adventure");

    const chapters = parseCatalogChaptersResponse(
      await responseJson(
        await fetch(
          `${running.baseUrl}/api/v1/catalog/comics/${encodedComic}/chapters?sourcePluginKey=${encodeURIComponent(FIXTURE_SOURCE_PLUGIN.key)}`,
        ),
      ),
    );
    assert.equal(chapters.items[0]?.label, "Chapter 1 · The Local Beginning");

    const sessionResponse = await fetch(
      `${running.baseUrl}${READER_SESSIONS_PATH}`,
      json("POST", {
        chapterKey: FIXTURE_CHAPTER_KEY,
        comicKey: FIXTURE_COMIC_KEY,
        sourcePluginKey: FIXTURE_SOURCE_PLUGIN.key,
      }),
    );
    assert.equal(sessionResponse.status, 201);
    const session = parseReaderSessionResponse(await responseJson(sessionResponse)).session;
    assert.equal(session.pageCount, 3);

    const pageResponse = await fetch(
      `${running.baseUrl}${READER_SESSIONS_PATH}/${session.id}/pages/1`,
    );
    const pageBytes = Buffer.from(await pageResponse.arrayBuffer());
    assert.equal(pageResponse.status, 200);
    assert.equal(pageResponse.headers.get("content-type"), "image/svg+xml; charset=utf-8");
    assert.equal(
      createHash("sha256").update(pageBytes).digest("hex"),
      "3eafebf9fa45b1d48b81c87bb85c55987b6d51ea34a5399c58bbe797c7311e9f",
    );

    const retainedResponse = await fetch(
      `${running.baseUrl}${LIBRARY_ITEMS_PATH}`,
      json("POST", { pageIndex: 1, sessionId: session.id }),
    );
    assert.equal(retainedResponse.status, 201);
    const retained = parseLibraryItemResponse(await responseJson(retainedResponse)).item;

    const progressed = parseLibraryItemResponse(
      await responseJson(
        await fetch(
          `${running.baseUrl}${LIBRARY_ITEMS_PATH}/${retained.id}/progress`,
          json("PUT", {
            chapterKey: session.chapterKey,
            chapterLabel: session.chapterLabel,
            pageCount: session.pageCount,
            pageIndex: 2,
          }),
        ),
      ),
    ).item;
    assert.equal(progressed.progress.pageIndex, 2);

    const unavailable = parseLibraryItemResponse(
      await responseJson(
        await fetch(
          `${running.baseUrl}/api/v1/fixture/source-bindings/${retained.sourceBinding.id}/unavailable`,
          json("POST", { reasonCode: "comic_provider_unreachable" }),
        ),
      ),
    ).item;
    assert.equal(unavailable.sourceBinding.availability, "unavailable");
    assert.deepEqual(unavailable.snapshot, progressed.snapshot);
    assert.deepEqual(unavailable.progress, progressed.progress);

    const catalogCoverRoute = new URL(catalogCoverUrl(FIXTURE_SOURCE_PLUGIN.key, FIXTURE_COMIC_KEY));
    const catalogCover = await fetch(`${running.baseUrl}${catalogCoverRoute.pathname}${catalogCoverRoute.search}`);
    assert.equal(catalogCover.status, 200, "Catalog covers remain browsable independently of a saved Source Binding.");
    assert.equal(catalogCover.headers.get("content-type"), "image/svg+xml; charset=utf-8");

    const invalidatedPage = await fetch(
      `${running.baseUrl}${READER_SESSIONS_PATH}/${session.id}/pages/1`,
    );
    assert.equal(invalidatedPage.status, 404);
    assert.equal(
      parseApiErrorResponse(await responseJson(invalidatedPage)).error.code,
      "reader_session_not_found",
    );

    const blockedRead = await fetch(
      `${running.baseUrl}${READER_SESSIONS_PATH}`,
      json("POST", { libraryItemId: retained.id }),
    );
    assert.equal(blockedRead.status, 409);
    assert.equal(parseApiErrorResponse(await responseJson(blockedRead)).error.code, "source_binding_unavailable");

    const blockedCatalogRead = await fetch(
      `${running.baseUrl}${READER_SESSIONS_PATH}`,
      json("POST", {
        chapterKey: FIXTURE_CHAPTER_KEY,
        comicKey: FIXTURE_COMIC_KEY,
        sourcePluginKey: FIXTURE_SOURCE_PLUGIN.key,
      }),
    );
    assert.equal(blockedCatalogRead.status, 409);
    assert.equal(
      parseApiErrorResponse(await responseJson(blockedCatalogRead)).error.code,
      "source_binding_unavailable",
    );

    await running.stop();
    running = await startReadingServer(databasePath);

    const afterRestart = parseLibraryItemsResponse(
      await responseJson(await fetch(`${running.baseUrl}${LIBRARY_ITEMS_PATH}`)),
    );
    assert.deepEqual(afterRestart.items, [unavailable]);

    const staleSession = await fetch(
      `${running.baseUrl}${READER_SESSIONS_PATH}/${session.id}/pages/1`,
    );
    assert.equal(staleSession.status, 404);
    assert.equal(parseApiErrorResponse(await responseJson(staleSession)).error.code, "reader_session_not_found");

    const blockedCatalogReadAfterRestart = await fetch(
      `${running.baseUrl}${READER_SESSIONS_PATH}`,
      json("POST", {
        chapterKey: FIXTURE_CHAPTER_KEY,
        comicKey: FIXTURE_COMIC_KEY,
        sourcePluginKey: FIXTURE_SOURCE_PLUGIN.key,
      }),
    );
    assert.equal(blockedCatalogReadAfterRestart.status, 409);
  } finally {
    await running.stop();
    removeTestDirectory(directory);
  }
});

test("invalid requests and bounds return structured errors without mutation", async () => {
  const directory = createTestDirectory();
  const databasePath = path.join(directory, "comic-free.sqlite");
  const running = await startReadingServer(databasePath);

  try {
    const arbitraryUrl = await fetch(
      `${running.baseUrl}${READER_SESSIONS_PATH}`,
      json("POST", {
        chapterKey: FIXTURE_CHAPTER_KEY,
        comicKey: FIXTURE_COMIC_KEY,
        sourcePluginKey: FIXTURE_SOURCE_PLUGIN.key,
        upstreamUrl: "https://example.invalid/page.png",
      }),
    );
    assert.equal(arbitraryUrl.status, 400);
    assert.equal(parseApiErrorResponse(await responseJson(arbitraryUrl)).error.code, "invalid_request");

    const malformed = await fetch(`${running.baseUrl}${LIBRARY_ITEMS_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(malformed.status, 400);

    const invalidContentType = await fetch(`${running.baseUrl}${READER_SESSIONS_PATH}`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    assert.equal(invalidContentType.status, 415);

    const unsupportedMethod = await fetch(`${running.baseUrl}${LIBRARY_ITEMS_PATH}`, {
      method: "DELETE",
    });
    assert.equal(unsupportedMethod.status, 405);

    const emptySearch = await fetch(
      `${running.baseUrl}${CATALOG_SEARCH_PATH}?sourcePluginKey=${encodeURIComponent(FIXTURE_SOURCE_PLUGIN.key)}&q=`,
    );
    assert.equal(emptySearch.status, 400);

    const library = parseLibraryItemsResponse(
      await responseJson(await fetch(`${running.baseUrl}${LIBRARY_ITEMS_PATH}`)),
    );
    assert.deepEqual(library.items, []);
  } finally {
    await running.stop();
    removeTestDirectory(directory);
  }
});

test("DELETE removes only the requested Library Item and invalidates its reader sessions", async () => {
  const directory = createTestDirectory();
  const databasePath = path.join(directory, "comic-free.sqlite");
  let running = await startReadingServer(databasePath);

  try {
    const firstSession = parseReaderSessionResponse(
      await responseJson(
        await fetch(
          `${running.baseUrl}${READER_SESSIONS_PATH}`,
          json("POST", {
            chapterKey: FIXTURE_CHAPTER_KEY,
            comicKey: FIXTURE_COMIC_KEY,
            sourcePluginKey: FIXTURE_SOURCE_PLUGIN.key,
          }),
        ),
      ),
    ).session;
    const first = parseLibraryItemResponse(
      await responseJson(
        await fetch(
          `${running.baseUrl}${LIBRARY_ITEMS_PATH}`,
          json("POST", { pageIndex: 1, sessionId: firstSession.id }),
        ),
      ),
    ).item;
    const second = running.store.retain({
      chapterKey: "chapter/other",
      chapterLabel: "Chapter Other",
      comicKey: "comic/unrelated",
      comicProviderKey: "fixture.other",
      coverRef: "fixture-cover/unrelated",
      pageCount: 1,
      pageIndex: 0,
      sourcePluginKey: "fixture:other",
      title: "Unrelated Library Item",
    });

    const beforeInvalidDelete = parseLibraryItemsResponse(
      await responseJson(await fetch(`${running.baseUrl}${LIBRARY_ITEMS_PATH}`)),
    );
    assert.deepEqual(beforeInvalidDelete.items.map((item) => item.id), [first.id, second.id]);

    for (const invalidDelete of [
      `${running.baseUrl}${LIBRARY_ITEMS_PATH}/not-a-uuid`,
      `${running.baseUrl}${LIBRARY_ITEMS_PATH}/${first.id}?unexpected=true`,
    ]) {
      const response = await fetch(invalidDelete, { method: "DELETE" });
      assert.equal(response.status, 400);
      assert.equal(parseApiErrorResponse(await responseJson(response)).error.code, "invalid_request");
    }
    const bodyDelete = await fetch(`${running.baseUrl}${LIBRARY_ITEMS_PATH}/${first.id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(bodyDelete.status, 400);
    assert.deepEqual(
      parseLibraryItemsResponse(
        await responseJson(await fetch(`${running.baseUrl}${LIBRARY_ITEMS_PATH}`)),
      ),
      beforeInvalidDelete,
    );

    const deletedResponse = await fetch(
      `${running.baseUrl}${LIBRARY_ITEMS_PATH}/${first.id}`,
      { method: "DELETE" },
    );
    assert.equal(deletedResponse.status, 200);
    assert.deepEqual(parseDeleteLibraryItemResponse(await responseJson(deletedResponse)), {
      deletedId: first.id,
    });

    const staleRetain = await fetch(
      `${running.baseUrl}${LIBRARY_ITEMS_PATH}`,
      json("POST", { pageIndex: 1, sessionId: firstSession.id }),
    );
    assert.equal(staleRetain.status, 404);
    assert.equal(
      parseApiErrorResponse(await responseJson(staleRetain)).error.code,
      "reader_session_not_found",
    );

    const repeated = await fetch(`${running.baseUrl}${LIBRARY_ITEMS_PATH}/${first.id}`, {
      method: "DELETE",
    });
    assert.equal(repeated.status, 404);
    assert.equal(
      parseApiErrorResponse(await responseJson(repeated)).error.code,
      "library_item_not_found",
    );
    assert.deepEqual(
      parseLibraryItemsResponse(
        await responseJson(await fetch(`${running.baseUrl}${LIBRARY_ITEMS_PATH}`)),
      ).items,
      [second],
    );

    await running.stop();
    running = await startReadingServer(databasePath);
    assert.deepEqual(
      parseLibraryItemsResponse(
        await responseJson(await fetch(`${running.baseUrl}${LIBRARY_ITEMS_PATH}`)),
      ).items,
      [second],
    );
  } finally {
    await running.stop();
    removeTestDirectory(directory);
  }
});
