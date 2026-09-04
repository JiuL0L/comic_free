import assert from "node:assert/strict";
import test from "node:test";

import { parsePluginHostStatusResponse } from "./index.ts";

test("accepts a ready Plugin Host status response", () => {
  const status = parsePluginHostStatusResponse({
    apiVersion: "v1",
    internalPort: 4568,
    message: "Suwayomi is ready.",
    retryable: false,
    state: "ready",
  });

  assert.deepEqual(status, {
    apiVersion: "v1",
    internalPort: 4568,
    message: "Suwayomi is ready.",
    retryable: false,
    state: "ready",
  });
});

test("accepts every distinct Plugin Host lifecycle outcome and rejects unknown states", () => {
  const states = [
    "not_configured",
    "starting",
    "ready",
    "stopping",
    "stopped",
    "invalid_path",
    "port_occupied",
    "startup_timeout",
    "early_exit",
    "unexpected_exit",
    "shutdown_failed",
  ] as const;

  for (const state of states) {
    assert.equal(
      parsePluginHostStatusResponse({
        apiVersion: "v1",
        internalPort: state === "ready" ? 4568 : null,
        message: `Observed ${state}.`,
        retryable: state !== "invalid_path",
        state,
      }).state,
      state,
    );
  }

  assert.throws(
    () =>
      parsePluginHostStatusResponse({
        apiVersion: "v1",
        internalPort: null,
        message: "Unknown lifecycle state.",
        retryable: false,
        state: "running-ish",
      }),
    /state/,
  );
});
