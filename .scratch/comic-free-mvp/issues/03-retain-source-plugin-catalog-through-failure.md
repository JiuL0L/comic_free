# 03: Retain the Source Plugin catalog through failure

**What to build:** Let the local reader inspect Source Plugin availability and continue seeing the Last Known Catalog when refresh or provider access fails, while keeping confirmed removal distinct from temporary failure.

**Blocked by:** 01: Start the loopback application shell.

**Status:** ready-for-agent

- [ ] The Source Plugin surface has explicit loading, empty, healthy, disabled, missing, incompatible, Plugin Host unavailable, Comic Provider unreachable, refresh-failed, and unknown states.
- [ ] Successful refreshes persist a Last Known Catalog with observation timestamps in Comic Free-owned SQLite.
- [ ] A failed refresh records its own outcome and reason without deleting previously known Source Plugin entries.
- [ ] A confirmed removal is represented separately from refresh failure and requires explicit evidence rather than a missing refresh result.
- [ ] Suwayomi's transient `obsolete` observation is not copied directly into Comic Free's confirmed-removal state.
- [ ] Restoring a compatible Source Plugin makes affected Source Bindings explicitly refreshable without silently replacing Last Known Snapshots or Reading Progress.
- [ ] Fixture-backed browser and SQLite tests prove catalog retention, recovery, confirmed removal, and restart persistence without internet access.
