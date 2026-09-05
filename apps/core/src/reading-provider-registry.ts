import type { ReadingProvider, ReadingProvidersResponse, SourceBindingReasonCode } from '@comic-free/contracts';
import { SourcePluginChangeAdapterError } from './source-plugin-change.ts';
import type { CatalogStore } from './catalog-store.ts';
import { ReadingAdapterError, type ReadingAdapter } from './reading-adapter.ts';

const PREFIX = 'provider-comic:v1:';
export function scopedComicKey(provider: string, comic: string): string {
  return PREFIX + Buffer.from(JSON.stringify([provider, comic]), 'utf8').toString('base64url');
}
export function comicIdentity(key: string): { provider: string; comic: string } | null {
  if (!key.startsWith(PREFIX)) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(key.slice(PREFIX.length), 'base64url').toString('utf8'));
    if (!Array.isArray(value) || value.length !== 2 || value.some(v => typeof v !== 'string' || !v.trim())) throw new Error();
    return {provider: value[0], comic: value[1]};
  } catch { throw new TypeError('Invalid provider-scoped comic identity.'); }
}
export interface DiscoveredReadingProvider {
  descriptor: ReadingProvider;
  // Runtime fingerprint and adapter never enter SQLite or REST responses.
  runtimeKey: string;
  createAdapter: () => ReadingAdapter;
}

function scopeAdapter(adapter: ReadingAdapter, provider: string): ReadingAdapter {
  const unwrap = (key: string) => {
    const identity = comicIdentity(key);
    if (!identity || identity.provider !== provider) throw new ReadingAdapterError('catalog_item_not_found', 'The comic does not belong to this Comic Provider.', false);
    return identity.comic;
  };
  const details = async (key: string) => ({...await adapter.getDetails(unwrap(key)), comicKey: key});
  return {
    sourcePlugin: adapter.sourcePlugin, comicProviderKey: provider,
    search: async query => (await adapter.search(query)).map(item => ({...item, comicKey: scopedComicKey(provider, item.comicKey)})),
    getDetails: details,
    getChapters: key => adapter.getChapters(unwrap(key)),
    resolveChapter: async (key, chapter) => {
      const result = await adapter.resolveChapter(unwrap(key), chapter);
      return {...result, comic: {...result.comic, comicKey: key}};
    },
    readPage: (key, signal) => adapter.readPage(key, signal),
  };
}

