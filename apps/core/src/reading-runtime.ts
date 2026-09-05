import type { PluginHostStatusResponse } from '@comic-free/contracts';
import { FixtureCatalogAdapter, type CatalogAdapter } from './catalog-adapter.ts';
import { retainKnownProviders, type CatalogStore } from './catalog-store.ts';
import { FixtureReadingAdapter } from './reading-adapter.ts';
import { ReadingProviderRegistry, type DiscoveredReadingProvider } from './reading-provider-registry.ts';
import { ReadingService } from './reading-service.ts';
import type { ReadingStore } from './reading-store.ts';
import { FixtureSourcePluginChangeAdapter, SourcePluginChangeService } from './source-plugin-change.ts';
import { SuwayomiReadingAdapter } from './suwayomi-reading-adapter.ts';
import { SuwayomiSourcePluginChangeAdapter } from './suwayomi-source-plugin-change.ts';

// Production and deterministic HTTP tests use this same composition boundary.
export function createReadingRuntime(options: {
  catalogStore: CatalogStore;
  readingStore: ReadingStore;
  pluginHostStatus?: () => PluginHostStatusResponse;
  catalogFixture?: string;
}) {
  const {catalogStore, readingStore, pluginHostStatus} = options;
  const origin = () => {
    const status = pluginHostStatus?.();
    return status?.state === 'ready' && status.internalPort ? `http://127.0.0.1:${status.internalPort}` : null;
  };
  const host = pluginHostStatus ? new SuwayomiSourcePluginChangeAdapter(pluginHostStatus) : null;
  let sourcePluginChangeService: SourcePluginChangeService;
  const discover = async (): Promise<DiscoveredReadingProvider[]> => {
    if (!host) {
      const plugin = catalogStore.readCatalog().entries.find(entry => entry.pluginKey === 'fixture:reader');
      const providers = plugin?.providers.length ? plugin.providers : [{key: 'fixture.provider', name: 'Fixture Provider', language: 'en'}];
      return providers.map(provider => ({
        descriptor: {sourcePluginKey: 'fixture:reader', sourcePluginName: 'Comic Free Fixture Reader', comicProviderKey: provider.key, name: provider.name, language: provider.language, available: true},
        runtimeKey: provider.key,
        createAdapter: () => new FixtureReadingAdapter(provider),
      }));
    }
    return sourcePluginChangeService.runExclusive(async () => {
      const observed = await host.discoverInstalled(AbortSignal.timeout(15_000));
      const trusted = observed.filter(plugin => plugin.storeUrl && catalogStore.readTrustedPlugin(plugin.pluginKey, plugin.storeUrl));
      const catalog = catalogStore.readCatalog();
      const entries = catalog.entries;
      const changed = trusted.filter(plugin => {
        const old = entries.find(entry => entry.pluginKey === plugin.pluginKey);
        return JSON.stringify(old?.providers) !== JSON.stringify(retainKnownProviders(old?.providers ?? [], plugin.providers.map(({sourceId: _id, ...provider}) => provider)));
      });
      if (changed.length || catalog.lastRefresh?.status !== "healthy") catalogStore.recordSuccessfulRefresh({observedAt: new Date().toISOString(), entries: changed.map(plugin => ({name: plugin.name, pluginKey: plugin.pluginKey, version: plugin.version, status: 'healthy', reasonCode: null, removalEvidence: 'none', reportedObsolete: false, providers: plugin.providers.map(({sourceId: _id, ...provider}) => provider)}))});
      return trusted.flatMap(plugin => plugin.providers.map(provider => ({
        descriptor: {sourcePluginKey: plugin.pluginKey, sourcePluginName: plugin.name, comicProviderKey: provider.key, name: provider.name, language: provider.language, available: true},
        runtimeKey: JSON.stringify([origin(), provider.sourceId, plugin.version]),
        createAdapter: () => new SuwayomiReadingAdapter({comicProviderKey: provider.key, sourceId: provider.sourceId, sourcePluginKey: plugin.pluginKey, sourcePluginName: plugin.name, suwayomiOrigin: origin}),
      })));
    });
  };
  const registry = new ReadingProviderRegistry(catalogStore, discover, (plugin, provider, reason) => readingService.invalidateProvider(plugin, provider, reason));
  const readingService = new ReadingService(registry, readingStore, catalogStore);
  sourcePluginChangeService = new SourcePluginChangeService(host ?? new FixtureSourcePluginChangeAdapter({delayMs: 250, restartRequiredActions: ['update']}), catalogStore, {invalidateSourcePlugin: key => readingService.invalidateSourcePlugin(key)});
  const adapter: CatalogAdapter = host ? {
    refresh: async () => {
      // Called under the change-service lock by the HTTP handler; no nested locking.
      try {
        const observed = await host.discoverInstalled(AbortSignal.timeout(15_000));
        return {outcome: 'success', observedAt: new Date().toISOString(), entries: observed.filter(plugin => plugin.storeUrl && catalogStore.readTrustedPlugin(plugin.pluginKey, plugin.storeUrl)).map(plugin => ({name: plugin.name, pluginKey: plugin.pluginKey, version: plugin.version, status: 'healthy', reasonCode: null, removalEvidence: 'none', reportedObsolete: false, providers: plugin.providers.map(({sourceId: _id, ...provider}) => provider)}))};
      } catch {
        return {outcome: 'failure', observedAt: new Date().toISOString(), reasonCode: 'plugin_host_unavailable', message: 'The installed Comic Provider observation failed. Last Known Catalog retained.'};
      }
    },
  } : new FixtureCatalogAdapter(options.catalogFixture);
  return {adapter, readingService, sourcePluginChangeService};
}
