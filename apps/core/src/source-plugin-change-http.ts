import type { IncomingMessage, ServerResponse } from "node:http";

import {
  SOURCE_PLUGIN_CHANGES_PATH,
  parseSourcePluginChangeRequest,
  type ErrorResponse,
} from "@comic-free/contracts";

import { writeJson } from "./http-response.ts";
import {
  SourcePluginChangeError,
  type SourcePluginChangeService,
} from "./source-plugin-change.ts";

const MAX_JSON_BYTES = 64 * 1024;

async function readJson(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new SourcePluginChangeError(
      "unsupported_media_type",
      "This endpoint accepts application/json requests only.",
      false,
      415,
    );
  }
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bytes.length;
    if (totalBytes > MAX_JSON_BYTES) {
      throw new SourcePluginChangeError(
        "request_too_large",
        "The JSON request exceeds the 64 KiB limit.",
        false,
        413,
      );
    }
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new SourcePluginChangeError(
      "invalid_request",
      "The request body is not valid JSON.",
      false,
      400,
    );
  }
}

function normalizeError(error: unknown): SourcePluginChangeError {
  if (error instanceof SourcePluginChangeError) return error;
  if (error instanceof TypeError) {
    return new SourcePluginChangeError("invalid_request", error.message, false, 400);
  }
  return new SourcePluginChangeError(
    "source_plugin_change_failed",
    "The Local Core could not complete the Source Plugin change.",
    true,
    500,
  );
}

function writeError(response: ServerResponse, error: SourcePluginChangeError): void {
  const body: ErrorResponse = {
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    },
  };
  writeJson(response, error.status, body);
}

export function createSourcePluginChangeHttpHandler(service: SourcePluginChangeService) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname !== SOURCE_PLUGIN_CHANGES_PATH) return false;
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      writeError(
        response,
        new SourcePluginChangeError(
          "method_not_allowed",
          "This route accepts POST only.",
          false,
          405,
        ),
      );
      return true;
    }

    try {
      const input = parseSourcePluginChangeRequest(await readJson(request));
      writeJson(response, 200, await service.change(input));
    } catch (error) {
      writeError(response, normalizeError(error));
    }
    return true;
  };
}
