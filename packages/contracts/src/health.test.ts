import assert from "node:assert/strict";
import test from "node:test";

import { parseHealthResponse } from "./index.ts";

test("accepts the versioned Local Core health response", () => {
  const health = parseHealthResponse({
    apiVersion: "v1",
    service: "comic-free-local-core",
    status: "ready",
  });

  assert.deepEqual(health, {
    apiVersion: "v1",
    service: "comic-free-local-core",
    status: "ready",
  });
});

test("rejects an unsupported health contract version", () => {
  assert.throws(
    () =>
      parseHealthResponse({
        apiVersion: "v2",
        service: "comic-free-local-core",
        status: "ready",
      }),
    /apiVersion/,
  );
});

test("rejects an incomplete health response", () => {
  assert.throws(
    () => parseHealthResponse({ apiVersion: "v1", status: "ready" }),
    /service/,
  );
});
