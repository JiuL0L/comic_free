import { useEffect, useState } from "react";

import {
  CORE_HEALTH_URL,
  parseHealthResponse,
  type HealthResponse,
} from "@comic-free/contracts";

import { ReadingExperience } from "./ReadingExperience.tsx";
import { SettingsPanel } from "./Settings.tsx";
import { requestJson } from "./api.ts";

type StartupState =
  | { kind: "starting" }
  | { health: HealthResponse; kind: "ready" }
  | { kind: "failed"; message: string };

async function requestHealth(signal: AbortSignal): Promise<HealthResponse> {
  return requestJson(CORE_HEALTH_URL, parseHealthResponse, { signal });
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
        <h1>正在启动每日漫画</h1>
        <p className="summary">正在连接本机 Local Core…</p>
        <div className="status-line">
          <span className="status-dot pending" aria-hidden="true" />
          <span>正在等待 127.0.0.1:3210</span>
        </div>
      </main>
    );
  }

  if (state.kind === "failed") {
    return (
      <main className="shell" aria-live="assertive">
        <p className="eyebrow">LOCAL READER / STARTUP</p>
        <h1>每日漫画未能启动</h1>
        <p className="summary">{state.message}</p>
        <p className="guidance">
          请检查运行 <code>pnpm dev</code> 的终端，解决 Local Core 报错后重试。
        </p>
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          重试 Local Core
        </button>
      </main>
    );
  }

  return (
    <main className="shell" aria-live="polite">
      <header className="app-header">
        <div>
          <p className="eyebrow">COMIC FREE / LOCAL READER</p>
          <h1>每日漫画</h1>
          <p className="summary">本地书架、在线找漫画，阅读进度只保存到这台电脑。</p>
        </div>
        <div className="status-line"><span className="status-dot ready" aria-hidden="true" /><span>Local Core · API {state.health.apiVersion}</span></div>
      </header>
      <nav className="primary-nav" aria-label="主导航">
        <a href="#library">书架</a>
        <a href="#discover">找漫画</a>
        <a href="#reader">阅读</a>
        <a href="#settings">设置</a>
      </nav>
      <ReadingExperience />
      <SettingsPanel />
    </main>
  );
}
