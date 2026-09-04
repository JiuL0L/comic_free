# 06: Manage trusted Source Plugin changes

**What to build:** Let the local reader install, update, disable, or restore a compatible trusted Mihon Source Plugin through Comic Free without rebuilding the Browser WebUI, while preserving the Last Known Catalog and affected local reading state.

**Blocked by:** 03: Retain the Source Plugin catalog through failure; 04: Manage an approved Suwayomi Plugin Host safely.

**Status:** ready-for-agent

- [ ] Every operation identifies the extension store, package, local artifact, or other code source and requires the user's explicit approval before new third-party code is downloaded or executed.
- [ ] The Browser WebUI shows pending, successful, failed, and restart-required outcomes for install, update, disable, and restore operations.
- [ ] Source Plugin changes occur through the Local Core and Plugin Host adapter; the Browser WebUI never calls Suwayomi directly.
- [ ] Installing or updating a compatible Source Plugin makes its normalized Comic Providers available without rebuilding or reinstalling the Browser WebUI.
- [ ] Disabling, removing, failing, or restoring a Source Plugin changes Source Binding availability without deleting Library Items, Last Known Snapshots, or Reading Progress.
- [ ] Catalog refresh failure preserves the Last Known Catalog and remains distinct from a confirmed package removal.
- [ ] Operations have bounded timeouts, safe error envelopes, and structured logs that omit credentials, cookies, and downloaded code contents.
- [ ] Deterministic adapter tests cover all state transitions; an approved Suwayomi integration check proves at least one compatible installed Source Plugin survives the required restart.
