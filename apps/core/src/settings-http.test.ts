import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { SETTINGS_PATH, parseSettingsResponse } from "@comic-free/contracts";

import { FixtureCatalogAdapter } from "./catalog-adapter.ts";
import { CatalogStore } from "./catalog-store.ts";
import { createLocalCoreServer } from "./server.ts";
import { SettingsService, SettingsStore, loadEffectiveSettings } from "./settings.ts";

test("daily reader settings are JSON-only and reject cross-origin writes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "comic-free-settings-http-"));
  await writeFile(path.join(directory, "settings.json"), "{ damaged", "utf8");
  const catalogStore = new CatalogStore(path.join(directory, "comic-free.sqlite"));
  const loaded = await loadEffectiveSettings(directory, {});
  const settingsService = new SettingsService(new SettingsStore(directory), loaded.effectiveSettings);
  const server = createLocalCoreServer({ adapter: new FixtureCatalogAdapter(), catalogStore, settingsService });
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    assert(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}${SETTINGS_PATH}`;
    const recovered = parseSettingsResponse(await (await fetch(url)).json());
    assert.deepEqual(recovered.settings, { approvedSha256: null, jarPath: null, port: 4568, proxyUrl: null });
    assert.match(recovered.warning ?? "", /safe defaults/i);
    assert.equal((await fetch(url, { method: "PUT", body: "{}", headers: { "content-type": "text/plain" } })).status, 415);
    assert.equal((await fetch(url, { method: "PUT", body: "{}", headers: { "content-type": "application/json", origin: "https://example.invalid" } })).status, 403);
    const invalidPair = await fetch(url, {
      method: "PUT",
      body: JSON.stringify({ approvedSha256: null, jarPath: "C:/approved/suwayomi.jar", port: 4568, proxyUrl: null }),
      headers: { "content-type": "application/json" },
    });
    assert.equal(invalidPair.status, 400);
    const saved = await fetch(url, { method: "PUT", body: JSON.stringify({ approvedSha256: null, jarPath: null, port: 4569, proxyUrl: null }), headers: { "content-type": "application/json" } });
    assert.equal(saved.status, 200);
    const savedResponse = parseSettingsResponse(await saved.json());
    assert.equal(savedResponse.restartRequired, true);
    assert.equal(savedResponse.warning, undefined);
    assert.equal(
      parseSettingsResponse(await (await fetch(url)).json()).warning,
      undefined,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    catalogStore.close();
    await rm(directory, { force: true, recursive: true });
  }
});
