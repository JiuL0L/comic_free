# Comic Free minimal formal MVP

Status: ready-for-agent

## Problem Statement

The throwaway prototypes have answered the main feasibility questions, but Comic Free still has no formal, maintainable application slice. The existing evidence is split across independent prototype branches: the source-failure state model, Suwayomi process control, dynamic Mihon Source Plugin installation, live MangaDex traversal, and the Local Core REST/SQLite/page-proxy boundary have each been validated separately.

The next phase must connect those findings without silently turning the prototype into a full product. A user needs to open a local browser, see which Source Plugin produced a result, see the comic name, open a chapter, and see a real page through Comic Free. After retaining that comic and Reading Progress, a Source Plugin or Comic Provider failure must make the Source Binding visibly unavailable without deleting the Library Item, Last Known Snapshot, or Reading Progress.

The formal slice must also prevent Suwayomi implementation details from becoming durable Comic Free state. A live diagnostic showed that Suwayomi-local numeric manga and chapter identifiers, and the page URLs derived from them, may need to be rebuilt after a restart. Persisting them as Comic Free identity would make otherwise valid Library Items unreadable or incorrectly associated after Plugin Host cache changes.

Success therefore means proving one coherent, browser-visible vertical slice behind a stable loopback REST/JSON boundary, with deterministic acceptance evidence and an optional live MangaDex smoke check. It does not mean completing desktop packaging, a polished reader, or every provider-management feature.

## Solution

Build a minimal `pnpm` TypeScript workspace containing a React/Vite Browser WebUI, a Node.js Local Core, shared runtime-validated contracts, and deterministic fixtures. The Local Core listens only on `127.0.0.1:3210`, owns Comic Free SQLite state, translates between browser-facing contracts and a replaceable Plugin Host adapter, and proxies page bytes so the WebUI never talks directly to Suwayomi or a Comic Provider.

The first formal vertical slice is fixture-backed and browser-visible:

1. One development command starts the Browser WebUI and Local Core and reports readiness.
2. The user selects a named fixture Source Plugin, searches, opens details and a chapter, and sees a recognizable comic page.
3. The screen shows the Source Plugin name, comic title, chapter label, current page, and total page count.
4. The user retains the result as a Library Item and records Reading Progress.
5. The fixture Source Binding becomes unavailable and provider-dependent actions fail with a useful reason.
6. The Local Core restarts against the same SQLite database and returns the same Library Item, Last Known Snapshot, unavailable Source Binding, and Reading Progress.

After that deterministic slice passes, add the Suwayomi adapter behind the same internal provider interface. It resolves fresh Suwayomi runtime identifiers when provider-dependent operations begin, converts GraphQL responses into Comic Free contracts, and creates short-lived reader sessions for page proxying. The Browser WebUI receives only Local Core URLs and opaque Comic Free references, never upstream page URLs or durable Suwayomi-local IDs.

The Plugin Host lifecycle is explicit. Comic Free receives a user-specified Suwayomi JAR path, runs it on a loopback-only internal port with state under `.local-data/`, waits for readiness with a timeout, distinguishes startup failures, and performs a database-safe application-level shutdown before considering lifecycle support complete. No implementation task may download, update, or execute new third-party code without first naming the source and obtaining the user's explicit permission.

## User Stories

