import assert from "node:assert/strict";
import test from "node:test";

import { parseErrorResponse, parseSourcePluginCatalogResponse } from "./index.ts";

test("accepts the shared Local Core error envelope", () => {
  const response = parseErrorResponse({
    error: {
      code: "catalog_refresh_failed",
      message: "Source Plugin refresh failed.",
      retryable: true,
      context: { status: 502 },
    },
  });

  assert.equal(response.error.message, "Source Plugin refresh failed.");
  assert.equal(response.error.retryable, true);
  assert.deepEqual(response.error.context, { status: 502 });
});

test("rejects incomplete Local Core error envelopes", () => {
  assert.throws(
    () =>
      parseErrorResponse({
        error: {
          code: "catalog_refresh_failed",
          message: "Source Plugin refresh failed.",
        },
      }),
    /retryable/,
  );
});

test("accepts a retained Source Plugin catalog with a separate refresh outcome", () => {
  const catalog = parseSourcePluginCatalogResponse({
    entries: [
      {
        pluginKey: "fixture:reader",
        name: "Fixture Reader",
        version: "1.0.0",
        status: "healthy",
        reasonCode: null,
        observedAt: "2026-09-04T12:00:00.000Z",
        bindingsRefreshRequired: false,
      },
    ],
    lastRefresh: {
      status: "failed",
      observedAt: "2026-09-04T12:05:00.000Z",
      reasonCode: "refresh_failed",
      message: "The fixture catalog could not be read.",
    },
  });

  assert.equal(catalog.entries[0]?.name, "Fixture Reader");
  assert.equal(catalog.lastRefresh.status, "failed");
  assert.equal(catalog.lastRefresh.reasonCode, "refresh_failed");
});

test("rejects unknown Source Plugin availability states", () => {
  assert.throws(
    () =>
      parseSourcePluginCatalogResponse({
        entries: [
          {
            pluginKey: "fixture:reader",
            name: "Fixture Reader",
            version: null,
            status: "obsolete",
            reasonCode: null,
            observedAt: "2026-09-04T12:00:00.000Z",
            bindingsRefreshRequired: false,
          },
        ],
        lastRefresh: {
          status: "healthy",
          observedAt: "2026-09-04T12:00:00.000Z",
          reasonCode: null,
          message: null,
        },
      }),
    /status/,
  );
});
