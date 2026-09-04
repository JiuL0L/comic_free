import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  CATALOG_SEARCH_PATH,
  LIBRARY_ITEMS_PATH,
  READER_SESSIONS_PATH,
  READING_SOURCE_PLUGIN_PATH,
  parseApiErrorResponse,
  parseCatalogChaptersResponse,
  parseCatalogSearchResponse,
  parseLibraryItemResponse,
  parseReaderSessionResponse,
  parseReadingSourcePluginResponse,
} from "@comic-free/contracts";

import { createReadingHttpHandler } from "./reading-http.ts";
import { ReadingService } from "./reading-service.ts";
import { ReadingStore } from "./reading-store.ts";
import {
  SuwayomiReadingAdapter,
  type SuwayomiGraphqlTransport,
} from "./suwayomi-reading-adapter.ts";

type RecordedGeneration = Record<"chapters" | "details" | "pages" | "search", unknown>;

const ROOT = path.resolve(import.meta.dirname, "../../..");
const TEST_ROOT = path.join(ROOT, ".local-data", "test-output", "05-suwayomi-reading");

class RecordedTransport implements SuwayomiGraphqlTransport {
  constructor(private readonly generation: RecordedGeneration) {}

  async request(operation: string): Promise<unknown> {
    if (operation.includes("ComicFreeSearch")) return this.generation.search;
    if (operation.includes("ComicFreeDetails")) return this.generation.details;
    if (operation.includes("ComicFreeChapters")) return this.generation.chapters;
    if (operation.includes("ComicFreePages")) return this.generation.pages;
    throw new Error(`Unexpected recorded operation: ${operation}`);
  }
}

function loadGeneration(name: string): RecordedGeneration {
  return JSON.parse(
    readFileSync(
      path.join(ROOT, "tests", "fixtures", "suwayomi", `${name}.json`),
      "utf8",
    ),
  ) as RecordedGeneration;
}

function createAdapter(name: string, expectedRuntimePath: RegExp): SuwayomiReadingAdapter {
  return new SuwayomiReadingAdapter({
    comicProviderKey: "mangadex.org",
    graphql: new RecordedTransport(loadGeneration(name)),
    pageFetch: async (input) => {
      assert.match(String(input), expectedRuntimePath);
      return new Response(Buffer.from([0xff, 0xd8, 0x43, 0x46, 0xff, 0xd9]), {
        headers: { "content-type": "image/jpeg" },
      });
    },
    sourceId: "2499283573021220255",
    sourcePluginKey: "mihon:eu.kanade.tachiyomi.extension.all.mangadex:en",
    sourcePluginName: "MangaDex (English)",
    suwayomiOrigin: "http://127.0.0.1:4568",
  });
}

interface RunningServer {
  baseUrl: string;
  stop: () => Promise<void>;
}

async function startServer(
  databasePath: string,
  adapter: SuwayomiReadingAdapter,
): Promise<RunningServer> {
  const store = new ReadingStore(databasePath, () => "2026-09-04T16:00:00.000Z");
  const service = new ReadingService(adapter, store);
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
    stop: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      store.close();
    },
  };
}

function json(body: unknown): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  };
}

async function value(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>;
}

function atServer(baseUrl: string, localCoreUrl: string): string {
  const local = new URL(localCoreUrl);
  return `${baseUrl}${local.pathname}${local.search}`;
}

test("REST renews an expired reader session from durable bindings after runtime ids change", async () => {
  mkdirSync(TEST_ROOT, { recursive: true });
  const directory = mkdtempSync(path.join(TEST_ROOT, "renewal-"));
  const databasePath = path.join(directory, "comic-free.sqlite");
  let running = await startServer(
    databasePath,
    createAdapter("reading-generation-1", /manga\/101\/chapter\/201/),
  );

  try {
    const source = parseReadingSourcePluginResponse(
      await value(await fetch(`${running.baseUrl}${READING_SOURCE_PLUGIN_PATH}`)),
    );
    assert.equal(source.sourcePlugin.name, "MangaDex (English)");
    assert.doesNotMatch(JSON.stringify(source), /graphql|4568/i);

    const searchUrl = new URL(`${running.baseUrl}${CATALOG_SEARCH_PATH}`);
    searchUrl.searchParams.set("sourcePluginKey", source.sourcePlugin.key);
    searchUrl.searchParams.set("q", "Deterministic Adventure");
    const result = parseCatalogSearchResponse(await value(await fetch(searchUrl))).items[0];
    assert(result);

    const chapters = parseCatalogChaptersResponse(
      await value(
        await fetch(
          `${running.baseUrl}/api/v1/catalog/comics/${encodeURIComponent(result.comicKey)}/chapters?sourcePluginKey=${encodeURIComponent(source.sourcePlugin.key)}`,
        ),
      ),
    );
    const chapter = chapters.items[0];
    assert(chapter);

    const createdResponse = await fetch(
      `${running.baseUrl}${READER_SESSIONS_PATH}`,
      json({
        chapterKey: chapter.chapterKey,
        comicKey: result.comicKey,
        sourcePluginKey: source.sourcePlugin.key,
      }),
    );
    const createdBody = await value(createdResponse);
    const created = parseReaderSessionResponse(createdBody).session;
    assert.doesNotMatch(JSON.stringify(createdBody), /api\/graphql|manga\/101|4568/i);

    const pageResponse = await fetch(atServer(running.baseUrl, created.pageUrl));
    assert.equal(pageResponse.headers.get("content-type"), "image/jpeg");
    assert.deepEqual(
      Buffer.from(await pageResponse.arrayBuffer()),
      Buffer.from([0xff, 0xd8, 0x43, 0x46, 0xff, 0xd9]),
    );

    const retained = parseLibraryItemResponse(
      await value(
        await fetch(
          `${running.baseUrl}${LIBRARY_ITEMS_PATH}`,
          json({ pageIndex: 0, sessionId: created.id }),
        ),
      ),
    ).item;

    await running.stop();
    running = await startServer(
      databasePath,
      createAdapter("reading-generation-2", /manga\/501\/chapter\/601/),
    );

    const stale = await fetch(atServer(running.baseUrl, created.pageUrl));
    assert.equal(stale.status, 404);
    const staleError = parseApiErrorResponse(await value(stale)).error;
    assert.equal(staleError.code, "reader_session_not_found");
    assert.equal(staleError.retryable, true);

    const renewed = parseReaderSessionResponse(
      await value(
        await fetch(
          `${running.baseUrl}${READER_SESSIONS_PATH}`,
          json({ libraryItemId: retained.id }),
        ),
      ),
    ).session;
    assert.notEqual(renewed.id, created.id);
    assert.equal(renewed.comicKey, created.comicKey);
    assert.equal(renewed.chapterKey, created.chapterKey);
    assert.doesNotMatch(JSON.stringify(renewed), /api\/graphql|manga\/501|4568/i);

    const renewedPage = await fetch(atServer(running.baseUrl, renewed.pageUrl));
    assert.equal(renewedPage.status, 200);
  } finally {
    await running.stop();
    const relative = path.relative(TEST_ROOT, directory);
    assert.notEqual(relative, "");
    assert.equal(relative.startsWith(".."), false);
    rmSync(directory, { recursive: true, force: true });
  }
});