1. As a local reader, I want one documented development command to start the Browser WebUI and Local Core so that I can use the MVP without manually coordinating processes.
2. As a local reader, I want startup progress and failures to be visible so that a blank browser page is not my only signal when a component fails.
3. As a local reader, I want Comic Free to bind only to loopback so that the unauthenticated MVP is not exposed to my LAN.
4. As a local reader, I want to see the available Source Plugins by name so that I know where catalog results will come from.
5. As a local reader, I want the UI to distinguish a healthy Source Plugin from a disabled, missing, incompatible, unreachable, or refresh-failed one so that I know whether retrying can help.
6. As a local reader, I want the Last Known Catalog to remain visible after a catalog refresh failure so that a temporary outage does not make installed or previously known plugins appear deleted.
7. As a local reader, I want a confirmed removal to be different from a temporary refresh failure so that I do not lose trust in the plugin-management state.
8. As a local reader, I want to choose a Source Plugin before searching so that every result has an explicit origin.
9. As a local reader, I want search loading, empty, success, and error states so that delayed or failed provider work is understandable.
10. As a local reader, I want each search result to show its Source Plugin and comic title so that similarly named comics from different providers are distinguishable.
11. As a local reader, I want to open normalized comic details without seeing Suwayomi or provider-specific response shapes so that the Browser WebUI remains stable when the Plugin Host changes.
12. As a local reader, I want chapter labels and ordering to remain understandable even when provider metadata is incomplete so that I can select a chapter deliberately.
13. As a local reader, I want to open a chapter and see a recognizable page, not merely a successful HTTP response or transparent pixel, so that browser-visible rendering is actually proven.
14. As a local reader, I want the reader to show the Source Plugin name, comic title, chapter label, page number, and total page count so that I can verify what I am reading.
15. As a local reader, I want next-page and previous-page actions to enforce valid bounds so that invalid progress cannot be recorded.
16. As a local reader, I want page images to come from a Local Core URL so that browser CORS, provider headers, cookies, and upstream URLs do not leak into the WebUI.
17. As a local reader, I want a page failure to preserve my current reader context and offer a retry so that a transient Comic Provider failure does not discard navigation state.
18. As a local reader, I want to retain a catalog result as a Library Item so that its identity and minimal display information become locally owned.
19. As a local reader, I want a retained Library Item to show its Last Known Snapshot while its Comic Provider is unavailable so that the item does not disappear from my library.
20. As a local reader, I want my Reading Progress saved by Comic Free so that it does not depend on provider-side bookmarks or accounts.
21. As a local reader, I want saved progress to include a human-readable chapter snapshot as well as a resolvable provider chapter key so that the UI remains useful when live resolution fails.
22. As a local reader, I want reopening a Library Item to resume from its last-read chapter and page when the binding can be resolved so that reading continuity works.
23. As a local reader, I want unavailable Library Items to remain selectable for local metadata inspection while provider-dependent reading controls are disabled so that failure is visible rather than destructive.
24. As a local reader, I want restoring a compatible Source Plugin to make a Source Binding refreshable without silently replacing my local snapshot or progress so that recovery is deliberate.
25. As a local reader, I want an explicit Library Item deletion action to be distinct from Source Plugin failure so that only my action removes local reading state.
26. As a local reader, I want an ordinary Local Core restart to retain my Library Items, Last Known Snapshots, Source Bindings, and Reading Progress so that local state is durable.
27. As a local reader, I want a failed or restarted Plugin Host to leave local state readable so that Suwayomi lifecycle problems do not corrupt my library.
28. As a local reader, I want Comic Free to re-resolve Suwayomi runtime identifiers and page URLs when reading starts so that stale Plugin Host cache identifiers are not treated as permanent.
29. As a local reader, I want a stale reader session to fail clearly and be renewable from the chapter context so that a Local Core or Plugin Host restart has an understandable recovery path.
30. As a local reader, I want installing, updating, disabling, or replacing a compatible trusted Mihon Source Plugin to avoid a WebUI rebuild so that dynamic plugin management remains real.
31. As a local reader, I want third-party code operations to require an explicit, source-specific approval so that Comic Free never downloads or executes code without my knowledge.
32. As a local reader, I want live MangaDex checks to be labeled optional so that network, region, licensing, or upstream changes do not make deterministic local acceptance flaky.
33. As a maintainer, I want browser-facing contracts shared and runtime-validated so that malformed requests and adapter drift fail at a clear boundary.
34. As a maintainer, I want the fixture provider and Suwayomi adapter to implement the same narrow internal interface so that deterministic tests exercise the same Local Core behavior as live integrations.
35. As a maintainer, I want Comic Free local identities separated from Plugin Host runtime identities so that Suwayomi database rebuilds do not invalidate durable records.
36. As a maintainer, I want page proxy requests to accept only server-created reader-session references so that the loopback service cannot become an arbitrary URL fetcher.
37. As a maintainer, I want SQLite migrations to be explicit and repeatable from the first schema version so that future changes do not rely on deleting local state.
38. As a maintainer, I want writes involving a Library Item, Source Binding, Last Known Snapshot, and initial Reading Progress to use transactions so that partial records are not exposed after failure.
39. As a maintainer, I want structured logs to distinguish Local Core, Plugin Host, Source Plugin, and Comic Provider failures without storing image bytes, cookies, or sensitive headers so that diagnostics are useful and bounded.
40. As a maintainer, I want process shutdown to prove port release and clean state reopening so that a stopped process is not mistaken for database-safe termination.
41. As a maintainer, I want exact image content type and bytes preserved through the proxy so that browser rendering failures can be separated from provider fetch failures.
42. As a maintainer, I want deterministic acceptance fixtures to be small, local, and visually recognizable so that the full vertical slice can run without internet or third-party code.
43. As a maintainer, I want the core deterministic checks to run repeatedly against a fresh temporary data directory and against a restarted retained directory so that isolation and persistence are both proven.
44. As a maintainer, I want invalid input and unavailable-state behavior covered alongside the happy path so that contracts are not defined only by successful demos.
45. As a maintainer, I want the live smoke check to report observed source, title, chapter, page count, HTTP content type, byte count, and visible browser result so that it provides concrete evidence without becoming a permanent catalog assertion.

