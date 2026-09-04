import { useEffect, useState } from "react";

import {
  CORE_HEALTH_URL,
  parseHealthResponse,
  type HealthResponse,
} from "@comic-free/contracts";

type StartupState =
  | { kind: "starting" }
  | { health: HealthResponse; kind: "ready" }
  | { kind: "failed"; message: string };

async function requestHealth(signal: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(CORE_HEALTH_URL, { signal });
  if (!response.ok) {
    throw new Error(`Local Core returned HTTP ${response.status}.`);
  }
  return parseHealthResponse(await response.json());
}

function failureMessage(error: unknown): string {
  if (error instanceof Error && error.name !== "AbortError") return error.message;
  return "Local Core did not return a valid health response.";
}

export function App() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<StartupState>({ kind: "starting" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "starting" });

    void requestHealth(controller.signal).then(
      (health) => setState({ kind: "ready", health }),
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ kind: "failed", message: failureMessage(error) });
        }
      },
    );

    return () => controller.abort();
  }, [attempt]);

  if (state.kind === "starting") {
    return (
      <main className="shell" aria-live="polite">
        <p className="eyebrow">LOCAL READER / STARTUP</p>
        <h1>Starting Comic Free</h1>
        <p className="summary">Connecting to the Local Core on loopback…</p>
        <div className="status-line">
          <span className="status-dot pending" aria-hidden="true" />
          <span>Waiting for 127.0.0.1:3210</span>
        </div>
      </main>
    );
  }

  if (state.kind === "failed") {
    return (
      <main className="shell" aria-live="assertive">
        <p className="eyebrow">LOCAL READER / STARTUP</p>
        <h1>Comic Free could not start</h1>
        <p className="summary">{state.message}</p>
        <p className="guidance">
          Check the terminal running <code>pnpm dev</code>, resolve the reported Local Core
          problem, then retry.
        </p>
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          Retry Local Core
        </button>
      </main>
    );
  }

  return (
    <main className="shell" aria-live="polite">
      <p className="eyebrow">LOCAL READER / SYSTEM STATUS</p>
      <h1>Comic Free is ready</h1>
      <p className="summary">
        The Browser WebUI is connected through the Comic Free REST boundary.
      </p>
      <div className="status-line">
        <span className="status-dot ready" aria-hidden="true" />
        <span>Local Core · API {state.health.apiVersion}</span>
      </div>
      <dl className="facts">
        <div>
          <dt>Binding</dt>
          <dd>127.0.0.1 only</dd>
        </div>
        <div>
          <dt>Service</dt>
          <dd>{state.health.service}</dd>
        </div>
      </dl>
    </main>
  );
}
