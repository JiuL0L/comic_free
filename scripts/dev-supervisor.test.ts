import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import test from "node:test";

import { ensurePortAvailable, waitForHttpReady } from "./dev-supervisor.ts";

async function listenOnRandomPort(): Promise<{
  close: () => Promise<void>;
  port: number;
}> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert(address && typeof address === "object");

  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

test("reports an occupied loopback port with an actionable message", async () => {
  const listener = await listenOnRandomPort();

  try {
    await assert.rejects(
      ensurePortAvailable("Local Core", "127.0.0.1", listener.port),
      new RegExp(`Local Core port ${listener.port} is already in use`),
    );
  } finally {
    await listener.close();
  }
});

test("reports a Local Core that exits before readiness", async () => {
  const child = spawn(process.execPath, ["-e", "process.exit(23)"], {
    stdio: "ignore",
    windowsHide: true,
  });

  await assert.rejects(
    waitForHttpReady({
      child,
      name: "Local Core",
      timeoutMs: 2_000,
      url: "http://127.0.0.1:9/api/v1/health",
    }),
    /Local Core exited before readiness \(code 23\)/,
  );
});
