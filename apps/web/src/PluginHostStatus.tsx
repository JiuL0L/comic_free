import { useEffect, useState } from "react";

import {
  PLUGIN_HOST_STATUS_URL,
  parsePluginHostStatusResponse,
  type PluginHostState,
  type PluginHostStatusResponse,
} from "@comic-free/contracts";

const labels: Record<PluginHostState, string> = {
  early_exit: "Exited during startup",
  invalid_path: "Invalid artifact",
  not_configured: "Not configured",
  port_occupied: "Port occupied",
  ready: "Ready",
  shutdown_failed: "Shutdown failed",
  starting: "Starting",
  stopped: "Stopped",
  stopping: "Stopping",
  unexpected_exit: "Exited unexpectedly",
  startup_timeout: "Startup timed out",
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
        if (status.state === "starting" || status.state === "stopping") {
          timer = setTimeout(() => void load(), 500);
        }
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
      <h2 id="plugin-host-heading">Plugin Host</h2>
      {state.kind === "loading" && <p className="summary">Reading lifecycle state…</p>}
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
            <p className="guidance">Loopback internal port: {state.status.internalPort}</p>
          )}
        </>
      )}
    </section>
  );
}
