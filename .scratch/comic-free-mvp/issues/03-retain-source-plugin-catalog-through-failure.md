# 03: Retain the Source Plugin catalog through failure

**What to build:** Let the local reader inspect Source Plugin availability and continue seeing the Last Known Catalog when refresh or provider access fails, while keeping confirmed removal distinct from temporary failure.

**Blocked by:** 01: Start the loopback application shell.

**Status:** resolved

- [x] The Source Plugin surface has explicit loading, empty, healthy, disabled, missing, incompatible, Plugin Host unavailable, Comic Provider unreachable, refresh-failed, and unknown states.
- [x] Successful refreshes persist a Last Known Catalog with observation timestamps in Comic Free-owned SQLite.
- [x] A failed refresh records its own outcome and reason without deleting previously known Source Plugin entries.
- [x] A confirmed removal is represented separately from refresh failure and requires explicit evidence rather than a missing refresh result.
- [x] Suwayomi's transient `obsolete` observation is not copied directly into Comic Free's confirmed-removal state.
- [x] Restoring a compatible Source Plugin makes affected Source Bindings explicitly refreshable without silently replacing Last Known Snapshots or Reading Progress.
- [x] Fixture-backed browser and SQLite tests prove catalog retention, recovery, confirmed removal, and restart persistence without internet access.

## Answer

Implemented a runtime-validated Source Plugin catalog contract, loopback REST routes, a versioned Comic Free-owned SQLite store, deterministic fixture adapter, and Browser WebUI catalog surface. Refresh outcomes are stored separately from catalog observations: failed or incomplete refreshes retain prior entries, only `removalEvidence: "confirmed"` creates `confirmed_removed`, and `reportedObsolete` never does. A recovered plugin persists `bindingsRefreshRequired: true` and surfaces that explicit recovery requirement without writing any Last Known Snapshot or Reading Progress data.

Unexpected adapter failures now record an `unknown` failed refresh, return a runtime-validated retryable `502` JSON error envelope, and leave the already loaded Last Known Catalog visible in the browser. Deterministic verification passed with `pnpm verify`: typecheck, production build, 13 contract/unit/SQLite/REST checks, and 2 Chrome journeys covering startup plus catalog failure/restart/removal/recovery without internet access.
