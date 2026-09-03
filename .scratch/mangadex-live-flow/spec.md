# MangaDex live reading flow prototype

Status: answered on 2026-09-03. The throwaway artifact remains on branch `prototype/mangadex-live-flow` at commit `1099106` and is intentionally absent from `main`.

## Question

Can a second compatible Mihon extension complete the live path from dynamic installation through page URL discovery without rebuilding Comic Free?

## Answer

Yes. MangaDex `1.4.212` dynamically installed through Suwayomi, exposed 61 language-specific sources, and its English source completed search, details, chapter discovery, and page URL discovery. The successful selected result returned 20 search items, 3 chapters, and 95 page URLs for its newest available chapter.

This validates the dynamic extension and provider traversal boundary only. It does not validate actual image-byte fetching, the Comic Free REST facade or page proxy, SQLite-owned state, browser rendering, or database-safe Windows shutdown.

The successful `Berserk` search selected a different title containing that word, so it is pipeline evidence rather than a claim about the classic title. An earlier `One Piece` result exposed only two external or unavailable chapters and returned HTTP 404 for pages; retrying with another title separated content-specific absence from provider failure.
