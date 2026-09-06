# Source Comic Gallery

Status: implemented

## Goal

选择一个可用的 Comic Provider 后，Browser WebUI 自动加载该来源的完整热门目录，以漫画封面网格展示所有分页结果；用户点击任意封面卡片后，进入现有漫画详情、章节和阅读流程。

## Acceptance

- 来源选择后自动加载热门目录的每一页，直到 Comic Provider 明确返回末页。
- 每个目录结果展示封面和标题；封面加载只经过 Local Core，不让 Browser WebUI 直接访问 Plugin Host 或 Comic Provider。
- 整张封面卡片可点击，并打开对应漫画的详情及章节。
- 加载中、空目录、失败和封面加载失败均有可见状态；关键词搜索继续可用。
- 保留现有来源可用性策略、乱序响应防护、书架及阅读进度行为。
- 来源选择器只展示简体中文、繁体中文和英语 Comic Provider，按简体中文、繁体中文、英语排序并使用中文语言名称。

## Verification seam

公开 Browser WebUI：选择来源 → 等待全部分页封面 → 点击指定封面 → 看到对应详情和章节。

## Verification result

- `pnpm typecheck`: passed.
- `pnpm build`: passed.
- `pnpm test:unit`: 121 passed.
- `pnpm test:e2e`: 13 passed（包含中/英来源筛选、排序和中文标签验证）。
- Browser Harness: fixture 来源封面实际加载为 800 × 1200，点击整张卡片后显示详情与 2 个章节。
