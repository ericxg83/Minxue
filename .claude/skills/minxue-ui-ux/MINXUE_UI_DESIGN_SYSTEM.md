# MINXUE UI DESIGN SYSTEM

## 敏学产品级 UI / UX 视觉与交互设计规范

> 版本：v1.2\
> 用途：作为敏学前端页面、组件、工作台、移动端界面设计与改造的长期视觉基线。\
> 适用对象：Claude Code、Codex、前端开发、UI/UX
> Skill，以及参与敏学界面设计的其他代理。\
> 配套：`.claude/skills/minxue-ui-ux/SKILL.md` 负责 UX/治理，本文件负责视觉/工程标准。

------------------------------------------------------------------------

# 0. Design Authority — 设计权威与 Skill 优先级

敏学 UI 的所有设计、UX、交互与视觉决策，必须遵循以下优先级。

## 0.1 优先级

当不同规范、Skill、组件库或设计建议之间出现冲突时，按照以下优先级处理：

1. **敏学产品业务规则**
2. **MINXUE_UI_DESIGN_SYSTEM.md**
3. **敏学 minxue-ui-ux SKILL**
4. **外部专业 UI / UX Skill**
5. **第三方组件库默认设计**
6. **AI 自主设计判断**

高优先级规则始终覆盖低优先级规则。

------------------------------------------------------------------------

## 0.2 外部 Skill 的角色

外部 UI / UX Skill 是专业能力的补充，不是敏学 Design System 的替代品。

外部 Skill 可以用于：

-   UX 研究与分析
-   信息架构
-   交互设计
-   用户流程设计
-   Responsive Design
-   Accessibility
-   Motion / Micro-interaction
-   UI refinement
-   Visual polish
-   Design critique
-   行业最佳实践参考

但外部 Skill **不得直接覆盖或修改敏学已经确定的设计原则**。

------------------------------------------------------------------------

## 0.3 敏学品牌与视觉规则不可被覆盖

以下内容属于敏学核心设计资产：

-   敏学品牌 VI
-   主色与语义色
-   Design Tokens
-   Typography hierarchy
-   Spacing system
-   Radius system
-   Border system
-   Elevation / Shadow system
-   页面布局原则
-   组件规范
-   信息层级原则
-   “克制优先”的视觉原则
-   已明确禁止的 AI UI 反模式

任何外部 Skill 提出的方案，如果与以上规则冲突：

**必须优先遵循敏学 Design System。**

------------------------------------------------------------------------

## 0.4 外部 Skill 应该解决什么问题

当敏学 Design System 没有明确规定某个问题时，可以使用外部 Skill 提供专业建议。

例如：

-   某个操作应该使用 Drawer、Dialog 还是 Popover？
-   列表应该整行可点击还是只提供 Action？
-   筛选条件应该即时生效还是点击“应用”？
-   移动端复杂表单如何组织？
-   Loading / Empty / Error 状态应该如何设计？
-   如何减少用户完成任务所需的操作步骤？
-   如何改善页面的信息架构？
-   如何设计 hover、focus、transition 等交互反馈？

这些问题可以充分参考外部 UX / UI Skill。

------------------------------------------------------------------------

## 0.5 禁止为了“体现 Skill”而修改页面

任何 Skill 都不得为了体现设计能力而主动增加：

-   不必要的渐变
-   装饰性图标
-   大型 Hero
-   Bento Grid
-   大面积视觉特效
-   不必要的动画
-   不必要的 Card
-   不必要的阴影
-   不必要的圆角
-   不必要的交互
-   新的 UI 组件体系

如果当前设计已经合理：

**保持不变。**

设计优化必须有明确的用户体验、信息架构或视觉层级收益。

------------------------------------------------------------------------

## 0.6 设计决策原则

面对任何 UI / UX 问题，优先回答：

> 这个变化是否让用户更容易完成任务？

而不是：

> 这个变化是否让页面看起来更丰富？

敏学的设计目标：

**清晰 > 装饰**

**效率 > 炫技**

**信息层级 > 视觉噱头**

**一致性 > 局部惊艳**

**功能反馈 > 动画效果**

**克制 > 堆叠**

------------------------------------------------------------------------

# 01. 产品定位

敏学是面向教师、家长与学生的学习产品。

UI 不是营销落地页，也不是为了展示技术能力的 Demo。

### 核心设计目标

**专业、克制、清晰、高效、有温度。**

设计优先级：

1.  用户能否快速理解当前状态
2.  用户能否快速完成当前任务
3.  信息层级是否清楚
4.  不同页面是否属于同一个产品
5.  视觉是否精致
6.  装饰是否有价值

视觉表现不能牺牲任务效率。

------------------------------------------------------------------------

# 02. 两套界面气质

敏学存在两种主要界面环境，不要求完全相同，但必须共享同一品牌语言。

## 2.1 PC 教师工作台

技术基线：

-   Vue 3
-   Pinia
-   Element Plus
-   scoped CSS
-   `--wb-*` 变量

用户：

-   教师
-   主要任务为批改、复核、查看学生状态、处理学习数据

气质：

**专业、可靠、紧凑、状态优先、工作台化。**

关键词：

> Dense / Clear / Reliable / Efficient

不要做成：

-   营销网站
-   大面积 Hero 页面
-   装饰性 Dashboard
-   卡片墙
-   "AI 产品宣传页"

## 2.2 移动端

技术基线：

-   React 18 + Vite
-   Zustand
-   Tailwind
-   CSS Variables
-   `MobilePrimitives`
-   lucide-react
-   motion/react

用户：

-   家长
-   学生

气质：

**任务型、内容优先、少字、结论优先、单手可操作。**

移动端与 PC 可以有不同的信息密度，但必须保持：

-   品牌色
-   字体层级
-   状态语义
-   按钮语义
-   圆角语言
-   图标语言
-   反馈语言

的一致性。

------------------------------------------------------------------------

# 03. 整体视觉原则

## 3.1 克制，而不是寡淡

敏学需要留白，但留白必须承担作用。

好的留白：

-   分隔不同信息层级
-   帮助用户聚焦主要内容
-   提高阅读舒适度
-   给主要操作建立呼吸空间

无效留白：

-   内容被固定 `max-width` 压在中间
-   宽屏左右出现大片空白
-   一个很短的信息占据巨大卡片
-   为了"高级感"人为拉大区块
-   页面内容看起来像没有完成

**原则：留白必须有意图。**

## 3.2 专业，而不是冷冰冰

