import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { CATALOG_SEARCH_PATH, FIXTURE_SOURCE_PLUGIN, LIBRARY_ITEMS_PATH, READER_SESSIONS_PATH, parseApiErrorResponse, parseLibraryItemResponse, parseReaderSessionResponse } from "@comic-free/contracts";

import { FIXTURE_CHAPTER_KEY, FIXTURE_COMIC_KEY, FixtureReadingAdapter, ReadingAdapterError } from "./reading-adapter.ts";
import { createReadingHttpHandler } from "./reading-http.ts";
import { ReadingService } from "./reading-service.ts";
import { ReadingStore } from "./reading-store.ts";

type FailurePhase = "image" | "read" | "reader-session" | null;

class FailingFixtureAdapter extends FixtureReadingAdapter {
  failure: ReadingAdapterError | null = null;
  phase: FailurePhase = null;

  override async search(query: string) {
    if (this.phase === "read" && this.failure) throw this.failure;
    return super.search(query);
  }

  override async resolveChapter(comicKey: string, chapterKey: string) {
    if (this.phase === "reader-session" && this.failure) throw this.failure;
    return super.resolveChapter(comicKey, chapterKey);
  }

  override async readPage(pageKey: string, signal?: AbortSignal) {
    if (this.phase === "image" && this.failure) throw this.failure;
    void signal;
    return super.readPage(pageKey);
  }
}

interface RunningServer {
  baseUrl: string;
  service: ReadingService;
  stop: () => Promise<void>;
}

async function startServer(adapter: FailingFixtureAdapter, logger: (entry: unknown) => void): Promise<RunningServer> {
  const directory = mkdtempSync(path.join(tmpdir(), "comic-free-reading-diagnostics-"));
  const store = new ReadingStore(path.join(directory, "comic-free.sqlite"));
  const service = new ReadingService(adapter, store);
  const handle = createReadingHttpHandler(service, {
    logger,
    now: () => "2026-09-05T12:00:00.000Z",
  });
  const server = createServer((request, response) => void handle(request, response));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    service,
    stop: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      store.close();
      const relative = path.relative(path.resolve(tmpdir()), path.resolve(directory));
      assert.equal(path.isAbsolute(relative), false);
      assert.equal(relative.startsWith("comic-free-reading-diagnostics-"), true);
      assert.equal(relative.includes(path.sep), false);
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function expectedEntry(errorCode: string, failureLayer: string, requestKind: Exclude<FailurePhase, null>, route: string, status = 503) {
  return { component: "local-core", errorCode, event: "reading_request_failed", failureLayer, requestKind, retryable: true, route, status, timestamp: "2026-09-05T12:00:00.000Z" };
}

test("HTTP read failures log normalized layers without request secrets", async () => {
  const cases = [["plugin_host_unavailable", "plugin-host"], ["disabled", "source-plugin"], ["missing", "source-plugin"], ["incompatible", "source-plugin"], ["comic_provider_unreachable", "comic-provider"]] as const;
  for (const [code, failureLayer] of cases) {
    const entries: unknown[] = [];
    const adapter = new FailingFixtureAdapter();
    adapter.failure = new ReadingAdapterError(code, "https://alice:secret@example.invalid/page?token=private-token", true);
    adapter.phase = "read";
    const server = await startServer(adapter, (entry) => entries.push(entry));
    try {
      const url = new URL(`${server.baseUrl}${CATALOG_SEARCH_PATH}`);
      url.searchParams.set("sourcePluginKey", FIXTURE_SOURCE_PLUGIN.key);
      url.searchParams.set("q", "private-query");
      const response = await fetch(url, { headers: { authorization: "Bearer private-authorization", cookie: "session=private-cookie" } });
      assert.equal(response.status, 503);
      assert.equal(parseApiErrorResponse(await response.json()).error.code, code);
      assert.deepEqual(entries, [expectedEntry(code, failureLayer, "read", "catalog-search")]);
      assert.doesNotMatch(JSON.stringify(entries), /private|secret|token|authorization|alice|example\.invalid/i);
    } finally { await server.stop(); }
  }
});

test("HTTP reader-session and image failures use their public route categories", async () => {
  const entries: unknown[] = [];
  const adapter = new FailingFixtureAdapter();
  const server = await startServer(adapter, (entry) => entries.push(entry));
  try {
    adapter.failure = new ReadingAdapterError("plugin_host_unavailable", "private host URL", true);
    adapter.phase = "reader-session";
    const request = () => fetch(`${server.baseUrl}${READER_SESSIONS_PATH}`, { body: JSON.stringify({ chapterKey: FIXTURE_CHAPTER_KEY, comicKey: FIXTURE_COMIC_KEY, sourcePluginKey: FIXTURE_SOURCE_PLUGIN.key }), headers: { "content-type": "application/json" }, method: "POST" });
    assert.equal((await request()).status, 503);
    assert.deepEqual(entries.pop(), expectedEntry("plugin_host_unavailable", "plugin-host", "reader-session", "reader-session"));
    adapter.phase = null;
    const created = parseReaderSessionResponse(await (await request()).json()).session;
    adapter.failure = new ReadingAdapterError("page_timeout", "private image URL", true);
    adapter.phase = "image";
    assert.equal((await fetch(`${server.baseUrl}${READER_SESSIONS_PATH}/${created.id}/pages/0`)).status, 504);
    assert.deepEqual(entries.pop(), expectedEntry("page_timeout", "comic-provider", "image", "reader-page", 504));

    adapter.phase = null;
    const retained = parseLibraryItemResponse(await (await fetch(`${server.baseUrl}${LIBRARY_ITEMS_PATH}`, {
      body: JSON.stringify({ pageIndex: 0, sessionId: created.id }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })).json()).item;
    server.service.markBindingUnavailable(retained.sourceBinding.id, "comic_provider_unreachable");
    const unavailable = await fetch(`${server.baseUrl}${READER_SESSIONS_PATH}`, {
      body: JSON.stringify({ libraryItemId: retained.id }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(unavailable.status, 409);
    assert.deepEqual(entries.pop(), expectedEntry("source_binding_unavailable", "comic-provider", "reader-session", "reader-session", 409));

    assert.equal((await fetch(`${server.baseUrl}${READER_SESSIONS_PATH}/missing-private-session/pages/0`)).status, 404);
    assert.deepEqual(entries.pop(), expectedEntry("reader_session_not_found", "local-core", "image", "reader-page", 404));
  } finally { await server.stop(); }
});

test("a failed diagnostics logger does not alter the HTTP error response", async () => {
  const adapter = new FailingFixtureAdapter();
  adapter.failure = new ReadingAdapterError("comic_provider_unreachable", "upstream private detail", true);
  adapter.phase = "read";
  const server = await startServer(adapter, () => { throw new Error("logger failure"); });
  try {
    const url = new URL(`${server.baseUrl}${CATALOG_SEARCH_PATH}`);
    url.searchParams.set("sourcePluginKey", FIXTURE_SOURCE_PLUGIN.key);
    url.searchParams.set("q", "adventure");
    const response = await fetch(url);
    assert.equal(response.status, 503);
    assert.equal(parseApiErrorResponse(await response.json()).error.code, "comic_provider_unreachable");
  } finally { await server.stop(); }
});
