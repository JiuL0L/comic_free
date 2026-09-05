# Ticket 07 — optional MangaDex smoke observation

Observed: 2026-09-05T10:46:16Z. Formal application baseline: `f1282c0`.

## Verdict

**Incomplete: extension registration prerequisite failed.** The managed Suwayomi
host reached readiness, but the isolated host reported zero registered extensions
and only `Local source`. The formal Browser WebUI displayed `Suwayomi is ready.`
and `No Source Plugins have been observed yet.` No MangaDex source was available
for the formal reading adapter. Live search, chapter resolution and page rendering
were not reached. This is not evidence of a MangaDex network/provider failure.

This optional observation does not change deterministic MVP acceptance. Ticket 07
remains incomplete; it must not be presented as successful live reading.

## Authorized artifacts and isolation

The user explicitly approved executing the two existing artifacts in an isolated
data directory and contacting MangaDex; no extension download or update was approved
or performed by this task.

| Artifact | SHA-256 |
| --- | --- |
| Suwayomi `v2.3.2243`, `.local-data/suwayomi/v2.3.2243/Suwayomi-Server-v2.3.2243.jar` in the primary checkout | `821141B32E170D4A02D3CBDFED577ED8F07BD22383FF5F4132EBB5AE40E98DD5` |
| MangaDex `v1.4.212`, `.local-data/suwayomi/extension-runtime/extensions/tachiyomi-all.mangadex-v1.4.212.jar` in the primary checkout | `1ABAEB20D644E60CD2F426AAE5432A085909B9D971C49D9F102F9D5657324A50` |

Worktree: `E:/Code/comic_free/.Codex/worktrees/07-mangadex-smoke`.
Task data root: `.local-data/07-live/` within that worktree. Only the MangaDex JAR
was copied into the new runtime extension directory. The historical H2 database,
other extensions and user library were not copied or modified. Observation shows
that this JAR-only staging did not register the extension; the precise registration
mechanism was not established by this run.

## Evidence boundary

- Used the formal development supervisor, Local Core, managed Suwayomi lifecycle,
  and React Browser WebUI. Browser inspection used browser-harness on localhost.
- Host REST status: `ready`, internal port `4568`. Local diagnostic GraphQL calls
  returned HTTP 200 with `extensions.nodes = []` and only source `0 / Local source`.
  These calls diagnosed setup; they did not substitute for the formal reading path.
- Source Plugin/title/chapter/page number/count/image content type/byte count and
  rendered page: **not observed**. The fixture reader shown by the UI is not live
  MangaDex evidence. No permanent assertion about public content is made.
- Read-only SQLite inspection found zero rows in `library_items`,
  `last_known_snapshots`, `source_bindings`, and `reading_progress`. No transient
  manga/chapter IDs or upstream page URLs were persisted by this attempt. This is
  empty-state evidence only, not successful live identity or restart validation.
- Supervisor returned exit code 0 and `SMOKE_STOPPED`, but only ports 3210 and
  5173 were released. Port 4568 remained owned by Java PID 31856, verified against
  this task data root. `stopChild` in `scripts/dev-supervisor.ts` uses `child.kill()`;
  the Local Core shutdown handler was not successfully exercised on this Windows run.
  No H2 lock file was observed, which does not prove database-safe shutdown.
  The initial Java Attach cleanup proposal was rejected before execution. After the
  user explicitly approved that exact method, PID 31856 and its task-root ownership
  were revalidated, and a temporary local agent invoked `System.exit(0)` (Attach exit
  0). At 2026-09-05T10:51:46Z the JVM no longer existed, all three ports could be
  rebound, and no H2 lock file remained. This completed cleanup but does not repair
  the formal supervisor shutdown path or prove database reopen. No second live
  reading restart was attempted.

## Deterministic acceptance and retained logs

`pnpm install --offline --frozen-lockfile`: exit 0, 31 cached packages, zero downloads.
`pnpm verify`: exit 0; type checking and build passed, 67 unit/integration tests and
4 Chrome acceptance journeys passed. No product code changed after that verification.

Full task logs remain under the worktree's Git-ignored
`.local-data/test-output/07-mangadex-smoke/`:

- `deterministic.log`: complete verification output.
- `live-process.log`: formal supervisor startup/shutdown output.
- `live-evidence.json`: timestamped host/extension/source responses and SQLite counts.
- `attach-cleanup.log`, `cleanup-verification.txt`, `cleanup-result.json`: approved cleanup command output, successful port probes and timestamped process/lock checks.
- `shutdown.txt`: successful probes for 3210/5173; 4568 probe failed with EADDRINUSE (recorded separately in `shutdown-failure.txt`).

Evidence contains no image bodies, credentials, cookies or upstream page URLs.
Temporary execution/probe scripts stay in the worktree's uncommitted `work/` folder;
only documentation belongs in the proposed project change.

## Necessary next step

Establish a supported registration path for the existing approved artifact, or obtain
separate source-specific approval for an installable MangaDex package and its exact
version/source before downloading it. Do not silently reuse the historical H2 database.
Then repeat the formal WebUI reading journey and fill in the missing observed page and
retained-identity evidence. No push or merge is part of this task's authorization.