避免：

-   过度企业后台感
-   纯灰色堆叠
-   所有内容都使用同一种灰度
-   过度细碎的分割线

允许：

-   柔和的品牌色点缀
-   小面积状态色
-   轻量图标
-   微妙层级变化

## 3.3 精致，而不是装饰

优先通过以下方式产生品质感：

-   对齐
-   间距节奏
-   字体层级
-   颜色比例
-   组件尺寸
-   状态反馈
-   动效细节

而不是依靠：

-   大渐变
-   大阴影
-   玻璃拟态
-   大型插画
-   过多彩色图标
-   大量圆角卡片

------------------------------------------------------------------------

# 03.5 Design Tokens · 唯一权威

> 这一节是**工程落地**的核心。任何页面、组件、CSS 都必须从这一节取 token。
> 禁止业务页内自造颜色、字号、圆角、阴影、间距数值。

## 3.5.1 总则

-   **品牌色 `#6366F1` 不可替换**。不要因为某个 UI 库偏好就换主色。
-   **PC 与 Mobile 共享同一组语义色数值**（success/info/warning/danger/processing），命名可以不同（`--wb-status-*` vs `--status-*`），但颜色值必须一致。
-   **PC 端圆角克制（6/8/10/12），Mobile 端 iOS 风格（10/14/20/26/32）**。两套圆角语言**有意区分**，不要跨端统一。
-   **Token 名称跨端不对齐没关系，颜色数值跨端必须一致**。

## 3.5.2 颜色 · Color

### 品牌主色

``` css
/* PC 端 */
--wb-primary:        #6366F1   /* 主色 / Indigo-500 */
--wb-primary-hover:  #4F46E5
--wb-primary-soft:   #E0E7FF   /* tinted fill */
--wb-primary-mist:   #EEF2FF   /* 极浅底 */

/* Mobile 端 */
--primary:           #3157D5   /* 注意：移动端主色稍深，PC 端更亮 */
```

> ⚠️ **重要**：PC 端主色 `#6366F1`、Mobile 端主色 `#3157D5` 是**两个有意区分的值**。
> 这与"跨端共享色"不矛盾——"主色"是品牌代表色，跨端保持视觉一致即可，不必数值完全相同。
> **不要为追求完全统一而把某一端改掉。**

### 5 档状态色（PC 与 Mobile 共用同一组值）

| 状态 | Foreground | Background | 用途 |
|---|---|---|---|
| `success` | `#16A34A` | `#DCFCE7` | 已完成、已掌握、正确 |
| `info` | `#6366F1` | `#EEF2FF` | 进行中（非紧急）、说明、提示 |
| `warning` | `#D97706` | `#FEF3C7` | 待处理、注意、轻微异常 |
| `danger` | `#DC2626` | `#FEE2E2` | 错误、失败、需立即处理 |
| `processing` | `#7C3AED` | `#F5E8FF` | AI 批改中、异步处理中 |
| `neutral` | `#64748B` | `#F1F5F9` | 默认、无语义 |

> "处理中"是敏学特殊状态——AI 还没出判定，但不是失败也不是成功，必须与 danger 严格区分。

### 文字层级

``` css
--wb-text:            #1E293B   /* 一级文字 · 标题、关键数字 */
--wb-text-secondary:  #64748B   /* 二级文字 · 描述、辅助 */
--wb-text-tertiary:   #94A3B8   /* 三级文字 · 时间戳、meta */
--wb-text-disabled:   #CBD5E1
--wb-text-inverse:    #FFFFFF
```

## 3.5.3 间距 · Spacing（4 倍数）

``` css
--wb-space-0:  0
--wb-space-1:  4px
--wb-space-2:  8px
--wb-space-3: 12px
--wb-space-4: 16px   /* 默认卡间距、section gap */
--wb-space-5: 20px
--wb-space-6: 24px   /* 默认页面内 padding、卡内 padding */
--wb-space-8: 32px
--wb-space-10: 40px
--wb-space-12: 48px
```

**用法约束**：
- 业务页内禁止写 `padding: 13px / 14px / 17px / 18px` 等非 scale 数值。
- 临时微调（1–2px）允许，但应当写注释说明。
- gap / padding / margin 三者均使用同一组 scale。

## 3.5.4 字号 · Typography Ramp

``` css
--wb-fs-eyebrow:    11px   /* kicker / 全大写小标 */
--wb-fs-caption:    11px   /* 辅助说明、tooltip、字段标签 */
--wb-fs-meta:       12px   /* 二级文字、表头、行内 tag */
--wb-fs-body:       13px   /* 正文、行内数据 */
--wb-fs-card-title: 15px   /* 卡片标题 */
--wb-fs-section:    17px   /* section heading */
--wb-fs-page:       22px   /* 页面标题 */
--wb-fs-stat:       25px   /* 数字、指标 */
--wb-fs-display:    32px   /* 极少使用 · 仅 1–2 处 hero 数字 */
```

**字重**（PC 工作台 4 档）：

``` css
--wb-fw-regular:   400
--wb-fw-medium:    500
--wb-fw-semibold:  600
--wb-fw-bold:      650   /* 不用 700，避免与移动端"加粗"含义不同 */
```

**行高**：

``` css
--wb-lh-tight:    1.25   /* 标题、统计数字 */
--wb-lh-normal:   1.5    /* 默认 */
--wb-lh-relaxed:  1.65   /* 段落正文 */
```

## 3.5.5 圆角 · Radius

### PC 工作台（克制体系）

``` css
--wb-radius-xs:    6px   /* 状态 tag、mini chip */
--wb-radius-sm:    8px   /* 按钮、输入框 */
--wb-radius-md:   10px   /* 卡片、面板（默认） */
--wb-radius-lg:   12px   /* 弹层、dialog */
--wb-radius-xl:   16px   /* 仅 Hero 卡片 */
--wb-radius-pill: 9999px /* pill、状态点 */
```

### Mobile 端（iOS 风格）

``` css
--radius-sm:  10px
--radius-md:  14px   /* 默认卡片 */
--radius-lg:  20px
--radius-xl:  26px
--radius-2xl: 32px
```

> **不要把 Mobile 圆角改成 PC 体系**。两套体系是有意区分的。

## 3.5.6 边框 · Border

``` css
--wb-border:         #E2E8F0   /* 默认 1px */
--wb-border-light:   #F1F5F9   /* 行内分隔 */
--wb-border-strong:  #CBD5E1   /* 强调 */
--wb-border-subtle:  #F8FAFC   /* 几乎不可见 */
--wb-border-hairline: 1px      /* 主宽度，PC 端不用 0.5px */
```

