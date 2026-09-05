import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import type {
  PluginHostStatusResponse,
  SourcePluginChangeRequest,
} from "@comic-free/contracts";

import { SourcePluginChangeAdapterError } from "./source-plugin-change.ts";
import { SuwayomiSourcePluginChangeAdapter } from "./suwayomi-source-plugin-change.ts";

const PACKAGE_NAME = "eu.kanade.tachiyomi.extension.all.mangadex";
const STORE_URL = "https://extensions.example/repo/index.pb";

function request(
  action: SourcePluginChangeRequest["action"],
  expectedVersion: string | null,
): SourcePluginChangeRequest {
  return {
    action,
    approval: { approved: true },
    source: {
      expectedVersion,
      kind: "extension_store",
      packageName: PACKAGE_NAME,
      storeUrl: STORE_URL,
    },
  };
}

test("translates all approved Source Plugin changes through Suwayomi GraphQL", async () => {
  const patches: Array<Record<string, boolean>> = [];
  let requestCount = 0;
  let installedState = false;
  let providersAvailable = true;
  const server = createServer(async (incoming, response) => {
    requestCount += 1;
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      query: string;
      variables: Record<string, unknown>;
    };
    let data: Record<string, unknown>;
    if (body.query.includes("ComicFreeExtensionStores")) {
      data = { extensionStores: { nodes: [], totalCount: 0 } };
    } else if (body.query.includes("ComicFreeAddExtensionStore")) {
      data = {
        addExtensionStore: {
          extensionStore: { indexUrl: STORE_URL, name: "Fixture Store" },
        },
      };
    } else if (body.query.includes("ComicFreeFetchExtensions")) {
      data = {
        fetchExtensions: {
          extensionStores: [{ indexUrl: STORE_URL, name: "Fixture Store" }],
          extensions: [
            {
              hasUpdate: true,
              isInstalled: installedState,
              isObsolete: false,
              name: "MangaDex",
              pkgName: PACKAGE_NAME,
              source: {
                nodes: installedState && providersAvailable
                  ? [{ id: "2499283573021220255", lang: "en", name: "MangaDex" }]
                  : [],
                totalCount: installedState && providersAvailable ? 1 : 0,
              },
              storeIndexUrl: STORE_URL,
              versionName: "1.4.212",
            },
          ],
        },
      };
    } else if (body.query.includes("ComicFreeUpdateExtension")) {
      const input = body.variables.input as {
        patch: Record<string, boolean>;
      };
      patches.push(input.patch);
      if (input.patch.install === true) installedState = true;
      if (input.patch.uninstall === true) installedState = false;
      const isInstalled = installedState;
      data = {
        updateExtension: {
          extension: {
            hasUpdate: false,
            isInstalled,
            isObsolete: false,
            name: "MangaDex",
            pkgName: PACKAGE_NAME,
            source: {
              nodes: isInstalled && providersAvailable
                ? [{ id: "2499283573021220255", lang: "en", name: "MangaDex" }]
                : [],
              totalCount: isInstalled && providersAvailable ? 1 : 0,
            },
            storeIndexUrl: STORE_URL,
            versionName: "1.4.212",
          },
        },
      };
    } else {
      response.writeHead(400).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data }));
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert(address && typeof address === "object");
    const status = (): PluginHostStatusResponse => ({
      apiVersion: "v1",
      internalPort: address.port,
      message: "Ready.",
      retryable: false,
      state: "ready",
    });
    const adapter = new SuwayomiSourcePluginChangeAdapter(status);

    const installed = await adapter.change(
      request("install", "1.4.212"),
      AbortSignal.timeout(1_000),
    );
    assert.equal(installed.providers[0]?.key, "2499283573021220255");
    await adapter.change(request("update", "1.4.212"), AbortSignal.timeout(1_000));
    const requestsBeforeDisable = requestCount;
    const disabled = await adapter.change(
      request("disable", null),
      AbortSignal.timeout(1_000),
      {
        bindingsRefreshRequired: false,
        name: installed.name,
        observedAt: "2026-09-04T12:00:00.000Z",
        pluginKey: installed.pluginKey,
        providers: installed.providers,
        reasonCode: null,
        status: "healthy",
        version: installed.version,
      },
    );
    assert.equal(disabled.status, "disabled");
    assert.equal(disabled.providers[0]?.name, "MangaDex");
    assert.equal(installedState, true);
    assert.equal(requestCount, requestsBeforeDisable);
    const restored = await adapter.change(
      request("restore", "1.4.212"),
      AbortSignal.timeout(1_000),
    );
    assert.equal(restored.providers[0]?.name, "MangaDex");
    providersAvailable = false;
    await assert.rejects(
      adapter.change(request("update", "1.4.212"), AbortSignal.timeout(1_000)),
      (error: unknown) =>
        error instanceof SourcePluginChangeAdapterError &&
        error.code === "source_plugin_has_no_providers",
    );

    assert.deepEqual(patches, [
      { install: true },
      { update: true },
      { update: true },
    ]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("rejects a version mismatch before Suwayomi executes third-party code", async () => {
  let mutations = 0;
  const server = createServer(async (incoming, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      query: string;
    };
    if (body.query.includes("ComicFreeUpdateExtension")) mutations += 1;
    const data = body.query.includes("ComicFreeExtensionStores")
      ? { extensionStores: { nodes: [{ indexUrl: STORE_URL }], totalCount: 1 } }
      : {
          fetchExtensions: {
            extensionStores: [{ indexUrl: STORE_URL }],
            extensions: [
              {
                hasUpdate: true,
                isInstalled: false,
                isObsolete: false,
                name: "MangaDex",
                pkgName: PACKAGE_NAME,
                storeIndexUrl: STORE_URL,
                versionName: "1.4.213",
              },
            ],
          },
        };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data }));
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert(address && typeof address === "object");
    const adapter = new SuwayomiSourcePluginChangeAdapter(() => ({
      apiVersion: "v1",
      internalPort: address.port,
      message: "Ready.",
      retryable: false,
      state: "ready",
    }));

    await assert.rejects(
      adapter.change(request("install", "1.4.212"), AbortSignal.timeout(1_000)),
      (error: unknown) =>
        error instanceof SourcePluginChangeAdapterError &&
        error.code === "source_plugin_version_mismatch",
    );
    assert.equal(mutations, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("stops reading a chunked Plugin Host response after the 1 MiB limit", async () => {
  const server = createServer((_incoming, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.write("x".repeat(700_000));
    response.end("x".repeat(400_000));
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert(address && typeof address === "object");
    const adapter = new SuwayomiSourcePluginChangeAdapter(() => ({
      apiVersion: "v1",
      internalPort: address.port,
      message: "Ready.",
      retryable: false,
      state: "ready",
    }));

    await assert.rejects(
      adapter.change(request("install", "1.4.212"), AbortSignal.timeout(1_000)),
      (error: unknown) =>
        error instanceof SourcePluginChangeAdapterError &&
        error.code === "plugin_host_response_too_large",
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
