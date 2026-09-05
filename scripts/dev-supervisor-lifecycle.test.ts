import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createConnection } from "node:net";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { ensurePortAvailable, startDevelopment, waitForHttpReady } from "./dev-supervisor.ts";

const fakeHost = `
const http = require('node:http');
const server = http.createServer((req, res) => {
  res.end('ok');
  if (req.url === '/shutdown') server.close(() => process.exit(0));
});
server.listen(0, '127.0.0.1', () => process.send(server.address().port));
process.on('message', message => {
  if (message === 'shutdown') server.close(() => { require('node:fs').writeFileSync('host-stopped.txt', 'clean'); process.exit(0); });
});
`;

async function fixtureRoot(exitCode = 0, ignoreShutdown = false): Promise<string> {
  const base = path.resolve('.local-data/test-output/07-supervisor');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'case-'));
  await mkdir(path.join(root, 'apps/core/src'), { recursive: true });
  await mkdir(path.join(root, 'node_modules/vite/bin'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}', 'utf8');
  await writeFile(path.join(root, 'apps/core/src/main.ts'), `
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
const host = spawn(process.execPath, ['-e', ${JSON.stringify(fakeHost)}], {
  stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
});
const port = await new Promise(resolve => host.once('message', resolve));
writeFileSync('host-port.txt', String(port));
const core = createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({apiVersion:'v1', service:'comic-free-local-core', status:'ready'}));
  if (req.url === '/crash') void close();
});
core.listen(3210, '127.0.0.1');
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  const exited = new Promise(resolve => host.once('exit', resolve));
  host.send('shutdown');
  await exited;
  core.close(() => process.exit(${exitCode}));
}
process.on('message', message => { if (message === 'shutdown' && !${ignoreShutdown}) void close(); });
process.on('disconnect', () => void close());
process.on('SIGTERM', () => void close());
`, 'utf8');
  await writeFile(path.join(root, 'node_modules/vite/bin/vite.js'), `
const http = require('node:http');
const web = http.createServer((req,res) => {
  res.end('web');
  if (req.url === '/exit') web.close(() => process.exit(0));
});
web.listen(5173, '127.0.0.1');
`, 'utf8');
  return root;
}

test('development stop waits for the Local Core to release its Plugin Host', async () => {
  const root = await fixtureRoot();
  const controller = await startDevelopment(root);
  const port = Number(await readFile(path.join(root, 'host-port.txt'), 'utf8'));
  try {
    const stopping = controller.stop();
    assert.equal(controller.stop(), stopping);
    await stopping;
    await ensurePortAvailable('Plugin Host', '127.0.0.1', port);
    assert.equal(await readFile(path.join(root, 'host-stopped.txt'), 'utf8'), 'clean');
  } finally {
    // Release only this test-owned fake host if the regression leaves it orphaned.
    await fetch(`http://127.0.0.1:${port}/shutdown`).catch(() => undefined);
  }
});


test('development stop reports Local Core shutdown failure instead of succeeding', async () => {
  const root = await fixtureRoot(23);
  const controller = await startDevelopment(root);
  const port = Number(await readFile(path.join(root, 'host-port.txt'), 'utf8'));
  try {
    await assert.rejects(controller.stop(), (error: unknown) =>
      error instanceof AggregateError && error.errors.some((cause: unknown) =>
        cause instanceof Error && cause.message.includes('code 23')));
    await ensurePortAvailable('Plugin Host', '127.0.0.1', port);
  } finally {
    await fetch(`http://127.0.0.1:${port}/shutdown`).catch(() => undefined);
  }
});


test("an existing Local Core crash remains an unexpected-exit error, not a shutdown error", async () => {
  const root = await fixtureRoot(23);
  const controller = await startDevelopment(root);
  const unexpected = assert.rejects(controller.unexpectedExit, /Local Core exited unexpectedly \(code 23\)/);
  await fetch("http://127.0.0.1:3210/crash");
  await unexpected;
  await controller.stop();
  await ensurePortAvailable("Local Core", "127.0.0.1", 3210);
  await ensurePortAvailable("Browser WebUI", "127.0.0.1", 5173);
});


test("shutdown timeout falls back to IPC disconnect and waits for cooperative cleanup", async (t) => {
  const root = await fixtureRoot(0, true);
  const controller = await startDevelopment(root);
  const port = Number(await readFile(path.join(root, "host-port.txt"), "utf8"));
  try {
    const webExited = assert.rejects(controller.unexpectedExit, /Browser WebUI exited unexpectedly/);
    await fetch("http://127.0.0.1:5173/exit");
    await webExited;
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const stopping = controller.stop();
    t.mock.timers.tick(40_000);
    await stopping;
    t.mock.timers.reset();
    await ensurePortAvailable("Plugin Host", "127.0.0.1", port);
    assert.equal(await readFile(path.join(root, "host-stopped.txt"), "utf8"), "clean");
  } finally {
    t.mock.timers.reset();
    await fetch(`http://127.0.0.1:${port}/shutdown`).catch(() => undefined);
  }
});




test("Local Core shutdown releases SQLite even when a client holds an incomplete HTTP request", async () => {
  const dataRoot = await fixtureRoot();
  const core = fork(path.resolve("apps/core/src/main.ts"), [], {
    env: { ...process.env, COMIC_FREE_DATA_DIR: dataRoot,
      COMIC_FREE_SUWAYOMI_JAR: "", COMIC_FREE_SUWAYOMI_APPROVED_SHA256: "" },
    execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const exited = new Promise<number | null>((resolve) => core.once("exit", resolve));
  let socket: ReturnType<typeof createConnection> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await waitForHttpReady({ child: core, name: "Local Core", timeoutMs: 5_000,
      url: "http://127.0.0.1:3210/api/v1/health" });
    socket = createConnection({ host: "127.0.0.1", port: 3210 });
    socket.on("error", () => undefined);
    await new Promise<void>((resolve) => socket?.once("connect", resolve));
    socket.write("POST /api/v1/reader-sessions HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{");
    core.send("shutdown");
    const code = await Promise.race([exited, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Local Core still waits on a client connection during shutdown")), 2_000);
    })]);
    assert.equal(code, 0);
    await ensurePortAvailable("Local Core", "127.0.0.1", 3210);
  } finally {
    if (timer) clearTimeout(timer);
    socket?.destroy();
    if (core.connected) core.send("shutdown");
    await exited;
  }
});
