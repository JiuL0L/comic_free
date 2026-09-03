# Mihon extension flow prototype

Status: answered on 2026-09-03. This is a throwaway prototype, not formal product implementation.

## Question

Can Comic Free dynamically add a current third-party Mihon extension store, install one extension through Suwayomi GraphQL, retain it across restart, and reach a real provider without rebuilding the WebUI?

## Answer

The dynamic extension boundary is feasible. Suwayomi added the current Keiyoushi protobuf store, fetched its catalog, installed `MANGA Plus by SHUEISHA`, exposed nine language sources, and retained the installation across restart without rebuilding Comic Free.

Live browsing through the selected extension is not validated. Search, popular, and latest operations returned the extension's generic `An unknown error happened`, while a direct request to the same MANGA Plus API returned a valid protobuf payload containing One Piece titles. This narrows the failure to the Suwayomi/extension execution path rather than basic provider reachability.

A later failed GitHub refresh reduced Suwayomi's catalog to the already-installed entry and marked that extension obsolete. Comic Free must preserve a Last Known Catalog and distinguish refresh failure from confirmed removal.

The executable artifact remains outside `main` on branch `prototype/mihon-extension-flow` at commit `3ba7eb8`.
