# Probe MangaDex live reading

Status: resolved with remaining integration work

## Result

- Prototype branch and commit: `prototype/mangadex-live-flow` at `1099106`
- Installed package: `eu.kanade.tachiyomi.extension.all.mangadex`
- Installed version: `1.4.212` (`104212`)
- Artifact: 223576 bytes; SHA-256 `1ABAEB20D644E60CD2F426AAE5432A085909B9D971C49D9F102F9D5657324A50`
- English source id: `2499283573021220255`; 61 language sources total
- Successful traversal: 20 search items, details, 3 chapters, and 95 page URLs
- Successful run log: `.local-data/suwayomi/probe-logs/2026-09-03T17-08-47-970Z.stdout.log`
- Process stopped without force fallback and released port `4570`.

## Decision

Accept the dynamic extension-to-page-URL path as validated. Keep the executable probe on its throwaway branch. The next prototype should place a small Local Core REST/JSON boundary in front of the confirmed GraphQL operations, persist Comic Free-owned state in SQLite, and stream actual page bytes through a loopback proxy.
