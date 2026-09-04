# PROJECT_MAP

Status: PARTIALLY VERIFIED

## Identity

- Project: `comic_free`
- Purpose: Local, personal comic browsing client with a WebUI and dynamically installable source-code modules.
- Repository: `https://github.com/JiuL0L/comic_free.git`; local `main` tracks `origin/main`.
- Branch: `main`
- Architecture and prototype scope: Confirmed by the user on 2026-09-03; formal implementation started with MVP ticket 01.
- Validated throwaway prototype: branch `prototype/source-failure-state`, artifact commit `360d6a9`, verdict commit `69729c5`; HTML is intentionally absent from `main`.
- Validated Suwayomi integration prototype: branch `prototype/suwayomi-integration`, commit `4416fd3`; executable probe code is intentionally absent from `main`.
- Validated dynamic extension prototype: branch `prototype/mihon-extension-flow`, commit `3ba7eb8`; executable probe code and third-party artifacts are intentionally absent from `main`.
- Validated MangaDex live-flow prototype: branch `prototype/mangadex-live-flow`, commit `1099106`; executable probe code and third-party artifacts are intentionally absent from `main`.
- Validated Local Core boundary prototype: branch `prototype/local-core-boundary`, artifact commit `718c179`, verdict commit `7229946`; executable prototype code is intentionally absent from `main`.
- Formal MVP specification: `.scratch/comic-free-mvp/spec.md`; status `ready-for-agent`. Seven dependency-ordered implementation tickets are published under `.scratch/comic-free-mvp/issues/`; ticket 01 provides the application shell and ticket 03 adds the retained Source Plugin catalog.

## Entrypoints

- WebUI: `apps/web/src/App.tsx`; React, TypeScript, and Vite in a local browser on Windows. It shows startup states plus the Source Plugin catalog loading, empty, availability, refresh-failure, confirmed-removal, and recovery states.
- Local Core: `apps/core/src/main.ts` composes `apps/core/src/server.ts`, `CatalogStore`, and the fixture catalog adapter; it is bound to `127.0.0.1:3210` and exposes health plus `GET /api/v1/source-plugins` and `POST /api/v1/source-plugins/refresh`.
- Shared contracts: `packages/contracts/src/index.ts`; runtime-validates the `v1` health and retained Source Plugin catalog responses.
- Development supervisor: `scripts/start-dev.ts` and `scripts/dev-supervisor.ts`; starts the Local Core and Browser WebUI, waits for readiness, reports failures, and shuts down both processes.
- Source plugin host: Suwayomi loading trusted Mihon extensions through its extension-management capabilities; not scaffolded.

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
- Library Items retain Last Known Snapshots. Source Plugin or Comic Provider failure marks a Source Binding unavailable without deleting the Library Item or Reading Progress.

## Planned prototype UI

- Library.
- Source Plugin management.
- Search and comic details.
- Minimal chapter page browsing.

## Planned data flow

`Browser WebUI -> local core -> Suwayomi -> Mihon Source Plugin -> Comic Provider`

Page images return through `Comic Provider -> Mihon Source Plugin -> Suwayomi -> local core proxy -> Browser WebUI`.

Suwayomi-local numeric manga/chapter identifiers, resolved page lists, and upstream page URLs are transient; the Local Core re-resolves them and gives the WebUI only short-lived reader-session references.

## Verification

- Setup verification: inspect the files under `docs/agents/` and run `git status --short --branch`.
- Ticket 01 development: `pnpm dev`; expected browser URL is `http://127.0.0.1:5173/`.
- Deterministic verification: `pnpm verify`; type-checks, builds, runs contract/process/SQLite tests, completes the Chrome startup and Source Plugin journeys, and proves loopback port release.
- Ticket 03 verification log: `.local-data/test-output/03-source-plugin-catalog/verify.log`; the isolated branch passed contract, SQLite, REST, startup, catalog-failure, restart, confirmed-removal, and recovery checks without network access.
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
- Formal Suwayomi-to-Local-Core translation and product Browser WebUI rendering: UNVERIFIED.
- Windows application-level graceful Suwayomi/H2 shutdown: UNVERIFIED; `child.kill("SIGTERM")` is not sufficient evidence of a database-safe shutdown.
- Formal Comic Free REST contracts, migrations, and product integration: UNVERIFIED; the validated schema and routes are throwaway fixtures, not production commitments.

## Uncertainty

- Exact REST resources, validation library, and persistence schema.
- Exact application-level mechanism for database-safe Suwayomi/H2 shutdown on Windows.
- Whether MANGA Plus's current extension failure is caused by Suwayomi compatibility, Java networking, or provider request semantics.
- Which stable public title and chapter should back repeatable optional live smoke checks; the successful substring search was pipeline evidence, not a fixed-title assertion.
