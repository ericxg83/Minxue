# 敏学 PC 工作台 · 设计契约（DESIGN.md）

> 唯一权威设计规范，评审（静态 + 截图）以此为准。以 `src/workbench/styles/workbench-theme.css` 的 token 为准。
> 本文件随主题演化持续维护；阶段 0 从现有 token 反向抽取生成。

## 0. 阅读入口

- 主色、状态色、间距、字号、圆角、动效、阴影：`src/workbench/styles/workbench-theme.css`（`--wb-*` 前缀）
- 布局壳：`src/workbench/App.vue`（app-shell / app-main / workbench-content）
- 侧边导航：`src/workbench/components/layout/AppSidebar.vue`
- 顶栏：`src/workbench/components/layout/AppHeader.vue`

## 1. 设计原则

1. **一个主色系**：主色 Indigo `#6366F1`，accent Violet `#8B5CF6` 仅限渐变/图表强调。所有 hover/active/soft/mist 从这两色派生。
2. **克制卡片**：卡片默认无阴影（`--wb-elev-flat`），仅可浮起项（KPI 卡）用 `--wb-elev-card`，浮层用 `--wb-elev-overlay/modal`。
3. **统计数字一律 `font-variant-numeric: tabular-nums`**：数字宽度稳定，布局不跳动。
4. **色彩不作唯一信息载体**：状态同时有文字/图标/结构（如边框）表达。
5. **正文对比度 ≥ 4.5:1**：次要文字 `--wb-text-tertiary` 仅用于装饰性信息，可读性优先。
6. **禁止新增半档字号**：不得使用 10.5/11.5/12.5/13.5 等非 token 字号。字号只从 token 档取。
7. **等宽横排卡片 ≤ 3 张**：超过 3 张并列等宽卡会失去焦点，改为分隔单元（如 KpiStrip 单容器内分格）或网格。

## 2. 布局

- 侧栏 `--wb-sidebar-width: 220px`，顶栏 `--wb-header-height: 52px`
- 三档容器：standard 1520 / workspace 1520 / wide 1680（`wb-page__inner` max-width）
- 页面内边距：x `clamp(24px,3vw,40px)`，y `30px`
- 页面纵向滚动在 `.wb-page`，侧栏/顶栏不随内容滚动

## 3. 色板（token 权威）

| token | 值 | 用途 |
|---|---|---|
| `--wb-primary` | `#6366F1` | 主色 |
| `--wb-primary-hover` | `#6366f1` | hover |
| `--wb-primary-soft` | `#E0E7FF` | 软底 |
| `--wb-primary-mist` | `#EEF2FF` | 最浅底（active nav） |
| `--wb-accent` | `#8B5CF6` | 仅渐变/图表 |
| `--wb-bg` | `#F5F6F8` | 页面底 |
| `--wb-bg-card` | `#FFFFFF` | 卡片底 |
| `--wb-bg-hover` | `#F1F5F9` | hover 底 |
| `--wb-text` | `#1E293B` | 主文字 |
| `--wb-text-secondary` | `#64748B` | 次级 |
| `--wb-text-tertiary` | `#94A3B8` | 三级（装饰） |
| `--wb-border` | `#E2E8F0` | 边框 |
| `--wb-border-light` | `#F1F5F9` | 弱分隔 |
| `--wb-border-strong` | `#CBD5E1` | 强调分隔 |
| 状态 5 档 | fg+bg 各一 | success/info/warning/danger/processing |

## 4. 字号档（唯一合法档）

| 档 | token | 值 | 权重 |
|---|---|---|---|
| caption | `--wb-fs-caption` | 11px | 500 |
| meta | `--wb-fs-meta` | 12px | 500 |
| body | `--wb-fs-body` | 13px | 400 |
| card-title | `--wb-fs-card-title` | 15px | 600 |
| section | `--wb-fs-section` | 17px | 600 |
| page | `--wb-fs-page` | 22px | 650 |
| stat | `--wb-fs-stat` | 25px | 650 |
| display | `--wb-fs-display` | 32px | 仅 hero |

字族：`-apple-system, BlinkMacSystemFont, "PingFang SC", "SF Pro Text", "Inter", sans-serif`

## 5. 间距（8pt 系）

0/4/8/12/16/20/24/32/40/48（`--wb-space-0..12`）。控件内 padding 用 space-2/3，卡内用 space-4/6。

## 6. 圆角与边框

- 控件 8px（`--wb-radius-sm`）、卡片 10px（`md`）、浮层 12px（`lg`）、Hero 16px（`xl`）、pill
- 边框一律 1px `--wb-border` 系；分隔用 `--wb-border-light`
- **边框语言**：边框只用于「结构分组」与「状态强调」，不用于装饰性堆叠

## 7. 动效

- fast 120ms（hover/focus）、base 180ms、slow 240ms（弹层）
- ease：`cubic-bezier(0.4,0,0.2,1)`；位移/透明度组合，不用 scale 抖动

## 8. 导航（AppSidebar）契约

- **侧栏独立深色底**（r16x+2 裁决 2026-10-06：浅色模板感重，改深靛蓝 `#1b1a33`，与右侧浅色内容区形成明暗对比）：本地 token 前缀 `--sd-*`，不动全局主题 token
- 一级项：图标 + label，min-height 40px，圆角 6px，hover `rgba(255,255,255,0.06)`，active 白字 600 + 淡 Indigo 渐变底（`rgba(99,102,241,.24→.08)`）+ `inset 0 0 0 1px rgba(99,102,241,.28)` 微描边（不用左缘指示条，背景+描边已足够）
- **活数据徽标**：仅 `/grade` 一处 = `noti.summary.pendingReviewPapers`（待人工复核卷数，口径与批改中心 chip
  同源，⛔ 不得用未读通知数 `pendingReview`——那是「徽标 1 / 页面 7」事故成因，2026-10-09）。
  批改中心每次重拉列表会顺带刷一次摘要，避免「页面 0 / 徽标旧值」错位等 45s 轮询。
  `/weekly-report` 的「今日新增错题」角标已下线（r25x 裁决 2026-10-09：纯信息性、进页不清零、不代表有待办）。
  复用 AppHeader 轮询不新增请求；徽标仅在 >0 时显示
- 分组：`教学工作` / `教学资源` 两组。练习册管理 / 试卷答案库 / 我的考法库 是**平级一级项**，
  **不再有父子收纳**（r16x 裁决 2026-10-06：三者是不同对象；r101 的二级收纳已撤销）
- 分组标签：caption 11px，字重 700，`letter-spacing .08em`，中文语境克制呈现，深底下用 `rgba(255,255,255,.75)` 保障对比；`nav` 顶部接 1px 发丝分隔线（`rgba(255,255,255,.08)`）
- **禁止半档字号**：字号只从 §4 token 档取（r16x 已清掉 12.5px，勿再引入）
- 分组间距 20px，组内项间距 0（连续列表）
- 导航项圆角、hover/active 状态不得使用阴影，仅颜色/边框
- footer：32px 头像圆 + 名称 + 菜单，深色半透雾面卡（`rgba(255,255,255,.05)` + `inset 0 0 0 1px rgba(255,255,255,.08)`）
- ⛔ 入口可达性由 `test/resourceFold.test.mjs` 盯着：8 个入口必须在侧栏、对应路由不得删、
  不得出现「声明了 children 却没渲染」的孤儿子项（只删不接 = 入口静默消失）

## 9. 评审门槛

- 静态：P0/P1 必须 0；P2 允许 ≤ 2 且必须有修正方向
- 截图：另一多模态模型评分 ≥ 4/5；单条 finding 落地即算修复，误判需给出证据
