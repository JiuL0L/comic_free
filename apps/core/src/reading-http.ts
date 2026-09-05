import type { IncomingMessage, ServerResponse } from "node:http";

import {
  CATALOG_SEARCH_PATH,
  LIBRARY_ITEMS_PATH,
  READING_SOURCE_PLUGIN_PATH,
  READING_PROVIDERS_PATH,
  parseReadingProvidersResponse,
  parseReadingProviderSelection,
  READER_SESSIONS_PATH,
  SOURCE_BINDING_REASON_CODES,
  parseCreateReaderSessionRequest,
  parseLibraryItemId,
  parseRefreshSourceBindingRequest,
  parseRetainLibraryItemRequest,
  parseUpdateProgressRequest,
  type ApiErrorResponse,
  type SourceBindingReasonCode,
} from "@comic-free/contracts";

import { writeJson } from "./http-response.ts";
import {
  ReadingServiceError,
  normalizeReadingError,
  type ReadingService,
} from "./reading-service.ts";

const MAX_JSON_BYTES = 64 * 1024;
function writeError(response: ServerResponse, error: ReadingServiceError): void {
  const body: ApiErrorResponse = {
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    },
  };
  writeJson(response, error.status, body);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new ReadingServiceError(
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
      throw new ReadingServiceError(
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
    throw new ReadingServiceError(
      "invalid_request",
      "The request body is not valid JSON.",
      false,
      400,
    );
  }
}

function invalidRequest(error: unknown): ReadingServiceError {
  if (error instanceof ReadingServiceError) return error;
  if (error instanceof TypeError || error instanceof URIError) {
    return new ReadingServiceError("invalid_request", error.message, false, 400);
  }
  return normalizeReadingError(error);
}

function methodNotAllowed(response: ServerResponse, allowed: string): void {
  response.setHeader("Allow", allowed);
  writeError(
    response,
    new ReadingServiceError(
      "method_not_allowed",
      `This route accepts ${allowed} only.`,
      false,
      405,
    ),
  );
}

function requireQuery(value: string | null, field: string): string {
  if (!value || value.trim() === "") {
    throw new TypeError(`Invalid ${field}: expected a non-empty query value.`);
  }
  return value;
}

function requireNoQuery(requestUrl: URL): void {
  if ([...requestUrl.searchParams.keys()].length > 0) {
    throw new TypeError("Invalid delete Library Item request: query parameters are not allowed.");
  }
}

function requireEmptyBody(request: IncomingMessage): void {
  const contentLength = request.headers["content-length"];
  if (
    request.headers["transfer-encoding"] !== undefined ||
    (contentLength !== undefined && contentLength !== "0")
  ) {
    throw new TypeError("Invalid delete Library Item request: a request body is not allowed.");
  }
}

function parseUnavailableRequest(value: unknown): SourceBindingReasonCode {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Invalid unavailable request: expected a JSON object.");
  }
  const request = value as Record<string, unknown>;
  const unexpected = Object.keys(request).find((key) => key !== "reasonCode");
  if (unexpected) {
    throw new TypeError(`Invalid unavailable request: unexpected field "${unexpected}".`);
  }
  if (
    typeof request.reasonCode !== "string" ||
    !SOURCE_BINDING_REASON_CODES.includes(request.reasonCode as SourceBindingReasonCode)
  ) {
    throw new TypeError("Invalid reasonCode: unsupported Source Binding reason.");
  }
  return request.reasonCode as SourceBindingReasonCode;
}

