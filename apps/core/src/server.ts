import { createServer, type Server, type ServerResponse } from "node:http";

import {
  CORE_HEALTH_PATH,
  createHealthResponse,
  PLUGIN_HOST_STATUS_PATH,
  type PluginHostStatusResponse,
  WEB_UI_ORIGIN,
} from "@comic-free/contracts";

interface LocalCoreServerOptions {
  pluginHostStatus?: () => PluginHostStatusResponse;
}

const NOT_CONFIGURED: PluginHostStatusResponse = {
  apiVersion: "v1",
  internalPort: null,
  message: "No approved Suwayomi JAR is configured.",
  retryable: false,
  state: "not_configured",
};

export function createLocalCoreServer(options: LocalCoreServerOptions = {}): Server {
  return createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", WEB_UI_ORIGIN);
    response.setHeader("Vary", "Origin");

    if (request.method === "GET" && request.url === CORE_HEALTH_PATH) {
      writeJson(response, 200, createHealthResponse());
      return;
    }

    if (request.method === "GET" && request.url === PLUGIN_HOST_STATUS_PATH) {
      writeJson(response, 200, options.pluginHostStatus?.() ?? NOT_CONFIGURED);
      return;
    }

    writeJson(response, 404, {
      error: {
        code: "route_not_found",
        message: "The requested Local Core route does not exist.",
        retryable: false,
      },
    });
  });
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