## Implementation Decisions

- Use one `pnpm` workspace with `apps/web`, `apps/core`, `packages/contracts`, and `tests/fixtures` as established by ADR 0002.
- Use React, TypeScript, and Vite for the Browser WebUI. Use Node.js and TypeScript for the Local Core. Use built-in `node:sqlite` for Comic Free state.
- Keep the Browser WebUI dependent only on shared Comic Free REST/JSON contracts. It must not import Suwayomi GraphQL types or call Suwayomi or Comic Providers directly.
- Bind the Local Core exclusively to `127.0.0.1:3210`. The MVP has no authentication; startup must fail rather than fall back to a non-loopback address.
- Provide one root development command that starts the required local processes, waits for Local Core readiness, and prints the browser URL and actionable failure details. Desktop packaging is not part of this command.
- Define a small versioned `/api` surface covering health, Source Plugin status, catalog search, details, chapters, Library Items, Reading Progress, reader-session creation, and page bytes. Shared contracts validate request bodies, path/query parameters, success responses, and error responses at runtime.
- Use a consistent JSON error envelope containing a stable error code, human-readable message, retryability, and optional non-sensitive context. Preserve normal HTTP status semantics. Image responses return bytes rather than a JSON envelope after headers have been sent.
- Model a Library Item with a Comic Free-generated local identifier and a Last Known Snapshot. Model each Source Binding separately with a normalized Source Plugin key, Comic Provider key, plugin-scoped durable comic key, availability status, reason code, and observation timestamps.
- Require every adapter to produce plugin-scoped durable comic and chapter keys from provider-owned identity such as a canonical provider-relative identifier or URL. If the provider exposes no native durable identifier, the adapter owns a deterministic, versioned derivation; Suwayomi-local database identifiers are never valid inputs to durable identity.
- Model Reading Progress under the Library Item with that durable chapter key, a last-known chapter label, zero-based page index, and update timestamp. Validate that page indexes are non-negative and within a known page count when that count is available.
- Treat Suwayomi-local numeric manga/chapter identifiers, fetched page lists, and page URLs as transient resolution data. Do not persist them as Comic Free durable identity and do not expose upstream page URLs to the Browser WebUI.
- Resolve current Suwayomi runtime identifiers from durable Source Binding data before provider-dependent operations. If resolution fails, mark or report the binding unavailable without deleting local records.
- Create short-lived, in-memory reader sessions after chapter resolution. A reader session maps an opaque Local Core token and page index to a currently resolved upstream page request. Sessions expire on restart and can be recreated from the Library Item or current catalog context.
- Restrict the page proxy to reader sessions created by the Local Core. It must reject caller-supplied arbitrary URLs, forward only required upstream headers, apply bounded timeouts and response-size limits, preserve the successful image content type and exact bytes, and avoid logging cookies, authorization material, or image bodies.
- Implement one internal Plugin Host adapter interface for Source Plugin listing/status, search, details, chapters, and page resolution. The deterministic fixture adapter and Suwayomi adapter implement the same interface.
- Keep a Last Known Catalog of Source Plugin metadata and record refresh outcome separately. A failed refresh does not prove removal, and Suwayomi's transient `obsolete` observation is not copied directly into Comic Free's confirmed-removal state.
- Use explicit availability reason codes for disabled Source Plugin, missing Source Plugin, incompatible Source Plugin, Plugin Host unavailable, Comic Provider unreachable, refresh failure, unresolved catalog item, and unknown failure. User-facing text derives from these codes and may include safe diagnostic context.
- Store Comic Free SQLite, Suwayomi runtime state, and logs under Git-ignored `.local-data/` in normal development. Tests use isolated temporary directories and never mutate the developer's retained `.local-data/`.
- Introduce SQLite schema versioning with an initial migration. Use transactions for multi-record state changes and enable foreign-key enforcement. Deleting a Library Item is an explicit operation; status transitions never cascade into deletion.
- Accept a user-specified Suwayomi JAR path. The formal implementation does not download or update Suwayomi or Source Plugins automatically. Any task that needs new third-party code must pause for source-specific user approval.
- Run Suwayomi as a loopback-only managed child process on an available internal port with an isolated root directory, readiness deadline, captured logs, and distinct invalid-path, occupied-port, timeout, early-exit, and unexpected-exit outcomes.
- Do not claim Suwayomi lifecycle completion until an application-level, database-safe Windows shutdown path has been identified and verified by clean restart and state access. Abrupt process termination is only an explicitly reported fallback, not passing evidence.
- Keep the minimum Browser WebUI to four navigable surfaces: Library, Source Plugins, search/details, and reader. Each surface includes useful loading, empty, success, unavailable, and error states; visual polish beyond clear information hierarchy is deferred.
- Always show Source Plugin name with catalog results and reader context. The reader also shows comic title, chapter label, current page, and total pages.
- Implement the fixture-backed vertical slice before the Suwayomi adapter. Add live integration only after the same browser flow passes deterministically.
- Keep formal work off the prototype branches. The existing `prototype/*` branches remain historical evidence; implementation tickets created from this spec should define their own normal development branch/worktree strategy.

