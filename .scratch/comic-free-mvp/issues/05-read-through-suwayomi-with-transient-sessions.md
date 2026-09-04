# 05: Read through Suwayomi with transient reader sessions

**What to build:** Let the local reader complete the existing Comic Free reading journey through the Suwayomi adapter while Comic Free re-resolves Plugin Host runtime identifiers and keeps upstream page URLs out of durable state and the Browser WebUI.

**Blocked by:** 02: Complete deterministic reading and retention; 04: Manage an approved Suwayomi Plugin Host safely.

**Status:** resolved

- [x] The Suwayomi adapter implements the same internal Source Plugin, search, details, chapters, and page-resolution interface as the fixture adapter.
- [x] Shared runtime validation converts Suwayomi GraphQL success and error responses into stable Comic Free REST/JSON contracts.
- [x] Adapter-produced comic and chapter keys derive from provider-owned durable identity and never from Suwayomi-local database numbers.
- [x] Opening a chapter resolves current Suwayomi identifiers and creates an opaque, short-lived Local Core reader session.
- [x] The Browser WebUI receives only Local Core page URLs and never receives upstream page URLs, provider cookies, or Suwayomi GraphQL payloads.
- [x] Restarting the Local Core or Plugin Host invalidates old reader sessions with a clear renewable error, then re-resolves the same chapter from its durable Source Binding and Reading Progress.
- [x] The page proxy enforces bounds, timeout, response-size, and image-type checks while preserving successful image content type and exact bytes.
- [x] Recorded Suwayomi-shaped fixtures cover translation and transient-ID renewal in the deterministic suite without Java, network, or third-party execution.
- [x] An opt-in approved local integration check proves the same flow against a configured Suwayomi runtime without replacing deterministic acceptance.

## Answer

- Added a runtime-validated Suwayomi reading adapter behind the same internal interface as the deterministic fixture. Durable comic and chapter keys encode provider-owned URLs and search/label hints, never Suwayomi manga or chapter database ids.
- Recorded generations change runtime ids from `101/201` to `501/601`; deterministic REST tests prove the same retained Library Item renews a session and resolves the new page path after restart.
- Reader sessions remain in memory, return only Local Core page URLs, and surface a retryable `reader_session_not_found` after restart. The Browser WebUI now offers `Renew reader session` without losing its chapter context.
- The Suwayomi page path is restricted to the configured loopback origin and enforces bounds, request timeout, maximum bytes, image content type, and exact successful bytes.
- `pnpm verify:suwayomi-reading` is an explicit opt-in check for an already running approved local runtime. Its no-query guard was verified; no live provider run occurred in this implementation turn because no user-selected live query/runtime configuration was supplied.
