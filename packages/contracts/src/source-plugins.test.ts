import assert from "node:assert/strict";
import test from "node:test";

import {
  parseErrorResponse,
  parseSourcePluginCatalogResponse,
  parseSourcePluginChangeRequest,
  parseSourcePluginChangeResponse,
} from "./index.ts";

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

test("accepts an explicitly approved, source-specific Source Plugin install", () => {
  const request = parseSourcePluginChangeRequest({
    action: "install",
    approval: { approved: true },
    source: {
      expectedVersion: "1.4.212",
      kind: "extension_store",
      packageName: "eu.kanade.tachiyomi.extension.all.mangadex",
      storeUrl: "https://extensions.example/repo/index.pb",
    },
  });

  assert.equal(request.action, "install");
  assert.equal(request.source.expectedVersion, "1.4.212");
});

test("rejects unapproved downloads and version-ambiguous installs", () => {
  assert.throws(
    () =>
      parseSourcePluginChangeRequest({
        action: "install",
        approval: { approved: false },
        source: {
          expectedVersion: "1.4.212",
          kind: "extension_store",
          packageName: "eu.kanade.tachiyomi.extension.all.mangadex",
          storeUrl: "https://extensions.example/repo/index.pb",
        },
      }),
    /approval/,
  );
  assert.throws(
    () =>
      parseSourcePluginChangeRequest({
        action: "restore",
        approval: { approved: true },
        source: {
          expectedVersion: null,
          kind: "extension_store",
          packageName: "eu.kanade.tachiyomi.extension.all.mangadex",
          storeUrl: "https://extensions.example/repo/index.pb",
        },
      }),
    /expectedVersion/,
  );
});

test("accepts a restart-required change with normalized Comic Providers", () => {
  const response = parseSourcePluginChangeResponse({
    catalog: {
      entries: [
        {
          bindingsRefreshRequired: true,
          name: "MangaDex",
          observedAt: "2026-09-04T12:00:00.000Z",
          pluginKey: "eu.kanade.tachiyomi.extension.all.mangadex",
          reasonCode: null,
          status: "healthy",
          version: "1.4.212",
        },
      ],
      lastRefresh: {
        message: null,
        observedAt: null,
        reasonCode: null,
        status: "never",
      },
    },
    change: {
      action: "update",
      completedAt: "2026-09-04T12:00:00.000Z",
      message: "MangaDex was updated. Restart the Plugin Host to finish.",
      outcome: "restart_required",
      plugin: {
        name: "MangaDex",
        pluginKey: "eu.kanade.tachiyomi.extension.all.mangadex",
        providers: [
          { key: "2499283573021220255", language: "en", name: "MangaDex" },
        ],
        status: "healthy",
        version: "1.4.212",
      },
      source: {
        expectedVersion: "1.4.212",
        kind: "extension_store",
        packageName: "eu.kanade.tachiyomi.extension.all.mangadex",
        storeUrl: "https://extensions.example/repo/index.pb",
      },
    },
  });

  assert.equal(response.change.outcome, "restart_required");
  assert.equal(response.change.plugin.providers[0]?.language, "en");
  assert.equal(response.catalog.lastRefresh.status, "never");
});