## Testing Decisions

- The primary acceptance seam is one browser-level end-to-end journey through the actual Browser WebUI, REST/JSON boundary, Local Core domain logic, SQLite repository, fixture adapter, and page proxy. This is the highest practical seam and is the release gate for the MVP slice.
- The deterministic page fixture must be visibly recognizable and non-transparent, with stable dimensions, content type, byte length, and SHA-256. The browser assertion must prove that the image decoded and rendered with non-zero natural dimensions; a status-only or 1x1 transparent response is insufficient.
- The primary journey asserts visible Source Plugin name, comic title, chapter label, current/total page indicator, and rendered page; then it retains the Library Item, records progress, makes the Source Binding unavailable, restarts the Local Core against the same database, and asserts the retained snapshot, unavailable reason, and exact progress.
- Run the primary journey once with a fresh temporary data directory and again across a deliberate Local Core restart. The test owns and removes only its named temporary directory after verifying the resolved path is inside the test workspace.
- Add REST contract tests for health, search, details, chapters, Library Item creation/listing, progress update/read, unavailable transitions, reader-session creation, stale-session behavior, and error envelopes.
- Add negative contract cases for malformed JSON, missing required fields, unknown references, negative or out-of-range page indexes, unsupported methods, and invalid content types. Validation failures return deterministic `4xx` responses and do not mutate SQLite.
- Add SQLite integration tests for first migration, idempotent reopen, transaction rollback, foreign-key enforcement, explicit Library Item deletion, source-failure retention, and restart persistence.
- Add page-proxy integration tests that compare exact bytes and content type, enforce page bounds, reject arbitrary external URLs, handle upstream timeout/non-image/oversize responses, and prove that sensitive upstream headers are not reflected or logged.
- Test the internal adapter contract once against the deterministic fixture and with recorded Suwayomi-shaped fixtures. This keeps GraphQL translation coverage deterministic without requiring Java, a network, or third-party execution in the normal suite.
- Test process supervision with a controlled local fake child for readiness, timeout, early exit, occupied internal port, unexpected exit, log capture, and port release. This suite does not substitute for the separate real Suwayomi shutdown proof.
- Gate the Suwayomi adapter with an opt-in local integration check using a user-specified, already-approved JAR and isolated data directory. It must verify readiness, adapter translation, transient-ID re-resolution after restart, and database-safe shutdown before the lifecycle ticket is complete.
- Keep MangaDex as an opt-in live smoke check, not a deterministic gate. It must use a user-approved installed extension, avoid asserting a permanently stable public title, and record the actual Source Plugin, selected comic, chapter, page count, image content type, byte count, and browser-visible rendering observed in that run.
- Do not rerun prior exploratory installation/search experiments as part of implementing the fixture slice. Reuse their conclusions; run a new live check only when validating the formal Suwayomi adapter or diagnosing a changed integration.
- A root verification command must run type checking, unit/integration tests, and the deterministic browser journey. A second explicitly named command runs approved local Suwayomi/live smoke checks so that third-party or network failures remain separated from core acceptance.
- Keep full logs under a task-specific test output directory and report command, exit code, decisive evidence, and log path. Test output must distinguish deterministic local success from optional live-provider observations.

