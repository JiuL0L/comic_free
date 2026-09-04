import assert from "node:assert/strict";
import test from "node:test";

import {
  PLUGIN_HOST_STATUS_PATH,
  parsePluginHostStatusResponse,
} from "@comic-free/contracts";

import { createLocalCoreServer } from "./server.ts";

test("the Local Core exposes Plugin Host readiness without exposing GraphQL", async () => {
  const server = createLocalCoreServer({
    pluginHostStatus: () => ({
      apiVersion: "v1",
      internalPort: 4568,
      message: "Suwayomi is ready.",
      retryable: false,
      state: "ready",
    }),
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert(address && typeof address === "object");
    const response = await fetch(
      `http://127.0.0.1:${address.port}${PLUGIN_HOST_STATUS_PATH}`,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(parsePluginHostStatusResponse(await response.json()), {
      apiVersion: "v1",
      internalPort: 4568,
      message: "Suwayomi is ready.",
      retryable: false,
      state: "ready",
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
