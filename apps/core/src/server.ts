import { createServer, type ServerResponse } from "node:http";

import {
  CORE_HEALTH_PATH,
  SOURCE_PLUGINS_PATH,
  SOURCE_PLUGINS_REFRESH_PATH,
  WEB_UI_ORIGIN,
  createHealthResponse,
} from "@comic-free/contracts";

import type { CatalogAdapter } from "./catalog-adapter.ts";
import type { CatalogStore } from "./catalog-store.ts";

export interface LocalCoreServerOptions {
  adapter: CatalogAdapter;
  catalogStore: CatalogStore;
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

async function refreshCatalog(
  response: ServerResponse,
  adapter: CatalogAdapter,
  catalogStore: CatalogStore,
): Promise<void> {
  try {
    const refresh = await adapter.refresh();
    if (refresh.outcome === "success") {
      catalogStore.recordSuccessfulRefresh(refresh);
    } else {
      catalogStore.recordFailedRefresh(refresh);
    }
    writeJson(response, 200, catalogStore.readCatalog());
  } catch {
    const message = "The Source Plugin catalog refresh failed unexpectedly.";
    try {
      catalogStore.recordFailedRefresh({
        observedAt: new Date().toISOString(),
        reasonCode: "unknown",
        message,
      });
    } catch {
      writeJson(response, 500, {
        error: {
          code: "catalog_state_write_failed",
          message: "Comic Free could not record the catalog refresh outcome.",
          retryable: true,
        },
      });
      return;
    }

    writeJson(response, 502, {
      error: {
        code: "source_plugin_refresh_failed",
        message,
        retryable: true,
      },
    });
  }
}

export function createLocalCoreServer({ adapter, catalogStore }: LocalCoreServerOptions) {
  return createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", WEB_UI_ORIGIN);
    response.setHeader("Vary", "Origin");

    if (request.method === "GET" && request.url === CORE_HEALTH_PATH) {
      writeJson(response, 200, createHealthResponse());
      return;
    }

    if (request.method === "GET" && request.url === SOURCE_PLUGINS_PATH) {
      writeJson(response, 200, catalogStore.readCatalog());
      return;
    }

    if (request.method === "POST" && request.url === SOURCE_PLUGINS_REFRESH_PATH) {
      void refreshCatalog(response, adapter, catalogStore);
      return;
    }

    writeNotFound(response);
  });
}

function writeNotFound(response: ServerResponse): void {
  writeJson(response, 404, {
      error: {
        code: "route_not_found",
        message: "The requested Local Core route does not exist.",
        retryable: false,
      },
  });
}
