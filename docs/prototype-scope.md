# Comic Free architecture and prototype scope

Status: Confirmed by the user on 2026-09-03. This document authorizes no formal product implementation.

Validated finding: The user accepted the source-failure state model on 2026-09-03 after an interactive throwaway prototype. The artifact remains on branch `prototype/source-failure-state` at commit `360d6a9`; this validates state transitions, not real SQLite or Suwayomi integration.

Validated finding: MangaDex `1.4.212` was dynamically installed through Suwayomi and completed live search, details, chapter discovery, and page URL discovery on 2026-09-03. The artifact remains on branch `prototype/mangadex-live-flow` at commit `1099106`; this validates traversal through page URLs, not actual image-byte proxying, SQLite persistence, or browser rendering.

Validated finding: A minimal Node.js Local Core bound to `127.0.0.1:3210` exposed normalized fixture-backed REST/JSON, stored Library Items, Last Known Snapshots, Source Bindings, and Reading Progress in Comic Free-owned SQLite, proxied the fixture provider's exact PNG bytes, and retained the unavailable binding and reading state across restart. Two consecutive deterministic checks passed on 2026-09-03. The executable artifact remains on branch `prototype/local-core-boundary` at commit `718c179`, with verdict commit `7229946`; this does not validate live-provider image bytes, Suwayomi translation, browser rendering, formal contracts, migrations, or production hardening.

Validated finding: The pinned Suwayomi `v2.3.2243` JAR passed digest verification, reached GraphQL readiness, exposed extension-management operations, rejected an occupied port before startup, and released its port after controlled termination. The executable probe remains on branch `prototype/suwayomi-integration` at commit `4416fd3`. Windows application-level graceful shutdown of Suwayomi and H2 remains unverified.

Validated finding: Suwayomi dynamically added the current Keiyoushi protobuf store, installed `MANGA Plus by SHUEISHA 1.6.65`, exposed nine language sources, and retained the installation across restart. The executable probe remains on branch `prototype/mihon-extension-flow` at commit `3ba7eb8`. Live MANGA Plus browsing did not pass: SEARCH, POPULAR, and LATEST all returned the extension's generic error despite direct provider API reachability. A failed store refresh also marked the retained extension obsolete, so Comic Free must preserve a Last Known Catalog and distinguish refresh failure from confirmed removal.

## Goal

Prove that a local browser client can browse comics through dynamically managed source-code modules while keeping the user's library and reading state independent from any single module or remote provider.

## Architecture

```text
Browser WebUI
    -> Local Core REST/JSON API
        -> local SQLite state
        -> Suwayomi GraphQL adapter
            -> trusted Mihon Source Plugin
                -> Comic Provider
```

Page images return through the Local Core proxy. The WebUI never calls Suwayomi or a Comic Provider directly.

## Components

### Browser WebUI

- React, TypeScript, and Vite.
- Runs in the current Windows machine's local browser.
- Calls only the Local Core REST/JSON API.
- Contains Library, Source Plugin management, search and details, and minimal chapter browsing screens.

### Local Core

- Node.js and TypeScript.
- Listens only on `127.0.0.1:3210`; prototype authentication is unnecessary because LAN exposure is forbidden.
- Owns stable browser-facing contracts, local persistence, page proxying, Suwayomi translation, and child-process lifecycle.
- Uses built-in `node:sqlite` to avoid an additional native database dependency.

### Plugin Host

- A user-specified Suwayomi JAR running as a managed child process on an internal available port.
- Loads only compatible Mihon extensions from a trusted extension store or an explicit local import.
- May require a Local Core restart after extension installation or update.
- Is replaceable; its GraphQL schema is not exposed to the WebUI.

## Dynamic extension boundary

For this prototype, dynamic addition means installing, updating, disabling, or replacing compatible Mihon extensions without changing or rebuilding the WebUI and without reinstalling Comic Free.

It does not mean executing an arbitrary unknown JavaScript module. A custom JavaScript Plugin Host and support for multiple Plugin Hosts are deferred until the Suwayomi path has proved the boundary.

## Local state ownership

Comic Free owns these minimal records:

- Library Item: stable local identity and Last Known Snapshot.
- Source Binding: plugin identity, provider-specific comic identity, and availability status.
- Reading Progress: last-read chapter and page.

Suwayomi owns extension installation state, provider-specific cookies, remote catalog details, and temporary cache data.

All prototype runtime state is retained under Git-ignored `.local-data/`. It survives ordinary restarts but has no promised migration path to a formal product.

## Failure behavior

When a Source Plugin is disabled, incompatible, removed, or unable to reach its Comic Provider:

- The Library Item, Last Known Snapshot, Source Binding, and Reading Progress remain stored.
- The binding is shown as unavailable with an actionable reason when known.
- Provider-dependent refresh and chapter loading may fail without making the local item disappear.
- Re-enabling or repairing the source permits an explicit refresh; it does not silently replace local state.

Startup timeout, invalid JAR path, occupied public port, and child-process exit must be reported distinctly.

## Repository shape

```text
apps/web          Browser WebUI
apps/core         Local Core
packages/contracts Shared validated contracts
tests/fixtures    Deterministic provider and integration fixtures
```

The repository will use a `pnpm` workspace while remaining one domain context.

## Prototype acceptance

Required deterministic checks:

1. One command starts the Local Core and its managed Suwayomi process.
2. Fixture-backed search returns normalized results.
3. Details and chapters can be opened.
4. Page images are returned through the Local Core proxy.
5. A comic can be retained as a Library Item with Reading Progress.
6. Disabling or failing its source leaves the local item and progress intact and visibly unavailable.
7. Restarting the prototype preserves the same local state.
8. A compatible trusted Mihon extension can be installed, updated, or disabled without rebuilding the WebUI.

Current evidence: the deterministic Local Core portion of search, details, chapters, page-byte proxying, library retention, unavailable binding state, and restart persistence is validated by `prototype/local-core-boundary`. Its one-command check starts a loopback fixture Comic Provider and the Local Core, not a managed Suwayomi child; the previously validated Suwayomi and extension prototypes remain separate evidence.

Optional live smoke check:

- Try `MANGA Plus by SHUEISHA` for real search and reading flow.
- Try `MANGA Plus Creators by SHUEISHA` for extension lifecycle behavior.
- Use MangaDex as the currently validated alternate provider path; pin a stable public title and chapter before treating the live smoke check as repeatable.
- Network, region, licensing, removed titles, or upstream changes are reported separately and do not alone invalidate the deterministic prototype.

## Explicitly out of scope

- Formal desktop packaging or Tauri shell.
- macOS, Linux, mobile, or LAN access.
- Full reader polish, batch or offline downloads, accounts, cloud sync, and migration guarantees.
- Login-required providers.
- Arbitrary JavaScript plugins or automatic execution of untrusted code.
- Silent extension installation or an automatic extension marketplace.
- Production security hardening, auto-update, telemetry, and release packaging.

## Deferred implementation choices

- Exact REST resources and error schema.
- Runtime validation library and final SQLite table design.
- Windows-specific graceful Suwayomi/H2 shutdown mechanism.
- Root cause of the current MANGA Plus extension failure under Suwayomi.
- Alternate extension for the optional live smoke check if MANGA Plus remains unusable.
- Exact fixed title or chapter for the optional live smoke check.

These choices may be settled during a throwaway prototype only if they do not widen the scope above.
