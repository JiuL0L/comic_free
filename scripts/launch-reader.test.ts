import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  hasReadyComicFree,
  launchReader,
  REQUIRED_JAVA_MAJOR,
  REQUIRED_NODE_MAJOR,
  REQUIRED_PNPM_MAJOR,
  verifyConfiguredHostPrerequisites,
  verifyLaunchPrerequisites,
} from "./launch-reader.ts";

const versions = new Map([
  ["pnpm", `v${REQUIRED_PNPM_MAJOR}.33.2`],
  ["pnpm.cmd", `v${REQUIRED_PNPM_MAJOR}.33.2`],
  ["java", `openjdk version \"${REQUIRED_JAVA_MAJOR}.0.9\"`],
  ["javac", `javac ${REQUIRED_JAVA_MAJOR}.0.9`],
  ["jar", `${REQUIRED_JAVA_MAJOR}.0.9`],
]);

test("launch prerequisites require Node 26 and pnpm 10 without touching Java for fixture mode", async () => {
  const commands: string[] = [];
  await verifyLaunchPrerequisites({
    nodeVersion: `${REQUIRED_NODE_MAJOR}.4.1`,
    commandRunner: async (command) => {
      commands.push(command);
      return { output: versions.get(command) ?? "" };
    },
  });
  assert.deepEqual(commands, [process.platform === "win32" ? "pnpm.cmd" : "pnpm"]);
});

test("a configured host verifies its JAR and all Java 21 tools", async () => {
  const commands: string[] = [];
  let checkedJar = "";
  await verifyConfiguredHostPrerequisites({
    jarPath: "C:\\approved\\suwayomi.jar",
    commandRunner: async (command) => {
      commands.push(command);
      return { output: versions.get(command) ?? "" };
    },
    fileExists: async (filePath) => { checkedJar = filePath; },
  });
  assert.equal(checkedJar, "C:\\approved\\suwayomi.jar");
  assert.deepEqual(commands.sort(), ["jar", "java", "javac"]);
});

test("version failures tell the user which installed runtime must change", async () => {
  await assert.rejects(
    verifyLaunchPrerequisites({
      nodeVersion: "24.12.0",
    }),
    /Node\.js 26\.x is required/,
  );
});

test("a missing configured JAR warns but still starts Core and opens Settings", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "comic-free-launcher-host-warning-"));
  const warnings: string[] = [];
  let browserOpened = 0;
  let supervisorStarted = 0;
  try {
    await writeFile(path.join(dataDirectory, "settings.json"), JSON.stringify({
      approvedSha256: "a".repeat(64),
      jarPath: "C:/missing/Suwayomi-Server.jar",
      port: 4568,
      proxyUrl: null,
    }), "utf8");
    const outcome = await launchReader(process.cwd(), {
      ...process.env,
      COMIC_FREE_DATA_DIR: dataDirectory,
    }, {
      commandRunner: async (command) => ({ output: versions.get(command) ?? "" }),
      fileExists: async () => { throw new Error("Configured JAR is missing."); },
      fetch: async () => new Response("not ready", { status: 503 }),
      openBrowser: () => { browserOpened += 1; },
      reportWarning: (message) => { warnings.push(message); },
      startDevelopment: async () => {
        supervisorStarted += 1;
        return { stop: async () => undefined, unexpectedExit: Promise.resolve() as Promise<never> };
      },
    });
    assert.equal(outcome, "started");
    assert.equal(supervisorStarted, 1);
    assert.equal(browserOpened, 1);
    assert.match(warnings.join("\n"), /Configured JAR is missing/);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("an unsupported Node version blocks launch before Core or browser startup", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "comic-free-launcher-node-version-"));
  try {
    await assert.rejects(
      launchReader(process.cwd(), {
        ...process.env,
        COMIC_FREE_DATA_DIR: dataDirectory,
      }, {
        nodeVersion: "24.12.0",
        startDevelopment: async () => {
          throw new Error("Node version gate must prevent starting the supervisor.");
        },
        openBrowser: () => {
          throw new Error("Node version gate must prevent opening the browser.");
        },
      }),
      /Node\.js 26\.x is required/,
    );
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("an existing instance is accepted only after both Core health and WebUI respond", async () => {
  const core = await hasReadyComicFree(async (url) => {
    if (url === "http://127.0.0.1:3210/api/v1/health") {
      return new Response(JSON.stringify({ apiVersion: "v1", service: "comic-free-local-core", status: "ready" }), { status: 200 });
    }
    if (url === "http://127.0.0.1:3210/api/v1/settings") {
      return new Response(JSON.stringify({
        restartRequired: false,
        settings: { approvedSha256: null, jarPath: null, port: 4568, proxyUrl: null },
      }), { status: 200 });
    }
    return new Response("web", { status: 200 });
  });
  assert.equal(core, true);

  const missingWeb = await hasReadyComicFree(async (url) => new Response(
    url === "http://127.0.0.1:3210/api/v1/health"
      ? JSON.stringify({ apiVersion: "v1", service: "comic-free-local-core", status: "ready" })
      : url === "http://127.0.0.1:3210/api/v1/settings"
        ? JSON.stringify({ restartRequired: false, settings: { approvedSha256: null, jarPath: null, port: 4568, proxyUrl: null } })
        : "missing",
    { status: url === "http://127.0.0.1:3210/api/v1/settings" || url === "http://127.0.0.1:3210/api/v1/health" ? 200 : 503 },
  ));
  assert.equal(missingWeb, false);

  const oldCore = await hasReadyComicFree(async (url) => new Response(
    url === "http://127.0.0.1:3210/api/v1/health"
      ? JSON.stringify({ apiVersion: "v1", service: "comic-free-local-core", status: "ready" })
      : "not found",
    { status: url === "http://127.0.0.1:3210/api/v1/health" ? 200 : 404 },
  ));
  assert.equal(oldCore, false);
});

test("the launcher opens a confirmed existing app without starting another child", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "comic-free-launcher-"));
  let opened = 0;
  try {
    const outcome = await launchReader(process.cwd(), {
      ...process.env,
      COMIC_FREE_DATA_DIR: dataDirectory,
    }, {
      commandRunner: async (command) => ({ output: versions.get(command) ?? "" }),
      fetch: async (url) => new Response(
        url === "http://127.0.0.1:3210/api/v1/health"
          ? JSON.stringify({ apiVersion: "v1", service: "comic-free-local-core", status: "ready" })
          : url === "http://127.0.0.1:3210/api/v1/settings"
            ? JSON.stringify({ restartRequired: false, settings: { approvedSha256: null, jarPath: null, port: 4568, proxyUrl: null } })
            : "web",
        { status: 200 },
      ),
      openBrowser: () => { opened += 1; },
      startDevelopment: async () => {
        throw new Error("A healthy existing application must not start another child.");
      },
    });
    assert.equal(outcome, "existing");
    assert.equal(opened, 1);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