## 3.5.7 阴影 · Elevation（PC 工作台）

**核心原则：PC 工作台默认无阴影，靠 border 分层。只有浮层才使用阴影。**

``` css
--wb-elev-flat:     none                            /* 默认 · 99% 场景 */
--wb-elev-card:     0 1px 2px rgba(15,23,42,0.04)   /* 几乎不可见 · 仅可浮起的 KPI 卡 */
--wb-elev-overlay:  0 8px 24px rgba(15,23,42,0.10)  /* popover、tooltip */
--wb-elev-modal:    0 16px 40px rgba(15,23,42,0.14) /* dialog、drawer */
```

> ⚠️ **禁止 `box-shadow: 0 18px 40px rgba(15,23,42,.55)` 这种重阴影**。这是 HandoutPreview 当前的违规。
> **禁止普通内容卡片使用 `box-shadow` 来"浮起"**。需要层级用 border + 背景色差。

## 3.5.8 动效 · Motion

``` css
--wb-motion-fast:     120ms   /* hover、focus */
--wb-motion-base:     180ms   /* 默认 */
--wb-motion-slow:     240ms   /* 弹层进出 */
--wb-motion-ease:     cubic-bezier(0.4, 0, 0.2, 1)
--wb-motion-ease-out: cubic-bezier(0, 0, 0.2, 1)
```

不要用：循环动画、自动播放、超过 300ms 的弹跳、无意义漂浮。

## 3.5.9 状态徽标尺寸（StatusTag 遵守）

``` css
--wb-tag-height:  22px
--wb-tag-padding: 0 8px
--wb-tag-radius:  5px
--wb-tag-fs:      11px
--wb-tag-fw:      600
--wb-tag-dot-size: 6px
--wb-tag-gap:     5px
```

------------------------------------------------------------------------

# 04. Layout · 三档容器原则（v1.1 新增）

> 取代旧的"PC 禁止窄腰 / 推荐自适应"原则。
> 新原则：**根据页面类型选择容器档位**。
> 禁止简单把所有 max-width 调到 1600px 收场。

## 4.0 三档容器定义

| 档位 | Token | 数值 | 适用页面 |
|---|---|---|---|
| **Standard** | `--wb-container-standard` | 1320px | 列表、表单、设置、对象详情（默认） |
| **Workspace** | `--wb-container-workspace` | 1520px | 批改中心、学生工作台、诊断、对比 |
| **Wide** | `--wb-container-wide` | 1680px | 复杂双/三栏、宽表格、对比工作区、编辑器 |
| Bleed | — | 100% | 弹层、独立编辑器、特殊场景 |

### 使用方式

``` html
<!-- 默认 Standard · 不需要加 modifier -->
<div class="wb-page">
  <div class="wb-page__inner">…</div>
</div>

<!-- Workspace 档位 · 在 .wb-page 上叠加 modifier -->
<div class="wb-page wb-page--workspace">
  <div class="wb-page__inner">…</div>
</div>

<!-- Wide 档位 -->
<div class="wb-page wb-page--wide">
  <div class="wb-page__inner">…</div>
</div>
```

也提供单一区块级的命名空间：

``` html
<section class="wb-container--workspace">…</section>
```

## 4.1 各档位的页面归属

| 档位 | 当前归属页面 |
|---|---|
| **Standard** | HandoutList · WorksheetList · QuestionBank · Settings · Login · 用户中心 |
| **Workspace** | DashboardWorkbench · GradeCenterWorkbench · StudentsWorkbench · StudentDetailWorkbench · WeeklyReportWorkbench · WorksheetManagement · WrongBook · RetryTasks · Todo |
| **Wide** | GrowthWorkbench · HandoutPreview · 任何带 3 栏 / 表格可视空间 / 数据对比的页面 |

> 当前很多 Workspace 页面仍用着 Standard 容器，这是窄腰问题的主因。
> 下一阶段开始把这些页面迁到对应的档位。

## 4.2 容器内的布局原则

**当屏幕变宽时，优先增加**：

-   并列信息区
-   第二列
-   筛选区
-   操作区
-   表格可视空间
-   数据对比空间

**不要**简单把单个 Card 拉宽。

### 错误

``` text
一个卡片从 600px 拉到 1300px，里面只有三行文字
```

### 正确

``` text
┌──────────────┬──────────────┐
│ 主要信息     │ 次级信息      │
├──────────────┴──────────────┤
│ 表格 / 列表 / 工作区         │
└─────────────────────────────┘
```

## 4.3 页面内边距

PC 工作台：

-   水平：`--wb-page-padding-x: 24px`（统一，不写 `clamp`）
-   垂直：`--wb-page-padding-y: 24px`
-   底部：`--wb-page-padding-bottom: 48px`
-   **禁止在同一工作台内出现 16 / 24 / 48 / 64px 随机分布**

------------------------------------------------------------------------

# 05. 信息层级

敏学界面遵循：

> **先结论，再细节。**
>
> **先操作，再原始数据。**
>
> **先人话，再术语。**

## 一级信息

用户当前最需要知道的：

-   页面标题
-   当前状态
-   核心数字
-   当前任务
-   最重要操作

## 二级信息

用于辅助决策：

-   时间
-   次级状态
-   简短说明
-   对比信息
-   次级操作

## 三级信息

用于深入查看：

-   ID
-   技术状态
-   JSON
-   模型名称
-   原始识别结果
-   诊断信息

三级信息不能抢一级信息的视觉注意力。

------------------------------------------------------------------------

# 06. Typography 字体层级

字体层级必须形成稳定的视觉节奏。

建议建立项目 token，而不是每个页面单独决定字号。

示例层级：

``` text
Page Title
  ↓
Section Title
  ↓
Card / Object Title
  ↓
Body
  ↓
Secondary
  ↓
Caption
```

原则：

-   页面标题明显，但不要巨大
-   数据数字可以突出，但不能像营销页 Hero 数字
-   正文保证可读性
-   辅助文字降低视觉权重
-   不通过大量加粗制造层级
-   不使用大量全大写英文 eyebrow

敏学主界面语言为中文。

------------------------------------------------------------------------

# 07. Color 色彩系统

## 7.1 品牌色

必须延续敏学现有 VI。

**不得因为某个 UI Skill、组件库或设计参考而自行创造另一套品牌色。**

品牌色应主要承担：

