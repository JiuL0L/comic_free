import path from "node:path";

import {
  LOCAL_CORE_HOST,
  LOCAL_CORE_PORT,
} from "@comic-free/contracts";

import { FixtureReadingAdapter } from "./reading-adapter.ts";
import { ReadingService } from "./reading-service.ts";
import { ReadingStore } from "./reading-store.ts";
import { createLocalCoreServer } from "./server.ts";

const dataDirectory = path.resolve(process.env.COMIC_FREE_DATA_DIR ?? ".local-data");
const readingStore = new ReadingStore(path.join(dataDirectory, "comic-free.sqlite"));
const readingService = new ReadingService(new FixtureReadingAdapter(), readingStore);
const server = createLocalCoreServer({ readingService });

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

const close = () =>
  server.close(() => {
    readingStore.close();
    process.exit(0);
  });
process.once("SIGINT", close);
process.once("SIGTERM", close);
