import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import test from "node:test";
import path from "node:path";
import { promisify } from "node:util";

import { buildJvmShutdownAgent } from "./jvm-shutdown-agent.ts";
import { PluginHostManager } from "./plugin-host-manager.ts";

const execFileAsync = promisify(execFile);
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

test("the first-party JVM agent invokes shutdown hooks before the managed JVM exits", async () => {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const testRoot = await mkdtemp(path.join(OUTPUT_ROOT, "jvm-agent-"));
  const classesRoot = path.join(testRoot, "fixture-classes");
  const runtimeRoot = path.join(testRoot, "runtime");
  const fixtureSource = path.resolve(
    import.meta.dirname,
    "../../../tests/fixtures/FakeJvmPluginHost.java",
  );
  const internalPort = await randomLoopbackPort();
  const shutdownPort = await randomLoopbackPort();
  let manager: PluginHostManager | undefined;

  try {
    await Promise.all([
      mkdir(classesRoot, { recursive: true }),
      mkdir(runtimeRoot, { recursive: true }),
    ]);
    await execFileAsync("javac", [
      "--add-modules",
      "jdk.httpserver",
      "-d",
      classesRoot,
      fixtureSource,
    ]);
    const agentJar = await buildJvmShutdownAgent(path.join(testRoot, "agent"));
    const shutdownToken = "jvm-test-token";
    const shutdownCredentialPath = path.join(testRoot, "agent", "shutdown-token");
    const encodedCredentialPath = Buffer.from(shutdownCredentialPath, "utf8").toString(
      "base64url",
    );
    manager = new PluginHostManager({
      artifactPath: fixtureSource,
      command: "java",
      commandArguments: [
        "--add-modules=jdk.httpserver",
        `-javaagent:${agentJar}=port=${shutdownPort},tokenFileBase64=${encodedCredentialPath}`,
        "-cp",
        classesRoot,
        "FakeJvmPluginHost",
        String(internalPort),
        runtimeRoot,
      ],
      internalPort,
      logRoot: path.join(testRoot, "logs"),
      readinessUrl: `http://127.0.0.1:${internalPort}/api/graphql`,
      runtimeRoot,
      shutdownTimeoutMs: 5_000,
      shutdownCredentialPath,
      shutdownToken,
      shutdownUrl: `http://127.0.0.1:${shutdownPort}/comic-free/shutdown`,
      startupTimeoutMs: 5_000,
    });

    await manager.start();
    await assert.rejects(access(shutdownCredentialPath));
    const unauthorized = await fetch(
      `http://127.0.0.1:${shutdownPort}/comic-free/shutdown`,
      { method: "POST" },
    );
    assert.equal(unauthorized.status, 404);
    await assert.rejects(access(path.join(runtimeRoot, "jvm-shutdown-hook-ran")));
    assert.equal(manager.status().state, "ready");

    await manager.stop();
    await access(path.join(runtimeRoot, "jvm-shutdown-hook-ran"));
    assert.equal(manager.status().state, "stopped");
  } finally {
    await manager?.stop().catch(() => undefined);
    await rm(testRoot, { force: true, recursive: true });
  }
});
