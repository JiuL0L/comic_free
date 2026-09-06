import { expect, test } from "@playwright/test";
import type { ChildProcess } from "node:child_process";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { LOCAL_CORE_ORIGIN, LIBRARY_ITEMS_PATH, READER_SESSIONS_PATH, SETTINGS_URL, WEB_UI_URL, parseLibraryItemResponse, parseLibraryItemsResponse, parseReaderSessionResponse } from "@comic-free/contracts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUTPUT_ROOT = path.join(ROOT, ".local-data", "test-output", "daily-reader");
const RUNTIME_ROOT = path.join(OUTPUT_ROOT, `runtime-${process.pid}`);
let application: ChildProcess | undefined;
let startupOutput = "";

async function startApplication(): Promise<void> {
  startupOutput = "";
  application = fork(path.join(ROOT, "scripts", "start-dev.ts"), [], {
    cwd: ROOT,
    env: { ...process.env, COMIC_FREE_DATA_DIR: path.join(RUNTIME_ROOT, "data") },
    execArgv: ["--import", "tsx"], stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for startup.\n${startupOutput}`)), 15_000);
    application?.stdout?.on("data", (chunk: Buffer) => { startupOutput += chunk.toString("utf8"); if (startupOutput.includes(`Comic Free is ready: ${WEB_UI_URL}`)) { clearTimeout(timeout); resolve(); } });
    application?.stderr?.on("data", (chunk: Buffer) => { startupOutput += chunk.toString("utf8"); });
    application?.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Application exited (${code}).\n${startupOutput}`)); });
  });
}

async function stopApplication(): Promise<void> {
  const running = application; application = undefined;
  if (!running) return;
  if (running.connected) running.send("shutdown");
  if (running.exitCode === null && running.signalCode === null) await new Promise<void>(resolve => running.once("exit", resolve));
}

test.beforeAll(async () => { await rm(RUNTIME_ROOT, { recursive: true, force: true }); await mkdir(RUNTIME_ROOT, { recursive: true }); await startApplication(); });
test.afterAll(async () => { await stopApplication(); await rm(RUNTIME_ROOT, { recursive: true, force: true }); });

test("提供中文四段导航，并在连续阅读新章节时保存同一书架条目", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await expect(page.getByRole("link", { name: "书架" })).toBeVisible();
  await expect(page.getByRole("link", { name: "找漫画" })).toBeVisible();
  await expect(page.getByRole("link", { name: "阅读" })).toBeVisible();
  await expect(page.getByRole("link", { name: "设置" })).toBeVisible();

  await page.getByLabel("漫画来源", { exact: true }).selectOption("fixture:reader");
  await page.getByLabel("搜索关键词").fill("adventure");
  await page.getByRole("button", { name: "搜索漫画" }).click();
  await page.getByRole("button", { name: "查看详情" }).click();
  await page.getByRole("button", { name: /阅读 Chapter 1/ }).click();
  const reader = page.getByRole("region", { name: "阅读器" });
  await reader.getByRole("button", { name: "加入书架" }).click();
  await expect(reader.getByRole("button", { name: "已加入书架", exact: true })).toBeDisabled();
  const secondPageMarker = reader.locator("[data-reader-page][data-page-index='1']");
  await secondPageMarker.evaluate(element => element.scrollIntoView({ block: "start" }));
  await expect(reader.getByText("第 2 / 3 页")).toBeVisible();
  await expect.poll(async () => {
    const response = await page.request.get(`${LOCAL_CORE_ORIGIN}${LIBRARY_ITEMS_PATH}`);
    return parseLibraryItemsResponse(await response.json()).items[0]?.progress.pageIndex;
  }).toBe(1);
  await page.keyboard.press("ArrowRight");
  await expect(reader.getByText("第 3 / 3 页")).toBeVisible();
  await expect(reader.getByText("阅读进度已保存")).toBeVisible();
  await reader.getByRole("button", { name: "下一话" }).click();
  await expect(reader.getByText("Chapter 2 · Keep Reading")).toBeVisible();
  await expect(reader.getByText("阅读进度已保存")).toBeVisible();
  await reader.getByRole("button", { name: "下一页" }).click();
  await expect(reader.getByText("第 2 / 3 页")).toBeVisible();
  await expect(reader.getByText("阅读进度已保存")).toBeVisible();

  await page.goto("about:blank"); await stopApplication(); await startApplication();
  let releaseFirstPage!: () => void;
  const firstPageReleased = new Promise<void>((resolve) => { releaseFirstPage = resolve; });
  let firstPageStarted!: () => void;
  const firstPageRequested = new Promise<void>((resolve) => { firstPageStarted = resolve; });
  let delayed = false;
  await page.route(/\/api\/v1\/reader-sessions\/[^/]+\/pages\/0\?/, async (route) => {
    if (delayed) return route.continue();
    delayed = true;
    firstPageStarted();
    await firstPageReleased;
    await route.continue();
  });
  await page.goto("/");
  await page.getByRole("region", { name: "书架" }).getByRole("button", { name: "继续阅读" }).click();
  await firstPageRequested;
  releaseFirstPage();
  const resumedReader = page.getByRole("region", { name: "阅读器" });
  await expect(resumedReader.getByText("Chapter 2 · Keep Reading")).toBeVisible();
  await expect(resumedReader.getByText("第 2 / 3 页")).toBeVisible();
  const restoredMarker = resumedReader.locator("[data-reader-page][data-page-index='1']");
  await expect(restoredMarker).toBeVisible();
  await expect.poll(async () => (await restoredMarker.boundingBox())?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(120);
  await page.unrouteAll({ behavior: "wait" });
  await page.screenshot({ path: path.join(OUTPUT_ROOT, "daily-reader.png"), fullPage: true });
});

