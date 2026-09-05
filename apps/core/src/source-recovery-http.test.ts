import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { FIXTURE_SOURCE_PLUGIN, parseApiErrorResponse, parseLibraryItemResponse, parseLibraryItemsResponse, parseReaderSessionResponse } from "@comic-free/contracts";
import { CatalogStore } from "./catalog-store.ts";
import { FixtureCatalogAdapter } from "./catalog-adapter.ts";
import { ReadingAdapterError, FixtureReadingAdapter, FIXTURE_COMIC_KEY, FIXTURE_CHAPTER_KEY } from "./reading-adapter.ts";
import { ReadingService } from "./reading-service.ts";
import { ReadingStore } from "./reading-store.ts";
import { createLocalCoreServer } from "./server.ts";

const pluginKey = FIXTURE_SOURCE_PLUGIN.key;
const input = { sourcePluginKey: pluginKey, comicKey: FIXTURE_COMIC_KEY, chapterKey: FIXTURE_CHAPTER_KEY };
const root = path.resolve('.local-data/test-output/08-source-recovery');
function json(body: unknown): RequestInit { return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }; }
async function start(adapter = new FixtureReadingAdapter(), databasePath?: string) {
  mkdirSync(root, { recursive: true });
  const db = databasePath ?? path.join(mkdtempSync(path.join(root, 'rest-')), 'state.sqlite');
  const catalog = new CatalogStore(db);
  const store = new ReadingStore(db);
  const service = new ReadingService(adapter, store, catalog);
  const server = createLocalCoreServer({ adapter: new FixtureCatalogAdapter(), catalogStore: catalog, readingService: service });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const request = (url: string, body?: unknown) => fetch(base + url, body === undefined ? {} : json(body));
  const setPlugin = (status: 'healthy' | 'disabled', action: 'install' | 'restore' | 'disable') => {
    catalog.recordPluginChange({ pluginKey, name: FIXTURE_SOURCE_PLUGIN.name, version: '1', status, reasonCode: status === 'disabled' ? 'disabled' : null, observedAt: new Date().toISOString(), bindingsRefreshRequired: action === 'restore', providers: [] }, 'https://fixture.invalid/repo', action);
    service.invalidateSourcePlugin(pluginKey);
  };
  return { base, db, store, service, catalog, request, setPlugin, close: async () => { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); catalog.close(); } };
}

test('disabled plugin rejects unretained search, details, chapters, new sessions and old page requests', async () => {
  const run = await start();
  try {
    run.setPlugin('healthy', 'install');
    const session = parseReaderSessionResponse(await (await run.request('/api/v1/reader-sessions', input)).json()).session;
    run.setPlugin('disabled', 'disable');
    const query = `?sourcePluginKey=${encodeURIComponent(pluginKey)}`;
    for (const route of [`/api/v1/catalog/search${query}&q=adventure`, `/api/v1/catalog/comics/${encodeURIComponent(FIXTURE_COMIC_KEY)}${query}`, `/api/v1/catalog/comics/${encodeURIComponent(FIXTURE_COMIC_KEY)}/chapters${query}`]) {
      const response = await run.request(route);
      assert.equal(response.status, 409, route);
      assert.match(parseApiErrorResponse(await response.json()).error.message, /disabled/);
    }
    assert.equal((await run.request('/api/v1/reader-sessions', input)).status, 409);
    assert.equal((await run.request(`/api/v1/reader-sessions/${session.id}/pages/0`)).status, 404);
  } finally { await run.close(); }
});

