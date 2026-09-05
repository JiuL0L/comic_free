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
  SOURCE_PLUGIN_CHANGES_PATH,
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

function sourcePluginChange(action: "disable" | "install" | "restore") {
  return {
    action,
    approval: { approved: true },
    source: {
      expectedVersion: action === "disable" ? null : "1.0.0",
      kind: "extension_store",
      packageName: "fixture:reader",
      storeUrl: "https://fixtures.comic-free.invalid/repo/index.pb",
    },
  };
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
  const installed = await page.request.post(
    `${LOCAL_CORE_ORIGIN}${SOURCE_PLUGIN_CHANGES_PATH}`,
    { data: sourcePluginChange("install") },
  );
  expect(installed.status()).toBe(200);
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
  await page.getByLabel("Comic Provider", { exact: true }).selectOption("fixture:reader");
  await page.getByLabel("Search query").fill("no matches");
  await expect(searchButton).toBeEnabled();
  await searchButton.click();
  await expect(
    page.getByText("Searching Comic Free Fixture Reader / Fixture Provider (en)…"),
  ).toBeVisible();
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

  expect(oldPageUrl).not.toBeNull();
  const stalePagePath = new URL(oldPageUrl as string).pathname;
  const stalePageRequest = (url: URL) => url.pathname === stalePagePath;
  const rejectStalePage = async (route: import("@playwright/test").Route) => {
    await route.fulfill({
      body: JSON.stringify({
        error: {
          code: "reader_session_not_found",
          message: "The reader session is missing or expired. Reopen the chapter to continue.",
          retryable: true,
        },
      }),
      contentType: "application/json",
      status: 404,
    });
  };
  await page.route(stalePageRequest, rejectStalePage);
  await image.evaluate((element: HTMLImageElement) => {
    element.src = `${element.src}&after-restart=1`;
  });
  await expect(
    reader.getByText("The page could not be loaded. Your reader context was preserved."),
  ).toBeVisible();
  await page.unroute(stalePageRequest, rejectStalePage);
  await reader.getByRole("button", { name: "Renew reader session" }).click();
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => [element.naturalWidth, element.naturalHeight]))
    .toEqual([800, 1200]);

  await expect(reader.getByRole("button", { name: "Previous page" })).toBeDisabled();
  await reader.getByRole("button", { name: "Next page" }).click();
  await expect(reader.getByText("Page 2 of 3", { exact: true })).toBeVisible();
  await reader.getByRole("button", { name: "Retain in Library" }).click();
  await expect(reader.getByText("Saved to Library")).toBeVisible();

  await test.step("shows a failed first Resume and lets the reader retry before a Reader exists", async () => {
    await page.reload();
    const libraryRegion = page.getByRole("region", { name: "Your Library" });
    await expect(libraryRegion.getByRole("button", { name: "Resume reading" })).toBeEnabled();

    const resumeFailure = async (route: import("@playwright/test").Route) => {
      await route.fulfill({
        body: JSON.stringify({
          error: {
            code: "source_binding_unavailable",
            message: "Reading is unavailable because the Source Binding is unreachable.",
            retryable: true,
          },
        }),
        contentType: "application/json",
        status: 409,
      });
    };
    await page.route("**/api/v1/reader-sessions", resumeFailure);
    await libraryRegion.getByRole("button", { name: "Resume reading" }).click();
    await expect(libraryRegion.getByRole("alert")).toContainText(
      "Reading is unavailable because the Source Binding is unreachable.",
    );
    await expect(libraryRegion.getByRole("button", { name: "Retry Resume" })).toBeVisible();
    await page.unroute("**/api/v1/reader-sessions", resumeFailure);
    await libraryRegion.getByRole("button", { name: "Retry Resume" }).click();
    await expect(page.getByRole("region", { name: "Reader" })).toBeVisible();
  });

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

  const disabled = await page.request.post(
    `${LOCAL_CORE_ORIGIN}${SOURCE_PLUGIN_CHANGES_PATH}`,
    { data: sourcePluginChange("disable") },
  );
  expect(disabled.status()).toBe(200);
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

  await test.step("keeps the old Reader page and durable progress when a disabled Source Plugin rejects progress", async () => {
    await reader.getByRole("button", { name: "Previous page" }).click();
    await expect(reader.getByText("Page 3 of 3", { exact: true })).toBeVisible();
    await expect(reader.getByText("Reading is unavailable because the Source Plugin is disabled.")).toBeVisible();
    const retainedAfterRejectedProgress = parseLibraryItemsResponse(
      await (await page.request.get(`${LOCAL_CORE_ORIGIN}${LIBRARY_ITEMS_PATH}`)).json(),
    ).items[0];
    expect(retainedAfterRejectedProgress?.progress.pageIndex).toBe(2);
  });

  await page.reload();
  const libraryRegion = page.getByRole("region", { name: "Your Library" });
  await expect(libraryRegion.getByText("Deterministic Adventure", { exact: true })).toBeVisible();
  await expect(libraryRegion.getByText("Source Plugin disabled")).toBeVisible();
  await expect(libraryRegion.getByText("Chapter 1 · The Local Beginning")).toBeVisible();
  await expect(libraryRegion.getByText("Page 3 of 3")).toBeVisible();
  await expect(libraryRegion.getByRole("button", { name: "Refresh Source Binding" })).toBeVisible();

  await test.step("shows a disabled refresh failure, then restores and retries explicitly without opening a Reader", async () => {
    await libraryRegion.getByRole("button", { name: "Refresh Source Binding" }).click();
    await expect(libraryRegion.getByRole("alert")).toContainText(
      "Reading is unavailable because the Source Plugin is disabled.",
    );
    await expect(libraryRegion.getByRole("button", { name: "Retry refresh" })).toBeVisible();

    const restored = await page.request.post(
      `${LOCAL_CORE_ORIGIN}${SOURCE_PLUGIN_CHANGES_PATH}`,
      { data: sourcePluginChange("restore") },
    );
    expect(restored.status()).toBe(200);
    await page.getByRole("button", { name: "Reload Library" }).click();
    await expect(libraryRegion.getByText("Source Binding refresh required")).toBeVisible();

    await libraryRegion.getByRole("button", { name: "Retry refresh" }).click();
    await expect(libraryRegion.getByText("Source Binding refreshed. Resume reading when ready.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Reader" })).toHaveCount(0);
    await expect(libraryRegion.getByRole("button", { name: "Resume reading" })).toBeVisible();
    await libraryRegion.getByRole("button", { name: "Resume reading" }).click();
    await expect(page.getByRole("region", { name: "Reader" }).getByText("Page 3 of 3")).toBeVisible();
  });

  await page.goto("about:blank");
  await stopApplication();
  await startApplication();
  await page.goto("/");
  await expect(libraryRegion.getByText("Deterministic Adventure", { exact: true })).toBeVisible();
  await expect(libraryRegion.getByText("Available")).toBeVisible();
  await expect(libraryRegion.getByText("Page 3 of 3")).toBeVisible();

  const staleSession = await page.request.get(oldPageUrl as string);
  expect(staleSession.status()).toBe(404);

  const searchRequests = await page.request.get(
    `${LOCAL_CORE_ORIGIN}${CATALOG_SEARCH_PATH}?sourcePluginKey=fixture%3Areader&comicProviderKey=fixture.provider&q=adventure`,
  );
  expect(searchRequests.status()).toBe(200);
});
