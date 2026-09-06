import { useEffect, useState } from "react";

import {
  parseSourcePluginCatalogResponse,
  parseSourcePluginChangeResponse,
  SOURCE_PLUGIN_CHANGE_ACTIONS,
  SOURCE_PLUGIN_CHANGES_URL,
  SOURCE_PLUGINS_REFRESH_URL,
  SOURCE_PLUGINS_URL,
  type SourcePluginCatalogResponse,
  type SourcePluginChangeAction,
  type SourcePluginChangeResponse,
  type SourcePluginStatus,
} from "@comic-free/contracts";

import { requestJson } from "./api.ts";

const statusLabels: Record<SourcePluginStatus, string> = {
  healthy: "正常",
  disabled: "已停用",
  missing: "缺失",
  incompatible: "不兼容",
  plugin_host_unavailable: "插件宿主不可用",
  comic_provider_unreachable: "漫画来源无法连接",
  unknown: "未知",
  confirmed_removed: "已确认移除",
};

type CatalogState =
  | { kind: "loading" }
  | {
      catalog: SourcePluginCatalogResponse;
      kind: "loaded";
      requestError: string | null;
    }
  | { kind: "failed"; message: string };

type ChangeState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "success"; response: SourcePluginChangeResponse }
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
  const [action, setAction] = useState<SourcePluginChangeAction>("install");
  const [storeUrl, setStoreUrl] = useState("");
  const [packageName, setPackageName] = useState("");
  const [expectedVersion, setExpectedVersion] = useState("");
  const [approved, setApproved] = useState(false);
  const [change, setChange] = useState<ChangeState>({ kind: "idle" });

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

  const resetApproval = () => {
    setApproved(false);
    setChange({ kind: "idle" });
  };

  const applyChange = async () => {
    setChange({ kind: "pending" });
    try {
      const response = await requestJson(
        SOURCE_PLUGIN_CHANGES_URL,
        parseSourcePluginChangeResponse,
        {
          body: JSON.stringify({
            action,
            approval: { approved },
            source: {
              expectedVersion: action === "disable" ? null : expectedVersion.trim(),
              kind: "extension_store",
              packageName: packageName.trim(),
              storeUrl: storeUrl.trim(),
            },
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      setState({ kind: "loaded", catalog: response.catalog, requestError: null });
      setChange({ kind: "success", response });
      setApproved(false);
    } catch (error) {
      setChange({ kind: "failed", message: failureMessage(error) });
    }
  };

  const sourceComplete =
    storeUrl.trim() !== "" &&
    packageName.trim() !== "" &&
    (action === "disable" || expectedVersion.trim() !== "");

  return (
    <section className="catalog" aria-labelledby="source-plugins-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">CATALOG / LOCAL RECORD</p>
          <h2 id="source-plugins-heading">漫画来源插件</h2>
        </div>
        <button
          type="button"
          disabled={refreshing || state.kind === "loading"}
          onClick={() => void refresh()}
        >
          刷新漫画来源插件
        </button>
      </div>

      <form
        className="plugin-change-form"
        onSubmit={(event) => {
          event.preventDefault();
          void applyChange();
        }}
      >
        <div className="plugin-change-heading">
          <div>
            <p className="eyebrow">EXPLICIT APPROVAL / THIRD-PARTY CODE</p>
            <h3>管理已确认的变更</h3>
          </div>
          <p>
            Comic Free sends this request only to the Local Core. Install, update,
            and restore require the exact version you approve.
          </p>
        </div>
        <div className="plugin-change-fields">
          <label>
            变更操作
            <select
              value={action}
              onChange={(event) => {
                setAction(event.target.value as SourcePluginChangeAction);
                resetApproval();
              }}
            >
              {SOURCE_PLUGIN_CHANGE_ACTIONS.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate[0]?.toUpperCase()}{candidate.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label>
            扩展商店地址
            <input
              type="url"
              value={storeUrl}
              onChange={(event) => {
                setStoreUrl(event.target.value);
                resetApproval();
              }}
              placeholder="https://…/index.pb"
            />
          </label>
          <label>
            包名
            <input
              value={packageName}
              onChange={(event) => {
                setPackageName(event.target.value);
                resetApproval();
              }}
              placeholder="eu.kanade.tachiyomi.extension…"
            />
          </label>
          <label>
            已批准版本
            <input
              disabled={action === "disable"}
              value={action === "disable" ? "Not required for disable" : expectedVersion}
              onChange={(event) => {
                setExpectedVersion(event.target.value);
                resetApproval();
              }}
              placeholder="1.2.3"
            />
          </label>
        </div>
        <label className="plugin-approval">
          <input
            type="checkbox"
            checked={approved}
            disabled={!sourceComplete || change.kind === "pending"}
            onChange={(event) => setApproved(event.target.checked)}
          />
          I approve {action} for {packageName.trim() || "this package"} from the
          extension store shown above.
        </label>
        <button
          type="submit"
          disabled={!sourceComplete || !approved || change.kind === "pending"}
        >
          应用已批准变更
        </button>
        {change.kind === "pending" && (
          <p className="catalog-notice" aria-live="polite">
            正在应用已批准变更…
          </p>
        )}
        {change.kind === "failed" && (
          <div className="catalog-notice error" role="alert">
            <strong>Source Plugin change failed</strong>
            <span>{change.message}</span>
          </div>
        )}
        {change.kind === "success" && (
          <div className="catalog-notice change-success" role="status">
            <strong>
              {change.response.change.outcome === "restart_required"
                ? "Restart required"
                : "Change successful"}
            </strong>
            <span>{change.response.change.message}</span>
            <span>
              {change.response.change.source.packageName} ·{" "}
              {change.response.change.source.storeUrl}
            </span>
            {change.response.change.plugin.providers.length > 0 && (
              <span>
                Comic Providers: {change.response.change.plugin.providers
                  .map((provider) => `${provider.name} (${provider.language})`)
                  .join(", ")}
              </span>
            )}
          </div>
        )}
      </form>

      {state.kind === "loading" && (
        <p className="catalog-notice" aria-live="polite">
          正在加载漫画来源插件目录…
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
              正在刷新目录…
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
            <p className="catalog-notice empty">尚未发现漫画来源插件。</p>
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
                      <dt>版本</dt>
                      <dd>{entry.version ?? "未报告"}</dd>
                    </div>
                    <div>
                      <dt>发现时间</dt>
                      <dd>{new Date(entry.observedAt).toLocaleString()}</dd>
                    </div>
                  </dl>
                  {entry.providers.length > 0 && (
                    <div className="plugin-providers">
                      <strong>漫画来源</strong>
                      <ul>
                        {entry.providers.map((provider) => (
                          <li key={provider.key}>
                            <span>{provider.name}</span>
                            <code>{provider.language}</code>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {entry.bindingsRefreshRequired && (
                    <p className="refresh-required">
                      来源绑定需要手动刷新。
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
