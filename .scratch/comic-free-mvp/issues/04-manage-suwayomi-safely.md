# 04: Manage an approved Suwayomi Plugin Host safely

**What to build:** Let the local reader start and stop a user-specified, explicitly approved Suwayomi JAR through Comic Free, with visible readiness and failure states and evidence that Windows shutdown is safe for Suwayomi/H2 data.

**Blocked by:** 01: Start the loopback application shell.

**Status:** resolved

- [x] Before executing Suwayomi or any newly obtained third-party code, state the exact local artifact or source and obtain the user's explicit permission.
- [x] Comic Free accepts a user-specified JAR path and never downloads or updates Suwayomi automatically.
- [x] Suwayomi runs only on an available loopback internal port with its state and logs isolated under Comic Free's ignored runtime-data area.
- [x] The Local Core distinguishes invalid path, occupied port, startup timeout, early exit, ready, unexpected exit, and shutdown failure.
- [x] Readiness uses a stable local HTTP or GraphQL probe and is reflected through the Browser WebUI without exposing the GraphQL schema to it.
- [x] Structured logs identify Local Core versus Plugin Host failures without recording cookies, authorization material, image bodies, or other sensitive headers.
- [x] Controlled fake-child tests prove readiness, timeout, early exit, unexpected exit, log capture, and port release without third-party execution.
- [x] The real integration check identifies and uses an application-level database-safe Windows shutdown path, then proves port release and clean Suwayomi/H2 state reopening.
- [x] Abrupt termination is reported as a fallback and does not satisfy the database-safe shutdown acceptance criterion.

## Answer

- Comic Free now starts only a user-specified Suwayomi JAR whose SHA-256 matches the separately supplied approved digest. It never downloads or updates Suwayomi.
- The Plugin Host binds to loopback, stores runtime state and structured logs under `.local-data/`, and exposes its lifecycle to the Browser WebUI only through the Local Core REST contract.
- Deterministic fake-child coverage exercises readiness, occupied port, invalid path/digest, launch failure, timeout, early and unexpected exit, redacted log capture, graceful stop, fallback shutdown failure, and port release.
- Windows shutdown uses a first-party Java agent endpoint inside the target JVM. The endpoint calls `System.exit(0)`, allowing Suwayomi and H2 shutdown hooks to complete; forced termination remains an explicitly reported failure fallback.
- With explicit user approval, the official `Suwayomi-Server-v2.3.2243.jar` at SHA-256 `821141B32E170D4A02D3CBDFED577ED8F07BD22383FF5F4132EBB5AE40E98DD5` passed two consecutive real lifecycle runs. Each run reached GraphQL readiness, queried `mangas.totalCount`, stopped through the application endpoint, released port `4568`, left no H2 lock file, and the second run cleanly reopened `runtime/database.mv.db`.
- Evidence is retained in `.local-data/test-output/04-manage-suwayomi-safely/verify-suwayomi.log`.
