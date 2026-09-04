import { defineConfig } from "vite";
import { WEB_UI_HOST, WEB_UI_PORT } from "@comic-free/contracts";

export default defineConfig({
  root: import.meta.dirname,
  server: {
    host: WEB_UI_HOST,
    port: WEB_UI_PORT,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
