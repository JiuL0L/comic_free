# Local Core boundary prototype

Status: answered on 2026-09-03. The executable artifact remains on branch `prototype/local-core-boundary` at commit `718c179`, with verdict commit `7229946`, and is intentionally absent from `main`.

## Question

Can a minimal Comic Free Local Core, bound only to `127.0.0.1:3210`, keep Library Items, Last Known Snapshots, Source Bindings, and Reading Progress in Comic Free-owned SQLite while exposing a stable REST/JSON boundary and returning real page-image bytes through a loopback proxy, even after the backing Source Binding becomes unavailable and the Local Core restarts?

## Answer

Yes, for the deterministic fixture boundary. The built-in Node.js prototype exposed normalized catalog and library routes, stored Comic Free-owned records in SQLite, returned the fixture provider's exact PNG bytes through a Local Core URL, changed only the Source Binding to unavailable, and returned the same Library Item snapshot and Reading Progress after restarting against the same database.

Two consecutive checks passed. Each produced a 32768-byte SQLite database and proxied a 69-byte `image/png` payload with SHA-256 `c91dda6a5e5ad1ea705c71e5bb272e90013bbcedbb1af4de2ede25084b2b9f65`. The final retained state remained `library-fixture-comic`, binding status `unavailable`, chapter `fixture-chapter-1`, and page `0`; port `3210` was released after verification.

## Boundary of the answer

- No Suwayomi or MangaDex experiment was repeated.
- No internet request, third-party code, downloaded artifact, or new dependency was used.
- The exact production API, schema, migrations, validation, CORS policy, Suwayomi adapter, live-provider image path, WebUI, and desktop packaging remain deferred.
- Executable prototype code remains only on `prototype/local-core-boundary`.
