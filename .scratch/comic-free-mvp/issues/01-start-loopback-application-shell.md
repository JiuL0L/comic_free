# 01: Start the loopback application shell

**What to build:** Give the local reader one documented command that starts the Browser WebUI and Local Core, waits for readiness, and presents a useful browser-visible startup state instead of a blank page.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] Before downloading or executing any new third-party dependency, name its package source and purpose and obtain the user's explicit permission.
- [x] One root development command starts the Browser WebUI and Local Core and prints the browser URL.
- [x] The Local Core binds only to `127.0.0.1:3210` and fails rather than falling back to a LAN-visible address.
- [x] The Browser WebUI calls only the Local Core REST/JSON boundary and visibly distinguishes starting, ready, and failed states.
- [x] A versioned health response is runtime-validated through the shared Comic Free contracts.
- [x] Startup reports occupied-port and Local Core early-exit failures with actionable, non-sensitive details.
- [x] The root verification command type-checks the workspace and proves the health journey through the browser-facing seam.
- [x] Ordinary shutdown releases the Local Core port, and verification leaves the working tree free of runtime data.

## Answer

Implemented the formal loopback application shell on 2026-09-04.

- `pnpm dev` starts the Local Core, validates `GET /api/v1/health`, starts the Browser WebUI, waits for both services, and prints `http://127.0.0.1:5173/`.
- The Local Core and Browser WebUI use fixed loopback bindings on ports `3210` and `5173`; occupied ports and early process exits produce actionable terminal failures.
- The Browser WebUI visibly covers starting, ready, failed, and retry states while importing the shared runtime health contract.
- `pnpm verify` completed with exit code 0: TypeScript type-check, Vite production build, five contract/process tests, and one Chrome end-to-end health journey all passed. The journey also proved ordinary shutdown releases both ports.
- Full verification output is retained locally at `.local-data/test-output/01-start-loopback-application-shell/verify.log`; runtime output remains under the Git-ignored `.local-data/` boundary.
