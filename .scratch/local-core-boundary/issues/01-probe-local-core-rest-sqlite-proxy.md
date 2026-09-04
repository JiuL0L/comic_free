# Probe Local Core REST, SQLite, and page proxy

Status: resolved

## Answer

- Artifact: branch `prototype/local-core-boundary`, commit `718c179`
- Verdict: commit `7229946`
- Command on the throwaway branch: `node apps/core/prototypes/local-core-boundary/verify.prototype.mjs`
- Result: two consecutive runs exited `0` with `result: PASS`
- REST boundary: normalized search, details, chapters, page discovery, library creation/read, progress update, and binding-unavailable transition passed on `127.0.0.1:3210`
- SQLite: 32768 bytes; the same file retained the unavailable binding, Last Known Snapshot, chapter `fixture-chapter-1`, and page `0` across restart
- Page proxy: exact 69-byte PNG, `image/png`, SHA-256 `c91dda6a5e5ad1ea705c71e5bb272e90013bbcedbb1af4de2ede25084b2b9f65`
- Isolation: no network access, Suwayomi process, Mihon extension, downloaded code, or new dependency was used
- Cleanup: the check removed only its own temporary directory and left no listener on port `3210`

## Decision

Accept the minimal Local Core boundary as validated for deterministic fixtures. Keep executable code on the throwaway branch. Defer formal APIs, migrations, WebUI/CORS, Suwayomi adaptation, live image smoke checks, and packaging.

## Comments

- 2026-09-03: The first restart probe reused a pooled socket from the stopped process and returned `ECONNRESET`. Explicitly closing loopback responses made restart behavior deterministic; the complete check then passed twice.
