---
name: nightly-audit
description: 敏学 App 的夜间只读巡检（A 层自治）。当定时任务触发「夜间巡检」「nightly audit」「找 bug 不改代码」「体检报告」「棘轮基线」时使用。运行 lint/单测/构建三道闸，产出 docs/auto/reports/日期.md 与 backlog.md，只发现缺陷、只提名回归测试，绝不修改任何业务源码与门禁配置。
---

# 夜间只读巡检（A 层）

对仓库做体检并写报告。**本 skill 的默认动作是「不动手」。**

## 三条硬约束（不可协商，任何一次运行都适用）

1. **只加闸，不放宽。** 对应 AGENTS.md 第 11 条答案质量闸原则的全局化。
   禁止修改 `eslint.config.js` 的规则或 ignores、禁止修改任何 `test/*.test.mjs`
   的断言、禁止修改答案 OCR 三道防线与发布闸门判据。为了让检查「变绿」而放宽门禁，
   是本项目定义的最严重事故形态，等同于 2026-09-09 答案全本错位那次。
2. **核心链路只出提案，不改代码。** 批改主流程（`server/worker.js`、
   `server/services/aiJudgeService*`）、错题生命周期与去重、重练与组卷、掌握度计算、
   数据库 Schema/迁移/索引、`judgements` 审计语义、答案可信级别——
   一律写进报告的「提案」栏，附上影响范围、兼容策略、验证方式，等负责人拍板。
3. **不碰发布生效链路。** 构建必须走 `BUILD_OUTDIR` 输出到 `dist_nightly_日期/`，
   严禁写 `dist/` 与 `dist-app/`。工作区有任何未提交改动，当晚降级为
   只跑检查 + 写报告，不产生任何文件修改建议之外的动作。

## 额外红线：本仓库有一个自动提交进程

近 40 条提交的作者全是 `Minxue Deploy`（`git config user.name`），
`.gitignore` 里两处注释记录了它曾卷走过 `.env` 备份、并长期持 `git add` 锁阻塞人工提交。

因此：

- 巡检过程产生的任何临时文件，必须落在已被 `.gitignore` 覆盖的路径
  （`_*`、`dist_nightly_*/`、`__nightly_lint.json`）。
- **禁止执行 `git add`、`git commit`、`git checkout`、`git stash`。** 分支隔离由
  负责人人工决定，不由巡检进程代劳。
- 只允许写 `docs/auto/**`。

## 标准流程

1. 跑巡检引擎：

   ```bash
   node scripts/nightlyAudit.mjs
   ```

   它做四件事：ESLint 全量 → `node --test test/*.test.mjs` → `vite build`
   （产物落 `dist_nightly_日期/` 并自动删除）→ 与 `docs/auto/baseline.json` 做棘轮比对。
   退出码 1 表示**棘轮回退**，当晚禁止任何合并。

   产出两个文件，**分工固定，不要写错**：

   - `docs/auto/reports/日期-机器.md` — 每次重写，**禁止往这里手写分析**，重跑会被覆盖。
   - `docs/auto/reports/日期-提案.md` — 脚本仅在缺失时建骨架，**永不覆写**，人工与代理的判断只写这里。

2. 读 `日期-机器.md`，把结论写进 `日期-提案.md`，按分级往下处理：

   | 级别 | 含义 | 允许动作 |
   |---|---|---|
   | P0 | `no-undef` / `no-dupe-keys` / 解析失败——指向真实缺陷 | 人工核实调用链后写入 `backlog.md`，出修复提案 |
   | P1 | `no-empty`（空 catch）、`no-async-promise-executor`——静默失败风险 | 统计分布，标出落在核心链路上的那几条 |
   | P2 | 历史写法、可读性 | 只计数，进棘轮，不逐条打扰 |

3. 对每个新确认的 P0，**只提名**应补的回归测试文件名与断言意图，不创建测试文件。
   创建测试文件属于加闸，需负责人明确同意后再做，且新测试必须能因真实缺陷而红。

4. 报告末尾必须保留「已知盲区」段落，不得省略：`.vue` 模板层与 `.ts/.tsx`
   未进 lint（仓库缺 `eslint-plugin-vue`、`typescript-eslint`），
   所以「模板引用了 script 中未定义符号」这类缺陷抓不到。

## 核实 P0 的正确姿势（不要照抄 lint 结论）

`no-undef` 有两种成因，处置完全不同：

- 符号确实不存在 → 调用处必抛 ReferenceError，是真缺陷；
- 符号存在但作用域不可见（典型：`const` 声明在 `try{}` 内、`catch{}` 里引用）
  → 错误处理路径自身会抛异常，往往导致乐观更新无法回滚，比前者更隐蔽。

两种都要读源码确认，并写出「用户可见后果」而不只是「lint 报了什么」。

## 定位真实入口时的坑

- `1/App.tsx`、`2/App.tsx`、`3/App.tsx` 是被 git 跟踪的历史副本（1078/1468/1775 行），
  全局搜索会命中，**不能当作移动端入口**。
- `dist_gatefix/`、`dist_verify*/`、`dist_tmcheck*/`、`external/` 未被 `.gitignore`
  覆盖，里面是压缩产物；搜索前先排除。
- `server/routes/tasks.js` 与 `server/index.js` 里的内联 API 并存，改前确认真实调用入口。

## 交付物

- `docs/auto/reports/日期-机器.md` — 脚本每次重写，只放闸结果与分级发现
- `docs/auto/reports/日期-提案.md` — 人工/代理核实结论与提案，脚本永不覆写
- `docs/auto/backlog.md` — P0 池，只追加且同日不重复，勾选状态由人工改
- `docs/auto/baseline.json` — 棘轮基线，脚本自动收紧，人工不得抬高
