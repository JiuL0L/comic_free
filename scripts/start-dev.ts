import { WEB_UI_URL } from "@comic-free/contracts";

import { startDevelopment } from "./dev-supervisor.ts";

async function main(): Promise<void> {
  const controller = await startDevelopment();
  let shutdownStarted = false;

  const shutdown = async () => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    await controller.stop();
  };

  process.once("SIGINT", () => void shutdown().then(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().then(() => process.exit(0)));
  process.on("message", (message) => {
    if (message === "shutdown") {
      void shutdown().then(() => process.exit(0));
    }
  });

  console.log(`Comic Free is ready: ${WEB_UI_URL}`);
  await controller.unexpectedExit;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown startup failure.";
  console.error(`Comic Free startup failed: ${message}`);
  process.exitCode = 1;
});
