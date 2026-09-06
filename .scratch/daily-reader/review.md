# Daily reader review

Baseline: `b3d0a6b391f33ca626b76629c5dd57f3b761f95d`

Spec: `.scratch/daily-reader/spec.md`

Review date: 2026-09-06

## Standards

Independent review found duplicated Settings HTTP/error parsing and omitted recovery warning handling. Both now use the shared contracts and existing `requestJson`, preserving actionable service errors and editable drafts. Launcher Host checks now allow recovery through the UI while Node/pnpm remain startup prerequisites. CMD failures remain visible. No unresolved actionable Standards findings remain.

## Spec

Resolved findings: malformed saved settings blocked startup; missing JAR/Java blocked settings access; retain-then-chapter navigation depended on delayed library refresh; continuous-page tracking and delayed image layout could lose the restored position; recent-reading order was missing. Browser execution also exposed a retain-in-flight scroll race. Retained identity is now synchronous for callbacks, and completion of retention saves the latest viewed page if it changed during the request. Progress writes remain serialized. No unresolved explicit scope gaps remain.

## Verification

- `pnpm verify`: exit 0; typecheck/build, 119 unit/integration tests, 11 Chrome E2E tests pass.
- The scroll/retain/chapter/restart journey passed 5 consecutive runs after the race fix. The final suite reads persisted progress through HTTP, and checks late-image resume geometry.
- Browser cases also cover damaged-settings recovery, invalid-input draft preservation, settings applied after restart, recent-first shelf order, provider changes/recovery, confirmed deletion, and stale-response guards.
- Actual `Start-Comic-Free.cmd` ran from another cwd with a data path containing spaces. The default Chrome gained a new local reader tab, inspected through browser-harness. Ctrl+C released both loopback ports. A second CMD start applied persisted settings with `restartRequired: false`.
- CMD missing-Node behavior returns failure with a visible prerequisite message and pause. The PTY wrapper reports interruption on Ctrl+C; this is not reported as an application exit-0 assertion.
- No new live Suwayomi provider run, third-party download, push, PR, or merge was performed.
