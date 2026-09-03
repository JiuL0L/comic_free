# Suwayomi integration prototype

Status: confirmed scope

## Question

Can Comic Free manage a pinned Suwayomi Server process on this Windows machine, keep all runtime data inside Git-ignored `.local-data/`, detect readiness through a stable local HTTP/GraphQL probe, observe extension-management capability, and shut the child process down cleanly?

## Fixed external input

- Project: `Suwayomi/Suwayomi-Server`
- Release: `v2.3.2243` (official GitHub release marked Latest on 2026-09-03)
- Asset: `Suwayomi-Server-v2.3.2243.jar`
- Official SHA-256: `821141b32e170d4a02d3cbdfed577ed8f07bd22383ff5f4132ebb5ae40e98dd5`
- Release URL: `https://github.com/Suwayomi/Suwayomi-Server/releases/tag/v2.3.2243`
- Asset URL: `https://github.com/Suwayomi/Suwayomi-Server/releases/download/v2.3.2243/Suwayomi-Server-v2.3.2243.jar`

## Prototype boundary

- Use installed Java 21 and Node.js without adding project dependencies.
- Bind Suwayomi only to `127.0.0.1` on a prototype port.
- Disable browser launch, system tray, authentication, and bundled WebUI where supported.
- Put the downloaded JAR, generated configuration, database, cache, and logs under `.local-data/`.
- Surface command, PID, readiness attempts, endpoint result, shutdown result, and log paths.
- Do not install a third-party extension until Suwayomi process and API control are proven.

## Success criteria

- Downloaded JAR hash exactly matches the official digest.
- One command starts the pinned JAR with an isolated root directory.
- The probe distinguishes startup, ready, timeout, early exit, and occupied-port states.
- A local endpoint proves the server is responding and exposes enough API shape to locate extension management.
- The probe stops the child process and confirms the port is released.

## Non-goals

- Formal Local Core architecture or production process supervision.
- Comic Free SQLite schema or REST API.
- Real comic search, chapter reading, or image proxying.
- Third-party extension installation in this first integration step.

## Capture

- Throwaway branch: `prototype/suwayomi-integration`
- Planned probe: `apps/core/prototypes/suwayomi-integration.prototype.mjs`
