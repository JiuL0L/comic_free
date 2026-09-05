import { WEB_UI_URL } from "@comic-free/contracts";

import { startDevelopment } from "./dev-supervisor.ts";

async function main(): Promise<void> {
  const controller = await startDevelopment();
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () => shutdownPromise ??= controller.stop();

  const requestShutdown = () => void shutdown().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(`Comic Free shutdown failed: ${error instanceof Error ? error.message : "Unknown shutdown failure."}`);
      process.exit(1);
    },
  );
  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);
  process.on("message", (message) => {
    if (message === "shutdown") {
      requestShutdown();
    }
  });

  console.log(`Comic Free is ready: ${WEB_UI_URL}`);
  try {
    await controller.unexpectedExit;
  } catch (error) {
    await shutdown().catch((cleanupError: unknown) => {
      console.error(`Comic Free cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : "Unknown cleanup failure."}`);
    });
    throw error;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown startup failure.";
  console.error(`Comic Free startup failed: ${message}`);
  process.exitCode = 1;
});