test("损坏设置可在页面修复，错误保留草稿，保存后重启生效", async ({ page }) => {
  await stopApplication();
  await writeFile(path.join(RUNTIME_ROOT, "data", "settings.json"), "{broken", "utf8");
  await startApplication();
  await page.goto("/");
  const settings = page.locator("#settings");
  await expect(settings.getByRole("alert")).toContainText("保存的设置无法读取");
  const jarPath = settings.getByLabel("Suwayomi JAR 路径");
  await jarPath.fill("C:\\missing\\suwayomi.jar");
  await settings.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(settings.getByRole("alert")).toContainText("configured together");
  await expect(jarPath).toHaveValue("C:\\missing\\suwayomi.jar");
  await jarPath.fill("");
  await settings.getByLabel("Suwayomi 内部端口").fill("4569");
  await settings.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(settings.getByText("设置已保存，将在重启后生效。")).toBeVisible();
  await page.reload();
  await expect(settings.getByLabel("Suwayomi 内部端口")).toHaveValue("4569");
  await page.goto("about:blank");
  await stopApplication();
  await startApplication();
  const current = await page.request.get(SETTINGS_URL);
  expect(await current.json()).toEqual({
    restartRequired: false,
    settings: { approvedSha256: null, jarPath: null, port: 4569, proxyUrl: null },
  });
});

test("书架按最近阅读时间展示，而不是标题顺序", async ({ page }) => {
  const sessionResponse = await page.request.post(`${LOCAL_CORE_ORIGIN}${READER_SESSIONS_PATH}`, {
    data: { sourcePluginKey: "fixture:reader", comicKey: "comic/deterministic-adventure", chapterKey: "chapter/one" },
  });
  const { session } = parseReaderSessionResponse(await sessionResponse.json());
  const itemResponse = await page.request.post(`${LOCAL_CORE_ORIGIN}${LIBRARY_ITEMS_PATH}`, {
    data: { sessionId: session.id, pageIndex: 0 },
  });
  const { item } = parseLibraryItemResponse(await itemResponse.json());
  const older = { ...item, id: randomUUID(), snapshot: { ...item.snapshot, title: "Alpha Older" }, progress: { ...item.progress, updatedAt: "2020-01-01T00:00:00.000Z" } };
  const recent = { ...item, snapshot: { ...item.snapshot, title: "Zulu Recent" }, progress: { ...item.progress, updatedAt: "2026-09-06T00:00:00.000Z" } };
  await page.route(`${LOCAL_CORE_ORIGIN}${LIBRARY_ITEMS_PATH}`, route => route.fulfill({ json: { items: [older, recent] } }));
  await page.goto("/");
  await expect(page.getByRole("region", { name: "书架" }).getByRole("heading", { level: 3 })).toHaveText(["Zulu Recent", "Alpha Older"]);
});
