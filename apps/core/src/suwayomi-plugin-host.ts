import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";

import { buildJvmShutdownAgent } from "./jvm-shutdown-agent.ts";
import { PluginHostManager } from "./plugin-host-manager.ts";

export interface SuwayomiPluginHostOptions {
  approvedArtifactSha256: string;
  dataRoot: string;
  internalPort: number;
  jarPath: string;
  shutdownTimeoutMs?: number;
  startupTimeoutMs?: number;
}

export async function createSuwayomiPluginHost(
  options: SuwayomiPluginHostOptions,
): Promise<PluginHostManager> {
  assertPort(options.internalPort, "Plugin Host internal port");
  if (!/^[a-f\d]{64}$/i.test(options.approvedArtifactSha256)) {
    throw new TypeError("Approved Plugin Host SHA-256 must contain exactly 64 hexadecimal characters.");
  }
  const managedRoot = path.resolve(options.dataRoot);
  const runtimeRoot = path.join(managedRoot, "runtime");
  const logRoot = path.join(managedRoot, "logs");
  const agentJar = await buildJvmShutdownAgent(path.join(managedRoot, "shutdown-agent"));
  let shutdownPort = await randomLoopbackPort();
  while (shutdownPort === options.internalPort) shutdownPort = await randomLoopbackPort();
  const shutdownToken = randomBytes(32).toString("base64url");
  const rootProperty = runtimeRoot.replaceAll("\\", "/");

  return new PluginHostManager({
    approvedArtifactSha256: options.approvedArtifactSha256,
    artifactPath: path.resolve(options.jarPath),
    command: "java",
    commandArguments: [
      "--add-modules=jdk.httpserver",
      `-javaagent:${agentJar}=port=${shutdownPort},token=${shutdownToken}`,
      `-Dsuwayomi.tachidesk.config.server.rootDir=${rootProperty}`,
      "-Dsuwayomi.tachidesk.config.server.ip=127.0.0.1",
      `-Dsuwayomi.tachidesk.config.server.port=${options.internalPort}`,
      "-Dsuwayomi.tachidesk.config.server.authMode=none",
      "-Dsuwayomi.tachidesk.config.server.webUIEnabled=false",
      "-Dsuwayomi.tachidesk.config.server.initialOpenInBrowserEnabled=false",
      "-Dsuwayomi.tachidesk.config.server.systemTrayEnabled=false",
      "-Dsuwayomi.tachidesk.config.server.kcefEnabled=false",
      "-jar",
      path.resolve(options.jarPath),
    ],
    internalPort: options.internalPort,
    logRoot,
    readinessUrl: `http://127.0.0.1:${options.internalPort}/api/graphql`,
    runtimeRoot,
    shutdownTimeoutMs: options.shutdownTimeoutMs ?? 30_000,
    shutdownToken,
    shutdownUrl: `http://127.0.0.1:${shutdownPort}/comic-free/shutdown`,
    startupTimeoutMs: options.startupTimeoutMs ?? 180_000,
  });
}

function assertPort(port: number, label: string): void {
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw new TypeError(`${label} must be an integer from 1024 through 65535.`);
  }
}

async function randomLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not allocate a loopback shutdown port.");
  }
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}