test('explicit binding refresh preserves durable records and resumes saved page after restart', async () => {
  let run = await start();
  try {
    run.setPlugin('healthy', 'install');
    const session = parseReaderSessionResponse(await (await run.request('/api/v1/reader-sessions', input)).json()).session;
    const item = parseLibraryItemResponse(await (await run.request('/api/v1/library-items', { sessionId: session.id, pageIndex: 1 })).json()).item;
    run.setPlugin('disabled', 'disable');
    run.setPlugin('healthy', 'restore');
    const route = `/api/v1/source-bindings/${item.sourceBinding.id}/refresh`;
    const response = await run.request(route, {});
    assert.equal(response.status, 200);
    const recovered = parseLibraryItemResponse(await response.json()).item;
    assert.equal(recovered.sourceBinding.availability, 'available');
    assert.deepEqual(recovered.progress, item.progress);
    assert.deepEqual(recovered.snapshot, item.snapshot);
    assert.equal(recovered.id, item.id);
    const db = run.db; await run.close(); run = await start(undefined, db);
    const retained = parseLibraryItemsResponse(await (await run.request('/api/v1/library-items')).json()).items[0];
    assert.deepEqual(retained, recovered);
    const resumed = parseReaderSessionResponse(await (await run.request('/api/v1/reader-sessions', {libraryItemId: item.id})).json()).session;
    assert.equal(resumed.pageIndex, 1);
    assert.equal(resumed.chapterKey, item.progress.chapterKey);
    assert.equal((await run.request(`/api/v1/reader-sessions/${session.id}/pages/1`)).status, 404);
  } finally { await run.close(); }
});

class FailingAdapter extends FixtureReadingAdapter {
  failure: ReadingAdapterError | null = null;
  pageFailure: ReadingAdapterError | null = null;
  calls = 0;
  gate: Promise<void> | null = null;
  pageCount = 3;
  override async search(query: string) {
    this.calls++;
    if (this.failure) throw this.failure;
    return super.search(query);
  }
  override async resolveChapter(comicKey: string, chapterKey: string) {
    this.calls++;
    await this.gate;
    if (this.failure) throw this.failure;
    const result = await super.resolveChapter(comicKey, chapterKey);
    return {...result, pageKeys: result.pageKeys.slice(0, this.pageCount)};
  }
  override async readPage(key: string) {
    if (this.pageFailure) throw this.pageFailure;
    return super.readPage(key);
  }
}
async function retain(run: Awaited<ReturnType<typeof start>>) {
  const session = parseReaderSessionResponse(await (await run.request('/api/v1/reader-sessions', input)).json()).session;
  const item = parseLibraryItemResponse(await (await run.request('/api/v1/library-items', {sessionId: session.id, pageIndex: 1})).json()).item;
  return {session, item};
}

test('confirmed provider failure persists only affected bindings and invalidates sessions, while image failure retains context', async () => {
  const adapter = new FailingAdapter();
  let run = await start(adapter);
  try {
    const {session, item} = await retain(run);
    const unrelated = run.store.retain({comicKey: 'other', comicProviderKey: 'other.provider', sourcePluginKey: pluginKey, coverRef: 'other', title: 'Other', chapterKey: 'one', chapterLabel: 'One', pageCount: 2, pageIndex: 1});
    adapter.pageFailure = new ReadingAdapterError('page_timeout', 'Temporary image timeout', true);
    assert.equal((await run.request(`/api/v1/reader-sessions/${session.id}/pages/1`)).status, 504);
    assert.deepEqual(run.store.get(item.id), item);
    adapter.pageFailure = null;
    assert.equal((await run.request(`/api/v1/reader-sessions/${session.id}/pages/1`)).status, 200);
    adapter.failure = new ReadingAdapterError('comic_provider_unreachable', 'Provider unavailable', true);
    const response = await run.request(`/api/v1/catalog/search?sourcePluginKey=${encodeURIComponent(pluginKey)}&q=adventure`);
    assert.equal(response.status, 503);
    const items = parseLibraryItemsResponse(await (await run.request('/api/v1/library-items')).json()).items;
    const failed = items.find(value => value.id === item.id)!;
    assert.equal(failed.sourceBinding.reasonCode, 'comic_provider_unreachable');
    assert.deepEqual(failed.snapshot, item.snapshot);
    assert.deepEqual(failed.progress, item.progress);
    assert.deepEqual(items.find(value => value.id === unrelated.id), unrelated);
    assert.equal((await run.request(`/api/v1/reader-sessions/${session.id}/pages/1`)).status, 404);
    const db = run.db; await run.close(); run = await start(adapter, db);
    assert.deepEqual(run.store.get(item.id), failed);
  } finally { await run.close(); }
});

