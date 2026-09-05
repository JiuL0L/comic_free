import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CatalogStore } from "./catalog-store.ts";
import { ReadingStore } from "./reading-store.ts";
import { createReadingRuntime } from "./reading-runtime.ts";
import { createLocalCoreServer } from "./server.ts";

type Generation = Record<"chapters" | "details" | "pages" | "search", unknown>;

const ROOT = path.resolve(import.meta.dirname, "../../..");
const STORE_URL = "https://fixtures.comic-free.invalid/mangadex/index.pb";
const PLUGIN_KEY = "mihon:fixtures:mangadex";
const IMAGE = Buffer.from([0xff, 0xd8, 0x43, 0x46, 0xff, 0xd9]);

function generation(name: string): Generation {
  return JSON.parse(readFileSync(path.join(ROOT, "tests", "fixtures", "suwayomi", `${name}.json`), "utf8")) as Generation;
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

class FakeSuwayomiHost {
  installed = false;
  incomplete = false;
  sourceIds = [41, 42];
  omitFrench = false;
  generation = generation("reading-generation-1");
  readonly sourceRequests: string[] = [];
  readonly server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url?.startsWith("/api/v1/manga/")) {
      const pages = (this.generation.pages as {data: {fetchChapterPages: {pages: string[]}}}).data.fetchChapterPages.pages;
      if (!pages.includes(request.url)) { response.writeHead(404).end(); return; }
      response.writeHead(200, { "content-type": "image/jpeg", "content-length": IMAGE.length });
      response.end(IMAGE);
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {query: string; variables: {input?: Record<string, unknown>}};
    const query = body.query;
    const extension = {
      name: "MangaDex",
      pkgName: PLUGIN_KEY,
      versionName: "1.0.0",
      isInstalled: this.installed,
      isObsolete: false,
      hasUpdate: false,
      storeIndexUrl: STORE_URL,
      source: { nodes: [{id: this.sourceIds[0], name: "MangaDex", lang: "en"}, {id: this.sourceIds[1], name: "MangaDex", lang: "fr"}], totalCount: 2 },
    };
    if (this.omitFrench) extension.source = {nodes: extension.source.nodes.slice(0, 1), totalCount: 1};
    let data: unknown;
    if (query.includes("ComicFreeExtensionStores")) data = {extensionStores: {nodes: [{indexUrl: STORE_URL, name: "fixture store"}], totalCount: 1}};
    else if (query.includes("ComicFreeFetchExtensions")) data = {fetchExtensions: {extensionStores: [{indexUrl: STORE_URL, name: "fixture store"}], extensions: [extension]}};
    else if (query.includes("ComicFreeUpdateExtension")) {
      this.installed = true;
      data = {updateExtension: {extension: {...extension, isInstalled: true}}};
    } else if (query.includes("ComicFreeInstalledProviders")) {
      const node = {...extension, isInstalled: this.installed, source: this.incomplete ? {nodes: extension.source.nodes, totalCount: 3} : extension.source};
      data = {extensions: {nodes: this.installed ? [node] : [], totalCount: this.installed ? 1 : 0}};
    } else if (query.includes("ComicFreeSearch")) {
      if (!this.sourceIds.map(String).includes(String(body.variables.input?.source))) { response.writeHead(400).end(); return; }
      this.sourceRequests.push(String(body.variables.input?.source)); data = (this.generation.search as {data: unknown}).data;
    } else if (query.includes("ComicFreeDetails")) data = (this.generation.details as {data: unknown}).data;
    else if (query.includes("ComicFreeChapters")) data = (this.generation.chapters as {data: unknown}).data;
    else if (query.includes("ComicFreePages")) data = (this.generation.pages as {data: unknown}).data;
    else throw new Error(`Unexpected GraphQL request: ${query}`);
    response.writeHead(200, {"content-type": "application/json"});
    response.end(JSON.stringify({data}));
  });

  async start(): Promise<number> {
    const origin = await listen(this.server);
    return Number(new URL(origin).port);
  }
}

interface RunningCore { origin: string; catalog: CatalogStore; reading: ReadingStore; server: Server; }

