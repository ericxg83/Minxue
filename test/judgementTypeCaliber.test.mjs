// 回归测试：judgements 表的类型口径（TEXT）与调用方传参类型必须一致
//
// 事故背景（2026-09-23）：
//   `POST /api/admin/tasks/:id/convert-route`（「改批改方式」）在 dryRun 阶段就 500。
//   两层根因，都是「列名/类型口径写错」：
//     ① questions 表没有 question_no 列（只有 question_number，见迁移 014），
//        `SELECT ... question_no FROM questions` 直接 42703；
//     ② judgements.question_id 是 TEXT 列（迁移 006 建表时是 UUID，迁移 010
//        又建了一遍并写成 TEXT，后建覆盖前建），而调用方传 uuid[] 强制转换，
//        于是 `question_id = ANY($1::uuid[])` 抛
//        `42883 operator does not exist: text = uuid`。
//
//   非偶然：gradingFinalizer.getSettlementRows 早已因同一原因（重判结算 500）
//   改用了 `ANY($2::text[])`，但 convert-route 两处漏改 ⇒ 同一个坑第二次踩。
//
// 本测试锁定：
//   1) 全仓任何对 judgements 的 question_id 做数组比较，必须显式 ::text[]，
//      禁止 ::uuid[]（列本身是 TEXT，uuid[] 必然报 42883）；
//   2) convert-route 的影响面查询不许再从 questions 读 question_no；
//   3) 该查询若读题号，只能是 question_number。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

/** 扫描文件里所有「提到 judgements 的语句块」，返回其中带 uuid[] 强制转换的片段。 */
const findJudgementUuidCasts = (src, label) => {
  const lines = src.split('\n')
  // 剥掉行注释，避免把说明性注释里举反例的 ::uuid[] 当成违规
  const stripped = lines.map((l) => l.replace(/\/\/[^\n]*$/, ''))
  const hits = []
  for (let i = 0; i < stripped.length; i++) {
    // 只看真正引用 judgements 表的那一行，以及它前面 4 行（SQL 常写成多行模板串）
    const window = stripped.slice(Math.max(0, i - 4), i + 1).join('\n')
    if (!/JUDGEMENTS|judgements/i.test(stripped[i])) continue
    if (!/ANY\s*\(\s*\$\d+::uuid\[\]\s*\)/.test(window)) continue
    hits.push(`${label}:${i + 1}`)
  }
  return hits
}

test('judgements.question_id 是 TEXT 列 —— 任何数组比较都不许用 ::uuid[]', () => {
  const targets = [
    ['server/index.js', read('server/index.js')],
    ['server/worker.js', read('server/worker.js')],
    ['server/services/gradingFinalizer.js', read('server/services/gradingFinalizer.js')],
    ['server/services/neonService.js', read('server/services/neonService.js')],
  ]
  const offenders = targets.flatMap(([label, src]) => findJudgementUuidCasts(src, label))
  assert.deepEqual(
    offenders,
    [],
    `judgements 的 question_id 是 TEXT，用 ::uuid[] 必抛 42883 text = uuid；` +
    `应改为 ::text[] 并传 questionIds.map(String)。违规位置：${offenders.join(', ')}`
  )
})

/**
 * 取 convert-route 的路由体。
 * 注意不能拿 `if (dryRun)` 当结束标记 —— 它在本路由里先以注释形式出现过一次，
 * 会让切片提前截断，断言静默失效。
 */
const convertRouteBlock = (src) => {
  const start = src.indexOf("app.post('/api/admin/tasks/:taskId/convert-route'")
  assert.ok(start > -1, 'convert-route 路由必须存在')
  // 以下一个同级 app.<method>( 为界
  const rest = src.slice(start + 1)
  const nextRoute = rest.search(/\napp\.(get|post|put|delete|patch)\(/)
  const end = nextRoute > -1 ? start + 1 + nextRoute : src.length
  return src.slice(start, end)
}

test('convert-route 影响面查询不得从 questions 读 question_no', () => {
  const block = convertRouteBlock(read('server/index.js'))

  assert.ok(
    !/question_no/.test(block.replace(/\/\/[^\n]*/g, '').replace(/\n\s*\*/g, ' ')),
    'convert-route 里 questions 表没有 question_no 列（只有 question_number），' +
    '写 question_no 会让整条路由 42703 直接 500'
  )
})

test('convert-route 读题号必须用 question_number 且样本字段同步', () => {
  const block = convertRouteBlock(read('server/index.js'))

  assert.ok(
    /SELECT id, content, page_number, question_number FROM/.test(block),
    '影响面查询必须 SELECT question_number'
  )
  // 样本字段名与 SELECT 列名必须一致：SELECT 出 question_number 就必须取 r.question_number，
  // 否则 dryRun 返回的 samples[].no 恒为 undefined（老师看不到题号）。
  assert.ok(
    /no:\s*r\.question_number/.test(block),
    'dryRun 样本的题号必须取自 r.question_number（与 SELECT 列名一致，否则恒 undefined）'
  )
})

test('gradingFinalizer 保持 text[] 口径（防回退）', () => {
  const src = read('server/services/gradingFinalizer.js')
  assert.ok(
    /question_id = ANY\(\$2::text\[\]\)/.test(src),
    'getSettlementRows 必须保持 ::text[]；改回 uuid[] 会让重判结算重新 500'
  )
  assert.ok(
    /questionIds\.map\(String\)/.test(src),
    'settlement 查询的参数必须 map(String)，与 ::text[] 配对'
  )
})
