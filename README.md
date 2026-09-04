# Comic Free

Comic Free is a local, personal comic reader. The formal application provides a
loopback-only Browser WebUI and Local Core with deterministic reading, retained local
state, managed Suwayomi lifecycle, and an optional Suwayomi reading adapter.

## Start the application

Prerequisites: Node.js 26, pnpm 10, and a locally installed Google Chrome for the
browser acceptance check.

```powershell
pnpm install
pnpm dev
```

`pnpm dev` starts the Local Core on `127.0.0.1:3210`, waits for its validated `v1`
health response, starts the Browser WebUI, and prints:

```text
Comic Free is ready: http://127.0.0.1:5173/
```

Open that URL in a browser. Press `Ctrl+C` in the terminal to stop both local
processes. If either loopback port is occupied or a process exits early, the command
reports which component failed and what to check before retrying.

## Run an approved Suwayomi Plugin Host

Comic Free never downloads or updates Suwayomi. To opt in, provide both the exact
local JAR path and the SHA-256 that was explicitly approved for that artifact:

```powershell
$env:COMIC_FREE_SUWAYOMI_JAR = 'C:\path\to\Suwayomi-Server.jar'
$env:COMIC_FREE_SUWAYOMI_APPROVED_SHA256 = '<64-character approved digest>'
$env:COMIC_FREE_SUWAYOMI_SOURCE_ID = '<current Suwayomi source id>'
$env:COMIC_FREE_SUWAYOMI_SOURCE_PLUGIN_KEY = '<stable plugin-scoped key>'
$env:COMIC_FREE_SUWAYOMI_SOURCE_PLUGIN_NAME = '<display name>'
$env:COMIC_FREE_SUWAYOMI_COMIC_PROVIDER_KEY = '<stable provider key>'
pnpm dev
```

Java 21 with `java`, `javac`, and `jar` on `PATH` is required. Suwayomi binds to an
available loopback-only internal port (`4568` by default, configurable with
`COMIC_FREE_SUWAYOMI_PORT`), while its state and redacted structured logs stay under
the Git-ignored `.local-data/suwayomi/managed/` directory. The Browser WebUI reads a
normalized Local Core status route and never receives the GraphQL schema or shutdown
credential.

When all four Source Plugin variables are present, the reading UI uses the Suwayomi
adapter instead of the deterministic fixture. Comic Free derives durable comic and
chapter keys from provider-owned URLs, resolves current Suwayomi database identifiers
when reading starts, and gives the browser only short-lived Local Core page URLs.

After approving a particular local JAR, run the separate lifecycle proof:

```powershell
pnpm verify:suwayomi
```

This opt-in check starts the same artifact twice against one isolated data directory,
queries database-backed GraphQL state after each start, requests application-level JVM
shutdown, verifies that H2 lock files are gone, and confirms a clean reopen. An abrupt
termination is reported as `shutdown_failed` and does not pass this check.

With the approved runtime already running through `pnpm dev`, a second terminal can
run the opt-in reading check. Choose a search term appropriate for the installed Source
Plugin; the check does not install, update, start, or stop third-party code.

```powershell
$env:COMIC_FREE_SUWAYOMI_READING_QUERY = '<live search term>'
pnpm verify:suwayomi-reading
```

This reports the observed Source Plugin, comic, chapter, page count, image content type,
byte count, and SHA-256 without printing upstream page URLs or GraphQL payloads.

## Verify

```powershell
pnpm verify
```

The verification command type-checks and builds the workspace, runs contract, SQLite,
process, fixture-Suwayomi, and REST tests, then uses Chrome to exercise startup, catalog,
reading, retention, failure, restart, and reader-session renewal. It also verifies that
ordinary shutdown releases ports `3210` and `5173`.
