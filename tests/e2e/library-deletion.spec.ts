import { expect, test } from "@playwright/test";
import type { ChildProcess } from "node:child_process";
import { fork } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import {
  CATALOG_SEARCH_PATH,
  LIBRARY_ITEMS_PATH,
  LOCAL_CORE_ORIGIN,
  READER_SESSIONS_PATH,
  WEB_UI_URL,
  SOURCE_PLUGINS_URL,
  SOURCE_PLUGINS_REFRESH_URL,
  parseSourcePluginCatalogResponse,
  parseLibraryItemsResponse,
} from "@comic-free/contracts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUTPUT_ROOT = path.resolve(
  ROOT,
  ".local-data/test-output/10-library-deletion",
);
const RUNTIME_ROOT = path.join(OUTPUT_ROOT, `browser-runtime-${process.pid}`);
const DATA_DIRECTORY = path.join(RUNTIME_ROOT, "data");

let application: ChildProcess | undefined;
let startupOutput = "";

function assertSafeRuntimePath(): void {
  const relative = path.relative(OUTPUT_ROOT, RUNTIME_ROOT);
  expect(relative).not.toBe("");
  expect(relative.startsWith("..")).toBe(false);
  expect(path.isAbsolute(relative)).toBe(false);
}

async function startApplication(): Promise<void> {
  startupOutput = "";
  application = fork(path.join(ROOT, "scripts", "start-dev.ts"), [], {
    cwd: ROOT,
    env: { ...process.env, COMIC_FREE_DATA_DIR: DATA_DIRECTORY },
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for startup.\n${startupOutput}`)),
      15_000,
    );
    application?.stdout?.on("data", (chunk: Buffer) => {
      startupOutput += chunk.toString("utf8");
      if (startupOutput.includes(`Comic Free is ready: ${WEB_UI_URL}`)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    application?.stderr?.on("data", (chunk: Buffer) => {
      startupOutput += chunk.toString("utf8");
    });
    application?.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Application exited before readiness (${code}).\n${startupOutput}`));
    });
  });
}

async function stopApplication(): Promise<void> {
  const running = application;
  application = undefined;
  if (!running) return;
  if (running.connected) running.send("shutdown");
  if (running.exitCode === null && running.signalCode === null) {
    await new Promise<void>((resolve) => running.once("exit", () => resolve()));
  }
}

test.beforeAll(async () => {
  assertSafeRuntimePath();
  await rm(RUNTIME_ROOT, { recursive: true, force: true });
  await mkdir(RUNTIME_ROOT, { recursive: true });
  await startApplication();
});

test.afterAll(async () => {
  await stopApplication();
  assertSafeRuntimePath();
  await rm(RUNTIME_ROOT, { recursive: true, force: true });
});

test("confirms deletion, preserves on failure, retries and prevents stale reading writes", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Source Plugin", { exact: true }).selectOption("fixture:reader");
  await page.getByLabel("Search query").fill("adventure");
  await page.getByRole("button", { name: "Search catalog" }).click();
  await page.getByRole("button", { name: "Open details" }).click();
  await page.getByRole("button", { name: "Read Chapter 1 · The Local Beginning" }).click();
  const reader = page.getByRole("region", { name: "Reader" });
  const library = page.getByRole("region", { name: "Your Library" });
  await reader.getByRole("button", { name: "Retain in Library" }).click();
  await expect(library.getByRole("button", { name: "Delete from Library" })).toBeVisible();
  const before = parseLibraryItemsResponse(await (await page.request.get(`${LOCAL_CORE_ORIGIN}${LIBRARY_ITEMS_PATH}`)).json());
  const item = before.items[0]!;
  expect((await page.request.post(SOURCE_PLUGINS_REFRESH_URL)).status()).toBe(200);
  const catalogBefore = parseSourcePluginCatalogResponse(await (await page.request.get(SOURCE_PLUGINS_URL)).json());
  expect(catalogBefore.entries.some(entry => entry.pluginKey === "fixture:reader" && entry.status === "healthy" && entry.version === "1.0.0")).toBe(true);
  await library.getByRole("button", { name: "Delete from Library" }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Delete Library Item" });
  await expect(confirmation).toContainText("Deterministic Adventure");
  await expect(confirmation).toContainText("Reading Progress");
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  expect(await (await page.request.get(`${LOCAL_CORE_ORIGIN}${LIBRARY_ITEMS_PATH}`)).json()).toEqual(before);

  const target = `${LOCAL_CORE_ORIGIN}${LIBRARY_ITEMS_PATH}/${item.id}`;
  await page.route(target, async route => {
    if (route.request().method() !== "DELETE") return route.continue();
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "internal_error", message: "Deletion failed. Retry.", retryable: true } }) });
  });
  await library.getByRole("button", { name: "Delete from Library" }).click();
  await confirmation.getByRole("button", { name: "Confirm deletion" }).click();
  await expect(confirmation.getByRole("alert")).toHaveText("Deletion failed. Retry.");
  expect(await (await page.request.get(`${LOCAL_CORE_ORIGIN}${LIBRARY_ITEMS_PATH}`)).json()).toEqual(before);
  await page.unroute(target);

  let releaseOld!: () => void;
  const oldGate = new Promise<void>(resolve => { releaseOld = resolve; });
  let progressReady!: () => void;
  const progressStarted = new Promise<void>(resolve => { progressReady = resolve; });
  await page.route(`${target}/progress`, async route => {
    const response = await route.fetch();
    progressReady();
    await oldGate;
    await route.fulfill({ response });
  });
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await reader.getByRole("button", { name: "Next page" }).click();
  await progressStarted;
  let resumeReady!: () => void;
  const resumeStarted = new Promise<void>(resolve => { resumeReady = resolve; });
  await page.route(`${LOCAL_CORE_ORIGIN}${READER_SESSIONS_PATH}`, async route => {
    const response = await route.fetch();
    resumeReady();
    await oldGate;
    await route.fulfill({ response });
  });
  await library.getByRole("button", { name: "Resume reading" }).click();
  await resumeStarted;
  await library.getByRole("button", { name: "Delete from Library" }).click();

  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(target, async route => { await gate; await route.continue(); });
  await confirmation.getByRole("button", { name: "Confirm deletion" }).click();
  await expect(confirmation.getByRole("button", { name: "Deleting…" })).toBeDisabled();
  release();
  await expect(confirmation).not.toBeVisible();
  await expect(library.getByRole("status")).toContainText("Deleted Deterministic Adventure");
  await expect(library.getByText("Your Library is empty.")).toBeVisible();
  expect(parseSourcePluginCatalogResponse(await (await page.request.get(SOURCE_PLUGINS_URL)).json())).toEqual(catalogBefore);
  releaseOld();
  await page.unrouteAll({ behavior: "wait" });
  await expect(reader).not.toBeVisible();
  await expect(page.getByText("Reading Progress saved", { exact: true })).not.toBeVisible();
  expect(await (await page.request.put(`${target}/progress`, { data: { chapterKey: "chapter/one", chapterLabel: "Old", pageCount: 3, pageIndex: 1 } })).status()).toBe(404);
  expect(await (await page.request.post(`${LOCAL_CORE_ORIGIN}${READER_SESSIONS_PATH}`, { data: { libraryItemId: item.id } })).status()).toBe(404);
  await page.goto("about:blank");
  await stopApplication();
  await startApplication();
  await page.goto("/");
  await expect(library.getByText("Your Library is empty.")).toBeVisible();
  expect(await (await page.request.get(`${LOCAL_CORE_ORIGIN}${LIBRARY_ITEMS_PATH}`)).json()).toEqual({ items: [] });
});
