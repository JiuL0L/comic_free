# Probe Suwayomi process and API

Status: resolved

## Objective

Build and run the minimal integration probe described in `../spec.md`, using the pinned official JAR and isolated prototype data.

## Acceptance

- Official JAR digest is verified before execution.
- Probe uses one command and no added package dependency.
- Process readiness and shutdown are observable.
- API/GraphQL capability evidence is recorded without installing a third-party extension.
- Artifact remains outside `main` on `prototype/suwayomi-integration`.

## Answer

The process and GraphQL boundary are feasible on this Windows machine. The pinned official JAR passed SHA-256 verification, reached GraphQL readiness in about 4.3 seconds, exposed extension queries and mutations, rejected an occupied port before Java startup, and released its port after controlled process termination.

The executable probe and detailed run record remain on branch `prototype/suwayomi-integration` at commit `4416fd3`, outside `main`.

Formal implementation still needs a Windows-specific graceful shutdown mechanism. Node's `child.kill("SIGTERM")` ended the JVM without force fallback, but neither the logs nor `jcmd help` proved that Suwayomi's application shutdown hook and H2 close path ran. Process disappearance must not be treated as evidence of a database-safe shutdown.

Disabling KCEF produced a non-fatal upstream `CEF is disabled` error before the server began listening.

## Evidence

- Suwayomi version: `v2.3.2243`
- JAR bytes: `174128768`
- Verified SHA-256: `821141b32e170d4a02d3cbdfed577ed8f07bd22383ff5f4132ebb5ae40e98dd5`
- Final readiness: 5 attempts, 4263 ms, GraphQL root type `Query`
- GraphQL shape: 32 query fields and 78 mutation fields
- Extension queries: `extension`, `extensions`, `extensionStore`, `extensionStores`
- Extension mutations: `fetchExtensions`, `installExternalExtension`, `updateExtension`, `updateExtensions`, `addExtensionStore`, `removeExtensionStore`
- Controlled termination: no force fallback; port released on first check
- Port-conflict check: clear failure before Java startup
- Prototype artifact: branch `prototype/suwayomi-integration`, commit `4416fd3`

## Comments

- 2026-09-03: User authorized downloading the official Suwayomi release artifact.
- 2026-09-03: The downloaded JAR matched the official release size and digest after resumable transfers.
- 2026-09-03: Final process/API probe and occupied-port path passed; application-level graceful shutdown remains a separate implementation risk.
