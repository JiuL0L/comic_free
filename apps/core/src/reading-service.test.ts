import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { FIXTURE_CHAPTER_KEY, FixtureReadingAdapter } from "./reading-adapter.ts";
import { ReadingService, ReadingServiceError } from "./reading-service.ts";
import { ReadingStore } from "./reading-store.ts";
import { CatalogStore } from "./catalog-store.ts";
import { ReadingProviderRegistry } from "./reading-provider-registry.ts";


const ROOT = path.resolve(import.meta.dirname, "../../..");
const TEST_ROOT = path.join(ROOT, ".local-data", "test-output", "ticket-10");

function createTestDirectory(): string {
  mkdirSync(TEST_ROOT, { recursive: true });
  return mkdtempSync(path.join(TEST_ROOT, "reading-service-"));
}

function removeTestDirectory(directory: string): void {
  const relative = path.relative(TEST_ROOT, path.resolve(directory));
  assert.notEqual(relative, "");
  assert.equal(relative.startsWith(".."), false);
  rmSync(directory, { recursive: true, force: true });
}

test("deletion prevents in-flight resume and catalog session creation from yielding valid sessions", async () => {
  const directory = createTestDirectory();
  const store = new ReadingStore(path.join(directory, "comic-free.sqlite"));
  const adapter = new FixtureReadingAdapter();
  const service = new ReadingService(adapter, store);

  try {
    const initial = await service.createSession({
      chapterKey: "chapter/one",
      comicKey: "comic/deterministic-adventure",
      sourcePluginKey: "fixture:reader",
    });
    const item = service.retain({ pageIndex: 1, sessionId: initial.session.id });

    let releaseResolution: (() => void) | undefined;
    const originalResolve = adapter.resolveChapter.bind(adapter);
    adapter.resolveChapter = async (...args) => {
      await new Promise<void>((resolve) => {
        releaseResolution = resolve;
      });
      return originalResolve(...args);
    };

    const pendingResume = service.createSession({ libraryItemId: item.id });
    await new Promise<void>((resolve) => setImmediate(resolve));
    service.deleteLibraryItem(item.id);
    releaseResolution?.();

    await assert.rejects(
      pendingResume,
      (error: unknown) => error instanceof ReadingServiceError && error.code === "library_item_not_found",
    );

    adapter.resolveChapter = originalResolve;
    const reopened = await service.createSession({
      chapterKey: "chapter/one",
      comicKey: "comic/deterministic-adventure",
      sourcePluginKey: "fixture:reader",
    });
    const retainedAgain = service.retain({ pageIndex: 1, sessionId: reopened.session.id });
    let releaseCatalogResolution: (() => void) | undefined;
    adapter.resolveChapter = async (...args) => {
      await new Promise<void>((resolve) => {
        releaseCatalogResolution = resolve;
      });
      return originalResolve(...args);
    };
    const pendingCatalog = service.createSession({
      chapterKey: "chapter/one",
      comicKey: "comic/deterministic-adventure",
      sourcePluginKey: "fixture:reader",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    service.deleteLibraryItem(retainedAgain.id);
    releaseCatalogResolution?.();
    await assert.rejects(
      pendingCatalog,
      (error: unknown) => error instanceof ReadingServiceError && error.code === "library_item_not_found",
    );
    assert.throws(
      () => service.retain({ pageIndex: 1, sessionId: initial.session.id }),
      (error: unknown) => error instanceof ReadingServiceError && error.code === "reader_session_not_found",
    );
  } finally {
    store.close();
    removeTestDirectory(directory);
  }
});

test("refreshing a binding isolates identical comic keys belonging to different plugins", async () => {
  const directory = createTestDirectory();
  const db = path.join(directory, "comic-free.sqlite");
  const catalog = new CatalogStore(db);
  const store = new ReadingStore(db);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  let entered!: () => void;
  const started = new Promise<void>(resolve => {entered = resolve;});
  let holdB = false;
  function adapter(plugin: string) {
    const fixture = new FixtureReadingAdapter({key:'provider:v1:Shared:en',name:'Shared',language:'en'});
    return {
      sourcePlugin: {key: plugin, name: plugin}, comicProviderKey: fixture.comicProviderKey,
      browse: async (page: number) => {
        const result = await fixture.browse(page);
        return {...result, items: result.items.map(item => ({...item, sourcePluginKey: plugin, sourcePluginName: plugin}))};
      },
      search: async (query: string) => (await fixture.search(query)).map(item => ({...item, sourcePluginKey: plugin, sourcePluginName: plugin})),
      getDetails: async (key: string) => {
        if (plugin === 'plugin-b' && holdB) {entered(); await gate;}
        return {...await fixture.getDetails(key), sourcePluginKey: plugin, sourcePluginName: plugin};
      },
      getChapters: (key: string) => fixture.getChapters(key),
      resolveChapter: async (key: string, chapter: string) => {
        const result = await fixture.resolveChapter(key, chapter);
        return {...result, comic: {...result.comic, sourcePluginKey: plugin, sourcePluginName: plugin}};
      },
      readPage: (key: string) => fixture.readPage(key),
      readCover: (key: string) => fixture.readCover(key),
    };
  }
  const registry = new ReadingProviderRegistry(catalog, async () => ['plugin-a','plugin-b'].map(plugin => ({descriptor:{sourcePluginKey:plugin,sourcePluginName:plugin,comicProviderKey:'provider:v1:Shared:en',name:'Same Provider',language:'en',available:true},runtimeKey:plugin,createAdapter:() => adapter(plugin)})));
  const service = new ReadingService(registry, store, catalog);
  try {
    const comicA = (await service.search('plugin-a','adventure','provider:v1:Shared:en'))[0]!;
    const comicB = (await service.search('plugin-b','adventure','provider:v1:Shared:en'))[0]!;
    assert.equal(comicA.comicKey, comicB.comicKey);
    const sessionA = await service.createSession({sourcePluginKey:'plugin-a',comicKey:comicA.comicKey,chapterKey:FIXTURE_CHAPTER_KEY});
    const savedA = service.retain({sessionId:sessionA.session.id,pageIndex:0});
    holdB = true;
    const pendingB = service.getDetails('plugin-b', comicB.comicKey).then(value => ({ok:true, title:value.title}), (error: Error & {code?: string}) => ({ok:false,code:error.code,message:error.message}));
    await started;
    await service.refreshBinding(savedA.sourceBinding.id);
    release();
    const result = await pendingB;
    assert.equal(result.ok, true, 'Refreshing plugin A must preserve plugin B reading requests.');
  } finally { store.close(); catalog.close(); removeTestDirectory(directory); }
});
