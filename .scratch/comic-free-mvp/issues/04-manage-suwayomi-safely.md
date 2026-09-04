# 04: Manage an approved Suwayomi Plugin Host safely

**What to build:** Let the local reader start and stop a user-specified, explicitly approved Suwayomi JAR through Comic Free, with visible readiness and failure states and evidence that Windows shutdown is safe for Suwayomi/H2 data.

**Blocked by:** 01: Start the loopback application shell.

**Status:** ready-for-agent

- [ ] Before executing Suwayomi or any newly obtained third-party code, state the exact local artifact or source and obtain the user's explicit permission.
- [ ] Comic Free accepts a user-specified JAR path and never downloads or updates Suwayomi automatically.
- [ ] Suwayomi runs only on an available loopback internal port with its state and logs isolated under Comic Free's ignored runtime-data area.
- [ ] The Local Core distinguishes invalid path, occupied port, startup timeout, early exit, ready, unexpected exit, and shutdown failure.
- [ ] Readiness uses a stable local HTTP or GraphQL probe and is reflected through the Browser WebUI without exposing the GraphQL schema to it.
- [ ] Structured logs identify Local Core versus Plugin Host failures without recording cookies, authorization material, image bodies, or other sensitive headers.
- [ ] Controlled fake-child tests prove readiness, timeout, early exit, unexpected exit, log capture, and port release without third-party execution.
- [ ] The real integration check identifies and uses an application-level database-safe Windows shutdown path, then proves port release and clean Suwayomi/H2 state reopening.
- [ ] Abrupt termination is reported as a fallback and does not satisfy the database-safe shutdown acceptance criterion.
