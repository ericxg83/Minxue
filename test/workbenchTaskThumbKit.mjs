/**
 * 批改中心任务行「试卷小图」判据（2026-10-08）
 *
 * 需求原话（负责人）：「移动端有一个作业分区…我希望 PC 端也有这样一个列表，
 * 而且显示更丰富，比如显示出试卷的小图列表」「想『处理任务时能认出卷子』」。
 *
 * 落点：PC 批改中心（/grade）任务列表行左侧加试卷首页小图。
 * 本判据盯的是**几件一旦漏掉就会真出事的事**，不是「有没有这段代码」：
 *
 *  ① 小图必须走 ossThumbUrl 出缩略图，⛔ 不得直接引 task.imageUrl 原图。
 *     真实上传图 0.4~1.3MB 一张（2026-10-08 实测三张：1284KB / 1112KB / 392KB），
 *     一屏几十行 = 几十 MB。本仓 docs/workbench-week3-optimization.md:18
 *     已记过同类事故（错题列表一次性拉上百张缩略图）。
 *  ② 只取首页一张，⛔ 不得在列表里渲染 task.images 多页 —— 列表要的是「认得出」，不是「看得完」。
 *  ③ 必须 loading="lazy"：列表会把全部学生的任务拉平渲染，不做懒加载等于一次性拉满。
 *  ④ 必须 @error 兜底：OSS 图被删 / 网络抖动时不能留一个破图空框（露出底下的学生头像）。
 *  ⑤ v-memo 依赖必须含 task.imageUrl —— 重练卷「未交卷 → 已交卷」时 imageUrl 从空变有值，
 *     漏了这一项会被 memo 缓存吃掉，小图永远不出现（静默失效，不报错）。
 *  ⑥ is-broken 的 CSS 隐藏规则必须存在，否则兜底逻辑只是打了个没人消费的类名。
 *
 * 判据抽到 kit 里（而不是写在测试文件内），有两个理由：
 *  · 让**回归测试**和**反向自检脚本**跑同一把尺子 —— 反向自检若直接 import 测试文件，
 *    会连带拉起 node:test 运行器把进程接管掉（实测：脚本自己的输出全被吞掉）。
 *  · 长注释留在 kit 里：`test/spawnStdinGuard.test.mjs` 的 ① 号锁会检查
 *    「去注释后代码占比 > 40%」，测试文件正文若被文档头压到 36% 会**误判成锁失效**。
 *
 * 反向自检：把本函数套在改前那份 GradeCenterWorkbench.vue 上必须判红（实测 8 条）。
 *   改前副本：`git show HEAD:src/workbench/views/GradeCenterWorkbench.vue > _r244_old/GradeCenterWorkbench.vue`
 *   （`_*` 是每轮临时件、不入库，需照上面这行重新导出）。
 */
import { anchoredRange, anchoredSlice } from './sourceLockKit.mjs'

/**
 * 收集任务行小图相关的全部不符项。返回 [] 才算过。
 * @param {string} src GradeCenterWorkbench.vue 全文
 * @returns {string[]}
 */
export function collectTaskThumbFailures(src) {
  const fails = []

  // —— ①~④：任务行模板内部 ——
  const row = anchoredRange(src, 'v-for="task in visibleTasks"', '</li>', '任务行模板', fails)
  if (row !== null) {
    if (!row.includes('class="task-lead__thumb"')) {
      fails.push('任务行缺少试卷小图元素（.task-lead__thumb）')
    }
    if (!/ossThumbUrl\(\s*task\.imageUrl\s*\)/.test(row)) {
      fails.push('小图必须走 ossThumbUrl(task.imageUrl) 出缩略图')
    }
    if (/:src="task\.imageUrl"/.test(row)) {
      fails.push('⛔ 小图不得直接引 task.imageUrl 原图（0.4~1.3MB 一张，会把列表拖垮）')
    }
    if (/task\.images/.test(row)) {
      fails.push('⛔ 列表不得渲染 task.images 多页（只取首页一张）')
    }
    if (!/loading="lazy"/.test(row)) {
      fails.push('小图必须 loading="lazy"（列表可能渲染全部学生的任务）')
    }
    if (!/@error="onThumbError"/.test(row)) {
      fails.push('小图必须有加载失败兜底 @error="onThumbError"')
    }
  }

  // —— ⑤：v-memo 依赖 ——
  const memo = anchoredSlice(src, 'v-memo="[', 400, 'v-memo 依赖数组', fails)
  if (memo !== null && !memo.includes('task.imageUrl')) {
    fails.push('v-memo 依赖必须含 task.imageUrl，否则「未交卷 → 已交卷」时小图不会出现（静默失效）')
  }

  // —— ④ 的实现 + ⑥ 的 CSS ——
  const handler = anchoredSlice(src, 'const onThumbError', 400, 'onThumbError 处理函数', fails)
  if (handler !== null && !handler.includes("classList.add('is-broken')")) {
    fails.push('onThumbError 必须给 <img> 打 is-broken 类（DOM 级标记，避开 v-memo 缓存）')
  }
  if (!/\.task-lead__thumb\.is-broken\s*\{[^}]*display:\s*none/.test(src)) {
    fails.push('缺少 .task-lead__thumb.is-broken { display: none } —— 兜底类名没人消费')
  }

  // —— 兜底头像必须还在（小图加载失败 / 无图时不能留空框） ——
  const lead = anchoredSlice(src, 'class="task-lead"', 700, 'task-lead 容器', fails)
  if (lead !== null && !lead.includes('task-lead__avatar')) {
    fails.push('task-lead 内缺少学生头像兜底（无图 / 加载失败时会留空框）')
  }

  return fails
}
