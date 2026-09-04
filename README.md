# Comic Free

Comic Free is a local, personal comic reader. The formal application currently provides
the loopback-only Browser WebUI and Local Core startup shell from MVP ticket 01.

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

## Verify ticket 01

```powershell
pnpm verify
```

The verification command type-checks and builds the workspace, tests the shared
health contract and startup failure paths, then uses the installed Chrome to exercise
the Browser WebUI startup, ready, failed, and retry states. It also verifies that
ordinary shutdown releases ports `3210` and `5173`.
