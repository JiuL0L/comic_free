import type { IncomingMessage, ServerResponse } from "node:http";

import {
  SETTINGS_PATH,
  WEB_UI_ORIGIN,
  WEB_UI_PORT,
  parseSettingsUpdateRequest,
  type ErrorResponse,
} from "@comic-free/contracts";

import { writeJson } from "./http-response.ts";
import type { SettingsService } from "./settings.ts";

const MAX_JSON_BYTES = 16 * 1024;

class SettingsHttpError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

export function createSettingsHttpHandler(service: SettingsService) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname !== SETTINGS_PATH) return false;
    if (request.method === "GET") {
      try {
        writeJson(response, 200, await service.read());
      } catch (error) {
        writeError(response, normalizeError(error));
      }
      return true;
    }
    if (request.method !== "PUT") {
      response.setHeader("Allow", "GET, PUT");
      writeError(response, new SettingsHttpError("method_not_allowed", "This route accepts GET and PUT only.", 405));
      return true;
    }
    try {
      assertTrustedOrigin(request);
      const settings = parseSettingsUpdateRequest(await readJson(request));
      writeJson(response, 200, await service.save(settings));
    } catch (error) {
      writeError(response, normalizeError(error));
    }
    return true;
  };
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new SettingsHttpError("unsupported_media_type", "This endpoint accepts application/json requests only.", 415);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > MAX_JSON_BYTES) {
      throw new SettingsHttpError("request_too_large", "The JSON request exceeds the 16 KiB limit.", 413);
    }
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new SettingsHttpError("invalid_request", "The request body is not valid JSON.", 400);
  }
}

function assertTrustedOrigin(request: IncomingMessage): void {
  const origin = request.headers.origin;
  if (origin === undefined) return;
  if (origin === WEB_UI_ORIGIN || origin === `http://localhost:${WEB_UI_PORT}`) return;
  throw new SettingsHttpError("cross_origin_forbidden", "Daily reader settings may only be changed from the local Comic Free WebUI.", 403);
}

function normalizeError(error: unknown): SettingsHttpError {
  if (error instanceof SettingsHttpError) return error;
  if (error instanceof TypeError) return new SettingsHttpError("invalid_settings", error.message, 400);
  return new SettingsHttpError("settings_write_failed", "The Local Core could not save daily reader settings.", 500);
}

function writeError(response: ServerResponse, error: SettingsHttpError): void {
  const body: ErrorResponse = {
    error: { code: error.code, message: error.message, retryable: error.status >= 500 },
  };
  writeJson(response, error.status, body);
}
