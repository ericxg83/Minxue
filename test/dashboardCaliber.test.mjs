// 回归测试（2026-10-09）：Dashboard「今日新增错题 / 较昨日 / 今日已批改 / 近 7 日趋势」口径锁
//
// 事故（老师报数 + 只读探针 server/_diag_dashboard_todaywrong.mjs 实测生产库，非推理）：
//   ① `server/services/dashboardService.js` getDailyTrend 的两条 SQL 用 `::date AS day`，
//      pg 把 date 列反序列化成 JS Date 对象，`String(r.day)` = "Thu Oct 08 2026 00:00:00 GMT+0800…"
//      永远匹配不上 Intl 生成的 "2026-10-08" key ⇒ 序列恒 0 ⇒
//      「近 7 日暂无批改记录」恒显示、「较昨日」恒 −0、「今日已批改 N 份」恒 0。
//      （实测 10-08 真实数据：9 份 reviewed + 96 道错题，界面全 0。与 r130 图表空柱同族。）
//   ② `server/index.js` /api/tasks/summary 的 today_new_wrong 原口径
//      `lifecycle_status='new' AND added_at::date = CURRENT_DATE` 双重缩水：
//      CURRENT_DATE 是 Neon 会话时区（UTC）的自然日 ⇒ 北京 0-8 点新增被算进「昨天」（实测当天丢 2 道）；
//      lifecycle='new' 过滤把已被重练推进的错题剔除（实测当天再丢 1 道）⇒ 4 → 1。
//      且周报 newWrongCount 是全部生命周期（weeklyReport.js「所有生命周期状态」注释）⇒ 两处口径冲突。
//
// 2026-10-09 负责人拍板：① SQL 侧输出文本日期；② 上海自然日；③ 去掉 lifecycle 过滤、对齐周报
// （语义 = 「今日批卷产生的错题总数」）。
//
// 本锁是**源码级**锁（r250 先例）：这两处是纯 SQL 字符串，行为测试需要真连库，
// 源码断言 + 探针对账（改前 A / 真实 B / 改后 C）双保险即可锁死口径，防止有人「顺手优化」回去。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const serviceSrc = readFileSync(resolve(ROOT, 'server/services/dashboardService.js'), 'utf8')
const indexSrc = readFileSync(resolve(ROOT, 'server/index.js'), 'utf8')

// ── 元判据自证：判定词必须逐字存在，防「判据写错字」造成假通过（r249 教训）──
for (const token of ['getDailyTrend', 'Asia/Shanghai', 'today_new_wrong']) {
  assert.ok(
    (serviceSrc + indexSrc).includes(token),
    `元判据自证失败：判据词 ${token} 不在源码里，本文件的断言全部失效`
  )
}

test('trend 两条 SQL 必须在 SQL 侧输出文本日期（::date::text），防 pg date 反序列化成 Date 对象', () => {
  const count = serviceSrc.split("::date::text AS day").length - 1
  assert.ok(count >= 2, `getDailyTrend 的两条 SQL 都要 ::date::text AS day，实际只有 ${count} 处`)
  // 裸 ::date AS day 不允许再出现（那正是事故写法）
  assert.ok(
    !serviceSrc.includes('::date AS day'),
    'dashboardService.js 里又出现了裸 ::date AS day —— String(Date) 匹配不上 "YYYY-MM-DD" key，序列会恒 0'
  )
})

test('trend 的时区归一必须保留 Asia/Shanghai（不许有人改回 UTC 口径）', () => {
  const hits = serviceSrc.split("AT TIME ZONE 'Asia/Shanghai'").length - 1
  assert.ok(hits >= 2, `getDailyTrend 两条 SQL 都要 Asia/Shanghai 时区，实际只有 ${hits} 处`)
})

test('today_new_wrong 必须用上海自然日，禁止 CURRENT_DATE（Neon 会话时区是 UTC）', () => {
  const m = indexSrc.match(/COALESCE\(\(SELECT COUNT\(\*\)::int FROM \$\{TABLES\.WRONG_QUESTIONS\}[\s\S]{0,240}?AS today_new_wrong/)
  assert.ok(m, 'today_new_wrong 子查询没匹配到 —— SQL 结构被改了，更新本锁前先对账')
  assert.ok(
    m[0].includes("(added_at AT TIME ZONE 'Asia/Shanghai')::date") &&
    m[0].includes("(NOW() AT TIME ZONE 'Asia/Shanghai')::date"),
    'today_new_wrong 不再按上海自然日统计 —— 北京 0-8 点新增会被算进「昨天」'
  )
  assert.ok(
    !m[0].includes('CURRENT_DATE'),
    'today_new_wrong 又用上了 CURRENT_DATE —— 那是 UTC 自然日，与老师感知的自然日有 8 小时错位'
  )
})

test('today_new_wrong 不得再按 lifecycle 过滤（2026-10-09 拍板：对齐周报「全部生命周期」口径）', () => {
  const m = indexSrc.match(/COALESCE\(\(SELECT COUNT\(\*\)::int FROM \$\{TABLES\.WRONG_QUESTIONS\}[\s\S]{0,240}?AS today_new_wrong/)
  assert.ok(m, 'today_new_wrong 子查询没匹配到')
  assert.ok(
    !m[0].includes('lifecycle_status'),
    'today_new_wrong 又按 lifecycle_status 过滤了 —— 错题被重练推进后「今日新增」会缩水，且与周报口径冲突'
  )
})

test('summary SQL 参数占位符与参数数组必须重编号对齐（去掉 lifecycle 参数后 $3/$4 顺移）', () => {
  const m = indexSrc.match(/COALESCE\(\(SELECT COUNT\(\*\)::int FROM \$\{TABLES\.TASKS\} WHERE status = \$3 AND deleted_at IS NULL\), 0\) AS in_progress_count/)
  assert.ok(m, 'in_progress_count 应使用 $3（lifecycle 的 $3 被移除后顺移），占位符没对齐会直接 pg bind 报错')
  const paramsLine = indexSrc
    .split('\n')
    .find(l => l.includes('TASK_STATUS.DONE') && l.includes("'failed'"))
  assert.ok(paramsLine, 'summary 查询的参数数组行没找到')
  assert.ok(
    !paramsLine.includes("'new'"),
    `summary 参数数组里还留着 lifecycle 用的 'new'（${paramsLine.trim()}）—— 参数个数会多于占位符，pg bind 报错`
  )
})