-   主操作
-   当前选中
-   品牌识别
-   重要强调

不要大面积铺满页面。

## 7.2 中性色

建立明确的：

-   页面背景
-   卡片背景
-   一级文字
-   二级文字
-   辅助文字
-   边框
-   分割线

层级。

不要让页面变成：

> 白底 + 很多深浅不同的灰色随机组合。

## 7.3 状态色

状态颜色必须具有语义。

至少区分：

-   成功
-   信息
-   警告
-   错误 / 危险
-   待处理

状态色主要用于：

-   Badge
-   状态点
-   小面积背景
-   图标
-   边框
-   提示

不要让状态色大面积污染页面。

------------------------------------------------------------------------

# 08. Icon 图标系统

敏学可以使用图标，但图标必须承担识别或操作作用。

## 推荐

-   一级导航图标
-   操作按钮图标
-   状态图标
-   数据类别识别
-   空状态中的少量辅助图形

## 不推荐

-   每个 Card 都放一个彩色大图标
-   为了"活泼"给所有数字配彩色图标
-   同一页面使用多种图标风格
-   图标比文字还醒目
-   使用大量插画式彩色 icon

### 图标原则

> **图标帮助理解，不负责装饰。**

默认优先保持统一线性图标语言。

------------------------------------------------------------------------

# 09. Card 卡片系统

Card 是信息分组工具，不是默认页面容器。

## 应该使用 Card

当内容需要：

-   与其他内容形成明确分组
-   独立状态
-   独立操作
-   并列比较

## 不应该使用 Card

当：

-   两段内容本身属于同一信息层级
-   只是为了给页面"加东西"
-   一个 Card 内只有一两行普通文本
-   一整页被拆成十几个相同 Card

### 卡片层级

页面最多建立有限的视觉层级：

``` text
Page
 ├── Section
 │    ├── Card
 │    └── Card
 └── Table / List
```

避免：

``` text
Card
 └── Card
      └── Card
           └── Card
```

------------------------------------------------------------------------

# 10. Button 按钮系统

按钮必须有明确层级。

建议：

### Primary

当前页面最重要的一个动作。

### Secondary

重要但非主要动作。

### Text / Ghost

低干扰操作。

### Danger

删除、清空、重置等危险动作。

原则：

-   一个视觉区域不要出现多个同权重 Primary
-   不用颜色区分一堆本质相同的操作
-   按钮文字使用真实动作
-   避免"确定""提交"这类脱离上下文的抽象词

------------------------------------------------------------------------

# 11. Tabs 标签页

Tabs 用于：

> **同一对象 / 同一工作流下的平级内容切换。**

不要为了让页面"看起来完整"强行增加 Tab。

Tab 应该：

-   数量适中
-   名称短
-   当前状态明显
-   与页面标题存在清晰关系

如果几个区域其实是同一页面的连续内容，优先考虑页面结构，而不是 Tab。

------------------------------------------------------------------------

# 12. Table / List 数据列表

教师工作台属于高信息密度场景。

列表和表格优先保证：

1.  快速扫描
2.  快速定位
3.  快速操作
4.  状态可识别

避免：

-   每行塞大量按钮
-   操作按钮到处重复
-   一行一个大 Card
-   为了视觉留白把行高做得过大
-   把复杂编辑塞进表格

复杂编辑优先：

-   详情面板
-   Drawer
-   独立页面
-   分步流程

------------------------------------------------------------------------

# 13. Dashboard / 工作台首页

工作台首页不是"统计数字展示墙"。

首页应该回答：

1.  **现在有什么事情需要我处理？**
2.  **有没有异常？**
3.  **哪些学生需要关注？**
4.  **我下一步应该做什么？**

推荐结构：

``` text
页面标题 / 问候
        ↓
关键待办 / 核心状态
        ↓
主要工作区
        ↓
次级数据 / 趋势
```

而不是：

``` text
8 个统计 Card
↓
4 个彩色图表
↓
3 个装饰区块
```

------------------------------------------------------------------------

# 14. Status 状态设计

任何重要状态都应该让用户知道：

> **发生了什么 → 对我有什么影响 → 我下一步做什么**

例如：

错误：

> 图片处理没有完成

更好：

> 图片不够清晰，建议重拍这一页。

或者：

> AI 服务暂时不可用，请稍后重试。

状态必须可行动。

------------------------------------------------------------------------

# 15. Loading / Empty / Error / Long Content

每个真实页面都必须考虑：

-   Loading
-   Empty
-   Error
-   Partial data
-   Long text
-   Long file name
-   Overflow
-   No permission
-   Network failure

不要只设计"正常状态"。

空状态不是装饰页面。

它应该说明：

-   为什么为空
-   是否正常
-   用户下一步可以做什么

------------------------------------------------------------------------

# 16. Motion 动效

动效只用于：

-   页面状态变化
-   Hover
-   Active
-   展开 / 收起
-   Loading
-   成功反馈
-   页面切换

不要使用：

-   无意义漂浮
-   大幅弹跳
-   炫技动画
-   自动循环动画
-   为了"AI 感"增加的动态背景

原则：

> **动效应该让界面更容易理解，而不是让界面更显眼。**

------------------------------------------------------------------------

# 17. Responsive 响应式

PC 与移动端不是简单缩放。

### PC

重点：

-   信息密度
-   并列布局
-   快速操作
-   键盘效率

### 移动端

重点：

-   单手操作
-   结论优先
-   主操作优先
-   少字
-   合理重排

移动端必须重新安排任务优先级，而不是机械地把 PC 页面纵向堆叠。

------------------------------------------------------------------------

# 18. 组件一致性

同一产品中：

-   相同意义的按钮必须长得相近
-   相同状态必须使用相同颜色语义
-   相同层级的标题必须保持相近尺寸
-   相同页面边距必须保持一致
-   相同类型的列表必须共享交互语言
-   相同类型的 Tab / Badge / Input / Card 必须尽量复用

### 特别警惕

> **"局部都很好看，但放在一起不像同一个产品。"**

这是敏学当前 UI 演进阶段的重要风险。

------------------------------------------------------------------------

# 19. AI UI 反模式

敏学禁止为了制造"高级感"而自动出现：

-   大面积渐变
-   紫色玻璃拟态
-   巨大 Hero
-   大号营销标语
-   每个区块一个 eyebrow
-   彩色图标墙
-   Card 墙
-   过度圆角
-   过重阴影
-   巨大数字
-   过度留白
-   过多装饰线
-   一页堆很多视觉风格
-   组件库默认样式直接作为最终设计

