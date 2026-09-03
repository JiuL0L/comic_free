# Install and probe MANGA Plus

Status: resolved with limitation

## Validated

- Keiyoushi store: non-legacy protobuf, signing-key fingerprint `9add655a78e96c4ec7a53ef89dccb557cb5d767489fac5e785d671a5a75d4da2`
- Initial catalog count: 1394
- Installed package: `eu.kanade.tachiyomi.extension.all.mangaplus`
- Installed version: `1.6.65` (`106065`)
- Installed artifact: 177309 bytes, SHA-256 `F5FE345827F536DC81F953B5B3AC017B0AB298F7FB736BAE57C73CD1E0204680`
- Exposed sources: 9 languages; English source id `1998944621602463790`
- Store and installation persisted after restart.
- Prototype artifact: branch `prototype/mihon-extension-flow`, commit `3ba7eb8`

## Not validated

- Catalog browsing, manga details, chapters, page URLs, or image proxying through MANGA Plus.
- Database-safe Windows shutdown.

## Failure evidence

- SEARCH, POPULAR, and LATEST each returned `An unknown error happened`.
- Direct MANGA Plus API access returned HTTP 200, `application/x-protobuf`, 220731 bytes, and visible One Piece title strings.
- A later Java-side refresh failed to connect to `github.com:443`; Suwayomi retained the installed extension but marked it obsolete.

## Decision

Accept dynamic store and extension installation as validated. Do not accept live browsing as validated. The Local Core must maintain its own Last Known Catalog and failure classification instead of mirroring Suwayomi's transient `obsolete` state directly.