export function createReadingHttpHandler(service: ReadingService) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const { pathname } = requestUrl;
    const detailsMatch = pathname.match(/^\/api\/v1\/catalog\/comics\/([^/]+)$/);
    const chaptersMatch = pathname.match(
      /^\/api\/v1\/catalog\/comics\/([^/]+)\/chapters$/,
    );
    const pageMatch = pathname.match(
      /^\/api\/v1\/reader-sessions\/([^/]+)\/pages\/([^/]+)$/,
    );
    const progressMatch = pathname.match(
      /^\/api\/v1\/library-items\/([^/]+)\/progress$/,
    );
    const deleteMatch = pathname.match(/^\/api\/v1\/library-items\/([^/]+)$/);
    const unavailableMatch = pathname.match(
      /^\/api\/v1\/fixture\/source-bindings\/([^/]+)\/unavailable$/,
    );
    const refreshMatch = pathname.match(/^\/api\/v1\/source-bindings\/([^/]+)\/refresh$/);
    const known =
      pathname === CATALOG_SEARCH_PATH ||
      (pathname === READING_SOURCE_PLUGIN_PATH || pathname === READING_PROVIDERS_PATH) ||
      pathname === READER_SESSIONS_PATH ||
      pathname === LIBRARY_ITEMS_PATH ||
      Boolean(detailsMatch || chaptersMatch || pageMatch || progressMatch || unavailableMatch || refreshMatch || deleteMatch);
    if (!known) return false;

    try {
      if ((pathname === READING_SOURCE_PLUGIN_PATH || pathname === READING_PROVIDERS_PATH)) {
        if (request.method !== "GET") {
          methodNotAllowed(response, "GET");
          return true;
        }
        writeJson(response, 200, pathname === READING_PROVIDERS_PATH ? parseReadingProvidersResponse(await service.getProviders()) : service.getSourcePlugin());
        return true;
      }

      if (pathname === CATALOG_SEARCH_PATH) {
        if (request.method !== "GET") {
          methodNotAllowed(response, "GET");
          return true;
        }
        const sourcePluginKey = requireQuery(
          requestUrl.searchParams.get("sourcePluginKey"),
          "sourcePluginKey",
        );
        for (const key of requestUrl.searchParams.keys()) {
          if (!["sourcePluginKey", "comicProviderKey", "q"].includes(key) || requestUrl.searchParams.getAll(key).length !== 1) throw new TypeError("Invalid catalog search query parameters.");
        }
        const selection = parseReadingProviderSelection({sourcePluginKey, ...(requestUrl.searchParams.has("comicProviderKey") ? {comicProviderKey: requestUrl.searchParams.get("comicProviderKey")} : {})});
        const query = requireQuery(requestUrl.searchParams.get("q"), "q");
        writeJson(response, 200, { items: await service.search(selection.sourcePluginKey, query, selection.comicProviderKey) });
        return true;
      }

      if (chaptersMatch) {
        if (request.method !== "GET") {
          methodNotAllowed(response, "GET");
          return true;
        }
        const comicKey = decodeURIComponent(chaptersMatch[1] as string);
        const sourcePluginKey = requireQuery(
          requestUrl.searchParams.get("sourcePluginKey"),
          "sourcePluginKey",
        );
        writeJson(response, 200, {
          items: await service.getChapters(sourcePluginKey, comicKey),
        });
        return true;
      }

      if (detailsMatch) {
        if (request.method !== "GET") {
          methodNotAllowed(response, "GET");
          return true;
        }
        const comicKey = decodeURIComponent(detailsMatch[1] as string);
        const sourcePluginKey = requireQuery(
          requestUrl.searchParams.get("sourcePluginKey"),
          "sourcePluginKey",
        );
        writeJson(response, 200, {
          comic: await service.getDetails(sourcePluginKey, comicKey),
        });
        return true;
      }

      if (pathname === READER_SESSIONS_PATH) {
        if (request.method !== "POST") {
          methodNotAllowed(response, "POST");
          return true;
        }
        const input = parseCreateReaderSessionRequest(await readJson(request));
        writeJson(response, 201, await service.createSession(input));
        return true;
      }

      if (pageMatch) {
        if (request.method !== "GET") {
          methodNotAllowed(response, "GET");
          return true;
        }
        const pageIndex = Number(pageMatch[2]);
        const page = await service.readPage(
          decodeURIComponent(pageMatch[1] as string),
          pageIndex,
        );
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Length": page.bytes.length,
          "Content-Type": page.contentType,
          "X-Content-Type-Options": "nosniff",
        });
        response.end(page.bytes);
        return true;
      }

      if (pathname === LIBRARY_ITEMS_PATH) {
        if (request.method === "GET") {
          writeJson(response, 200, { items: service.listLibrary() });
          return true;
        }
        if (request.method === "POST") {
          const input = parseRetainLibraryItemRequest(await readJson(request));
          writeJson(response, 201, { item: service.retain(input) });
          return true;
        }
        methodNotAllowed(response, "GET, POST");
        return true;
      }

      if (deleteMatch) {
        if (request.method !== "DELETE") {
          methodNotAllowed(response, "DELETE");
          return true;
        }
        requireNoQuery(requestUrl);
        requireEmptyBody(request);
        const libraryItemId = parseLibraryItemId(decodeURIComponent(deleteMatch[1] as string));
        service.deleteLibraryItem(libraryItemId);
        writeJson(response, 200, { deletedId: libraryItemId });
        return true;
      }

      if (progressMatch) {
        if (request.method !== "PUT") {
          methodNotAllowed(response, "PUT");
          return true;
        }
        const input = parseUpdateProgressRequest(await readJson(request));
        writeJson(response, 200, {
          item: service.updateProgress(
            decodeURIComponent(progressMatch[1] as string),
            input,
          ),
        });
        return true;
      }

      if (refreshMatch) {
        if (request.method !== "POST") {
          methodNotAllowed(response, "POST");
          return true;
        }
        parseRefreshSourceBindingRequest(await readJson(request));
        writeJson(response, 200, { item: await service.refreshBinding(decodeURIComponent(refreshMatch[1] as string)) });
        return true;
      }

      if (unavailableMatch) {
        if (request.method !== "POST") {
          methodNotAllowed(response, "POST");
          return true;
        }
        const reasonCode = parseUnavailableRequest(await readJson(request));
        writeJson(response, 200, {
          item: service.markBindingUnavailable(
            decodeURIComponent(unavailableMatch[1] as string),
            reasonCode,
          ),
        });
        return true;
      }
    } catch (error) {
      writeError(response, invalidRequest(error));
      return true;
    }

    return false;
  };
}
