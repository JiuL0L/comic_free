# PROJECT_MAP

Status: PARTIALLY VERIFIED

## Identity

- Project: `comic_free`
- Purpose: Local, personal comic browsing client with a WebUI and dynamically installable source-code modules.
- Repository: `https://github.com/JiuL0L/comic_free.git`; local `main` tracks `origin/main`.
- Integration branch: `main`; implementation work uses task-specific `codex/` branches.
- Architecture and prototype scope: Confirmed by the user on 2026-09-03; formal implementation started with MVP ticket 01.
- Validated throwaway prototype: branch `prototype/source-failure-state`, artifact commit `360d6a9`, verdict commit `69729c5`; HTML is intentionally absent from `main`.
- Validated Suwayomi integration prototype: branch `prototype/suwayomi-integration`, commit `4416fd3`; executable probe code is intentionally absent from `main`.
- Validated dynamic extension prototype: branch `prototype/mihon-extension-flow`, commit `3ba7eb8`; executable probe code and third-party artifacts are intentionally absent from `main`.
- Validated MangaDex live-flow prototype: branch `prototype/mangadex-live-flow`, commit `1099106`; executable probe code and third-party artifacts are intentionally absent from `main`.
- Validated Local Core boundary prototype: branch `prototype/local-core-boundary`, artifact commit `718c179`, verdict commit `7229946`; executable prototype code is intentionally absent from `main`.
- Formal MVP specification: `.scratch/comic-free-mvp/spec.md`; status `implemented` (local deterministic acceptance; follow-up publication pending). Ten implementation tickets are published under `.scratch/comic-free-mvp/issues/`; tickets 01–06 provide the shell, deterministic reading/retention, retained Source Plugin catalog, approved Suwayomi lifecycle, transient Suwayomi reader sessions, and explicitly approved Source Plugin changes.

## Entrypoints

- Daily reader: `Start-Comic-Free.cmd` / `scripts/launch-reader.ts` (`pnpm start`) checks installed runtimes, starts the supervised services, and opens the Windows default browser; `docs/daily-reader-launch.md` documents setup. `apps/web/src/App.tsx` provides the Chinese shelf/discovery/reader/settings navigation, with saved setup in `Settings.tsx`.
- Persisted setup: `packages/contracts/src/settings.ts`, `apps/core/src/settings.ts`, and `settings-http.ts` validate `GET/PUT /api/v1/settings` and atomically store settings in the selected data directory. Runtime environment overrides remain supported; changes take effect after restart. Feature scope: `.scratch/daily-reader/spec.md`; browser acceptance: `tests/e2e/daily-reader.spec.ts`.

- Source recovery: `apps/core/src/reading-service.ts` checks retained plugin policy before and after reading; `POST /api/v1/source-bindings/:id/refresh` re-resolves saved identity/page without overwriting snapshots or progress. `apps/core/src/source-recovery-http.test.ts` covers disable, scoped failures, restart, and interleaved recovery.

