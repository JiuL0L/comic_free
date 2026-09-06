import { useEffect, useState } from "react";

import {
  PLUGIN_HOST_STATUS_URL,
  parsePluginHostStatusResponse,
  type PluginHostState,
  type PluginHostStatusResponse,
} from "@comic-free/contracts";

const labels: Record<PluginHostState, string> = {
  early_exit: "启动时退出",
  invalid_path: "文件无效",
  not_configured: "尚未配置",
  port_occupied: "端口已被占用",
  ready: "运行中",
  shutdown_failed: "停止失败",
  starting: "正在启动",
  stopped: "已停止",
  stopping: "正在停止",
  unexpected_exit: "意外退出",
  startup_timeout: "启动超时",
};

type ViewState =
  | { kind: "loading" }
  | { kind: "loaded"; status: PluginHostStatusResponse }
  | { kind: "failed"; message: string };

async function requestStatus(signal: AbortSignal): Promise<PluginHostStatusResponse> {
  const response = await fetch(PLUGIN_HOST_STATUS_URL, { signal });
  if (!response.ok) throw new Error(`Local Core returned HTTP ${response.status}.`);
  return parsePluginHostStatusResponse(await response.json());
}

export function PluginHostStatus() {
  const [state, setState] = useState<ViewState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const status = await requestStatus(controller.signal);
        setState({ kind: "loaded", status });
        timer = setTimeout(() => void load(), 500);
      } catch (error) {
        if (!controller.signal.aborted) {
          setState({
            kind: "failed",
            message:
              error instanceof Error
                ? error.message
                : "Local Core did not return a valid Plugin Host status.",
          });
        }
      }
    };
    void load();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <section className="plugin-host" aria-labelledby="plugin-host-heading">
      <p className="eyebrow">RUNTIME / MANAGED PROCESS</p>
      <h2 id="plugin-host-heading">插件宿主状态</h2>
      {state.kind === "loading" && <p className="summary">正在读取生命周期状态…</p>}
      {state.kind === "failed" && (
        <p className="guidance" role="alert">
          {state.message}
        </p>
      )}
      {state.kind === "loaded" && (
        <>
          <div className="status-line">
            <span
              className={`status-dot ${state.status.state === "ready" ? "ready" : "pending"}`}
              aria-hidden="true"
            />
            <span>{labels[state.status.state]}</span>
          </div>
          <p className="summary">{state.status.message}</p>
          {state.status.internalPort !== null && (
            <p className="guidance">回环内部端口：{state.status.internalPort}</p>
          )}
        </>
      )}
    </section>
  );
}
