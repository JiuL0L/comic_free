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
  parseLibraryItemsResponse,
} from "@comic-free/contracts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUTPUT_ROOT = path.resolve(
  ROOT,
  ".local-data/test-output/02-deterministic-reading",
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

test("reads, retains, disables provider reading, and restores local state after restart", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Find a comic" })).toBeVisible();
  await expect(page.getByText("Your Library is empty.")).toBeVisible();

  let releaseSearch!: () => void;
  const searchReleased = new Promise<void>((resolve) => {
    releaseSearch = resolve;
  });
  await page.route("**/api/v1/catalog/search?*", async (route) => {
    await searchReleased;
    await route.continue();
  });
  const searchButton = page.getByRole("button", { name: "Search catalog" });
  await expect(searchButton).toBeDisabled();
  await page.getByLabel("Source Plugin").selectOption("fixture:reader");
  await page.getByLabel("Search query").fill("no matches");
  await expect(searchButton).toBeEnabled();
  await searchButton.click();
  await expect(page.getByText("Searching Comic Free Fixture Reader…")).toBeVisible();
  releaseSearch();
  await expect(page.getByText("No comics matched this search.")).toBeVisible();
  await page.unroute("**/api/v1/catalog/search?*");

  await page.getByLabel("Search query").fill("retryable failure");
  await page.getByRole("button", { name: "Search catalog" }).click();
  await expect(
    page.getByText("The deterministic Comic Provider is temporarily unavailable."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry search" })).toBeVisible();

  await page.getByLabel("Search query").fill("adventure");
  await page.getByRole("button", { name: "Search catalog" }).click();
  await expect(page.getByText("Deterministic Adventure", { exact: true }).first()).toBeVisible();
  await expect(
    page.locator(".result-list").getByText("Comic Free Fixture Reader", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Open details" }).click();
  await expect(page.getByText("A local three-page adventure used to prove reading and retention without a network.")).toBeVisible();
  await page.getByRole("button", { name: "Read Chapter 1 · The Local Beginning" }).click();

  const reader = page.getByRole("region", { name: "Reader" });
  await expect(reader.getByText("Comic Free Fixture Reader", { exact: true })).toBeVisible();
  await expect(reader.getByText("Deterministic Adventure", { exact: true })).toBeVisible();
  await expect(reader.getByText("Chapter 1 · The Local Beginning", { exact: true })).toBeVisible();
  await expect(reader.getByText("Page 1 of 3", { exact: true })).toBeVisible();

  const image = reader.getByRole("img", { name: "Deterministic Adventure — page 1 of 3" });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => [element.naturalWidth, element.naturalHeight]))
    .toEqual([800, 1200]);
  await expect(reader.getByText("Rendered 800 × 1200")).toBeVisible();
  const oldPageUrl = await image.getAttribute("src");

  await expect(reader.getByRole("button", { name: "Previous page" })).toBeDisabled();
  await reader.getByRole("button", { name: "Next page" }).click();
  await expect(reader.getByText("Page 2 of 3", { exact: true })).toBeVisible();
  await reader.getByRole("button", { name: "Retain in Library" }).click();
  await expect(reader.getByText("Saved to Library")).toBeVisible();
  await reader.getByRole("button", { name: "Next page" }).click();
  await expect(reader.getByText("Page 3 of 3", { exact: true })).toBeVisible();
  await expect(reader.getByText("Reading Progress saved")).toBeVisible();
  await expect(reader.getByRole("button", { name: "Next page" })).toBeDisabled();

  const libraryResponse = await page.request.get(`${LOCAL_CORE_ORIGIN}${LIBRARY_ITEMS_PATH}`);
  const library = parseLibraryItemsResponse(await libraryResponse.json());
  const item = library.items[0];
  expect(item).toBeDefined();
  expect(item?.progress.pageIndex).toBe(2);

  const invalidProgress = await page.request.put(
    `${LOCAL_CORE_ORIGIN}${LIBRARY_ITEMS_PATH}/${item?.id}/progress`,
    {
      data: {
        chapterKey: "chapter/one",
        chapterLabel: "Chapter 1 · The Local Beginning",
        pageCount: 3,
        pageIndex: 3,
      },
    },
  );
  expect(invalidProgress.status()).toBe(400);

  const arbitraryUrl = await page.request.post(`${LOCAL_CORE_ORIGIN}${READER_SESSIONS_PATH}`, {
    data: {
      chapterKey: "chapter/one",
      comicKey: "comic/deterministic-adventure",
      sourcePluginKey: "fixture:reader",
      upstreamUrl: "https://example.invalid/page.png",
    },
  });
  expect(arbitraryUrl.status()).toBe(400);

  const unavailable = await page.request.post(
    `${LOCAL_CORE_ORIGIN}/api/v1/fixture/source-bindings/${item?.sourceBinding.id}/unavailable`,
    { data: { reasonCode: "comic_provider_unreachable" } },
  );
  expect(unavailable.status()).toBe(200);
  expect(oldPageUrl).not.toBeNull();
  const invalidatedSession = await page.request.get(oldPageUrl as string);
  expect(invalidatedSession.status()).toBe(404);

  const blockedCatalogRead = await page.request.post(
    `${LOCAL_CORE_ORIGIN}${READER_SESSIONS_PATH}`,
    {
      data: {
        chapterKey: "chapter/one",
        comicKey: "comic/deterministic-adventure",
        sourcePluginKey: "fixture:reader",
      },
    },
  );
  expect(blockedCatalogRead.status()).toBe(409);

  await page.reload();
  const libraryRegion = page.getByRole("region", { name: "Your Library" });
  await expect(libraryRegion.getByText("Deterministic Adventure", { exact: true })).toBeVisible();
  await expect(libraryRegion.getByText("Comic Provider unreachable")).toBeVisible();
  await expect(libraryRegion.getByText("Chapter 1 · The Local Beginning")).toBeVisible();
  await expect(libraryRegion.getByText("Page 3 of 3")).toBeVisible();
  await expect(libraryRegion.getByRole("button", { name: "Resume reading" })).toBeDisabled();

  await page.goto("about:blank");
  await stopApplication();
  await startApplication();
  await page.goto("/");
  await expect(libraryRegion.getByText("Deterministic Adventure", { exact: true })).toBeVisible();
  await expect(libraryRegion.getByText("Comic Provider unreachable")).toBeVisible();
  await expect(libraryRegion.getByText("Page 3 of 3")).toBeVisible();

  const staleSession = await page.request.get(oldPageUrl as string);
  expect(staleSession.status()).toBe(404);

  const searchRequests = await page.request.get(
    `${LOCAL_CORE_ORIGIN}${CATALOG_SEARCH_PATH}?sourcePluginKey=fixture%3Areader&q=adventure`,
  );
  expect(searchRequests.status()).toBe(200);
});
