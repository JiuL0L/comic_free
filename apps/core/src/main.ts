import path from "node:path";

import {
  LOCAL_CORE_HOST,
  LOCAL_CORE_PORT,
} from "@comic-free/contracts";

import { FixtureCatalogAdapter } from "./catalog-adapter.ts";
import { CatalogStore } from "./catalog-store.ts";
import { createLocalCoreServer } from "./server.ts";

const dataDirectory = path.resolve(process.env.COMIC_FREE_DATA_DIR ?? ".local-data");
const catalogStore = new CatalogStore(path.join(dataDirectory, "comic-free.sqlite"));
const adapter = new FixtureCatalogAdapter(process.env.COMIC_FREE_CATALOG_FIXTURE);
const server = createLocalCoreServer({ adapter, catalogStore });

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
    catalogStore.close();
    process.exit(0);
  });
process.once("SIGINT", close);
process.once("SIGTERM", close);
