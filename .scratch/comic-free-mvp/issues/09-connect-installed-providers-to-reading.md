# 09: Connect installed Comic Providers to reading

**What to build:** 将正式安装得到的 Comic Provider 目录接入阅读来源选择和适配器路由，让用户在 Comic Free 内完成安装后的搜索与阅读。

**Blocked by:** 05, 06, 08。08 的状态检查及恢复约定合并后再实施，避免重复设计来源可用性策略。

**Status:** resolved

## Context

- 来源：[MVP spec](../spec.md) User Stories 4、8、10、30、34–35，以及 [06](06-manage-trusted-source-plugin-changes.md) 的 normalized Providers 可用要求。
- 静态审查基线：`198d319`。`main.ts:createReadingAdapter` 通过环境变量只配置单个阅读来源；管理目录中的安装结果没有进入 `ReadingService` 的来源列表及路由。先用正式服务组合的确定性测试确认缺口。
- 实施基于包含 08 的最新已合并 main，在独立 worktree 中进行；主工作区旧状态不是实现基线。

## Acceptance criteria

- [x] 使用确定性安装结果复现“管理目录可见，但阅读来源不可选”，并建立经过正式 Local Core 服务组合的回归测试。
- [x] 成功安装或更新后，normalized Comic Providers 出现在阅读选择器中；用户无需手改来源环境变量、重建 WebUI 或重装客户端。确需 Plugin Host 重启的操作显示 restart-required，安全重启后发现结果可用。
- [x] 选择项清楚显示 Source Plugin 名称及 Provider 名称或语言；使用稳定的插件和 Provider 身份区分同名来源，路由到所选 Provider 的搜索、详情、章节和页解析。
- [x] 重启后，从持久化目录与当前 Host 观察重建路由；Suwayomi 数字 source/manga/chapter ID 仅作临时解析数据，Library Item 和 Reading Progress 继续使用持久化身份。
- [x] 来源发现有 loading、empty、success、error 状态；失败保留 Last Known Catalog，不能将缺失观察当作确认移除，也不能用 fixture 成功替代真实 Host 观察成功。
- [x] 新增路由使用 08 的统一来源策略：禁用或不可用来源不可绕过；恢复后的旧藏书通过显式刷新续读，不替换原快照和进度。
- [x] REST 列表及来源选择参数经过共享运行时验证；未知来源被拒绝。WebUI 只调用 Local Core，图片仍经受限 reader session 代理，不暴露 GraphQL、上游页 URL 或永久使用运行时 ID。
- [x] 确定性端到端检查覆盖至少两个 Provider（含同名或同插件不同语言），证明安装后选择、搜索、真实可识别 fixture 图片、状态限制和重启后路由；测试证明选项不是仅展示而实际仍调用默认来源。

## Verification and delivery

先跑新增回归检查，再执行 `pnpm verify` 和 Standards / Spec 两路审查。fixture 与 recorded Suwayomi 响应保持确定性；若进行真实安装或读取，使用具体获批来源及隔离数据，单独记录观察，不把网络成功设为确定性门槛。保存命令、退出码、证据和日志路径。

## Scope

本工单连接现有可信安装流程与阅读，不新增公共插件市场、任意 JAR 导入界面、自动信任、离线下载或桌面打包。

## Answer

Implemented on `codex/09-installed-providers`, based on merged `origin/main@27f3685`.
The primary checkout and its unrelated changes were preserved; work lives in
`E:/Code/comic_free/.Codex/worktrees/09-installed-providers`.

- `createReadingRuntime` is the production/test composition. Approved installed
  packages are observed through a read-only Host query; runtime source IDs map to
  package + Provider name/language keys without being persisted. Search explicitly
  selects a Provider; durable comic keys retain its scope through details, chapters,
  sessions, restart, and Library binding refresh.
- The validated providers endpoint supplies loading/empty/success/error UI states,
  automatic discovery and manual retry. Same-name EN/FR options route to different
  fixture results and rendered SVG images. Configured Host failure never uses a fixture.
- Last Known Providers survive missing observations and updates. Unobserved entries
  remain visible but unreadable. Incomplete discovery records `refresh_failed`, not
  a fabricated Provider outage; explicit Host-unavailable failures keep their scope.
  Recovery clears the discovery error without rewriting saved snapshots or progress.
- Existing disable/recovery guards cover every route. Runtime changes expire old
  sessions. The restart-required deterministic flow uses controlled application IPC
  shutdown/start, rediscovers FR, refreshes its binding and resumes the saved second page.

Verification (2026-09-05):

- Red regression: installation succeeded, then `/api/v1/reading/providers` returned
  404 instead of 200 (`comic-free-09-red.log`). A second red check proved a missing
  Provider was incorrectly discarded (`missing-observation-red.log`); both are fixed.
- `pnpm verify`: typecheck, build, 98 unit/integration tests, 6 Chrome E2E tests.
  Full delivery log: `.local-data/test-output/09-installed-providers/verify-delivery.log`.
- Targeted policy, changing runtime ID, discovery-failure/recovery and catalog-retention
  logs are in the same private directory. Recorded Host tests change source IDs
  41/42 to 141/142 and manga/chapter IDs 101/201 to 501/601; stale page paths are rejected.
- Standards review: fixed the Comic Provider accessibility label; no unresolved findings.
  Spec review: corrected discovery failure attribution, added restart-required coverage,
  retained missing Provider observations and cleared the recovered global refresh state;
  all findings re-reviewed and closed.
- Host query shape was checked against official Suwayomi `v2.3.2243`
  [ExtensionQuery.kt](https://github.com/Suwayomi/Suwayomi-Server/blob/v2.3.2243/server/src/main/kotlin/suwayomi/tachidesk/graphql/queries/ExtensionQuery.kt).
  No live third-party installation or image smoke was performed in this ticket. The
  restart-required test proves the deterministic product contract, not that a real JAR
  update necessarily requires restart. Provider renames/ambiguous identities and old
  manually assigned keys fail closed with retained Library state; no silent remapping.

Delivery: local commits only. Push, PR creation and merge were not requested.
