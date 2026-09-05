import { expect, test } from "@playwright/test";
import type { ChildProcess } from "node:child_process";
import { fork } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import {
  LIBRARY_ITEMS_PATH,
  LOCAL_CORE_ORIGIN,
  SOURCE_PLUGIN_CHANGES_PATH,
  WEB_UI_URL,
} from "@comic-free/contracts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUTPUT_ROOT = path.resolve(ROOT, ".local-data/test-output/09-installed-providers");
const RUNTIME_ROOT = path.join(OUTPUT_ROOT, `browser-runtime-${process.pid}`);
const DATA_DIRECTORY = path.join(RUNTIME_ROOT, "data");
const EN_PROVIDER_VALUE = "fixture:reader";
const FR_PROVIDER_VALUE = JSON.stringify(["fixture:reader", "fixture.provider.fr"]);

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

function change(action: "disable" | "install" | "restore" | "update") {
  return {
    action,
    approval: { approved: true },
    source: {
      expectedVersion: action === "disable" ? null : action === "update" ? "1.0.1" : "1.0.0",
      kind: "extension_store",
      packageName: "fixture:reader",
      storeUrl: "https://fixtures.comic-free.invalid/repo/index.pb",
    },
  };
}

async function searchAndOpen(page: import("@playwright/test").Page, optionValue: string) {
  const select = page.getByLabel("Comic Provider", { exact: true });
  await select.selectOption(optionValue);
  await page.getByLabel("Search query").fill("adventure");
  const response = page.waitForResponse((candidate) => {
    const url = new URL(candidate.url());
    return url.pathname === "/api/v1/catalog/search" && url.searchParams.get("comicProviderKey") === "fixture.provider.fr";
  });
  await page.getByRole("button", { name: "Search catalog" }).click();
  return response;
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

test("discovers installed same-plugin providers and preserves the selected route through recovery and restart", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/");
  const select = page.getByLabel("Comic Provider", { exact: true });
  await expect(select.locator(`option[value="${EN_PROVIDER_VALUE}"]`)).toHaveCount(1);

  const installed = await page.request.post(`${LOCAL_CORE_ORIGIN}${SOURCE_PLUGIN_CHANGES_PATH}`, {
    data: change("install"),
  });
  expect(installed.status()).toBe(200);

  await expect
    .poll(
      async () => select.locator("option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value)),
      { timeout: 15_000 },
    )
    .toContain(FR_PROVIDER_VALUE);
  await expect(select.locator(`option[value="${EN_PROVIDER_VALUE}"]`)).toHaveCount(1);
  expect(
    (await select.locator("option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value)))
      .filter((value) => value === FR_PROVIDER_VALUE),
  ).toHaveLength(1);

  await select.selectOption(EN_PROVIDER_VALUE);
  await page.getByLabel("Search query").fill("adventure");
  await page.getByRole("button", { name: "Search catalog" }).click();
  await expect(page.getByText("Deterministic Adventure", { exact: true })).toBeVisible();

  const frSearch = await searchAndOpen(page, FR_PROVIDER_VALUE);
  expect(frSearch.status()).toBe(200);
  await expect(page.getByText("Deterministic Adventure · fr", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open details" }).click();
  await expect(page.getByRole("heading", { name: "Deterministic Adventure · fr" })).toBeVisible();
  await page.getByRole("button", { name: "Read Chapter 1 · The Local Beginning" }).click();

  const reader = page.getByRole("region", { name: "Reader" });
  const image = reader.getByRole("img", { name: "Deterministic Adventure · fr — page 1 of 3" });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => [element.naturalWidth, element.naturalHeight]))
    .toEqual([800, 1200]);
  const pageResponse = await page.request.get((await image.getAttribute("src"))!);
  expect(await pageResponse.text()).toContain("COMIC FREE FR FIXTURE");

  await reader.getByRole("button", { name: "Next page" }).click();
  await expect(reader.getByText("Page 2 of 3", { exact: true })).toBeVisible();
  await reader.getByRole("button", { name: "Retain in Library" }).click();
  const library = page.getByRole("region", { name: "Your Library" });
  await expect(library.getByText("Deterministic Adventure · fr", { exact: true })).toBeVisible();
  const retained = await (await page.request.get(`${LOCAL_CORE_ORIGIN}${LIBRARY_ITEMS_PATH}`)).json();
  expect(retained.items[0].sourceBinding.comicProviderKey).toBe("fixture.provider.fr");
  expect(retained.items[0].progress.pageIndex).toBe(1);

  expect((await page.request.post(`${LOCAL_CORE_ORIGIN}${SOURCE_PLUGIN_CHANGES_PATH}`, { data: change("disable") })).status()).toBe(200);
  await page.getByRole("button", { name: "Reload Library" }).click();
  await expect(library.getByText("Source Plugin disabled")).toBeVisible();

  expect((await page.request.post(`${LOCAL_CORE_ORIGIN}${SOURCE_PLUGIN_CHANGES_PATH}`, { data: change("restore") })).status()).toBe(200);
  await page.getByRole("button", { name: "Reload Library" }).click();
  await expect(library.getByText("Source Binding refresh required")).toBeVisible();
  await library.getByRole("button", { name: "Refresh Source Binding" }).click();
  await expect(library.getByText("Source Binding refreshed. Resume reading when ready.")).toBeVisible();
  await library.getByRole("button", { name: "Resume reading" }).click();
  await expect(reader.getByText("Page 2 of 3", { exact: true })).toBeVisible();

  const beforeRestart = await (await page.request.get(`${LOCAL_CORE_ORIGIN}${LIBRARY_ITEMS_PATH}`)).json();
  const updated = await page.request.post(`${LOCAL_CORE_ORIGIN}${SOURCE_PLUGIN_CHANGES_PATH}`, {
    data: change("update"),
  });
  expect(updated.status()).toBe(200);
  expect((await updated.json()).change.outcome).toBe("restart_required");

  await page.goto("about:blank");
  await stopApplication();
  await startApplication();
  await page.goto("/");
  const restartedSelect = page.getByLabel("Comic Provider", { exact: true });
  await expect
    .poll(
      async () => restartedSelect.locator("option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value)),
      { timeout: 15_000 },
    )
    .toContain(FR_PROVIDER_VALUE);
  await restartedSelect.selectOption(FR_PROVIDER_VALUE);
  const restartedLibrary = page.getByRole("region", { name: "Your Library" });
  await expect(restartedLibrary.getByText("Deterministic Adventure · fr", { exact: true })).toBeVisible();
  await expect(restartedLibrary.getByText("Source Binding refresh required")).toBeVisible();
  const afterRestart = await (await page.request.get(`${LOCAL_CORE_ORIGIN}${LIBRARY_ITEMS_PATH}`)).json();
  expect(afterRestart.items[0].snapshot).toEqual(beforeRestart.items[0].snapshot);
  expect(afterRestart.items[0].progress).toEqual(beforeRestart.items[0].progress);
  await restartedLibrary.getByRole("button", { name: "Refresh Source Binding" }).click();
  await expect(restartedLibrary.getByText("Source Binding refreshed. Resume reading when ready.")).toBeVisible();
  await restartedLibrary.getByRole("button", { name: "Resume reading" }).click();
  await expect(page.getByRole("region", { name: "Reader" }).getByText("Page 2 of 3", { exact: true })).toBeVisible();
});
