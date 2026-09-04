# 02: Complete deterministic reading and retention

**What to build:** Let the local reader use a named deterministic Source Plugin to search, open details and a chapter, see a recognizable proxied page, retain the comic, save Reading Progress, and recover the same local state after the Source Binding fails and the Local Core restarts.

**Blocked by:** 01: Start the loopback application shell.

**Status:** resolved

- [x] The fixture adapter implements the same internal catalog and page-resolution interface intended for a real Plugin Host adapter.
- [x] The Browser WebUI lets the reader select the fixture Source Plugin and complete search, details, chapter selection, and bounded previous/next page navigation.
- [x] Search results and reader context visibly show the Source Plugin name, comic title, chapter label, current page, and total page count.
- [x] The deterministic page is non-transparent and visually recognizable; browser verification proves that it decoded with non-zero natural dimensions.
- [x] Page bytes come only through a Local Core reader session, preserve exact content type and bytes, and cannot be requested by supplying an arbitrary upstream URL.
- [x] Retaining the result transactionally creates a Comic Free Library Item, Last Known Snapshot, Source Binding, and Reading Progress in SQLite.
- [x] Comic and chapter identity uses plugin-scoped durable provider keys rather than fixture runtime identifiers.
- [x] Making the fixture Source Binding unavailable disables provider-dependent reading but does not delete or overwrite the Library Item, Last Known Snapshot, Source Binding, or Reading Progress.
- [x] Restarting the Local Core against the same test database returns the same local identity, snapshot, unavailable reason, chapter label/key, and zero-based page index.
- [x] The journey covers loading, empty, success, unavailable, retryable failure, and invalid page/progress states without mutating SQLite on rejected input.
- [x] The deterministic browser journey passes from both a fresh temporary data directory and a deliberate restart of a retained test directory.

## Answer

Implemented the fixture-backed catalog, reader-session proxy, transactional SQLite retention, unavailable Source Binding behavior, restart recovery, and complete Browser WebUI journey on `codex/02-complete-deterministic-reading`.

Verification: `pnpm verify` covers type checking, production build, contract/core tests, exact image bytes, rollback and foreign-key behavior, rejected input, browser image decoding, selectable Source Plugin, unavailable-session enforcement, and retained-state restart.