注意：

**这些不是绝对技术禁令。**

如果某个特殊页面确实需要表现力，必须说明为什么它符合产品任务与品牌，而不是因为"这样更好看"。

------------------------------------------------------------------------

# 20. 设计参考的使用原则

外部设计系统、UI Gallery、组件库都只能作为：

> **参考来源**

不能成为敏学最终视觉权威。

参考设计可以帮助解决：

-   组件形式
-   交互模式
-   排版灵感
-   状态表现
-   动效方式

但最终必须服从：

**敏学品牌 → 敏学 Design System → 当前页面任务 → 现有组件基线**

而不是：

**某个 UI 库 → 直接套用。**

------------------------------------------------------------------------

# 21. 新页面设计流程

设计或改造一个页面时，按以下顺序：

``` text
1. 理解用户任务
       ↓
2. 判断页面类型
       ↓
3. 确认信息优先级
       ↓
4. 确认入口与操作路径
       ↓
5. 选择布局
       ↓
6. 选择已有组件
       ↓
7. 应用 Design System
       ↓
8. 实现
       ↓
9. 浏览器实际验证
       ↓
10. 截图检查视觉
       ↓
11. 检查跨页面一致性
```

不要：

``` text
看到截图
↓
直接模仿视觉
↓
开始写 CSS
```

------------------------------------------------------------------------

# 22. 页面改造的判断顺序

发现页面不好看时，不要立即修改颜色或圆角。

按以下顺序排查：

### Level 1：结构

-   信息架构是否合理
-   页面是否需要这些区块
-   是否存在重复操作
-   是否应该合并内容

### Level 2：布局

-   是否存在无效留白
-   内容宽度是否合理
-   对齐是否统一
-   栅格是否合理

### Level 3：信息层级

-   用户第一眼看到什么
-   主操作是否明确
-   次要信息是否抢注意力

### Level 4：组件

-   Card 是否过多
-   Button 是否过多
-   Tab 是否必要
-   Icon 是否过多

### Level 5：视觉

-   字体
-   颜色
-   边框
-   阴影
-   圆角

### Level 6：动效

最后才考虑。

------------------------------------------------------------------------

# 23. 验收标准

交付任何重要 UI 前，必须确认：

## Layout

-   [ ] 页面宽度利用合理
-   [ ] 没有无意义的大面积留白
-   [ ] 页面边距统一
-   [ ] 内容没有被过窄容器压缩
-   [ ] 卡片没有无限拉宽
-   [ ] 对齐线清晰

## Hierarchy

-   [ ] 第一眼能找到主要任务
-   [ ] 核心状态明显
-   [ ] 次要信息没有抢主视觉
-   [ ] 操作与内容足够接近

## Visual

-   [ ] 色彩服从敏学 VI
-   [ ] 组件风格统一
-   [ ] 图标风格统一
-   [ ] 圆角统一
-   [ ] 边框与阴影克制
-   [ ] 没有明显 AI 模板感

## UX

-   [ ] Loading 有处理
-   [ ] Empty 有处理
-   [ ] Error 有处理
-   [ ] 长文本有处理
-   [ ] 危险操作有保护
-   [ ] 失败后有恢复路径

## Responsive

-   [ ] PC 宽屏正常
-   [ ] 1366px 左右正常
-   [ ] 移动端主任务可完成
-   [ ] 不存在横向溢出
-   [ ] 操作顺序符合设备特点

------------------------------------------------------------------------

# 24. 当前敏学设计阶段的核心判断

敏学现在不需要：

> **"更多 UI。"**

需要的是：

> **"更统一的 UI。"**

不需要：

> **"更多视觉效果。"**

需要的是：

> **"更准确的视觉层级。"**

不需要：

> **"更大的留白。"**

需要的是：

> **"有目的的留白。"**

不需要：

> **"把后台做得像网站。"**

需要的是：

> **"把后台做成真正好用、专业、有品牌感的教师工作台。"**

------------------------------------------------------------------------

# 25. 最终设计原则

如果设计者只能记住五句话：

### 01

**结构上克制，视觉上精致。**

### 02

**先解决任务和信息层级，再解决漂亮。**

### 03

**留白必须有目的，宽屏必须被合理利用。**

### 04

**组件可以参考外部设计系统，但敏学自己的设计语言才是最终权威。**

### 05

**单个页面好看不够，整个敏学必须看起来像同一个产品。**

------------------------------------------------------------------------

# 26. Component API · 唯一标准（v1.1 新增）

> 下面这些组件 API 是工作台的"唯一标准"。
> 业务页**禁止**自造同义组件。下一阶段开始把业务页内自造的同名实现替换到这些 API。

## 26.1 PageHeader · 页面标题

**位置**：`src/workbench/components/ui/PageHeader.vue`

``` vue
<PageHeader
  eyebrow="教学工作 / 批改中心"     <!-- 可选 · 面包屑/分组小标 -->
  title="作业批改"                  <!-- 必填 · 页面标题 -->
  description="集中处理学生作业与错题重练，当前有 12 项待处理。"  <!-- 可选 · 一句人话说明 -->
>
  <template #badge>
    <span class="pending-pill">12 项待处理</span>     <!-- 可选 · 标题旁的徽标 -->
  </template>
  <template #actions>
    <ActionButton variant="primary">开始批改</ActionButton>   <!-- 可选 · 右侧操作组 -->
  </template>
</PageHeader>
```

**视觉规则**：
- 标题 22px（`--wb-fs-page`）/ weight 650 / letter-spacing -.025em
- eyebrow 11px / primary 色 / letter-spacing .05em
- description 13px / secondary 色
- actions 右对齐，可 wrap

## 26.2 FilterBar · 筛选条

**位置**：`src/workbench/components/ui/FilterBar.vue`

``` vue
<FilterBar>
  <template #leading>
    <span>当前显示</span>
    <strong>12 名学生</strong>
  </template>
  <el-input placeholder="搜索" />
  <div class="filter-tabs">…</div>
  <template #actions>
    <ActionButton>导出</ActionButton>
  </template>
</FilterBar>
```

3 个 slot：`leading`（左侧标题/计数）、`filters`（中间筛选器）、`actions`（右侧操作）。

## 26.3 ContentCard · 通用卡片

**位置**：`src/workbench/components/ui/ContentCard.vue`

