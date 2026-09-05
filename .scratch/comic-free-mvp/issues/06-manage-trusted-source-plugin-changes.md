# 06: Manage trusted Source Plugin changes

**What to build:** Let the local reader install, update, disable, or restore a compatible trusted Mihon Source Plugin through Comic Free without rebuilding the Browser WebUI, while preserving the Last Known Catalog and affected local reading state.

**Blocked by:** 03: Retain the Source Plugin catalog through failure; 04: Manage an approved Suwayomi Plugin Host safely.

**Status:** resolved

- [x] Every operation identifies the extension store, package, local artifact, or other code source and requires the user's explicit approval before new third-party code is downloaded or executed.
- [x] The Browser WebUI shows pending, successful, failed, and restart-required outcomes for install, update, disable, and restore operations.
- [x] Source Plugin changes occur through the Local Core and Plugin Host adapter; the Browser WebUI never calls Suwayomi directly.
- [x] Installing or updating a compatible Source Plugin makes its normalized Comic Providers available without rebuilding or reinstalling the Browser WebUI.
- [x] Disabling, removing, failing, or restoring a Source Plugin changes Source Binding availability without deleting Library Items, Last Known Snapshots, or Reading Progress.
- [x] Catalog refresh failure preserves the Last Known Catalog and remains distinct from a confirmed package removal.
- [x] Operations have bounded timeouts, safe error envelopes, and structured logs that omit credentials, cookies, and downloaded code contents.
- [x] Deterministic adapter tests cover all state transitions; an approved Suwayomi integration check proves at least one compatible installed Source Plugin survives the required restart.

## Comments

- 2026-09-04: Deterministic implementation and verification are complete (`pnpm verify`: typecheck, production build, 59 unit/integration tests, and 4 browser E2E tests). The final checkbox remains open because its live Suwayomi half requires separate, source-specific user approval before the named third-party extension operation is run.
- 2026-09-04: After explicit user approval, the live check installed MangaDex `1.4.212` from the Keiyoushi store through the approved Suwayomi `v2.3.2243` JAR, enumerated 61 normalized Comic Providers, stopped cleanly, reopened the same data directory, and confirmed the package, version, and all 61 Providers survived. The retry used the explicit credential-free proxy `http://127.0.0.1:7897` after JVM direct access to `github.com` timed out. Exit code was 0; port `4569` and H2 lock files were released. Post-fix `pnpm verify` passed typecheck, production build, 61 unit/integration tests, and 4 browser E2E tests.

## Answer

Comic Free now manages explicitly approved Source Plugin install, update, local disable, and restore operations through the Local Core boundary. The retained catalog persists normalized Providers and keeps local disable policy separate from Plugin Host observations; catalog and Source Binding changes are transactional, non-readable transitions invalidate Reader Sessions, and refresh/change operations share a bounded serial coordinator. The Browser WebUI exposes all required operation outcomes without calling Suwayomi directly. Deterministic verification and the approved MangaDex restart integration both pass.
