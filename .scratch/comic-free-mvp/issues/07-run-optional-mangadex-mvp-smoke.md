# 07: Run the optional MangaDex MVP smoke check

**What to build:** Produce a final, opt-in observation showing whether the formal Comic Free path can dynamically expose MangaDex, display its actual Source Plugin and comic title, and render one real page without weakening deterministic MVP acceptance when the network or provider changes.

**Blocked by:** 05: Read through Suwayomi with transient reader sessions; 06: Manage trusted Source Plugin changes.

**Status:** resolved — live observation recorded; merged in PR #6 (198d319)

- [x] Before the run, identify the exact existing or proposed Suwayomi and MangaDex artifacts and obtain explicit permission for any new download, update, or third-party execution.
- [x] The smoke check uses the formal Browser WebUI, Local Core REST/JSON boundary, Suwayomi adapter, and Local Core page proxy rather than a temporary diagnostic page.
- [x] The evidence records the observed Source Plugin, selected comic title, chapter label, page number/count, HTTP image content type, byte count, and browser-visible rendered result.
- [x] The run does not assert that a particular public title, chapter, URL, page count, or catalog position will remain stable.
- [x] A network, region, licensing, removed-content, extension, or Comic Provider failure is classified and reported without failing the deterministic fixture suite.
- [x] The run confirms that no Suwayomi-local numeric manga/chapter identifier or upstream page URL was persisted as durable Comic Free identity.
- [x] Full logs are retained in a task-specific output location with secrets and image bodies excluded, and the final report separates deterministic local evidence from live observations.
- [x] The resulting verdict updates only project documentation on `main`; executable experiment artifacts, if any, remain outside `main` unless separately approved as formal implementation.

## Answer — 2026-09-05

[The final smoke observation](../../../docs/07-mangadex-smoke-observation.md) records
MangaDex 1.4.212 / Yotsuba&! / Vol.1 Ch.1, page 1 of 48, HTTP 200 image/jpg,
151105 bytes, and browser-visible 600 × 872 rendering. Formal Library resume after
Local Core + Suwayomi restart restored page 2 with a new session; actual durable keys
were inspected and all four retained-state tables survived restart unchanged.

The existing approved JAR was registered with the supported local upload API, without
new code downloads. Following the user's explicit instruction to continue the proposed
repairs, formal Windows supervisor shutdown and GraphQL Int translation fixes were
implemented with regressions. This is the separately approved formal implementation
exception to the original documentation-only scope; temporary experiment scripts and
screenshots are not committed. The management catalog's local-file import UI remains
outside scope; the configured reading selector exposed the registered MangaDex source.

`pnpm verify` passed: 73 tests plus 4 Chrome journeys. Final normal shutdown released
3210/5173/4568 with no H2 lock. No push or merge was requested or performed.
