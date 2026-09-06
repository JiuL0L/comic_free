import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { SETTINGS_PATH, parseDailyReaderSettings } from "@comic-free/contracts";

import { SettingsService, SettingsStore, loadEffectiveSettings } from "./settings.ts";

test("persists daily reader setup atomically and marks a changed runtime for restart", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "comic-free-settings-"));
  const store = new SettingsStore(directory);
  const service = new SettingsService(store, {
    approvedSha256: null,
    jarPath: null,
    port: 4568,
    proxyUrl: null,
  });
  try {
    assert.deepEqual(await service.read(), {
      restartRequired: false,
      settings: { approvedSha256: null, jarPath: null, port: 4568, proxyUrl: null },
    });
    const saved = await service.save({
      approvedSha256: "a".repeat(64),
      jarPath: "C:/approved/suwayomi.jar",
      port: 4569,
      proxyUrl: "http://127.0.0.1:7897",
    });
    assert.equal(saved.restartRequired, true);
    assert.deepEqual(
      parseDailyReaderSettings(JSON.parse(await readFile(path.join(directory, "settings.json"), "utf8"))),
      saved.settings,
    );
    const reopened = new SettingsService(new SettingsStore(directory), saved.settings);
    assert.deepEqual(await reopened.read(), { restartRequired: false, settings: saved.settings });
    assert.equal(SETTINGS_PATH, "/api/v1/settings");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("concurrent setup saves use independent temporary files and leave readable settings", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "comic-free-settings-concurrent-"));
  const store = new SettingsStore(directory);
  try {
    await Promise.all([
      store.write({ approvedSha256: null, jarPath: null, port: 4569, proxyUrl: null }),
      store.write({ approvedSha256: null, jarPath: null, port: 4570, proxyUrl: null }),
    ]);
    const reopened = await new SettingsStore(directory).read();
    assert([4569, 4570].includes(reopened.port));
    assert.deepEqual((await readdir(directory)).filter((name) => name.startsWith(".settings-")), []);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("invalid environment overrides still fail instead of masking a saved-settings recovery", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "comic-free-settings-environment-"));
  try {
    await assert.rejects(
      loadEffectiveSettings(directory, { COMIC_FREE_SUWAYOMI_PORT: "not-a-port" }),
      /COMIC_FREE_SUWAYOMI_PORT/,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