``` vue
<ContentCard title="任务队列" description="按优先级排列" flush>
  <template #actions>
    <el-button text type="primary">查看全部</el-button>
  </template>
  <!-- 主体内容 -->
  <EmptyState v-if="!items.length" title="没有任务" />
  <template #footer>
    <Pagination />
  </template>
</ContentCard>
```

**`flush` 模式**（默认带 20px padding，flush 时 padding 0）：用于表格、列表等需要撑满卡片的场景。

## 26.4 StatsCard · 单张指标卡

**位置**：`src/workbench/components/ui/StatsCard.vue`

``` vue
<StatsCard label="在读学生" :value="summary.active" unit="人" description="当前正常上课" tone="primary" />
<StatsCard label="待掌握错题" :value="3" unit="道" tone="danger" />
<StatsCard label="重练任务" :value="0" unit="份" />
```

`tone` 6 档：default / primary / success / info / warning / danger / processing。

**当 ≥ 2 张时** → 优先使用 `KpiStrip`（见 26.8）。

## 26.5 StatusTag · 状态徽标（**唯一实现**）

**位置**：`src/workbench/components/ui/StatusTag.vue`

``` vue
<StatusTag tone="success" label="已掌握" />
<StatusTag tone="warning">待处理</StatusTag>
<StatusTag tone="danger" :dot="false">处理异常</StatusTag>
<StatusTag tone="processing" label="批改中" />
<StatusTag tone="info" label="信息" />
<StatusTag tone="neutral" label="未开始" />
```

**6 档 tone**（**唯一**）：

| tone | 颜色对 | 用途 |
|---|---|---|
| `success` | green-600 / green-100 | 已完成、已掌握、正确 |
| `info` | indigo / indigo-100 | 进行中（非紧急）、说明 |
| `warning` | amber-600 / amber-100 | 待处理、注意、轻微异常 |
| `danger` | red-600 / red-100 | 错误、失败、需立即处理 |
| `processing` | violet / violet-100 | AI 批改中、异步处理 |
| `neutral` | slate / slate-100 | 默认、无语义 |

**禁止**业务页自造：
- `.status-badge` ← 删除
- `.risk-status` / `.mastery-status` ← 删除
- `<el-tag type="success" size="small" effect="plain">` ← 替换为 StatusTag

## 26.6 ActionButton · 按钮

**位置**：`src/workbench/components/ui/ActionButton.vue`

``` vue
<ActionButton variant="primary">开始批改</ActionButton>
<ActionButton variant="secondary">导出</ActionButton>
<ActionButton variant="danger">删除</ActionButton>
```

3 档：`primary` / `secondary` / `danger`。**禁止**业务页直接写 `el-button type="primary"`，应当包成 `ActionButton`。

## 26.7 EmptyState · 空态

**位置**：`src/workbench/components/ui/EmptyState.vue`

``` vue
<EmptyState
  title="今天没有待处理事项"
  description="作业处理完成后，新的任务会出现在这里。"
  compact
>
  <template #actions>
    <ActionButton>立即上传</ActionButton>
  </template>
</EmptyState>
```

`compact` 模式用于卡片内部（高度 160px vs 默认 240px）。

**所有列表/表格页面必须接入 EmptyState**。禁止空态下显示空白。

## 26.8 KpiStrip · 顶部 KPI 条（**官方标准**）

**位置**：`src/workbench/components/ui/KpiStrip.vue`

**基准来自 DashboardWorkbench 的 `.summary-strip`**：

- 4 列等宽，靠 border 分隔建立层级
- 不使用大号彩色 icon
- 不使用渐变 icon 背景
- 不使用营销式 KPI 卡
- 数字 + label 为主，tabular-nums 对齐
- 整行可点击，hover 高亮

``` vue
<KpiStrip
  aria-label="今日摘要"
  :items="[
    { key: 'pending', value: 12, label: '待人工复核', actionLabel: '去处理', actionIcon: ArrowRight, onClick: () => go('/todo') },
    { key: 'failed',  value: 3,  label: '识别异常', tone: 'danger', actionLabel: '查看异常', onClick: () => go('/todo') },
    { key: 'wrong',   value: 7,  label: '今日新增错题', actionLabel: '看错题池', onClick: () => go('/wrongbook') },
    { key: 'students',value: 18, label: '当前学生', actionLabel: '查看学生', onClick: () => go('/students') }
  ]"
/>
```

> **收敛目标**：GrowthWorkbench 等页面的旧 KPI 卡（带渐变彩色 icon 块的）需要逐步迁移到 KpiStrip。
> 业务页在迁移前不要使用新样式重写。

## 26.9 MiniStat · 内嵌迷你统计

**位置**：`src/workbench/components/ui/MiniStat.vue`

用于 ContentCard 内部或同行多列的迷你数字。

``` vue
<dl class="ds-mini-stat-grid">
  <MiniStat label="题目" :value="12" unit="题" />
  <MiniStat label="错题" :value="3" unit="题" tone="danger" emphasis />
  <MiniStat label="处理状态" value="已批改" />
</dl>
```

**禁止**业务页自造 `dl > div > dt + dd` 三段式结构。

------------------------------------------------------------------------

## 26.10 WorkbenchDialog · 弹层统一组件

**位置**：`src/workbench/components/ui/WorkbenchDialog.vue`

```vue
<WorkbenchDialog
  v-model="visible"
  title="编辑学生信息"
  :loading="saving"
  @closed="resetForm"
>
  <el-form>...</el-form>
  <template #footer>
    <ActionButton variant="ghost" @click="visible = false">取消</ActionButton>
    <ActionButton variant="primary" :loading="saving" @click="save">保存</ActionButton>
  </template>
</WorkbenchDialog>
```

**视觉规则**：
- 外层圆角 12px（`--wb-radius-lg`）
- 阴影 `0 16px 40px rgba(15,23,42,.14)`（`--wb-elev-modal`）
- 标题 17px / 600（`--wb-fs-section` / `--wb-fw-semibold`）
- header padding `18px 24px` / body padding `20px 24px` / footer padding `14px 24px`（对齐 ContentCard）
- 关闭按钮 hover 浅背景

**Props**：
| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `modelValue` | Boolean | false | v-model 显隐 |
| `title` | String | '' | 标题 |
| `width` | String/Number | '420px' | 宽度（表单弹窗默认 420） |
| `loading` | Boolean | false | 提交中状态：禁用遮罩 / Esc / 关闭按钮 |
| `destroyOnClose` | Boolean | true | 关闭后销毁内容 |

