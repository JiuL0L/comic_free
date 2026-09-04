import { expect, test } from "@playwright/test";
import {
  CORE_HEALTH_URL,
  LIBRARY_ITEMS_PATH,
  LOCAL_CORE_PORT,
  LOCAL_CORE_ORIGIN,
  WEB_UI_ORIGIN,
  WEB_UI_PORT,
  WEB_UI_URL,
} from "@comic-free/contracts";
import type { ChildProcess } from "node:child_process";
import { fork } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
let application: ChildProcess;
let startupOutput = "";

function waitForStartup(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for startup.\n${startupOutput}`)),
      15_000,
    );

    child.stdout?.on("data", (chunk: Buffer) => {
      startupOutput += chunk.toString("utf8");
      if (startupOutput.includes(`Comic Free is ready: ${WEB_UI_URL}`)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      startupOutput += chunk.toString("utf8");
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(
        new Error(`Application exited before browser readiness (code ${code}).\n${startupOutput}`),
      );
    });
  });
}

async function waitForPortRelease(port: number): Promise<void> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const available = await new Promise<boolean>((resolve) => {
      const probe = createServer();
      probe.once("error", () => resolve(false));
      probe.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
        probe.close(() => resolve(true));
      });
    });

    if (available) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Loopback port ${port} was not released after shutdown.`);
}

test.beforeAll(async () => {
  application = fork(path.join(ROOT, "scripts", "start-dev.ts"), [], {
    cwd: ROOT,
    env: process.env,
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  await waitForStartup(application);
});

test.afterAll(async () => {
  if (application.connected) application.send("shutdown");
  if (application.exitCode === null && application.signalCode === null) {
    await new Promise<void>((resolve) => application.once("exit", () => resolve()));
  }
  await Promise.all([
    waitForPortRelease(LOCAL_CORE_PORT),
    waitForPortRelease(WEB_UI_PORT),
  ]);
});

test("shows starting, ready, failed, and recovered startup states", async ({ page }) => {
  const browserFetches: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "fetch") browserFetches.push(request.url());
  });

  let releaseHealthRequest!: () => void;
  const healthRequestReleased = new Promise<void>((resolve) => {
    releaseHealthRequest = resolve;
  });
  let healthRequestSeen!: () => void;
  const healthRequestStarted = new Promise<void>((resolve) => {
    healthRequestSeen = resolve;
  });

  await page.route(CORE_HEALTH_URL, async (route) => {
    healthRequestSeen();
    await healthRequestReleased;
    await route.continue();
  });

  await page.goto("/");
  await healthRequestStarted;
  await expect(page.getByRole("heading", { name: "Starting Comic Free" })).toBeVisible();

  releaseHealthRequest();
  await expect(page.getByRole("heading", { name: "Comic Free is ready" })).toBeVisible();
  await expect(page.getByText("Local Core · API v1")).toBeVisible();

  await page.unroute(CORE_HEALTH_URL);
  let shouldFail = true;
  await page.route(CORE_HEALTH_URL, async (route) => {
    if (shouldFail) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": WEB_UI_ORIGIN },
        body: JSON.stringify({ error: "fixture unavailable" }),
      });
      return;
    }
    await route.continue();
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Comic Free could not start" })).toBeVisible();
  await expect(page.getByText("Local Core returned HTTP 503.")).toBeVisible();

  shouldFail = false;
  await page.getByRole("button", { name: "Retry Local Core" }).click();
  await expect(page.getByRole("heading", { name: "Comic Free is ready" })).toBeVisible();

  expect(new Set(browserFetches)).toEqual(
    new Set([CORE_HEALTH_URL, `${LOCAL_CORE_ORIGIN}${LIBRARY_ITEMS_PATH}`]),
  );
  expect(startupOutput).toContain(`Comic Free is ready: ${WEB_UI_URL}`);
});