## Out of Scope

- Tauri, Electron, installers, system-tray integration, automatic launch on login, or any other desktop packaging.
- A production-ready or fully polished WebUI, advanced reader gestures, continuous scrolling modes, themes, animation systems, or responsive mobile design.
- macOS, Linux, mobile, container, server-hosted, remote-browser, or LAN-access support.
- User accounts, authentication, multi-user state, cloud sync, provider-side bookmarks, social features, or telemetry.
- Batch download, offline library mirroring, archive export, media transcoding, OCR, translation, or content modification.
- Login-required Comic Providers, credential storage, cookie-management UI, CAPTCHA handling, or DRM circumvention.
- Arbitrary JavaScript plugins, multiple Plugin Host implementations, automatic trust decisions, or silent third-party code installation/update.
- A public extension marketplace or a complete extension update-management experience.
- Production security hardening, automatic migrations across released versions, backup/restore UX, auto-update, release signing, or support guarantees.
- Root-cause repair of the current MANGA Plus extension failure; it may remain recorded as an integration observation.
- Treating live MangaDex content, title availability, or page counts as stable product fixtures.
- Reusing throwaway prototype code without review. Prototype branches are evidence, not an implementation base or compatibility contract.

## Further Notes

- Confirmed evidence before this spec: the state model preserves local records through Source Plugin failure; Suwayomi `v2.3.2243` can be managed and queried locally; compatible Mihon extensions can be installed dynamically; MangaDex completed live search/details/chapters/page discovery; and a fixture Local Core completed REST/SQLite/exact-byte proxy/restart retention.
- A 2026-09-04 diagnostic additionally fetched one MangaDex page through the existing Suwayomi runtime as `image/jpeg` with 547,622 bytes and displayed it in a temporary loopback browser page together with the Source Plugin name, comic title, chapter, and page count. This proves live image bytes and browser display, but it is not evidence that the formal Suwayomi-to-Local-Core adapter exists.
- The same diagnostic found that stale Suwayomi-local chapter/page references returned `404` until chapter and page metadata were fetched again. This is the evidence for transient runtime resolution and ADR 0004.
- The main implementation risk is database-safe Windows shutdown of Suwayomi/H2. The lifecycle ticket must identify the supported application-level mechanism or document a narrowly bounded alternative with evidence; process disappearance alone is not acceptance.
- The first implementation increment should end after the deterministic browser-visible fixture journey passes. SQLite retention, source-unavailable behavior, and the image proxy belong in that same tracer bullet because separating them would recreate the already-fragmented prototype evidence.
- The next workflow step is `/to-tickets`, which should produce dependency-ordered, independently verifiable implementation tickets from this spec without expanding the scope.
