import assert from "node:assert/strict";
import test from "node:test";

import {
  parseSettingsResponse,
  parseSettingsUpdateRequest,
} from "./index.ts";

test("accepts the daily reader setup response", () => {
  const response = parseSettingsResponse({
    restartRequired: false,
    settings: {
      approvedSha256: null,
      jarPath: null,
      port: 4568,
      proxyUrl: "http://127.0.0.1:7897",
    },
    warning: "Saved settings require recovery.",
  });

  assert.equal(response.settings.port, 4568);
  assert.equal(response.settings.proxyUrl, "http://127.0.0.1:7897");
  assert.equal(response.warning, "Saved settings require recovery.");
});

test("requires an explicit JAR and approved SHA-256 pair", () => {
  assert.throws(
    () => parseSettingsUpdateRequest({
      approvedSha256: null,
      jarPath: "C:/approved/suwayomi.jar",
      port: 4568,
      proxyUrl: null,
    }),
    /both jarPath and approvedSha256/i,
  );
  assert.throws(
    () => parseSettingsUpdateRequest({
      approvedSha256: "f".repeat(64),
      jarPath: null,
      port: 4568,
      proxyUrl: null,
    }),
    /both jarPath and approvedSha256/i,
  );
});

test("rejects credential-bearing proxies and non-local Plugin Host ports", () => {
  assert.throws(
    () => parseSettingsUpdateRequest({
      approvedSha256: null,
      jarPath: null,
      port: 80,
      proxyUrl: "http://user:password@127.0.0.1:7897",
    }),
    /credentials|1024/i,
  );
});
