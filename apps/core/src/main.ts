import { createServer } from "node:http";

import {
  CORE_HEALTH_PATH,
  createHealthResponse,
  LOCAL_CORE_HOST,
  LOCAL_CORE_PORT,
  WEB_UI_ORIGIN,
} from "@comic-free/contracts";

const server = createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", WEB_UI_ORIGIN);
  response.setHeader("Vary", "Origin");

  if (request.method === "GET" && request.url === CORE_HEALTH_PATH) {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(createHealthResponse()));
    return;
  }

  response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  response.end(
    JSON.stringify({
      error: {
        code: "route_not_found",
        message: "The requested Local Core route does not exist.",
        retryable: false,
      },
    }),
  );
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Local Core could not start: port ${LOCAL_CORE_PORT} is already in use on ${LOCAL_CORE_HOST}.`,
    );
  } else {
    console.error(`Local Core could not start: ${error.message}`);
  }
  process.exitCode = 1;
});

server.listen({ host: LOCAL_CORE_HOST, port: LOCAL_CORE_PORT, exclusive: true }, () => {
  console.log(`Listening on http://${LOCAL_CORE_HOST}:${LOCAL_CORE_PORT}`);
});

const close = () => server.close(() => process.exit(0));
process.once("SIGINT", close);
process.once("SIGTERM", close);
