import { useEffect, useState } from "react";

import {
  SETTINGS_URL,
  parseSettingsResponse,
  type DailyReaderSettings,
} from "@comic-free/contracts";

import { PluginHostStatus } from "./PluginHostStatus.tsx";
import { SourcePlugins } from "./SourcePlugins.tsx";
import { requestJson } from "./api.ts";

type Settings = DailyReaderSettings;

type SettingsState =
  | { kind: "loading" }
  | { kind: "ready"; restartRequired: boolean; settings: Settings; warning?: string }
  | { kind: "failed"; message: string };

function emptySettings(): Settings {
  return { approvedSha256: null, jarPath: null, port: 4568, proxyUrl: null };
}

export function SettingsPanel() {
  const [state, setState] = useState<SettingsState>({ kind: "loading" });
  const [draft, setDraft] = useState<Settings>(emptySettings());
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setState({ kind: "loading" });
    try {
      const response = await requestJson(SETTINGS_URL, parseSettingsResponse, {});
      setDraft(response.settings);
      setState({ kind: "ready", ...response });
    } catch (error) {
      setState({ kind: "failed", message: error instanceof Error ? error.message : "无法读取设置。" });
    }
  };

  useEffect(() => { void load(); }, []);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const response = await requestJson(SETTINGS_URL, parseSettingsResponse, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      setDraft(response.settings);
      setState({ kind: "ready", ...response });
    } catch (error) {
      setState({ kind: "failed", message: error instanceof Error ? error.message : "保存设置失败。" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section id="settings" className="settings-panel" aria-labelledby="settings-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">LOCAL / SETTINGS</p>
          <h2 id="settings-heading">设置</h2>
        </div>
      </div>
      <p className="summary">只保存本机 Plugin Host 配置；不会下载或信任任何第三方文件。保存后将在下次重启时生效。</p>
      {state.kind === "loading" && <p className="reading-notice">正在读取设置…</p>}
      {state.kind === "failed" && <p className="reading-notice error" role="alert">{state.message}<button type="button" onClick={() => void load()}>重新读取</button></p>}
      {state.kind !== "loading" && (
        <>
          {state.kind === "ready" && state.warning && <p className="reading-notice error" role="alert">保存的设置无法读取，当前正使用安全默认值。请修正并保存有效设置以恢复。<span className="visually-hidden">{state.warning}</span></p>}
          <div className="settings-form">
            <label>Suwayomi JAR 路径<input aria-label="Suwayomi JAR 路径" value={draft.jarPath ?? ""} onChange={event => setDraft(current => ({ ...current, jarPath: event.target.value || null }))} /></label>
            <label>已批准的 SHA-256<input aria-label="已批准的 SHA-256" value={draft.approvedSha256 ?? ""} onChange={event => setDraft(current => ({ ...current, approvedSha256: event.target.value || null }))} /></label>
            <label>Suwayomi 内部端口<input aria-label="Suwayomi 内部端口" type="number" value={draft.port} onChange={event => setDraft(current => ({ ...current, port: Number(event.target.value) }))} /></label>
            <label>显式代理地址（可选）<input aria-label="显式代理地址" value={draft.proxyUrl ?? ""} onChange={event => setDraft(current => ({ ...current, proxyUrl: event.target.value || null }))} /></label>
          </div>
          <button type="button" disabled={saving} onClick={() => void save()}>{saving ? "正在保存…" : "保存设置"}</button>
          <p className="reading-notice" role="status">{state.kind === "ready" && state.restartRequired ? "设置已保存，将在重启后生效。" : "保存后将在重启时应用。"}</p>
        </>
      )}
      <PluginHostStatus />
      <SourcePlugins />
    </section>
  );
}
