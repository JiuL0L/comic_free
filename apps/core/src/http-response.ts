import type { ServerResponse } from "node:http";

export function writeJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  response.writeHead(status, {
    "Content-Length": bytes.length,
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(bytes);
}
