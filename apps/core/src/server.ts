import { createServer } from "node:http";

import {
  CORE_HEALTH_PATH,
  WEB_UI_ORIGIN,
  createHealthResponse,
} from "@comic-free/contracts";

import { writeJson } from "./http-response.ts";
import { createReadingHttpHandler } from "./reading-http.ts";
import type { ReadingService } from "./reading-service.ts";

export interface LocalCoreServerOptions {
  readingService: ReadingService;
}

export function createLocalCoreServer({ readingService }: LocalCoreServerOptions) {
  const handleReading = createReadingHttpHandler(readingService);
  return createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", WEB_UI_ORIGIN);
    response.setHeader("Vary", "Origin");

    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
        "Access-Control-Max-Age": "600",
      });
      response.end();
      return;
    }

    if (request.method === "GET" && request.url === CORE_HEALTH_PATH) {
      writeJson(response, 200, createHealthResponse());
      return;
    }

    void handleReading(request, response).then((handled) => {
      if (!handled) {
        writeJson(response, 404, {
          error: {
            code: "route_not_found",
            message: "The requested Local Core route does not exist.",
            retryable: false,
          },
        });
      }
    });
  });
}
