import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CatalogStore } from './catalog-store.ts';
import { ReadingStore } from './reading-store.ts';
import { createReadingRuntime } from './reading-runtime.ts';
import { createLocalCoreServer } from './server.ts';

test('installed providers are selectable through the composed Local Core', async () => {
  const database = path.join(mkdtempSync(path.join(os.tmpdir(), 'comic-free-09-')), 'state.sqlite');
  const catalogStore = new CatalogStore(database);
  const readingStore = new ReadingStore(database);
  const runtime = createReadingRuntime({catalogStore, readingStore});
  const server = createLocalCoreServer({catalogStore, ...runtime});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const installed = await fetch(`${origin}/api/v1/source-plugin-changes`, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({action:'install', approval:{approved:true}, source:{kind:'extension_store',packageName:'fixture:reader',storeUrl:'https://fixtures.comic-free.invalid/repo/index.pb',expectedVersion:'1.0.0'}})});
    assert.equal(installed.status, 200);
    const providers = await fetch(`${origin}/api/v1/reading/providers`);
    assert.equal(providers.status, 200);
    assert.equal((await providers.json()).items[0].comicProviderKey, 'fixture.provider');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    readingStore.close(); catalogStore.close();
  }
});