**行为规则**：
- `loading=true` 时：遮罩不可点关闭 / Esc 不可关 / 关闭按钮失效
- 内部表单（`el-form` / `el-form-item` / `el-input`）由调用方自管，本组件不接管
- footer 强制 `ActionButton`，不用 `el-button`

## 26.11 WorkbenchSelect · 下拉选择统一组件

**位置**：`src/workbench/components/ui/WorkbenchSelect.vue`

```vue
<WorkbenchSelect
  v-model="value"
  :options="items"
  placeholder="请选择"
  clearable
  filterable
  size="small"
  aria-label="选择项"
/>
```

**视觉规则**：
- 圆角 8px（`--wb-radius-sm`）
- 高度 34px（default）/ 28px（small）/ 40px（large）
- 边框 1px `--wb-border` / focus 2px `--wb-primary`
- 占位 `--wb-text-tertiary`

**稳定工作 props**：
| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `modelValue` | any | — | v-model |
| `options` | Array | [] | `[{label, value}]` |
| `placeholder` | String | '' | 占位 |
| `clearable` | Boolean | false | 可清空 |
| `disabled` | Boolean | false | 禁用 |
| `filterable` | Boolean | false | 搜索过滤 |
| `loading` | Boolean | false | 加载中 |
| `size` | String | 'default' | default / small / large |
| `width` | String | '160px' | 宽度 |
| `ariaLabel` | String | '' | a11y |

**Slots**：
- `#option` slot：自定义单个 option 渲染（`{ opt, index }` 作用域参数）
- `#empty` slot：无数据时显示（默认"无数据"）

**已知限制**：Element Plus 4.x el-select 的 `multiple` / `allow-create` 不通过 Vue 3 v-bind 透传（实测 el-select vnode props 接收不到）。需直接用 `<el-select multiple ... class="wb-select">` 形式（`class="wb-select"` 仍享受 token 化样式）。

## 26.12 WorkbenchInput · 输入框统一组件

**位置**：`src/workbench/components/ui/WorkbenchInput.vue`

```vue
<WorkbenchInput
  v-model="search"
  placeholder="搜索学生"
  clearable
  aria-label="按学生姓名搜索"
>
  <template #prefix><el-icon><Search /></el-icon></template>
</WorkbenchInput>

<WorkbenchInput
  v-model="form.content"
  type="textarea"
  :rows="5"
  show-word-limit
  :maxlength="500"
/>
```

**视觉规则**：
- 圆角 8px（`--wb-radius-sm`，与 WorkbenchSelect 一致）
- 高度 34px（textarea 自适应）
- 边框 1px `--wb-border` / focus 2px `--wb-primary`
- 占位 `--wb-text-tertiary`
- 字数计数 `--wb-text-tertiary` 11px

**Props**：
| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `modelValue` | any | — | v-model |
| `placeholder` | String | '' | 占位 |
| `maxlength` | Number | undefined | 字数限制 |
| `showWordLimit` | Boolean | false | 显示字数计数（textarea 也支持） |
| `clearable` | Boolean | false | 可清空 |
| `type` | String | 'text' | text / textarea / password / number / email |
| `rows` | Number | undefined | textarea 行数 |
| `autosize` | Boolean/Object | undefined | textarea 自适应高度 |
| `disabled` | Boolean | false | 禁用 |
| `width` | String | '100%' | 宽度 |
| `ariaLabel` | String | '' | a11y |

**Slots**：`#prefix` / `#suffix` / `#prepend` / `#append` 4 个槽位（与 Element Plus el-input 等价）。

## 26.13 humanizeError.js · 错误文案翻译工具

**位置**：`src/workbench/utils/humanizeError.js`

```js
import { humanizeError } from '../utils/humanizeError'
try { ... } catch (error) {
  loadError.value = humanizeError(error?.message, { entity: '任务列表' })
}
```

**API**：`humanizeError(message, { entity = '数据' } = {})`

**处理 5 类错误**：
- 无 message → `读不到${entity}，可能是网络或服务问题。`
- `network|fetch|timeout` → `网络似乎不太通畅，请稍后重试。`
- `401|403|unauthor` → `登录状态已过期，请重新登录。`
- `5\d{2}` → `服务暂时不可用，请稍后重试。`
- `不存在|已删除|未找到|not found` → `该${entity}不存在或已被删除。`
- 其他 → `读不到${entity}，请稍后重试。`

**使用规则**：
- 调用方传入 `entity` 参数（"任务列表" / "学生档案" / "学生列表" 等）让错误文案精确
- 不替代业务 success 反馈（success 用 Element Plus `ElMessage.success`）
- 不替代操作错误反馈（操作失败可继续用 `ElMessage.error` + 自定义 fallback 文案，但 message 部分用 humanizeError 翻译）

------------------------------------------------------------------------

# 27. KPI 标准 · 顶部指标条（v1.1 正式版）

> 来源：敏学第一阶段审查报告 → DashboardWorkbench 的 `.summary-strip` 被认定为**全工作台 KPI 基准**。

## 27.1 必须遵守的 6 条原则

1. **不使用大号彩色 icon**。不要 48px 圆块里塞个白色 lucide 图标。
2. **不使用渐变 icon 背景**。不要 `linear-gradient(135deg, primary, primary-hover)` 这种。
3. **不使用营销式 KPI 卡**。不要 5xl 数字 + 副标题 + 趋势 sparkline 那一套。
4. **数字 + label 为主**。label 用 `--wb-fs-body 13px / fw-semibold`；数字用 `--wb-fs-stat 25px / fw-bold / tabular-nums`。
5. **使用 border / divider 建立层级**。4 列用 `border-right: 1px solid --wb-border-light` 分隔，不靠 background 差异。
6. **信息密度优先**。整行可点击（默认）、整行 hover 高亮（`--wb-primary-mist`）。

## 27.2 视觉规格

``` text
外层：白底 + 1px border + radius 10px
列宽：4 列等宽（>1100px）/ 2x2（≤1100px）
列高：82px min
列内 padding：20px
列分隔：1px solid --wb-border-light
数字：25px / bold / tabular-nums
label：13px / semibold
action：12px / medium / tertiary
```

## 27.3 禁止的旧实现

- ❌ `GrowthWorkbench` 的 `kpi-card` + 4 色 `kpi-card__icon`（blue/green/purple/orange 渐变）—— 必须迁移到 KpiStrip
- ❌ 大写 + tracking 标签（"TODAY" / "本周"）作 eyebrow
- ❌ sparkline / mini chart 占 KPI 行
- ❌ 多行 KPI 描述（一行数字 + 2-3 行说明）

