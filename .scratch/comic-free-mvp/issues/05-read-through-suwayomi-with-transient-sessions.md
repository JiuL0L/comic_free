# 05: Read through Suwayomi with transient reader sessions

**What to build:** Let the local reader complete the existing Comic Free reading journey through the Suwayomi adapter while Comic Free re-resolves Plugin Host runtime identifiers and keeps upstream page URLs out of durable state and the Browser WebUI.

**Blocked by:** 02: Complete deterministic reading and retention; 04: Manage an approved Suwayomi Plugin Host safely.

**Status:** ready-for-agent

- [ ] The Suwayomi adapter implements the same internal Source Plugin, search, details, chapters, and page-resolution interface as the fixture adapter.
- [ ] Shared runtime validation converts Suwayomi GraphQL success and error responses into stable Comic Free REST/JSON contracts.
- [ ] Adapter-produced comic and chapter keys derive from provider-owned durable identity and never from Suwayomi-local database numbers.
- [ ] Opening a chapter resolves current Suwayomi identifiers and creates an opaque, short-lived Local Core reader session.
- [ ] The Browser WebUI receives only Local Core page URLs and never receives upstream page URLs, provider cookies, or Suwayomi GraphQL payloads.
- [ ] Restarting the Local Core or Plugin Host invalidates old reader sessions with a clear renewable error, then re-resolves the same chapter from its durable Source Binding and Reading Progress.
- [ ] The page proxy enforces bounds, timeout, response-size, and image-type checks while preserving successful image content type and exact bytes.
- [ ] Recorded Suwayomi-shaped fixtures cover translation and transient-ID renewal in the deterministic suite without Java, network, or third-party execution.
- [ ] An opt-in approved local integration check proves the same flow against a configured Suwayomi runtime without replacing deterministic acceptance.