test('refresh rejects invalid input, disabled sources, missing chapters and shortened page lists without resetting progress', async () => {
  const adapter = new FailingAdapter(); const run = await start(adapter);
  try {
    run.setPlugin('healthy', 'install');
    const {item} = await retain(run);
    const route = `/api/v1/source-bindings/${item.sourceBinding.id}/refresh`;
    assert.equal((await run.request(route, { comicKey: 'injected' })).status, 400);
    assert.equal((await run.request('/api/v1/source-bindings/unknown/refresh', {})).status, 404);
    assert.deepEqual(run.store.get(item.id), item);
    run.setPlugin('disabled', 'disable');
    const beforeCalls = adapter.calls;
    assert.equal((await run.request(route, {})).status, 409);
    assert.equal((await run.request('/api/v1/reader-sessions', input)).status, 409);
    assert.equal(adapter.calls, beforeCalls);
    run.setPlugin('healthy', 'restore');
    adapter.failure = new ReadingAdapterError('chapter_not_found', 'Original chapter no longer resolves', false);
    const missing = await run.request(route, {});
    assert.equal(parseApiErrorResponse(await missing.json()).error.code, 'chapter_not_found');
    assert.notEqual(run.store.get(item.id)?.sourceBinding.availability, 'available');
    adapter.failure = null; adapter.pageCount = 1;
    const shortened = await run.request(route, {});
    assert.equal(parseApiErrorResponse(await shortened.json()).error.code, 'invalid_page_index');
    assert.deepEqual(run.store.get(item.id)?.progress, item.progress);
    adapter.pageCount = 3;
    assert.equal((await run.request(route, {})).status, 200);
  } finally { await run.close(); }
});

test('disable and restore interleaved with refresh cannot revive a binding or an old session', async () => {
  const adapter = new FailingAdapter(); const run = await start(adapter);
  try {
    run.setPlugin('healthy', 'install');
    const {item} = await retain(run);
    run.setPlugin('disabled', 'disable'); run.setPlugin('healthy', 'restore');
    let release!: () => void;
    adapter.gate = new Promise<void>(resolve => { release = resolve; });
    const refreshing = run.service.refreshBinding(item.sourceBinding.id);
    run.setPlugin('disabled', 'disable'); run.setPlugin('healthy', 'restore');
    release();
    await assert.rejects(refreshing, /Source Plugin changed/);
    assert.equal(run.store.get(item.id)?.sourceBinding.availability, 'refresh_required');
    assert.deepEqual(run.store.get(item.id)?.progress, item.progress);
  } finally { await run.close(); }
});

for (const reason of ['plugin_host_unavailable', 'missing', 'incompatible'] as const) {
  test(`${reason} marks this configured plugin and preserves unrelated library items`, async () => {
    const adapter = new FailingAdapter(); const run = await start(adapter);
    try {
      const {item, session} = await retain(run);
      const unrelated = run.store.retain({comicKey: 'other', comicProviderKey: 'other.provider', sourcePluginKey: 'other.plugin', coverRef: 'other', title: 'Other', chapterKey: 'one', chapterLabel: 'One', pageCount: 2, pageIndex: 1});
      adapter.failure = new ReadingAdapterError(reason, 'Confirmed upstream failure', true);
      await run.request(`/api/v1/catalog/search?sourcePluginKey=${encodeURIComponent(pluginKey)}&q=adventure`);
      const failed = run.store.get(item.id)!;
      assert.equal(failed.sourceBinding.reasonCode, reason);
      assert.deepEqual(failed.progress, item.progress);
      assert.deepEqual(run.store.get(unrelated.id), unrelated);
      assert.equal((await run.request(`/api/v1/reader-sessions/${session.id}/pages/0`)).status, 404);
    } finally { await run.close(); }
  });
}

test('a later catalog refresh does not undo an explicitly refreshed binding', async () => {
  const run = await start();
  try {
    run.setPlugin('healthy', 'install'); const {item} = await retain(run);
    run.setPlugin('disabled', 'disable'); run.setPlugin('healthy', 'restore');
    const route = `/api/v1/source-bindings/${item.sourceBinding.id}/refresh`;
    assert.equal((await run.request(route, {})).status, 200);
    run.catalog.recordSuccessfulRefresh({observedAt: new Date().toISOString(), entries: [{pluginKey, name: FIXTURE_SOURCE_PLUGIN.name, status: 'healthy', reasonCode: null, removalEvidence: 'none', reportedObsolete: false, version: '1'}]});
    assert.equal(run.store.get(item.id)?.sourceBinding.availability, 'available');
    assert.equal((await run.request('/api/v1/reader-sessions', {libraryItemId: item.id})).status, 201);
  } finally { await run.close(); }
});