export class ReadingProviderRegistry {
  readonly #catalog: CatalogStore;
  readonly #invalidate: (plugin: string, provider: string, reason: SourceBindingReasonCode) => void;
  readonly #discover: () => Promise<DiscoveredReadingProvider[]>;
  readonly #routes = new Map<string, {runtimeKey: string; adapter: ReadingAdapter}>();
  #pending: Promise<ReadingProvidersResponse> | null = null;
  #last: ReadingProvidersResponse = {items: [], state: 'empty', message: null};
  constructor(catalog: CatalogStore, discover: () => Promise<DiscoveredReadingProvider[]>, invalidate: (plugin: string, provider: string, reason: SourceBindingReasonCode) => void = () => {}) {
    this.#catalog = catalog; this.#discover = discover; this.#invalidate = invalidate;
  }
  refresh(): Promise<ReadingProvidersResponse> {
    if (this.#pending) return this.#pending;
    this.#pending = this.#refresh().finally(() => { this.#pending = null; });
    return this.#pending;
  }
  async #refresh(): Promise<ReadingProvidersResponse> {
    try {
      const observations = await this.#discover();
      const entries = this.#catalog.readCatalog().entries;
      const seen = new Set<string>();
      const items = observations.map(({descriptor, runtimeKey, createAdapter}) => {
        const key = JSON.stringify([descriptor.sourcePluginKey, descriptor.comicProviderKey]);
        if (seen.has(key)) throw new Error('Duplicate Comic Provider identity.');
        seen.add(key);
        const plugin = entries.find(p => p.pluginKey === descriptor.sourcePluginKey);
        const available = descriptor.available && (!plugin || plugin.status === 'healthy');
        const previous = this.#routes.get(key);
        if (!previous || previous.runtimeKey !== runtimeKey) {
          if (previous) this.#invalidate(descriptor.sourcePluginKey, descriptor.comicProviderKey, "refresh_failed");
          const original = createAdapter();
          // Keep pre-existing fixture Library Items resolvable without rewriting their durable keys.
          this.#routes.set(key, {runtimeKey, adapter: descriptor.comicProviderKey === 'fixture.provider' ? original : scopeAdapter(original, descriptor.comicProviderKey)});
        }
        return {...descriptor, available};
      });
      for (const key of this.#routes.keys()) if (!seen.has(key)) {
        const [plugin, provider] = JSON.parse(key) as [string, string];
        this.#invalidate(plugin, provider, "refresh_failed"); this.#routes.delete(key);
      }
      // Incomplete observations retain the persistent catalog, but never remain readable.
      for (const plugin of entries) for (const provider of plugin.providers) {
        if (!items.some(item => item.sourcePluginKey === plugin.pluginKey && item.comicProviderKey === provider.key)) {
          this.#invalidate(plugin.pluginKey, provider.key, "refresh_failed");
          items.push({sourcePluginKey: plugin.pluginKey, sourcePluginName: plugin.name, comicProviderKey: provider.key, name: provider.name, language: provider.language, available: false});
        }
      }
      this.#last = {items, state: items.length ? 'success' : 'empty', message: null};
    } catch (error) {
      // An incomplete observation proves neither removal nor a Provider outage.
      const reason = error instanceof SourcePluginChangeAdapterError && error.code === "plugin_host_unavailable" ? "plugin_host_unavailable" : "refresh_failed";
      this.#catalog.recordFailedRefresh({observedAt: new Date().toISOString(), reasonCode: reason === "plugin_host_unavailable" ? reason : "unknown", message: "Comic Provider discovery failed. Last Known Catalog retained."});
      for (const key of this.#routes.keys()) { const [plugin, provider] = JSON.parse(key) as [string, string]; this.#invalidate(plugin, provider, reason); }
      this.#routes.clear();
      const items = this.#catalog.readCatalog().entries.flatMap(plugin => plugin.providers.map(provider => ({sourcePluginKey: plugin.pluginKey, sourcePluginName: plugin.name, comicProviderKey: provider.key, name: provider.name, language: provider.language, available: false})));
      for (const item of items) this.#invalidate(item.sourcePluginKey, item.comicProviderKey, reason);
      for (const old of this.#last.items) if (!items.some(item => item.sourcePluginKey === old.sourcePluginKey && item.comicProviderKey === old.comicProviderKey)) items.push({...old, available: false});
      this.#last = {items, state: 'error', message: 'Comic Provider discovery failed. Last Known Catalog retained; retry when the Plugin Host is ready.'};
    }
    return this.#last;
  }
  hasPlugin(plugin: string): boolean { return this.#last.items.some(item => item.sourcePluginKey === plugin); }
  get(plugin: string, comic?: string, provider?: string): ReadingAdapter {
    const identity = comic ? comicIdentity(comic) : null;
    if (identity && provider && provider !== identity.provider) throw new TypeError('Comic Provider selection does not match the comic.');
    const key = identity?.provider ?? provider ?? (comic && plugin === "fixture:reader" ? "fixture.provider" : undefined);
    const candidates = this.#last.items.filter(item => item.sourcePluginKey === plugin && (!key || item.comicProviderKey === key));
    if (candidates.length !== 1) throw new TypeError('Select a known, unambiguous Comic Provider.');
    const selected = candidates[0]!;
    const route = this.#routes.get(JSON.stringify([plugin, selected.comicProviderKey]));
    if (!selected.available || !route) throw new ReadingAdapterError('refresh_failed', 'The selected Comic Provider is unavailable. Refresh discovery and the saved binding before resuming.', true);
    return route.adapter;
  }
}
