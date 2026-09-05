# 10: Expose explicit Library Item deletion

**What to build:** 将存储层已有删除能力接入 Local Core REST 与书架界面，让用户明确删除选中的本地藏书及关联阅读状态。

**Blocked by:** 02（已合并至审查基线）。不依赖 08 或 09；可独立实施，但同时编辑 reading-service、reading-http 或 ReadingExperience 时须协调。

**Status:** resolved

## Context

- 来源：[MVP spec](../spec.md) User Story 25、Implementation Decisions 的显式删除与事务要求，以及 Testing Decisions 的 Library Item deletion 检查。
- 静态审查基线：`198d319`。`ReadingStore.delete()` 已存在，但 `reading-http.ts` 的 Library Items 路径只支持 GET/POST，`ReadingExperience.tsx` 无用户删除操作。
- 从最新已合并 main 创建独立 worktree，带入本工单，保留主工作区并行改动。

## Acceptance criteria

- [x] 先建立通过 REST 和浏览器执行删除的回归检查，证明现有界面/接口缺口，再接入已有存储能力。
- [x] 书架为选中的 Library Item 提供明确删除操作，删除前确认具体漫画及本地进度会被移除；取消操作不产生变更。
- [x] 删除接口采用一致的 HTTP 语义及共享运行时验证；明确规定未知 ID 和重复删除的结果，非法请求不修改数据。
- [x] 删除事务只移除目标 Library Item 及其 Source Binding、Last Known Snapshot、Reading Progress；其他藏书、来源目录和已安装插件保持不变。成功重启后目标仍不存在。
- [x] available、unavailable、refresh_required 状态的藏书都允许本地删除，不依赖网络或 Plugin Host 可用性；来源故障本身仍不会触发删除。
- [x] 界面显示删除中、成功及失败状态；失败保留条目并允许重试。若删除当前阅读条目，清除其已收藏关联，防止后续异步进度保存或旧 Resume 操作重新创建已删除记录。
- [x] 确定性测试覆盖取消、成功、未知 ID、失败、两条藏书只删除一条、当前阅读条目删除及重启持久化；断言数据库关联记录和无关条目，而非只断言按钮消失。

## Verification and delivery

先取得新增检查的失败证据，再运行相关 REST/SQLite/浏览器回归及 `pnpm verify`，最后执行 Standards / Spec 两路审查。保存任务日志和验证结果。本工单不需要下载或执行新的第三方代码。

## Scope

只删除 Comic Free 本地藏书记录；不卸载插件、不删除提供方内容、不清空 Suwayomi 数据，也不增加回收站或批量删除功能。

## Answer

Implemented on `codex/10-library-deletion`, based on `origin/main@198d319`, in the isolated worktree `E:/Code/comic_free/.Codex/worktrees/10-library-deletion`.

- `DELETE /api/v1/library-items/:id` accepts a UUID path ID and no query/body. Success: `200 {deletedId}`. Unknown and repeated deletion: structured `404 library_item_not_found`. Invalid ID/query/body: `400 invalid_request`; unsupported method: `405`.
- Shared runtime parsers validate ID and response. Deletion uses existing SQLite foreign-key cascades and invalidates matching transient sessions. In-flight Resume/catalog resolution cannot return a session for the deleted retained identity.
- The Library confirmation identifies the comic and local records being removed. Cancel does nothing; pending disables controls; failure keeps the target and allows retry; success reports deletion and closes the matching Reader. Generation checks ignore late progress, retain, Resume and renewal responses.
- No remote provider or Plugin Host is needed. Explicit re-opening and retaining a comic later remains supported.

### Regression evidence (2026-09-05)

Before implementation:

1. `pnpm exec playwright test tests/e2e/library-deletion.spec.ts`: 1 failed; `Delete from Library` button was not found after successfully retaining the fixture comic. This proves the original user-visible gap.
2. `pnpm exec tsx --test apps/core/src/reading-http.test.ts`: failed because the new `parseDeleteLibraryItemResponse` contract export did not exist. This is contract/API test loading evidence, not an executed HTTP-status assertion.

Baseline HTTP replay during final review (after implementation, not a pre-implementation run):

- Extracted the unchanged `198d319:apps/core/src/reading-http.ts` handler using `git show` into the ignored evidence directory, with local import paths adjusted. A real loopback HTTP server backed by an in-memory retained fixture received `DELETE /api/v1/library-items/:id`: returned `404`, and the target still existed. The regression expectation of `200` failed (exit 1). Command: `pnpm exec tsx .local-data/ticket-10/baseline-probe.ts`; log: `.local-data/ticket-10/baseline-rest-replay.log`. This confirms the old route gap directly. The strict requested order was met for the browser and contract tests; the executed HTTP baseline evidence was added retrospectively.

After implementation:

- Focused REST/contracts/SQLite/service checks: 17 passed, 0 failed. Malformed requests target a live record; all rows remain unchanged. A forced cascade failure rolls back all four target/other record types. Successful deletion removes all target rows and retains the other rows across restart.
- Browser regression checks confirmation/cancel, injected failure/retry, pending/success, stale progress and Resume responses, current Reader closure, local persistence, and an unchanged complete Source Plugin catalog with the healthy versioned fixture plugin.
- Full `pnpm verify`: typecheck, production build, 78 unit tests and 5 Chrome end-to-end tests passed (exit 0).

Full local logs are retained under `.local-data/ticket-10/`: `browser-red.log`, `red-rest.log`, `green-focused.log`, and `verify.log`. They contain test fixture data only and are ignored by Git. This committed record preserves the commands, decisive failure and final results for review.

### Two-axis review

Standards: no documented-standard violations. One low-priority heuristic noted repeated single-line stale-response guards; retained explicitly because a helper would still require the same conditional returns and add indirection.

Spec: no functional defect identified. The initial evidence gaps (catalog/plugin invariance and recorded red/green verification) were addressed with the browser catalog snapshot assertion and this record.

Delivery is a local commit. No push, PR, or merge was requested or performed.
