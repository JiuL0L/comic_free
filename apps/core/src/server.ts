import { createServer, type ServerResponse } from "node:http";

import {
  CORE_HEALTH_PATH,
  PLUGIN_HOST_STATUS_PATH,
  SOURCE_PLUGIN_CHANGES_PATH,
  SOURCE_PLUGINS_PATH,
  SOURCE_PLUGINS_REFRESH_PATH,
  WEB_UI_ORIGIN,
  createHealthResponse,
  type PluginHostStatusResponse,
} from "@comic-free/contracts";

import type { CatalogAdapter } from "./catalog-adapter.ts";
import type { CatalogStore } from "./catalog-store.ts";
import { writeJson } from "./http-response.ts";
import { createReadingHttpHandler } from "./reading-http.ts";
import type { ReadingService } from "./reading-service.ts";
import { createSourcePluginChangeHttpHandler } from "./source-plugin-change-http.ts";
import type { SourcePluginChangeService } from "./source-plugin-change.ts";
import { createSettingsHttpHandler } from "./settings-http.ts";
import type { SettingsService } from "./settings.ts";

export interface LocalCoreServerOptions {
  adapter: CatalogAdapter;
  catalogStore: CatalogStore;
  pluginHostStatus?: () => PluginHostStatusResponse;
  readingService?: ReadingService;
  settingsService?: SettingsService;
  sourcePluginChangeService?: SourcePluginChangeService;
}

const NOT_CONFIGURED: PluginHostStatusResponse = {
  apiVersion: "v1",
  internalPort: null,
  message: "No approved Suwayomi JAR is configured.",
  retryable: false,
  state: "not_configured",
};

async function refreshCatalog(
  response: ServerResponse,
  adapter: CatalogAdapter,
  catalogStore: CatalogStore,
  readingService?: ReadingService,
  sourcePluginChangeService?: SourcePluginChangeService,
): Promise<void> {
  const execute = async () => {
    try {
      const refresh = await adapter.refresh();
      if (refresh.outcome === "success") {
        catalogStore.recordSuccessfulRefresh(refresh);
      } else {
        catalogStore.recordFailedRefresh(refresh);
      }
      const catalog = catalogStore.readCatalog();
      if (readingService) {
        for (const entry of catalog.entries) {
          if (entry.status !== "healthy" || entry.bindingsRefreshRequired) {
            readingService.invalidateSourcePlugin(entry.pluginKey);
          }
        }
      }
      writeJson(response, 200, catalog);
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
  };
  if (sourcePluginChangeService) {
    await sourcePluginChangeService.runExclusive(execute);
  } else {
    await execute();
  }
}

export function createLocalCoreServer({
  adapter,
  catalogStore,
  pluginHostStatus,
  readingService,
  settingsService,
  sourcePluginChangeService,
}: LocalCoreServerOptions) {
  const handleReading = readingService
    ? createReadingHttpHandler(readingService)
    : null;
  const handleSourcePluginChange = sourcePluginChangeService
    ? createSourcePluginChangeHttpHandler(sourcePluginChangeService)
    : null;
  const handleSettings = settingsService
    ? createSettingsHttpHandler(settingsService)
    : null;

  return createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", WEB_UI_ORIGIN);
    response.setHeader("Vary", "Origin");

    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Max-Age": "600",
      });
      response.end();
      return;
    }

    if (request.method === "GET" && request.url === CORE_HEALTH_PATH) {
      writeJson(response, 200, createHealthResponse());
      return;
    }

    if (request.method === "GET" && request.url === PLUGIN_HOST_STATUS_PATH) {
      writeJson(response, 200, pluginHostStatus?.() ?? NOT_CONFIGURED);
      return;
    }

    if (handleSettings) {
      void handleSettings(request, response).then((handled) => {
        if (!handled) routeRequest(request, response);
      });
      return;
    }

    routeRequest(request, response);
  });

  function routeRequest(request: import("node:http").IncomingMessage, response: ServerResponse): void {

    if (request.method === "GET" && request.url === SOURCE_PLUGINS_PATH) {
      writeJson(response, 200, catalogStore.readCatalog());
      return;
    }

    if (request.method === "POST" && request.url === SOURCE_PLUGINS_REFRESH_PATH) {
      void refreshCatalog(
        response,
        adapter,
        catalogStore,
        readingService,
        sourcePluginChangeService,
      );
      return;
    }

    if (
      handleSourcePluginChange &&
      new URL(request.url ?? "/", "http://127.0.0.1").pathname ===
        SOURCE_PLUGIN_CHANGES_PATH
    ) {
      void handleSourcePluginChange(request, response);
      return;
    }

    if (handleReading) {
      void handleReading(request, response).then((handled) => {
        if (!handled) writeNotFound(response);
      });
      return;
    }

    writeNotFound(response);
  }
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
