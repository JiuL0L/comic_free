# PROJECT_MAP

Status: PARTIALLY VERIFIED

## Identity

- Project: `comic_free`
- Purpose: Local, personal comic browsing client with a WebUI and dynamically installable source-code modules.
- Repository: Local Git repository with no remote configured.
- Branch: `main`
- Architecture and prototype scope: Confirmed by the user on 2026-09-03; formal implementation has not started.
- Validated throwaway prototype: branch `prototype/source-failure-state`, artifact commit `360d6a9`, verdict commit `69729c5`; HTML is intentionally absent from `main`.
- Validated Suwayomi integration prototype: branch `prototype/suwayomi-integration`, commit `4416fd3`; executable probe code is intentionally absent from `main`.

## Planned entrypoints

- WebUI: React, TypeScript, and Vite in a local browser on Windows; not scaffolded.
- Local core: Node.js and TypeScript service bound to `127.0.0.1:3210` that owns Library Items, Source Bindings, and Reading Progress through built-in `node:sqlite`, exposes a small REST/JSON interface to the WebUI, translates Suwayomi GraphQL internally, proxies page images, and manages the Suwayomi child process; not scaffolded.
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

## Verification

- Setup verification: inspect the files under `docs/agents/` and run `git status --short --branch`.
- Prototype verification: one command starts the Local Core and its Suwayomi child process; install, update, or disable a compatible trusted Mihon extension without rebuilding the WebUI or reinstalling the client; search, open details and chapters, display proxied pages, then disable the source and restart while retaining one Library Item and its Reading Progress.
- Required deterministic checks use local fixtures for search, details, chapters, image proxying, library retention, unavailable bindings, and restart persistence; they do not require a live Comic Provider.
- Candidate live source: `MANGA Plus by SHUEISHA`; current local reachability and readable titles remain UNVERIFIED.
- Candidate lifecycle source: `MANGA Plus Creators by SHUEISHA`; used to exercise install and disable behavior, with current local reachability still UNVERIFIED.
- Live-provider smoke checks are optional and cannot fail the local architecture solely because of network, region, licensing, or upstream changes.
- Source-failure state model: VALIDATED by direct reducer execution, Chrome walkthrough, and user acceptance on 2026-09-03.
- Suwayomi `v2.3.2243` startup, GraphQL readiness, extension API surface, occupied-port rejection, controlled process termination, and port release: VALIDATED on 2026-09-03 by prototype commit `4416fd3`.
- Windows application-level graceful Suwayomi/H2 shutdown: UNVERIFIED; `child.kill("SIGTERM")` is not sufficient evidence of a database-safe shutdown.
- Real Mihon extension loading, Comic Free SQLite persistence, and REST integration: UNVERIFIED.

## Uncertainty

- Exact REST resources, validation library, and persistence schema.
- Windows-specific graceful Suwayomi/H2 shutdown mechanism.
- Exact extension-store mutation inputs and compatible extension installation flow.
- Which fixed public title or chapter should be used for the optional live smoke check.