- WebUI: `apps/web/src/App.tsx`, `apps/web/src/PluginHostStatus.tsx`, `apps/web/src/SourcePlugins.tsx`, and `apps/web/src/ReadingExperience.tsx`; React, TypeScript, and Vite in a local browser on Windows. Startup states lead into managed Plugin Host status, retained Source Plugin catalog, fixture search/details/chapter reader, and retained Library Items.
- Source Comic gallery: `ReadingExperience.tsx` automatically follows every `GET /api/v1/catalog/browse` page for the selected Comic Provider and renders clickable cover cards. `GET /api/v1/catalog/comics/:comicKey/cover` proxies bounded image bytes through the Local Core; the Suwayomi adapter uses its loopback manga-thumbnail endpoint and keeps runtime manga ids in memory only. Feature scope: `.scratch/source-comic-gallery/spec.md`.
- Installed Provider routing: `apps/core/src/reading-runtime.ts` is the shared production/test composition; `reading-provider-registry.ts` resolves package + Provider identities to current Host adapters. `GET /api/v1/reading/providers` supplies the validated selector; selected search accepts `comicProviderKey`, and subsequent comic keys carry Provider scope.
- Local Core: `apps/core/src/main.ts` composes `apps/core/src/server.ts`, `CatalogStore`, the fixture catalog adapter, `ReadingStore`, `ReadingService`, Source Plugin change service, and the optional approved Suwayomi Plugin Host; it is bound to `127.0.0.1:3210`.
- Plugin Host lifecycle: `apps/core/src/plugin-host-manager.ts` owns validated spawn/readiness/status/logging/shutdown behavior; `apps/core/src/suwayomi-plugin-host.ts` supplies isolated Suwayomi arguments; `apps/core/java/comicfree/shutdown/ComicFreeShutdownAgent.java` provides the application-level JVM shutdown endpoint.
- Deterministic adapter: `apps/core/src/reading-adapter.ts`; implements the replaceable catalog/page interface with one named Source Plugin, durable provider keys, and two chapters of three local SVG pages each.
- Suwayomi reading adapter: `apps/core/src/suwayomi-reading-adapter.ts`; validates GraphQL responses, derives durable keys from provider URLs, re-resolves runtime ids, and fetches bounded image bytes only from the configured loopback Plugin Host.
- Source Plugin changes: `apps/core/src/source-plugin-change.ts` owns serialized, approval-gated bounded operations, safe logs, and the deterministic adapter; `apps/core/src/catalog-store.ts` atomically persists normalized providers and synchronizes Source Bindings; `apps/core/src/suwayomi-source-plugin-change.ts` translates install/update to Suwayomi GraphQL while disable remains a persistent Comic Free-local state and does not uninstall the extension.
- Reading diagnostics: `apps/core/src/reading-http.ts` emits bounded structured failure records; `reading-diagnostics.test.ts` verifies failure layers and redaction through HTTP. `reading-runtime.test.ts` covers external Host metadata refresh.
- Explicit Library Item deletion: `apps/core/src/reading-http.ts` exposes `DELETE /api/v1/library-items/:id` (200 with `deletedId`, unknown/repeat 404); `ReadingService` invalidates matching transient sessions and `ReadingStore` cascades local records. `ReadingExperience.tsx` confirms the title and local progress removal and discards stale reading responses. Regression entrypoints: `apps/core/src/reading-service.test.ts` and `tests/e2e/library-deletion.spec.ts`.
- Shared contracts: `packages/contracts/src/index.ts` and `packages/contracts/src/reading.ts`; runtime-validate the `v1` health, Plugin Host lifecycle, catalog, reader-session, Library Item, error, and Reading Progress boundaries.
- Development supervisor: `scripts/start-dev.ts` and `scripts/dev-supervisor.ts`; starts the Local Core and Browser WebUI, waits for readiness, reports failures, and shuts down both processes. Local Core shutdown uses IPC so Windows can await its managed Plugin Host before exit; `scripts/dev-supervisor-lifecycle.test.ts` covers cooperative shutdown and failure propagation.
- Source plugin host: approved Suwayomi process lifecycle and trusted Mihon extension install/update/local-disable/restore are implemented; normalized providers are available to the management catalog after reload, and the configured Suwayomi adapter translates provider search and reading.

## Planned repository layout

- `apps/web`: Browser WebUI.
- `apps/core`: Local Core.
- `packages/contracts`: Shared, validated request and response contracts.
- `tests/fixtures`: Deterministic provider and integration fixtures.
- Package management: `pnpm` workspace.
- Prototype platform: The current Windows machine and local browser only; cross-platform and mobile support are out of scope.

## Planned runtime and data

- The Local Core listens only on loopback and has no authentication in the prototype.
- The Local Core starts a user-specified Suwayomi JAR on an available internal port, waits for readiness with a timeout, reports startup failures, and stops the child process when it exits.
- `.local-data/` stores the SQLite database, Suwayomi state, and logs; it is ignored by Git and retained across restarts.
- Prototype data is not guaranteed to migrate directly into a formal product.
- Library Items, Last Known Snapshots, Source Bindings, and Reading Progress use explicit SQLite migrations and transactional retention. Source Plugin observations and the Comic Free-local disable policy are persisted separately; ordinary refresh cannot silently restore a locally disabled plugin. Source Plugin or Comic Provider failure marks a Source Binding unavailable and invalidates matching Reader Sessions; approved update or restoration marks retained bindings `refresh_required`; all local records remain intact.

