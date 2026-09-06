# Comic Free

Comic Free is a local, personal comic reader. The formal application provides a
loopback-only Browser WebUI and Local Core, retained Source Plugin catalog and reading
state, safe Suwayomi lifecycle management, explicitly approved Source Plugin changes,
and an optional Suwayomi reading adapter.

## Start the application

Windows 日常使用：已安装 Node.js 26 和 pnpm 10 后，首次在项目目录运行
`pnpm install --frozen-lockfile`，以后双击 `Start-Comic-Free.cmd`，或运行
`pnpm start`。启动器检查环境、启动本地服务，并打开默认浏览器。

页面按「书架 / 找漫画 / 阅读 / 设置」组织。首次进入「设置」保存本地
Suwayomi JAR 路径、该文件已确认的 SHA-256、可选 HTTP 代理和内部端口，
再按 `Ctrl+C` 停止启动器并重新双击启动，设置才会生效。配置在线来源还需
Java 21 JDK；未配置时可先阅读内置示例漫画。程序不会自动下载运行时或扩展。

在「找漫画」选择已安装的来源，打开漫画并「加入书架」；加入后阅读位置
自动保存，可使用单页或连续阅读、键盘翻页、上一章和下一章。下次从书架继续。
书架与设置保存在项目的 `.local-data`（可通过 `COMIC_FREE_DATA_DIR` 指定）。
详细启动与故障说明见 [Windows 一键启动](docs/daily-reader-launch.md)。

在线目录提供有效章节号时按章节号升序阅读；章节号缺失时保留来源目录顺序，
可从章节列表选择。来源尚未配置或连接失败时，页面会显示当前状态与恢复入口。

Development uses the same services without automatically opening a browser.
Google Chrome is required only for the browser acceptance checks.

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
# Select one approved entry from GET /api/v1/reading/providers for this smoke check.
$env:COMIC_FREE_SUWAYOMI_SOURCE_PLUGIN_KEY = '<installed package name>'
$env:COMIC_FREE_SUWAYOMI_COMIC_PROVIDER_KEY = '<stable Provider key from the list>'
$env:COMIC_FREE_SUWAYOMI_READING_QUERY = '<live search term>'
pnpm verify:suwayomi-reading
```

This reports the observed Source Plugin, comic, chapter, page count, image content type,
byte count, and SHA-256 without printing upstream page URLs or GraphQL payloads.

## Manage an approved Source Plugin

The Source Plugins screen can install, update, disable, or restore a trusted Mihon
extension through the Local Core. Each request identifies the extension store URL,
package name, and (except for disable) exact approved version. The action remains
disabled until the user checks the source-specific approval box. The Browser WebUI never
calls Suwayomi directly.

Successful changes update the retained catalog immediately and expose normalized Comic
Providers in the reading selector automatically (or through Refresh providers) without rebuilding the WebUI. Select the Source Plugin, Provider name and language before searching. Disable is a Comic Free-local
state change: the approved package remains installed in Suwayomi and no uninstall mutation
is sent. Disabling makes matching Source Bindings unavailable; updating or restoring marks
them `refresh_required`. Library Items, Last Known Snapshots, and Reading Progress remain
unchanged. Catalog refresh failure remains a separate retained observation. This screen
owns management and discovery; the configured reading adapter handles provider reading.

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

The verification command type-checks and builds the workspace, runs contract, SQLite,
process, fixture-Suwayomi, and REST tests, then uses Chrome to exercise startup, catalog,
reading, retention, failure, restart, and reader-session renewal. It also verifies that
ordinary shutdown releases ports `3210` and `5173`.

## Installed Comic Providers

With an approved Host configured, install or restore a specifically approved extension
in Source Plugins, then select its Provider in Find a comic. The application discovers
current Host source IDs itself; the old SOURCE_ID / SOURCE_PLUGIN_NAME reading settings
are no longer needed. A configured but unavailable Host never falls back to fixture reading.
The list retains Last Known Catalog entries on observation failure and provides retry.
Disabled or unobserved Providers cannot read. After a failure, use Refresh Source Binding
before resuming a saved Library Item; snapshots and progress are retained.

Provider identity is scoped by installed package plus exact Provider name and language.
Current numeric source/manga/chapter IDs stay in memory. Ambiguous duplicate identities
are rejected. A Provider rename or an older manually assigned binding identity is not
silently remapped: the saved item remains retained and unresolved until its original
identity is available again.