async function startCore(database: string, port: number): Promise<RunningCore> {
  const catalog = new CatalogStore(database);
  const reading = new ReadingStore(database);
  const runtime = createReadingRuntime({
    catalogStore: catalog,
    readingStore: reading,
    pluginHostStatus: () => ({apiVersion: "v1", internalPort: port, message: "fixture host ready", retryable: false, state: "ready"}),
  });
  const server = createLocalCoreServer({catalogStore: catalog, ...runtime});
  return {origin: await listen(server), catalog, reading, server};
}

async function stopCore(core: RunningCore): Promise<void> {
  await close(core.server);
  core.reading.close();
  core.catalog.close();
}

async function install(origin: string): Promise<void> {
  const response = await fetch(`${origin}/api/v1/source-plugin-changes`, json("POST", {
    action: "install", approval: {approved: true},
    source: {kind: "extension_store", packageName: PLUGIN_KEY, storeUrl: STORE_URL, expectedVersion: "1.0.0"},
  }));
  assert.equal(response.status, 200);
}

test("installed same-name Comic Providers route real Local Core HTTP reading and retain durable progress across Host restart", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "comic-free-09-host-"));
  const database = path.join(directory, "state.sqlite");
  const host = new FakeSuwayomiHost();
  const port = await host.start();
  let core = await startCore(database, port);
  try {
    await install(core.origin);
    const providers = await (await fetch(`${core.origin}/api/v1/reading/providers`)).json() as {state: string; items: Array<{comicProviderKey: string; language: string}>};
    assert.equal(providers.state, "success");
    assert.deepEqual(providers.items.map(item => [item.comicProviderKey, item.language]), [["provider:v1:MangaDex:en", "en"], ["provider:v1:MangaDex:fr", "fr"]]);

    const beforeUnknown = host.sourceRequests.length;
    const unknown = await fetch(`${core.origin}/api/v1/catalog/search?sourcePluginKey=${encodeURIComponent(PLUGIN_KEY)}&comicProviderKey=unknown&q=adventure`);
    assert.equal(unknown.status, 400);
    const ambiguous = await fetch(`${core.origin}/api/v1/catalog/search?sourcePluginKey=${encodeURIComponent(PLUGIN_KEY)}&q=adventure`);
    assert.equal(ambiguous.status, 400);
    assert.equal(host.sourceRequests.length, beforeUnknown);

    const searchUrl = `${core.origin}/api/v1/catalog/search?sourcePluginKey=${encodeURIComponent(PLUGIN_KEY)}&comicProviderKey=${encodeURIComponent("provider:v1:MangaDex:fr")}&q=adventure`;
    const searchResponse = await fetch(searchUrl);
    assert.equal(searchResponse.status, 200);
    const search = await searchResponse.json() as {items: Array<{comicKey: string}>};
    assert.equal(host.sourceRequests.at(-1), "42");
    const comicKey = search.items[0]?.comicKey;
    assert(comicKey);
    const detailsResponse = await fetch(`${core.origin}/api/v1/catalog/comics/${encodeURIComponent(comicKey)}?sourcePluginKey=${encodeURIComponent(PLUGIN_KEY)}`);
    assert.equal(detailsResponse.status, 200);
    const details = await detailsResponse.json() as {comic: {comicProviderKey: string}};
    assert.equal(details.comic.comicProviderKey, "provider:v1:MangaDex:fr");
    const chapters = await (await fetch(`${core.origin}/api/v1/catalog/comics/${encodeURIComponent(comicKey)}/chapters?sourcePluginKey=${encodeURIComponent(PLUGIN_KEY)}`)).json() as {items: Array<{chapterKey: string}>};
    const sessionResponse = await fetch(`${core.origin}/api/v1/reader-sessions`, json("POST", {sourcePluginKey: PLUGIN_KEY, comicKey, chapterKey: chapters.items[0]?.chapterKey}));
    assert.equal(sessionResponse.status, 201);
    const session = (await sessionResponse.json() as {session: {id: string; pageUrl: string; chapterKey: string; chapterLabel: string; pageCount: number}}).session;
    const page = await fetch(`${core.origin}/api/v1/reader-sessions/${session.id}/pages/0`);
    assert.equal(page.headers.get("content-type"), "image/jpeg");
    assert.deepEqual(Buffer.from(await page.arrayBuffer()), IMAGE);
    const retained = await (await fetch(`${core.origin}/api/v1/library-items`, json("POST", {sessionId: session.id, pageIndex: 0}))).json() as {item: {id: string; sourceBinding: {durableComicKey: string}}};
    await fetch(`${core.origin}/api/v1/library-items/${retained.item.id}/progress`, json("PUT", {chapterKey: session.chapterKey, chapterLabel: session.chapterLabel, pageCount: session.pageCount, pageIndex: 1}));
    assert.doesNotMatch(retained.item.sourceBinding.durableComicKey, /101|201/);

    await stopCore(core);
    host.generation = generation("reading-generation-2");
    host.sourceIds = [141, 142];
    core = await startCore(database, port);
    const resumed = await (await fetch(`${core.origin}/api/v1/reader-sessions`, json("POST", {libraryItemId: retained.item.id}))).json() as {session: {id: string; pageIndex: number}};
    assert.equal(resumed.session.pageIndex, 1);
    assert.equal(host.sourceRequests.at(-1), "142");
    const resumedPage = await fetch(`${core.origin}/api/v1/reader-sessions/${resumed.session.id}/pages/1`);
    assert.equal(resumedPage.status, 200);

    const libraryBefore = await (await fetch(`${core.origin}/api/v1/library-items`)).json() as {items: Array<{id: string; snapshot: unknown; progress: unknown; sourceBinding: {reasonCode: string}}>};
    host.incomplete = true;
    const catalogBefore = await (await fetch(`${core.origin}/api/v1/source-plugins`)).json() as {entries: unknown[]};
    const failedDiscovery = await (await fetch(`${core.origin}/api/v1/reading/providers`)).json() as {state: string};
    assert.equal(failedDiscovery.state, "error");
    const catalogAfter = await (await fetch(`${core.origin}/api/v1/source-plugins`)).json() as {entries: unknown[]};
    assert.deepEqual(catalogAfter.entries, catalogBefore.entries);
    const libraryAfter = await (await fetch(`${core.origin}/api/v1/library-items`)).json() as typeof libraryBefore;
    assert.equal(libraryAfter.items[0]?.id, libraryBefore.items[0]?.id);
    assert.deepEqual(libraryAfter.items[0]?.snapshot, libraryBefore.items[0]?.snapshot);
    assert.deepEqual(libraryAfter.items[0]?.progress, libraryBefore.items[0]?.progress);
    assert.equal(libraryAfter.items[0]?.sourceBinding.reasonCode, "refresh_failed");
    assert.equal((await fetch(`${core.origin}/api/v1/reader-sessions/${resumed.session.id}/pages/1`)).status, 404);

    host.incomplete = false;
    host.omitFrench = true;
    const partial = await (await fetch(`${core.origin}/api/v1/reading/providers`)).json() as {items: Array<{comicProviderKey: string; available: boolean}>};
    assert.equal(partial.items.find(item => item.comicProviderKey === "provider:v1:MangaDex:fr")?.available, false);
    assert.equal(partial.items.find(item => item.comicProviderKey === "provider:v1:MangaDex:en")?.available, true);
    const retainedCatalog = await (await fetch(`${core.origin}/api/v1/source-plugins`)).json() as {entries: Array<{providers: unknown[]}>; lastRefresh: {status: string}};
    assert.equal(retainedCatalog.entries[0]?.providers.length, 2);
    assert.equal(retainedCatalog.lastRefresh.status, "healthy");
    const disabled = await fetch(`${core.origin}/api/v1/source-plugin-changes`, json("POST", {action: "disable", approval: {approved: true}, source: {kind: "extension_store", packageName: PLUGIN_KEY, storeUrl: STORE_URL, expectedVersion: null}}));
    assert.equal(disabled.status, 200);
    const beforeDisabledRead = host.sourceRequests.length;
    const blocked = await fetch(`${core.origin}/api/v1/catalog/search?sourcePluginKey=${encodeURIComponent(PLUGIN_KEY)}&comicProviderKey=${encodeURIComponent("provider:v1:MangaDex:fr")}&q=adventure`);
    assert.equal(blocked.status, 409);
    assert.equal(host.sourceRequests.length, beforeDisabledRead);
  } finally {
    await stopCore(core);
    await close(host.server);
    rmSync(directory, {recursive: true, force: true});
  }
});
