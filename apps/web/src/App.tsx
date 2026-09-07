import { useEffect, useState } from "react";

import {
  CORE_HEALTH_URL,
  parseHealthResponse,
  type HealthResponse,
} from "@comic-free/contracts";

import {
  ReadingExperience,
  type ReadingSection,
} from "./ReadingExperience.tsx";
import { SettingsPanel } from "./Settings.tsx";
import { requestJson } from "./api.ts";

type StartupState =
  | { kind: "starting" }
  | { health: HealthResponse; kind: "ready" }
  | { kind: "failed"; message: string };

type AppSection = ReadingSection | "settings";

const sections: { id: AppSection; label: string }[] = [
  { id: "library", label: "书架" },
  { id: "discover", label: "找漫画" },
  { id: "reader", label: "阅读" },
  { id: "settings", label: "设置" },
];

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
  const [activeSection, setActiveSection] = useState<AppSection>("discover");
  const [switchDirection, setSwitchDirection] = useState<"left" | "right">("left");

  const showSection = (nextSection: AppSection) => {
    if (nextSection === activeSection) return;
    const currentIndex = sections.findIndex((section) => section.id === activeSection);
    const nextIndex = sections.findIndex((section) => section.id === nextSection);
    setSwitchDirection(nextIndex > currentIndex ? "left" : "right");
    setActiveSection(nextSection);
  };

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
        {sections.map((section) => (
          <button
            key={section.id}
            id={`nav-${section.id}`}
            type="button"
            aria-controls={section.id}
            aria-current={activeSection === section.id ? "page" : undefined}
            onClick={() => showSection(section.id)}
          >
            {section.label}
          </button>
        ))}
      </nav>
      <div className="app-view-stack" data-switch-direction={switchDirection}>
        <ReadingExperience
          visibleSection={activeSection === "settings" ? null : activeSection}
          switchDirection={switchDirection}
          onOpenReader={() => showSection("reader")}
        />
        <div
          className="app-view-panel"
          data-switch-direction={switchDirection}
          hidden={activeSection !== "settings"}
        >
          <SettingsPanel />
        </div>
      </div>
    </main>
  );
}
