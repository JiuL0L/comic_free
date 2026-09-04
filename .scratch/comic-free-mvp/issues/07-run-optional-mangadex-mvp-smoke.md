# 07: Run the optional MangaDex MVP smoke check

**What to build:** Produce a final, opt-in observation showing whether the formal Comic Free path can dynamically expose MangaDex, display its actual Source Plugin and comic title, and render one real page without weakening deterministic MVP acceptance when the network or provider changes.

**Blocked by:** 05: Read through Suwayomi with transient reader sessions; 06: Manage trusted Source Plugin changes.

**Status:** ready-for-agent

- [ ] Before the run, identify the exact existing or proposed Suwayomi and MangaDex artifacts and obtain explicit permission for any new download, update, or third-party execution.
- [ ] The smoke check uses the formal Browser WebUI, Local Core REST/JSON boundary, Suwayomi adapter, and Local Core page proxy rather than a temporary diagnostic page.
- [ ] The evidence records the observed Source Plugin, selected comic title, chapter label, page number/count, HTTP image content type, byte count, and browser-visible rendered result.
- [ ] The run does not assert that a particular public title, chapter, URL, page count, or catalog position will remain stable.
- [ ] A network, region, licensing, removed-content, extension, or Comic Provider failure is classified and reported without failing the deterministic fixture suite.
- [ ] The run confirms that no Suwayomi-local numeric manga/chapter identifier or upstream page URL was persisted as durable Comic Free identity.
- [ ] Full logs are retained in a task-specific output location with secrets and image bodies excluded, and the final report separates deterministic local evidence from live observations.
- [ ] The resulting verdict updates only project documentation on `main`; executable experiment artifacts, if any, remain outside `main` unless separately approved as formal implementation.
