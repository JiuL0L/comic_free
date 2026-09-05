import { expect, test } from "@playwright/test";
import type { ChildProcess } from "node:child_process";
import { fork } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { WEB_UI_URL } from "@comic-free/contracts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUTPUT_ROOT = path.resolve(
  ROOT,
  ".local-data/test-output/03-source-plugin-catalog",
);
const RUNTIME_ROOT = path.join(OUTPUT_ROOT, "browser-runtime");
const DATA_DIRECTORY = path.join(RUNTIME_ROOT, "data");
const FIXTURE_PATH = path.join(RUNTIME_ROOT, "catalog.json");

let application: ChildProcess | undefined;
let startupOutput = "";

function assertSafeRuntimePath(): void {
  const relative = path.relative(OUTPUT_ROOT, RUNTIME_ROOT);
  expect(relative).not.toBe("");
  expect(relative.startsWith("..")).toBe(false);
  expect(path.isAbsolute(relative)).toBe(false);
}

async function writeFixture(value: unknown): Promise<void> {
  await writeFile(FIXTURE_PATH, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function startApplication(): Promise<void> {
  startupOutput = "";
  application = fork(path.join(ROOT, "scripts", "start-dev.ts"), [], {
    cwd: ROOT,
    env: {
      ...process.env,
      COMIC_FREE_CATALOG_FIXTURE: FIXTURE_PATH,
      COMIC_FREE_DATA_DIR: DATA_DIRECTORY,
    },
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
  await writeFixture({
    outcome: "failure",
    observedAt: "2026-09-04T12:00:00.000Z",
    reasonCode: "unknown",
    message: "Initial fixture is replaced before refresh.",
  });
  await startApplication();
});

test.afterAll(async () => {
  await stopApplication();
  assertSafeRuntimePath();
  await rm(RUNTIME_ROOT, { recursive: true, force: true });
});

test("retains every Source Plugin state through failure, restart, removal, and recovery", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Comic Free is ready" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Source Plugins" })).toBeVisible();
  await expect(page.getByText("No Source Plugins have been observed yet.")).toBeVisible();

  await writeFixture({
    outcome: "success",
    delayMs: 250,
    observedAt: "2026-09-04T12:05:00.000Z",
    entries: [
      ["fixture:healthy", "Healthy Fixture", "healthy", null],
      ["fixture:disabled", "Disabled Fixture", "disabled", "disabled"],
      ["fixture:missing", "Missing Fixture", "missing", "missing"],
      ["fixture:incompatible", "Incompatible Fixture", "incompatible", "incompatible"],
      [
        "fixture:host",
        "Host Offline Fixture",
        "plugin_host_unavailable",
        "plugin_host_unavailable",
      ],
      [
        "fixture:provider",
        "Provider Offline Fixture",
        "comic_provider_unreachable",
        "comic_provider_unreachable",
      ],
      ["fixture:unknown", "Unknown Fixture", "unknown", "unknown"],
    ].map(([pluginKey, name, status, reasonCode]) => ({
      pluginKey,
      name,
      version: "1.0.0",
      status,
      reasonCode,
      removalEvidence: "none",
      reportedObsolete: false,
    })),
  });

  await page.getByRole("button", { name: "Refresh Source Plugins" }).click();
  await expect(page.getByText("Refreshing catalog…")).toBeVisible();
  for (const label of [
    "Healthy",
    "Disabled",
    "Missing",
    "Incompatible",
    "Plugin Host unavailable",
    "Comic Provider unreachable",
    "Unknown",
  ]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }

  await page.route("**/api/v1/source-plugins/refresh", (route) => route.abort());
  await page.getByRole("button", { name: "Refresh Source Plugins" }).click();
  await expect(page.getByText("Refresh request failed", { exact: true })).toBeVisible();
  await expect(page.getByText("Healthy Fixture")).toBeVisible();
  await page.unroute("**/api/v1/source-plugins/refresh");

  await writeFixture({
    outcome: "failure",
    observedAt: "2026-09-04T12:10:00.000Z",
    reasonCode: "refresh_failed",
    message: "The deterministic catalog refresh failed.",
  });
  await page.getByRole("button", { name: "Refresh Source Plugins" }).click();
  await expect(page.getByText("Refresh failed", { exact: true })).toBeVisible();
  await expect(page.getByText("The deterministic catalog refresh failed.")).toBeVisible();
  await expect(page.getByText("Healthy Fixture")).toBeVisible();

  await stopApplication();
  await startApplication();
  await page.goto("/");
  await expect(page.getByText("Refresh failed", { exact: true })).toBeVisible();
  await expect(page.getByText("Healthy Fixture")).toBeVisible();

  await writeFixture({
    outcome: "success",
    observedAt: "2026-09-04T12:15:00.000Z",
    entries: [
      {
        pluginKey: "fixture:healthy",
        name: "Healthy Fixture",
        version: "1.0.0",
        status: "missing",
        reasonCode: "missing",
        removalEvidence: "confirmed",
        reportedObsolete: true,
      },
    ],
  });
  await page.getByRole("button", { name: "Refresh Source Plugins" }).click();
  await expect(page.getByText("Confirmed removed", { exact: true })).toBeVisible();

  await writeFixture({
    outcome: "success",
    observedAt: "2026-09-04T12:20:00.000Z",
    entries: [
      {
        pluginKey: "fixture:healthy",
        name: "Healthy Fixture",
        version: "1.0.1",
        status: "healthy",
        reasonCode: null,
        removalEvidence: "none",
        reportedObsolete: true,
      },
    ],
  });
  await page.getByRole("button", { name: "Refresh Source Plugins" }).click();
  await expect(page.getByText("Healthy", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Source Bindings require explicit refresh.")).toBeVisible();
});

test("shows pending, successful, failed, and restart-required plugin changes", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Manage a trusted change" })).toBeVisible();
  await page.getByLabel("Extension store URL").fill(
    "https://fixtures.comic-free.invalid/repo/index.pb",
  );
  await page.getByLabel("Package name").fill("fixture:reader");
  await page.getByLabel("Approved version").fill("1.0.0");
  await page.getByLabel(/I approve install/i).check();
  await page.getByRole("button", { name: "Apply approved change" }).click();
  await expect(page.getByText("Applying approved change…")).toBeVisible();
  await expect(page.getByText("Comic Free Fixture Reader was installed.")).toBeVisible();
  await expect(page.getByText("Fixture Provider", { exact: true })).toHaveCount(2);

  await page.reload();
  await expect(page.getByText("Fixture Provider", { exact: true })).toHaveCount(2);
  await page.getByLabel("Extension store URL").fill(
    "https://fixtures.comic-free.invalid/repo/index.pb",
  );
  await page.getByLabel("Package name").fill("fixture:reader");

  await page.getByLabel("Change action").selectOption("update");
  await page.getByLabel("Approved version").fill("1.1.0");
  await page.getByLabel(/I approve update/i).check();
  await page.getByRole("button", { name: "Apply approved change" }).click();
  await expect(page.getByText(/Restart required/i)).toBeVisible();

  await page.getByLabel("Change action").selectOption("disable");
  await page.getByLabel(/I approve disable/i).check();
  await page.getByRole("button", { name: "Apply approved change" }).click();
  await expect(page.getByText("Comic Free Fixture Reader was disabled.")).toBeVisible();
  await expect(page.getByText("Disabled", { exact: true }).last()).toBeVisible();

  await page.getByLabel("Change action").selectOption("restore");
  await page.getByLabel("Approved version").fill("1.1.0");
  await page.getByLabel(/I approve restore/i).check();
  await page.getByRole("button", { name: "Apply approved change" }).click();
  await expect(page.getByText("Comic Free Fixture Reader was restored.")).toBeVisible();

  await page.getByLabel("Package name").fill("missing.secret=must-not-leak");
  await page.getByLabel(/I approve restore/i).check();
  await page.getByRole("button", { name: "Apply approved change" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "The approved Source Plugin was not found",
  );
  await expect(page.getByRole("alert")).not.toContainText("must-not-leak");
});
