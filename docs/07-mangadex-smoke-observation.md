# Ticket 07 — MangaDex smoke observation

Observed: 2026-09-05T11:15:48Z; resume verified at 11:20:01Z.
Base: `f1282c0`; the formal shutdown and GraphQL Int fixes in this change were
applied before the successful run.

## Verdict

**PASS for this optional live observation.** The formal Browser WebUI displayed
MangaDex, the selected comic, chapter, page count and a decoded real image served
through the Local Core page proxy. A retained Library Item resumed on page 2 after
restarting both Local Core and Suwayomi. Deterministic acceptance passed separately.
This does not promise that the selected public content will remain available.

| Observed field | Value |
| --- | --- |
| Source Plugin | MangaDex, `eu.kanade.tachiyomi.extension.all.mangadex`, version `1.4.212` |
| Configured provider | MangaDex English, source `2499283573021220255` |
| Comic | Yotsuba&! |
| Chapter | Vol.1 Ch.1 - Yotsuba & Moving |
| First observed page | 1 of 48 |
| Local Core image response | HTTP 200, `image/jpg`, 151105 bytes |
| Image SHA-256 | `7356968fea0ddf74b0e41835f5dc3fcf0915b8c20cacf4e19bb26a69dd3fa7d2` |
| Browser decoded dimensions | 600 × 872; visible manga panels confirmed by screenshot inspection |
| Retained/resumed progress | Page 2 of 48, same comic and chapter, newly created reader session |

## Artifacts, authorization and setup

The user approved executing the exact existing files in isolated data, then explicitly
asked to continue the proposed diagnosis, minimal fixes and regression checks. No new
Suwayomi or extension code was downloaded or updated. Temporary setup/probe scripts
and screenshots remain outside the committed change. The formal fixes are the separately
authorized repair work; no push or merge has been performed.

| Existing artifact in `E:/Code/comic_free` | Approved SHA-256 |
| --- | --- |
| `.local-data/suwayomi/v2.3.2243/Suwayomi-Server-v2.3.2243.jar` | `821141B32E170D4A02D3CBDFED577ED8F07BD22383FF5F4132EBB5AE40E98DD5` |
| `.local-data/suwayomi/extension-runtime/extensions/tachiyomi-all.mangadex-v1.4.212.jar` | `1ABAEB20D644E60CD2F426AAE5432A085909B9D971C49D9F102F9D5657324A50` |

Worktree: `E:/Code/comic_free/.Codex/worktrees/07-mangadex-smoke`.
Isolated data: `.local-data/07-live/` inside that worktree. Historical H2 data and the
primary checkout's library were not copied or modified.

Copying the JAR into an empty extensions directory did not register it. Inspection of
the approved Suwayomi artifact identified its supported `installExternalExtension`
GraphQL mutation. Its multipart parser accepts a top-level `Upload` variable:
`mutation($file: Upload!) { installExternalExtension(input:{extensionFile:$file}) { __typename } }`,
with the file map targeting `variables.file`. The existing JAR was uploaded locally
as `approved-mangadex.jar`; the installed file retained the approved SHA-256.
Registration returned `isInstalled: true` and 61 MangaDex language sources (62 including
Local source), and persisted across restarts. This was provisioning through Suwayomi's
local API; all user reading actions used the formal Comic Free WebUI and REST facade.

The reading source was configured with the observed English source id, package key,
display name `MangaDex`, and provider key `mangadex:en`. The Source Plugins management
catalog does not automatically import an externally provisioned extension; this run
proves its exposure in the configured reading selector, not a new local-file import UI.

## Failures diagnosed and repaired

1. JAR-only staging produced an empty extension registry. This was a setup failure,
   not a MangaDex network failure. Supported local registration resolved it.
