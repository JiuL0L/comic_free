# Use a TypeScript workspace behind a local REST boundary

For the Windows-only prototype, Comic Free uses a `pnpm` workspace with a React, TypeScript, and Vite WebUI, a Node.js and TypeScript Local Core, shared validated contracts, deterministic test fixtures, and built-in `node:sqlite`; the WebUI depends only on the Local Core's small REST/JSON interface while the Local Core contains Suwayomi GraphQL translation, so provider-host changes do not force the browser client to adopt Suwayomi's schema.
