import { useEffect, useState } from "react";

import {
  parseSourcePluginCatalogResponse,
  SOURCE_PLUGINS_REFRESH_URL,
  SOURCE_PLUGINS_URL,
  type SourcePluginCatalogResponse,
  type SourcePluginStatus,
} from "@comic-free/contracts";

import { requestJson } from "./api.ts";

const statusLabels: Record<SourcePluginStatus, string> = {
  healthy: "Healthy",
  disabled: "Disabled",
  missing: "Missing",
  incompatible: "Incompatible",
  plugin_host_unavailable: "Plugin Host unavailable",
  comic_provider_unreachable: "Comic Provider unreachable",
  unknown: "Unknown",
  confirmed_removed: "Confirmed removed",
};

type CatalogState =
  | { kind: "loading" }
  | {
      catalog: SourcePluginCatalogResponse;
      kind: "loaded";
      requestError: string | null;
    }
  | { kind: "failed"; message: string };

function failureMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Local Core did not return a valid Source Plugin catalog.";
}

async function requestCatalog(
  signal: AbortSignal,
  method: "GET" | "POST",
): Promise<SourcePluginCatalogResponse> {
  return requestJson(
    method === "GET" ? SOURCE_PLUGINS_URL : SOURCE_PLUGINS_REFRESH_URL,
    parseSourcePluginCatalogResponse,
    { method, signal },
  );
}

export function SourcePlugins() {
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [state, setState] = useState<CatalogState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    void requestCatalog(controller.signal, "GET").then(
      (catalog) => setState({ kind: "loaded", catalog, requestError: null }),
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ kind: "failed", message: failureMessage(error) });
        }
      },
    );
    return () => controller.abort();
  }, [attempt]);

  const refresh = async () => {
    const controller = new AbortController();
    setRefreshing(true);
    setState((current) =>
      current.kind === "loaded" ? { ...current, requestError: null } : current,
    );
    try {
      const catalog = await requestCatalog(controller.signal, "POST");
      setState({ kind: "loaded", catalog, requestError: null });
    } catch (error) {
      const message = failureMessage(error);
      setState((current) =>
        current.kind === "loaded"
          ? { ...current, requestError: message }
          : { kind: "failed", message },
      );
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section className="catalog" aria-labelledby="source-plugins-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">CATALOG / LOCAL RECORD</p>
          <h2 id="source-plugins-heading">Source Plugins</h2>
        </div>
        <button
          type="button"
          disabled={refreshing || state.kind === "loading"}
          onClick={() => void refresh()}
        >
          Refresh Source Plugins
        </button>
      </div>

      {state.kind === "loading" && (
        <p className="catalog-notice" aria-live="polite">
          Loading Source Plugin catalog…
        </p>
      )}
      {state.kind === "failed" && (
        <div className="catalog-notice error" role="alert">
          <strong>Catalog unavailable</strong>
          <span>{state.message}</span>
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            Retry catalog
          </button>
        </div>
      )}
      {state.kind === "loaded" && (
        <>
          {refreshing && (
            <p className="catalog-notice" aria-live="polite">
              Refreshing catalog…
            </p>
          )}
          {state.requestError && (
            <div className="catalog-notice error" role="alert">
              <strong>Refresh request failed</strong>
              <span>{state.requestError}</span>
              <span>The Last Known Catalog remains available below.</span>
            </div>
          )}
          {state.catalog.lastRefresh.status === "failed" && (
            <div className="catalog-notice error" role="status">
              <strong>Refresh failed</strong>
              <span>{state.catalog.lastRefresh.message}</span>
              <span>The Last Known Catalog remains available below.</span>
            </div>
          )}
          {state.catalog.entries.length === 0 ? (
            <p className="catalog-notice empty">No Source Plugins have been observed yet.</p>
          ) : (
            <ul className="plugin-grid">
              {state.catalog.entries.map((entry) => (
                <li className="plugin-card" key={entry.pluginKey}>
                  <div className="plugin-card-heading">
                    <div>
                      <h3>{entry.name}</h3>
                      <p>{entry.pluginKey}</p>
                    </div>
                    <span className={`plugin-status status-${entry.status}`}>
                      {statusLabels[entry.status]}
                    </span>
                  </div>
                  <dl>
                    <div>
                      <dt>Version</dt>
                      <dd>{entry.version ?? "Not reported"}</dd>
                    </div>
                    <div>
                      <dt>Observed</dt>
                      <dd>{new Date(entry.observedAt).toLocaleString()}</dd>
                    </div>
                  </dl>
                  {entry.bindingsRefreshRequired && (
                    <p className="refresh-required">
                      Source Bindings require explicit refresh.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