------------------------------------------------------------------------

# 28. 允许的渐变 · Allowed Gradients（v1.1 正式规则）

> 不要把渐变全部删除。敏学不是冷冰冰的后台，渐变在"克制使用"前提下是允许的。

## 28.1 允许的渐变场景

| 场景 | 例子 | 规则 |
|---|---|---|
| **品牌轻渐变** | `--wb-primary-mist → --wb-bg-card` 135° | 极弱对比，仅作背景提示 |
| 学生身份区 | StudentDetail `identity-card` | 已存在的"克制地有温度"范本 |
| 学生下一步建议 | StudentDetail `next-action` | 已存在的范本 |
| 极少量状态强调 | loading skeleton、processing chip | 不要影响可读性 |

## 28.2 禁止的渐变

| 禁止 | 原因 |
|---|---|
| ❌ **KPI 彩色渐变 icon**（blue/green/purple/orange） | 典型 AI 模板；让"统计"变"装饰" |
| ❌ **大面积营销 Hero 渐变**（`#6366F1 → #8B5CF6` 头图） | 工作台不是营销页 |
| ❌ **普通 Card 渐变背景** | 默认卡片用纯白底 + border，渐变是例外 |
| ❌ **为了"活泼"给每个指标配不同颜色** | 数字本身就是信息，不需要装饰 |
| ❌ **深色径向渐变**（`#101828 0%, #0a101d 70%`） | 工作台永远不用深色背景 |
| ❌ **跨色相渐变**（`#52C41A → #73D13D`、`#722ED1 → #9254DE`） | 跨色相 = 视觉污染 |

## 28.3 判断口诀

> 一个渐变能不能用，问 3 个问题：
> 1. 去掉渐变后内容还能不能读？ → 如果不能，渐变就是支撑
> 2. 这个渐变是不是跨色相？ → 如果是，禁止
> 3. 这个渐变在静默状态下像不像一个色块？ → 如果是，禁止

------------------------------------------------------------------------

# 29. AI UI 反模式 · 工程设计原则（v1.1 正式版）

> 这 10 条是工程级硬约束，不允许"我知道但我这样做"的例外。

## 29.1 10 条禁止

1. **每个数字配一个彩色 icon**
2. **每个功能一个彩色 Card**（功能页应当用 tab/分栏/链接组织）
3. **无意义的大圆角**（PC 端任何大于 16px 的圆角都要给出理由）
4. **普通内容大阴影**（普通内容用 border，浮层才用阴影）
5. **大面积渐变**（背景渐变超过 30% 视口比例禁止）
6. **页面为了视觉效果堆叠 Card**（如果一张卡只有一行字，删掉它）
7. **同一种信息出现多个不同视觉组件**（KPI 只能有一种、KPI 卡只能有一种）
8. **为了填充空间强行增加 UI**（空着比堆着更专业）
9. **同一功能在不同页面出现不同按钮样式**（"开始批改" 在 GradeCenter / Dashboard / StudentDetail 应当长得一样）
10. **一个页面拥有自己的 Design System**（页面可以延用 token，但不允许自己再定义一套颜色/字号/圆角）

## 29.2 核心原则

> **减少装饰，提高信息密度。**
> **减少组件数量，提高系统一致性。**

## 29.3 反模式自检表

交付前 5 分钟对照此表：

- [ ] 没有任何数字配 48px 渐变彩色 icon 块
- [ ] 没有任何"为了好看"加的 Card
- [ ] 没有任何跨色相渐变
- [ ] 没有 box-shadow 用在普通内容上
- [ ] 没有同一组件族在两个页面有不同实现
- [ ] 没有 >16px 圆角在没有理由的地方出现
- [ ] 没有为了"完整性"加的 placeholder / eyebrow / 大标题

------------------------------------------------------------------------

# 30. 下一阶段 · 业务页迁移优先级（v1.1 制定）

> 这一节标记哪些页面应当迁移到新 Design System、迁移到哪一档容器。
> 实际迁移由后续阶段执行，本阶段不动业务页。

## 30.1 P0 · 必迁

| 页面 | 迁移项 |
|---|---|
| **DashboardWorkbench** | `.summary-strip` → `<KpiStrip>`；容器 Standard → 保留（首页不需要更宽） |
| **GradeCenterWorkbench** | 自造 `.status-badge` → `<StatusTag>`；容器 Standard → **Workspace 1520px** |
| **StudentDetailWorkbench** | 自造 dl 三段式 → `<MiniStat>`；容器 Standard → **Workspace 1520px** |

## 30.2 P1 · 建议迁

| 页面 | 迁移项 |
|---|---|
| **StudentsWorkbench** | 自造 grid 表格 → DataTable；StatsCard 收成 KpiStrip |
| **WeeklyReportWorkbench** | 自造 `.risk-status` / `.mastery-status` → `<StatusTag>` |
| **WrongBookCenter** | 同上 |
| **WorksheetManagement** | 同上 |
| **RetryTasksWorkbench** | 1240px → Workspace |

## 30.3 P2 · 后续优化

| 页面 | 迁移项 |
|---|---|
| **GrowthWorkbench** | 4 色 kpi-card → `<KpiStrip>`；container 不变（已是 Wide 档思路）；box-shadow → 移除 |
| **HandoutPreview** | 全页视觉重做（与工作台风格统一）— 但不归本阶段 |
| **HandoutList** | 小封面渐变 → 移除 |
| **HandoutPreview** / **GrowthWorkbench** | 替换所有自造状态色为 status token |

## 30.4 不动

- `TopNavBar.vue`（死代码）→ 留给后续"代码清理"阶段
- V1/V2 并存（`ExamPageV2` / `ProcessingPageV2` / `WrongBookPageV2`） → 留给后续
- 移动端 `phone-frame` 的 `!important` overrides → 留给后续

------------------------------------------------------------------------

## 与现有 UI Skill 的关系

本文件不是替代 `minxue-ui-ux` Skill。

两者关系：

``` text
minxue-ui-ux
= 怎么思考、怎么评审、怎么验证、怎么避免错误

MINXUE_UI_DESIGN_SYSTEM.md
= 敏学应该长什么样、使用什么视觉语言、什么可以做、什么不应该做
```

任何影响用户界面的前端任务，应同时遵循两者。

冲突时的完整优先级序列见本文档首章 **# 0.1 优先级**。
