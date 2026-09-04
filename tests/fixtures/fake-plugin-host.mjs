import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const port = Number.parseInt(process.env.FAKE_PLUGIN_HOST_PORT ?? "", 10);
const runtimeRoot = process.env.FAKE_PLUGIN_HOST_RUNTIME_ROOT;
const mode = process.env.FAKE_PLUGIN_HOST_MODE ?? "ready";
const shutdownToken = process.env.FAKE_PLUGIN_HOST_SHUTDOWN_TOKEN;

if (!Number.isInteger(port) || !runtimeRoot || !shutdownToken) process.exit(64);
if (mode === "early-exit") process.exit(23);

const server = createServer((request, response) => {
  if (
    request.method === "POST" &&
    request.url === "/comic-free/shutdown" &&
    request.headers.authorization === `Bearer ${shutdownToken}`
  ) {
    if (mode === "shutdown-failure") {
      response.writeHead(503).end();
      setTimeout(() => process.exit(43), 500);
      return;
    }
    response.writeHead(202).end();
    setTimeout(async () => {
      await writeFile(path.join(runtimeRoot, "shutdown-hook-ran"), "yes", "utf8");
      server.close(() => process.exit(0));
      server.closeAllConnections();
    }, 25);
    return;
  }
  if (request.method === "POST" && request.url === "/api/graphql") {
    if (mode === "timeout") {
      response.writeHead(503, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ errors: [{ message: "not ready" }] }));
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ data: { __typename: "Query" } }));
    return;
  }
  response.writeHead(404).end();
});

if (
  mode === "ready" ||
  mode === "timeout" ||
  mode === "unexpected-exit" ||
  mode === "shutdown-failure"
) {
  server.listen(port, "127.0.0.1", () => {
    console.log("fake Plugin Host ready");
    console.error("Authorization: Bearer should-not-be-logged");
    console.error("Cookie: session=should-not-be-logged");
    if (mode === "unexpected-exit") setTimeout(() => process.exit(42), 250);
  });
}

setInterval(() => undefined, 1_000);
