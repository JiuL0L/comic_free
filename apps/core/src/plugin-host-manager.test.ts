import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import test from "node:test";
import path from "node:path";

import { PluginHostManager } from "./plugin-host-manager.ts";

const OUTPUT_ROOT = path.resolve(
  import.meta.dirname,
  "../../../.local-data/test-output/04-manage-suwayomi-safely",
);

async function randomLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

test("starts a ready fake Plugin Host, runs its shutdown hook, and releases its port", async () => {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const testRoot = await mkdtemp(path.join(OUTPUT_ROOT, "ready-"));
  const runtimeRoot = path.join(testRoot, "runtime");
  const port = await randomLoopbackPort();
  const fixturePath = path.resolve(
    import.meta.dirname,
    "../../../tests/fixtures/fake-plugin-host.mjs",
  );
  const manager = new PluginHostManager({
    artifactPath: fixturePath,
    command: process.execPath,
    commandArguments: [fixturePath],
    environment: {
      FAKE_PLUGIN_HOST_MODE: "ready",
      FAKE_PLUGIN_HOST_PORT: String(port),
      FAKE_PLUGIN_HOST_RUNTIME_ROOT: runtimeRoot,
      FAKE_PLUGIN_HOST_SHUTDOWN_TOKEN: "test-only-token",
    },
    internalPort: port,
    logRoot: path.join(testRoot, "logs"),
    readinessUrl: `http://127.0.0.1:${port}/api/graphql`,
    runtimeRoot,
    shutdownTimeoutMs: 3_000,
    shutdownToken: "test-only-token",
    shutdownUrl: `http://127.0.0.1:${port}/comic-free/shutdown`,
    startupTimeoutMs: 3_000,
  });

  try {
    await manager.start();
    assert.equal(manager.status().state, "ready");

    await manager.stop();
    assert.equal(manager.status().state, "stopped");
    await access(path.join(runtimeRoot, "shutdown-hook-ran"));

    const rebound = createServer();
    await new Promise<void>((resolve, reject) => {
      rebound.once("error", reject);
      rebound.listen(port, "127.0.0.1", resolve);
    });
    await new Promise<void>((resolve, reject) =>
      rebound.close((error) => (error ? reject(error) : resolve())),
    );
  } finally {
    await manager.stop().catch(() => undefined);
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("classifies a missing user-specified artifact as invalid_path without spawning it", async () => {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const testRoot = await mkdtemp(path.join(OUTPUT_ROOT, "invalid-path-"));
  const port = await randomLoopbackPort();
  const manager = new PluginHostManager({
    artifactPath: path.join(testRoot, "missing.jar"),
    command: process.execPath,
    commandArguments: ["this-must-not-run"],
    internalPort: port,
    logRoot: path.join(testRoot, "logs"),
    readinessUrl: `http://127.0.0.1:${port}/api/graphql`,
    runtimeRoot: path.join(testRoot, "runtime"),
    shutdownTimeoutMs: 250,
    shutdownToken: "unused",
    shutdownUrl: `http://127.0.0.1:${port}/comic-free/shutdown`,
    startupTimeoutMs: 250,
  });

  try {
    await assert.rejects(manager.start(), /artifact path does not exist/i);
    assert.equal(manager.status().state, "invalid_path");
  } finally {
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("does not spawn an artifact whose digest differs from the approved SHA-256", async () => {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const testRoot = await mkdtemp(path.join(OUTPUT_ROOT, "digest-"));
  const port = await randomLoopbackPort();
  const fixturePath = path.resolve(
    import.meta.dirname,
    "../../../tests/fixtures/fake-plugin-host.mjs",
  );
  const manager = new PluginHostManager({
    approvedArtifactSha256: "0".repeat(64),
    artifactPath: fixturePath,
    command: process.execPath,
    commandArguments: [fixturePath],
    internalPort: port,
    logRoot: path.join(testRoot, "logs"),
    readinessUrl: `http://127.0.0.1:${port}/api/graphql`,
    runtimeRoot: path.join(testRoot, "runtime"),
    shutdownTimeoutMs: 250,
    shutdownToken: "unused",
    shutdownUrl: `http://127.0.0.1:${port}/comic-free/shutdown`,
    startupTimeoutMs: 250,
  });

  try {
    await assert.rejects(manager.start(), /approved SHA-256/i);
    assert.equal(manager.status().state, "invalid_path");
  } finally {
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("classifies an occupied loopback internal port before spawning the Plugin Host", async () => {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const testRoot = await mkdtemp(path.join(OUTPUT_ROOT, "occupied-"));
  const fixturePath = path.resolve(
    import.meta.dirname,
    "../../../tests/fixtures/fake-plugin-host.mjs",
  );
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const address = listener.address();
  assert(address && typeof address === "object");
  const manager = new PluginHostManager({
    artifactPath: fixturePath,
    command: process.execPath,
    commandArguments: [fixturePath],
    environment: {
      FAKE_PLUGIN_HOST_MODE: "ready",
      FAKE_PLUGIN_HOST_PORT: String(address.port),
      FAKE_PLUGIN_HOST_RUNTIME_ROOT: path.join(testRoot, "runtime"),
      FAKE_PLUGIN_HOST_SHUTDOWN_TOKEN: "unused",
    },
    internalPort: address.port,
    logRoot: path.join(testRoot, "logs"),
    readinessUrl: `http://127.0.0.1:${address.port}/api/graphql`,
    runtimeRoot: path.join(testRoot, "runtime"),
    shutdownTimeoutMs: 250,
    shutdownToken: "unused",
    shutdownUrl: `http://127.0.0.1:${address.port}/comic-free/shutdown`,
    startupTimeoutMs: 250,
  });

  try {
    await assert.rejects(manager.start(), /already in use/i);
    assert.equal(manager.status().state, "port_occupied");
  } finally {
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
    await manager.stop().catch(() => undefined);
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("classifies a child that exits before readiness as early_exit", async () => {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const testRoot = await mkdtemp(path.join(OUTPUT_ROOT, "early-exit-"));
  const runtimeRoot = path.join(testRoot, "runtime");
  const port = await randomLoopbackPort();
  const fixturePath = path.resolve(
    import.meta.dirname,
    "../../../tests/fixtures/fake-plugin-host.mjs",
  );
  const manager = new PluginHostManager({
    artifactPath: fixturePath,
    command: process.execPath,
    commandArguments: [fixturePath],
    environment: {
      FAKE_PLUGIN_HOST_MODE: "early-exit",
      FAKE_PLUGIN_HOST_PORT: String(port),
      FAKE_PLUGIN_HOST_RUNTIME_ROOT: runtimeRoot,
      FAKE_PLUGIN_HOST_SHUTDOWN_TOKEN: "unused",
    },
    internalPort: port,
    logRoot: path.join(testRoot, "logs"),
    readinessUrl: `http://127.0.0.1:${port}/api/graphql`,
    runtimeRoot,
    shutdownTimeoutMs: 250,
    shutdownToken: "unused",
    shutdownUrl: `http://127.0.0.1:${port}/comic-free/shutdown`,
    startupTimeoutMs: 1_000,
  });

  try {
    await assert.rejects(manager.start(), /exited before readiness/i);
    assert.equal(manager.status().state, "early_exit");
  } finally {
    await manager.stop().catch(() => undefined);
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("classifies a process launch failure as early_exit", async () => {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const testRoot = await mkdtemp(path.join(OUTPUT_ROOT, "launch-failure-"));
  const port = await randomLoopbackPort();
  const fixturePath = path.resolve(
    import.meta.dirname,
    "../../../tests/fixtures/fake-plugin-host.mjs",
  );
  const manager = new PluginHostManager({
    artifactPath: fixturePath,
    command: path.join(testRoot, "missing-command.exe"),
    commandArguments: [],
    internalPort: port,
    logRoot: path.join(testRoot, "logs"),
    readinessUrl: `http://127.0.0.1:${port}/api/graphql`,
    runtimeRoot: path.join(testRoot, "runtime"),
    shutdownTimeoutMs: 250,
    shutdownToken: "unused",
    shutdownUrl: `http://127.0.0.1:${port}/comic-free/shutdown`,
    startupTimeoutMs: 250,
  });

  try {
    await assert.rejects(manager.start(), /could not start/i);
    assert.equal(manager.status().state, "early_exit");
  } finally {
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("classifies a running child that misses its readiness deadline as startup_timeout", async () => {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const testRoot = await mkdtemp(path.join(OUTPUT_ROOT, "timeout-"));
  const runtimeRoot = path.join(testRoot, "runtime");
  const port = await randomLoopbackPort();
  const fixturePath = path.resolve(
    import.meta.dirname,
    "../../../tests/fixtures/fake-plugin-host.mjs",
  );
  const manager = new PluginHostManager({
    artifactPath: fixturePath,
    command: process.execPath,
    commandArguments: [fixturePath],
    environment: {
      FAKE_PLUGIN_HOST_MODE: "timeout",
      FAKE_PLUGIN_HOST_PORT: String(port),
      FAKE_PLUGIN_HOST_RUNTIME_ROOT: runtimeRoot,
      FAKE_PLUGIN_HOST_SHUTDOWN_TOKEN: "test-only-token",
    },
    internalPort: port,
    logRoot: path.join(testRoot, "logs"),
    readinessUrl: `http://127.0.0.1:${port}/api/graphql`,
    runtimeRoot,
    shutdownTimeoutMs: 1_000,
    shutdownToken: "test-only-token",
    shutdownUrl: `http://127.0.0.1:${port}/comic-free/shutdown`,
    startupTimeoutMs: 250,
  });

  try {
    await assert.rejects(manager.start(), /startup deadline/i);
    assert.equal(manager.status().state, "startup_timeout");
  } finally {
    await manager.stop().catch(() => undefined);
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("classifies a child that dies after readiness as unexpected_exit", async () => {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const testRoot = await mkdtemp(path.join(OUTPUT_ROOT, "unexpected-exit-"));
  const runtimeRoot = path.join(testRoot, "runtime");
  const port = await randomLoopbackPort();
  const fixturePath = path.resolve(
    import.meta.dirname,
    "../../../tests/fixtures/fake-plugin-host.mjs",
  );
  const manager = new PluginHostManager({
    artifactPath: fixturePath,
    command: process.execPath,
    commandArguments: [fixturePath],
    environment: {
      FAKE_PLUGIN_HOST_MODE: "unexpected-exit",
      FAKE_PLUGIN_HOST_PORT: String(port),
      FAKE_PLUGIN_HOST_RUNTIME_ROOT: runtimeRoot,
      FAKE_PLUGIN_HOST_SHUTDOWN_TOKEN: "unused",
    },
    internalPort: port,
    logRoot: path.join(testRoot, "logs"),
    readinessUrl: `http://127.0.0.1:${port}/api/graphql`,
    runtimeRoot,
    shutdownTimeoutMs: 250,
    shutdownToken: "unused",
    shutdownUrl: `http://127.0.0.1:${port}/comic-free/shutdown`,
    startupTimeoutMs: 1_000,
  });

  try {
    await manager.start();
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(manager.status().state, "unexpected_exit");
    assert.match(manager.status().message, /code 42/);
  } finally {
    await manager.stop().catch(() => undefined);
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("reports shutdown_failed when application shutdown is rejected", async () => {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const testRoot = await mkdtemp(path.join(OUTPUT_ROOT, "shutdown-failure-"));
  const runtimeRoot = path.join(testRoot, "runtime");
  const port = await randomLoopbackPort();
  const fixturePath = path.resolve(
    import.meta.dirname,
    "../../../tests/fixtures/fake-plugin-host.mjs",
  );
  const manager = new PluginHostManager({
    artifactPath: fixturePath,
    command: process.execPath,
    commandArguments: [fixturePath],
    environment: {
      FAKE_PLUGIN_HOST_MODE: "shutdown-failure",
      FAKE_PLUGIN_HOST_PORT: String(port),
      FAKE_PLUGIN_HOST_RUNTIME_ROOT: runtimeRoot,
      FAKE_PLUGIN_HOST_SHUTDOWN_TOKEN: "test-only-token",
    },
    internalPort: port,
    logRoot: path.join(testRoot, "logs"),
    readinessUrl: `http://127.0.0.1:${port}/api/graphql`,
    runtimeRoot,
    shutdownTimeoutMs: 250,
    shutdownToken: "test-only-token",
    shutdownUrl: `http://127.0.0.1:${port}/comic-free/shutdown`,
    startupTimeoutMs: 1_000,
  });

  try {
    await manager.start();
    await assert.rejects(manager.stop(), /rejected application shutdown/i);
    assert.equal(manager.status().state, "shutdown_failed");
    assert.match(manager.status().message, /abrupt fallback/i);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("captures structured Plugin Host logs and redacts sensitive headers", async () => {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const testRoot = await mkdtemp(path.join(OUTPUT_ROOT, "logs-"));
  const runtimeRoot = path.join(testRoot, "runtime");
  const logRoot = path.join(testRoot, "logs");
  const port = await randomLoopbackPort();
  const fixturePath = path.resolve(
    import.meta.dirname,
    "../../../tests/fixtures/fake-plugin-host.mjs",
  );
  const manager = new PluginHostManager({
    artifactPath: fixturePath,
    command: process.execPath,
    commandArguments: [fixturePath],
    environment: {
      FAKE_PLUGIN_HOST_MODE: "ready",
      FAKE_PLUGIN_HOST_PORT: String(port),
      FAKE_PLUGIN_HOST_RUNTIME_ROOT: runtimeRoot,
      FAKE_PLUGIN_HOST_SHUTDOWN_TOKEN: "test-only-token",
    },
    internalPort: port,
    logRoot,
    readinessUrl: `http://127.0.0.1:${port}/api/graphql`,
    runtimeRoot,
    shutdownTimeoutMs: 1_000,
    shutdownToken: "test-only-token",
    shutdownUrl: `http://127.0.0.1:${port}/comic-free/shutdown`,
    startupTimeoutMs: 1_000,
  });

  try {
    await manager.start();
    await manager.stop();
    const log = await readFile(path.join(logRoot, "plugin-host.jsonl"), "utf8");
    assert.match(log, /"component":"plugin-host"/);
    assert.match(log, /"stream":"stdout"/);
    assert.match(log, /"stream":"stderr"/);
    assert.match(log, /\[REDACTED\]/);
    assert.doesNotMatch(log, /should-not-be-logged/);
  } finally {
    await manager.stop().catch(() => undefined);
    await rm(testRoot, { force: true, recursive: true });
  }
});