2. The Windows development supervisor terminated Local Core directly, bypassing its
   application-level Plugin Host shutdown. Initial cleanup required an explicitly
   approved temporary Java Attach agent, recorded in commits `52d5f10` and `1332cd9`.
   The formal supervisor now sends IPC shutdown, waits for completion, reports failed
   or timed-out shutdown, and shares the pending result across repeated requests.
   Local Core also shuts down on parent IPC disconnect. Subsequent real runs used
   only the repaired formal lifecycle, released all three ports and reopened H2.
3. The adapter converted runtime manga/chapter IDs to strings. Real GraphQL requests
   failed with `Expected a value that can be converted to type 'Int' but it was a 'String'`.
   It now retains positive 32-bit integers; source IDs remain strings to preserve their
   larger values. Regression coverage checks outbound ID types and rejects invalid IDs.
4. Final deterministic browser acceptance exposed incomplete HTTP connections holding
   Local Core shutdown and SQLite open. Local Core now stops accepting connections,
   closes existing HTTP connections, then closes SQLite in the server-close callback.
   A real-Core incomplete-request regression failed before this fix and now passes.

Timeout handling remains explicit: after 40 seconds the supervisor disconnects IPC
and allows another 5 seconds for cooperative cleanup. If the Core is wholly unresponsive,
it reports shutdown failure rather than silently force-killing a database process.

## Retention and restart evidence

The user retained the item and advanced to page 2 in the formal UI. Read-only inspection
of Comic Free SQLite decoded the durable comic key to `{title,url}` and chapter key to
`{label,url}`. Both URLs contained provider UUIDs; neither contained Suwayomi runtime ID
fields or image-page addresses. This inspection covered actual retained reading data,
not an empty database. Host runtime IDs and upstream image URLs were not persisted as
Comic Free identity.

After application-level shutdown and restart, all rows in `library_items`,
`source_bindings`, `reading_progress` and `last_known_snapshots` matched the pre-restart
snapshot. The old Local Core page session returned HTTP 404 with retryable
`reader_session_not_found`. Clicking the formal Library's `Resume reading` created a
new session, restored page 2 of 48, and decoded the image at 600 × 872.

Final shutdown exited 0. Ports 3210, 5173 and 4568 were successfully rebound and released;
no H2 `.lock.db` remained. No task JVM was left running.

## Deterministic acceptance and logs

`pnpm verify`: exit 0; typecheck/build passed, **73 unit/integration tests and 4 Chrome
acceptance journeys passed**. Tests include cooperative Plugin Host shutdown, propagation
of Local Core shutdown failure, preservation of unexpected-exit causes, repeated-stop
waiting, timed-out shutdown via IPC disconnect, incomplete HTTP requests, GraphQL Int requests and invalid
runtime IDs. The original supervisor and adapter regressions were observed failing before
the fixes. The fixture suite does not depend on MangaDex, Java downloads or live content.

Full redacted text evidence remains under the worktree's Git-ignored
`.local-data/test-output/07-mangadex-smoke/`:

- `supervisor-red.log`, `adapter-red.log`, `review-red.log`, `http-shutdown-red.log`, `deterministic-fixed.log`.
- `registration.json`, `registered-sources.json`, `browser-page-evidence.json`.
- `durable-identity.json`, `restart-persistence.txt`, `stale-session.json`, `resume-evidence.json`.
- `final-lifecycle.json`, `final-lifecycle.log`, `final-process-check.json`: real entrypoint restart/exit code, extension reopen, remaining JVM and H2 lock counts.
- `live-process-retry.log`, `live-reading-fixed.log`, `live-resume-process.log`, `final-shutdown.txt`.

Earlier failed-run and authorized cleanup logs remain in the same task directory.
Logs exclude credentials, cookies, upstream image URLs and image bodies. The temporary
visual-inspection screenshot is separate from text logs, in uncommitted `work/07-reader.png`.
Public titles, chapters, page counts, hashes and availability above are observations
from this run only; future optional failures must be classified independently of the
fixture acceptance gate.
