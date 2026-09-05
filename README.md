# Comic Free

Comic Free is a local, personal comic reader. The formal application provides a
loopback-only Browser WebUI and Local Core, retained Source Plugin catalog and reading
state, safe Suwayomi lifecycle management, and explicitly approved Source Plugin changes.

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
pnpm dev
```

Java 21 with `java`, `javac`, and `jar` on `PATH` is required. Suwayomi binds to an
available loopback-only internal port (`4568` by default, configurable with
`COMIC_FREE_SUWAYOMI_PORT`), while its state and redacted structured logs stay under
the Git-ignored `.local-data/suwayomi/managed/` directory. The Browser WebUI reads a
normalized Local Core status route and never receives the GraphQL schema or shutdown
credential.

After approving a particular local JAR, run the separate lifecycle proof:

```powershell
pnpm verify:suwayomi
```

This opt-in check starts the same artifact twice against one isolated data directory,
queries database-backed GraphQL state after each start, requests application-level JVM
shutdown, verifies that H2 lock files are gone, and confirms a clean reopen. An abrupt
termination is reported as `shutdown_failed` and does not pass this check.

## Manage an approved Source Plugin

The Source Plugins screen can install, update, disable, or restore a trusted Mihon
extension through the Local Core. Each request identifies the extension store URL,
package name, and (except for disable) exact approved version. The action remains
disabled until the user checks the source-specific approval box. The Browser WebUI never
calls Suwayomi directly.

Successful changes update the retained catalog immediately and expose normalized Comic
Provider names after reload without rebuilding the WebUI. Disable is a Comic Free-local
state change: the approved package remains installed in Suwayomi and no uninstall mutation
is sent. Disabling makes matching Source Bindings unavailable; updating or restoring marks
them `refresh_required`. Library Items, Last Known Snapshots, and Reading Progress remain
unchanged. Catalog refresh failure remains a separate retained observation. Provider search
and reading through Suwayomi remain ticket 05; this screen owns management and discovery.

After approving one exact extension operation, the opt-in restart check requires all of
the following values and refuses to run when any value or the approval flag is absent:

```powershell
$env:COMIC_FREE_SOURCE_PLUGIN_CHANGE_APPROVED = 'true'
$env:COMIC_FREE_SUWAYOMI_JAR = 'C:\path\to\Suwayomi-Server.jar'
$env:COMIC_FREE_SUWAYOMI_APPROVED_SHA256 = '<64-character approved digest>'
$env:COMIC_FREE_SOURCE_PLUGIN_STORE_URL = 'https://trusted.example/repo/index.pb'
$env:COMIC_FREE_SOURCE_PLUGIN_PACKAGE = 'approved.package.name'
$env:COMIC_FREE_SOURCE_PLUGIN_VERSION = 'approved.version'
# Optional when the JVM cannot reach the approved store directly:
$env:COMIC_FREE_SUWAYOMI_PROXY = 'http://127.0.0.1:7897'
pnpm verify:source-plugin-changes
```

The check installs only that approved version into an isolated data directory, performs
an application-level safe shutdown, starts the same Plugin Host state again, and verifies
that the installed Source Plugin survived the restart.

## Verify the deterministic application

```powershell
pnpm verify
```

The verification command type-checks and builds the workspace, tests the shared
health contract and startup failure paths, then uses the installed Chrome to exercise
the Browser WebUI startup, ready, failed, and retry states. It also verifies that
ordinary shutdown releases ports `3210` and `5173`.