## Planned prototype UI

- Library with retained snapshots, unavailable reasons, and Reading Progress.
- Source Plugin management.
- Fixture-backed search and comic details.
- Bounded chapter page browsing through opaque Local Core reader sessions.

## Planned data flow

`Browser WebUI -> local core -> Suwayomi -> Mihon Source Plugin -> Comic Provider`

Page images return through `Comic Provider -> Mihon Source Plugin -> Suwayomi -> local core proxy -> Browser WebUI`.

Suwayomi-local numeric manga/chapter identifiers, resolved page lists, and upstream page URLs are transient; the Local Core re-resolves them and gives the WebUI only short-lived reader-session references.

## Verification

- Setup verification: inspect the files under `docs/agents/` and run `git status --short --branch`.
- Ticket 01 development: `pnpm dev`; expected browser URL is `http://127.0.0.1:5173/`.
- Deterministic verification: `pnpm verify`; type-checks, builds, runs contract/process/SQLite tests, completes the Chrome startup, Plugin Host status, Source Plugin, and reading journeys, and proves loopback port release.
- Opt-in real lifecycle verification: with an explicitly approved local artifact configured, `pnpm verify:suwayomi` starts the same Suwayomi data root twice, probes database-backed GraphQL state, requests in-JVM application shutdown, and verifies H2 lock and port release.
- Ticket 06 deterministic verification: `pnpm verify` covers approval/version gates, all four fixture change transitions, safe errors/logs, catalog evidence retention, Source Binding preservation, Suwayomi-shaped GraphQL translation, and browser-visible pending/success/failure/restart-required outcomes.
- Ticket 06 opt-in integration: with one explicitly approved JAR, extension store, package, and version configured, `pnpm verify:source-plugin-changes` installs that exact Source Plugin and verifies it survives a database-safe Plugin Host restart.
- Ticket 06 live integration: VALIDATED on 2026-09-04 with approved Suwayomi `v2.3.2243` SHA-256 `821141B32E170D4A02D3CBDFED577ED8F07BD22383FF5F4132EBB5AE40E98DD5`, Keiyoushi store, and MangaDex `1.4.212`; install and same-data-root restart each exposed 61 normalized Providers. The JVM used explicit credential-free proxy `http://127.0.0.1:7897` after direct `github.com` access timed out. Exit code `0`, port `4569` released, and no H2 lock remained.
- Ticket 02 focused verification: `pnpm exec tsx --test packages/contracts/src/reading.test.ts apps/core/src/reading-adapter.test.ts apps/core/src/reading-store.test.ts apps/core/src/reading-http.test.ts` and `pnpm exec playwright test tests/e2e/reading.spec.ts`.
- Ticket 02 full verification: `pnpm verify`; includes exact fixture-byte checks, transaction rollback/foreign-key/reopen tests, REST negative cases, the browser-visible reading journey, source failure, session invalidation, and retained-directory restart.
- Ticket 03 verification log: `.local-data/test-output/03-source-plugin-catalog/verify.log`; the isolated branch passed contract, SQLite, REST, startup, catalog-failure, restart, confirmed-removal, and recovery checks without network access.
- Ticket 05 focused verification: recorded Suwayomi generations plus REST restart tests prove runtime-id renewal, opaque sessions, stable errors, exact image bytes, and bounded proxy behavior without Java or network. `pnpm verify:suwayomi-reading` remains opt-in for an already approved running runtime.
- Prototype verification: one command starts the Local Core and its Suwayomi child process; install, update, or disable a compatible trusted Mihon extension without rebuilding the WebUI or reinstalling the client; search, open details and chapters, display proxied pages, then disable the source and restart while retaining one Library Item and its Reading Progress.
- Required deterministic checks use local fixtures for search, details, chapters, image proxying, library retention, unavailable bindings, and restart persistence; they do not require a live Comic Provider.
- Candidate live source: `MANGA Plus by SHUEISHA`; current local reachability and readable titles remain UNVERIFIED.
- Candidate lifecycle source: `MANGA Plus Creators by SHUEISHA`; used to exercise install and disable behavior, with current local reachability still UNVERIFIED.
- Live-provider smoke checks are optional and cannot fail the local architecture solely because of network, region, licensing, or upstream changes.
- Source-failure state model: VALIDATED by direct reducer execution, Chrome walkthrough, and user acceptance on 2026-09-03.
- Suwayomi `v2.3.2243` startup, GraphQL readiness, extension API surface, occupied-port rejection, controlled process termination, and port release: VALIDATED on 2026-09-03 by prototype commit `4416fd3`.
- Dynamic Keiyoushi store addition, MANGA Plus extension installation, source enumeration, and restart retention: VALIDATED on 2026-09-03 by prototype commit `3ba7eb8`.
- A failed store refresh can collapse Suwayomi's catalog to installed entries and mark an installed extension obsolete: OBSERVED; Comic Free requires a Last Known Catalog and refresh-failure state.
- MANGA Plus live catalog access through the installed extension: FAILED in SEARCH, POPULAR, and LATEST modes despite direct provider API reachability; details, chapters, pages, and image proxying remain UNVERIFIED.
- MangaDex `1.4.212` dynamic installation, 61-source enumeration, live search, details, chapters, and page URL discovery through Suwayomi GraphQL: VALIDATED on 2026-09-03 by prototype commit `1099106`; the successful selected result returned 95 page URLs.
- Local Core `127.0.0.1:3210` REST/JSON facade, Comic Free-owned SQLite state, exact fixture PNG byte proxying, source-failure retention, and restart persistence: VALIDATED with deterministic fixtures on 2026-09-03 by artifact commit `718c179` and verdict commit `7229946`; two consecutive full checks passed.
- Live MangaDex page image bytes and browser rendering through a temporary loopback diagnostic proxy: VALIDATED on 2026-09-04 (`200 image/jpeg`, 547622 bytes, with Source Plugin name, comic title, chapter, and page count visible). This is evidence for the boundary, not a formal Local Core adapter.
- Suwayomi-local numeric chapter/page references becoming stale after restart and requiring fresh chapter/page resolution: OBSERVED on 2026-09-04; they must not be persisted as durable Comic Free identity.
- Formal Suwayomi-to-Local-Core translation and Browser WebUI reader-session renewal: VALIDATED deterministically with recorded Suwayomi-shaped fixtures; a live configured-runtime run remains optional and UNVERIFIED.
- Windows application-level graceful Suwayomi/H2 shutdown: VALIDATED on 2026-09-04 with official Suwayomi `v2.3.2243` at SHA-256 `821141B32E170D4A02D3CBDFED577ED8F07BD22383FF5F4132EBB5AE40E98DD5`. Two consecutive runs reached GraphQL readiness, queried the database, stopped through the in-JVM shutdown-agent endpoint, released port `4568`, left no H2 lock, and reopened `runtime/database.mv.db` cleanly.
- Formal fixture-backed Comic Free REST contracts, initial reading-state migration, transactional retention, exact-byte session proxy, Browser WebUI journey, restart persistence, and approved Suwayomi process lifecycle: VALIDATED by tickets 02–04. Suwayomi catalog/reader translation remains UNVERIFIED.

- Ticket 07 live observation and approved integration repairs: `docs/07-mangadex-smoke-observation.md`; real MangaDex page rendering, retained page-2 resume after restart, and normal three-port release validated on 2026-09-05.

## Uncertainty

- Whether future Suwayomi releases preserve compatibility with the first-party Java shutdown-agent injection; every newly approved artifact must repeat the lifecycle verification.
- Whether MANGA Plus's current extension failure is caused by Suwayomi compatibility, Java networking, or provider request semantics.
- Which stable public title and chapter should back repeatable optional live smoke checks; the successful substring search was pipeline evidence, not a fixed-title assertion.