test('a provider outage cancels an in-flight unretained chapter without poisoning invalid input', async () => {
  const adapter = new FailingAdapter(); const run = await start(adapter);
  try {
    const {item} = await retain(run);
    const invalid = await run.request('/api/v1/reader-sessions', {...input, chapterKey: 'unknown'});
    assert.equal(invalid.status, 404);
    assert.deepEqual(run.store.get(item.id), item);
    // Remove only this test fixture item so the pending request has no retained binding.
    run.store.delete(item.id);
    let release!: () => void;
    adapter.gate = new Promise<void>(resolve => { release = resolve; });
    const pending = run.service.createSession(input);
    adapter.failure = new ReadingAdapterError('comic_provider_unreachable', 'Confirmed provider failure', true);
    await run.request(`/api/v1/catalog/search?sourcePluginKey=${encodeURIComponent(pluginKey)}&q=adventure`);
    adapter.failure = null; release();
    await assert.rejects(pending, /Source Plugin changed/);
    assert.deepEqual(run.service.listLibrary(), []);
  } finally { await run.close(); }
});

test('a provider failure leaves another provider in-flight reading usable', async () => {
  class TwoProviderAdapter extends FailingAdapter {
    override async getDetails(comicKey: string) {
      const details = await super.getDetails(FIXTURE_COMIC_KEY);
      return comicKey === 'other' ? {...details, comicKey, comicProviderKey: 'other.provider'} : details;
    }
  }
  const adapter = new TwoProviderAdapter(); const run = await start(adapter);
  try {
    const other = run.store.retain({comicKey: 'other', comicProviderKey: 'other.provider', sourcePluginKey: pluginKey, coverRef: 'other', title: 'Other', chapterKey: FIXTURE_CHAPTER_KEY, chapterLabel: 'One', pageCount: 3, pageIndex: 1});
    let release!: () => void;
    adapter.gate = new Promise<void>(resolve => { release = resolve; });
    const pending = run.service.createSession({libraryItemId: other.id});
    adapter.failure = new ReadingAdapterError('comic_provider_unreachable', 'Fixture provider unavailable', true);
    await run.request(`/api/v1/catalog/search?sourcePluginKey=${encodeURIComponent(pluginKey)}&q=adventure`);
    adapter.failure = null; release();
    const resolved = await pending;
    assert.equal(resolved.session.comicKey, 'other');
    assert.equal(resolved.session.pageIndex, 1);
    assert.deepEqual(run.store.get(other.id), other);
  } finally { await run.close(); }
});

test('old readers cannot update saved progress during disable or recovery', async () => {
  const run = await start();
  try {
    run.setPlugin('healthy', 'install'); const {item} = await retain(run);
    for (const action of ['disable', 'restore'] as const) {
      run.setPlugin(action === 'disable' ? 'disabled' : 'healthy', action);
      const saved = {...item.progress, pageIndex: 2};
      const write = await fetch(`${run.base}/api/v1/library-items/${item.id}/progress`, {...json({chapterKey: saved.chapterKey, chapterLabel: saved.chapterLabel, pageCount: saved.pageCount, pageIndex: saved.pageIndex}), method: 'PUT'});
      assert.equal(write.status, 409);
      assert.deepEqual(run.store.get(item.id)?.progress, item.progress);
    }
  } finally { await run.close(); }
});

test('deleting a library item while refreshing never recreates its binding', async () => {
  const adapter = new FailingAdapter(); const run = await start(adapter);
  try {
    const {item} = await retain(run);
    let release!: () => void;
    adapter.gate = new Promise<void>(resolve => { release = resolve; });
    const pending = run.service.refreshBinding(item.sourceBinding.id);
    run.service.deleteLibraryItem(item.id);
    release();
    await assert.rejects(pending);
    assert.deepEqual(run.service.listLibrary(), []);
    assert.equal((await run.request(`/api/v1/source-bindings/${item.sourceBinding.id}/refresh`, {})).status, 404);
  } finally { await run.close(); }
});
