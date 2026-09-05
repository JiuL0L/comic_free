# 08: Complete Source Plugin disable and recovery

**What to build:** 补齐来源禁用、真实读取故障、显式恢复绑定和恢复失败提示，使已有与未收藏漫画遵守相同的来源策略，并保留本地阅读状态。

**Blocked by:** 02, 03, 05, 06（已合并至审查基线；实施前核实最新 main）。

**Status:** resolved

## Context

- 来源：[MVP spec](../spec.md) User Stories 17、19、22–24、27、29，以及 [ADR 0003](../../../docs/adr/0003-run-locally-and-retain-library-state-through-source-failure.md)。
- 静态审查基线：`198d319`。`reading-service.ts` 的可用性检查放行无 Library Item 的请求，适配器故障只向上传播；`refresh_required` 被拒绝但缺少解除入口；`ReadingExperience.tsx` 的 resume 错误仅在 reader 已存在时显示。以上是待回归测试确认的发现，不是已经复现的结果。
- 主工作区存在旧提交及并行未提交改动。实施须从最新已合并 main 创建独立 worktree，并带入本工单；不要将主工作区旧代码作为实现基线。

## Acceptance criteria

- [x] 在修改行为前，以确定性测试证明禁用绕过、恢复无入口和首次 Resume 错误不可见的现象；若发现与当前实现不符，记录证据并修正对应结论。
- [x] 禁用来源后，搜索、详情、章节、新会话及已有会话取页均遵守插件状态；未收藏漫画也不能绕过，返回明确原因，且被拒请求不会调用上游适配器。
- [x] 已确认的 Plugin Host / Source Plugin / Comic Provider 不可用失败更新受影响绑定的状态和原因，并阻止继续使用受影响会话；影响范围按故障归属限定。无效输入或单张图片失败不得被笼统升级为整个插件不可用。
- [x] 禁用、故障和恢复待刷新期间，Library Item 身份、Last Known Snapshot、Reading Progress 保持不变；重启后仍可读取，故障原因可见。
- [x] 更新或恢复插件后，提供明确的“刷新绑定”操作，使用原有持久化身份重新解析；成功才恢复 available，保留快照和进度。失败保留原记录，显示原因及重试入口；插件仍禁用时拒绝刷新。
- [x] 刷新成功后能创建新会话，从原章节和页码继续阅读；旧会话保持失效。恢复过程遇到已不可解析章节或无效页码时明确报告，不静默重置进度。
- [x] 首次从书架 Resume 即使 reader 尚不存在，也显示操作中、成功或失败状态及可用重试入口。图片临时失败仍保留阅读上下文和重试路径。
- [x] 相关 REST 请求和错误使用共享运行时验证；无效或未知绑定请求不改写数据库，刷新与禁用交错时最终状态不得绕过禁用策略。
- [x] 确定性浏览器验收覆盖“收藏并记录进度 → 禁用 → 拒绝阅读 → 恢复 → 显式刷新 → 原进度续读”，以及首次 Resume 失败提示；验证重启持久化和无关藏书不受影响。

## Verification and delivery

先运行新增回归检查取得失败证据，逐项修复后运行 `pnpm verify`，再做 Standards / Spec 两路审查。保存任务专用日志并记录命令、退出码和决定性证据。正常验证使用本地 fixture；真实第三方验证沿用项目的具体来源授权要求。完成后更新本工单结果；push、PR、merge 分别遵循当次授权。

## Scope

来源目录到多 Provider 阅读路由由 [09](09-connect-installed-providers-to-reading.md) 负责；本工单先为当前可配置来源提供统一状态策略。藏书删除由 [10](10-expose-explicit-library-item-deletion.md) 负责。

## Implementation evidence

- Isolated checkout: `.Codex/worktrees/08-source-recovery`, branch `codex/08-source-recovery`, refreshed `origin/main` baseline `198d319`. No open PR duplicated this ticket at start.
- Agreed regression seams: Local Core REST with deterministic upstream fixtures and SQLite reopen; Browser WebUI initial Resume and disable/restore/refresh/continue journeys.
- Before fixes: `outputs/issue08/backend-red.log` records disabled search returning 200 instead of 409 and refresh returning 404 instead of 200. `failure-red.log` records missing persisted provider failure. `baseline-reading-ui.log` confirms initial Resume failure and refresh entry were invisible.
- Changes: source policy gates all reads before/after upstream awaits; confirmed source failures persist binding reasons with provider/plugin scope; image HTTP/network failures remain page errors. Explicit refresh validates original comic/provider/chapter and page range, preserves snapshot/progress, invalidates old sessions and refuses concurrent source changes. UI provides per-item Resume/refresh feedback and retries.
- Refresh failure preserves identity/snapshot/progress and persists `unresolved_catalog_item` or `refresh_failed` when no newer source state supersedes it. Retry uses saved identity only. The request accepts only `{}` and rejects caller-supplied replacement identity/page fields.
- Current integration scope remains one configured ReadingAdapter. Host failures affect that configured plugin; provider failures affect its provider. Multi-provider routing remains ticket 09.
- Real browser recovery test uses fixture plugin install/disable/restore and the actual refresh endpoint. Initial Resume failure is injected only at the browser request boundary; successful retry uses the real Local Core.

## Answer

Implemented and verified locally on `codex/08-source-recovery`.

- Final command: `pnpm verify`, exit 0. Typecheck and production build passed; 93 unit/integration tests and 5 Chrome E2E tests passed on integrated main `d7eca41`. Full log: `outputs/issue08/verify-integrated.log`.
- Standards review: one terminology violation and two naming suggestions, all addressed (Source Plugin terminology, policy revision names, conditional catalog refresh-flag clearing).
- Spec review: two findings fixed and independently rechecked. Provider generations are scoped by plugin/provider; unavailable or refresh-required bindings reject old-reader progress writes. Browser state rolls back after rejected progress writes. Red evidence is in `provider-scope-red.log` and `progress-red.log`; corrected REST checks are in `review-green.log`, and browser rollback evidence in `reading-ui-progress-rollback.log`.
- Browser journey also exercises a real disabled refresh failure, retry after restore, explicit successful refresh without automatically opening the reader, original page resume, and persistence after restart. Failed Resume/refresh actions reload the library to reveal current binding reasons and recovery controls.
- Local fixture verification only; no new third-party artifact was downloaded or executed. No push, PR, or merge performed in this task.

### Integration with ticket 10

While implementing, `origin/main` advanced to `d7eca41` (PR #7, explicit local Library Item deletion). Rebased this unpublished ticket onto that main; preserved both REST routes, deletion during reader-session resolution checks, and UI deletion generation guards. Refresh completion also respects the UI generation, and a deterministic regression verifies deletion during refresh never recreates the binding. Both deletion and source recovery Chrome journeys pass in the final full verification.

Post-rebase bounded Spec review passed for the three conflict files: both deletion and recovery behavior retained, including asynchronous deletion guards.
