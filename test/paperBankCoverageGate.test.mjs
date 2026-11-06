/**
 * 一模卷「漏题」回归锁（2026-11-06）
 *
 * 事故：嘉定一模第 2 页卷面印 6—12 共 7 道题，库里只入库 2 道（还是卷面 11、12 被记成 6、7）；
 *   徐汇丢了第 19、24 题（24 是 12 分抛物线压轴）。页面毫无异常，直到老师自己发现。
 *
 * 根因是两行代码配错：
 *   ① parsePageToQuestions 里 `Number(q.question_number)` 不认 "第6题"/"6."/"（6）"，
 *      整页题号退化成 NaN，被「本页最大题号之后顺延」编成 1—7；
 *   ② replacePaperQuestions 按「题号+小问」**跨整卷**去重、无条件保留首次，
 *      于是第 2 页那 7 行与第 1 页 1—5 撞号，前 5 行被当「重复题」静默丢弃，
 *      只在 metadata 留一句「识别出 N 行重复题号（多为答题卡页重复识别）」。
 *
 * 本文件锁死：
 *   ① 题号解析认得出卷面各种写法，认不出返回 null（绝不猜数字）；
 *   ② 补号必须**全卷唯一**，且补在相邻印刷题号之间（不许每页从 1 重来、也不许全甩到卷末）；
 *   ③ 撞号时「同页/正文相似」才丢，「正文不同」必须改号保留 —— 宁可多一行，绝不静默少一行；
 *   ④ 落库后有独立于 OCR 的逐页题号清点，漏题/串号进 metadata 并可被前端读到；
 *   ⑤ 重新解析要清掉上一轮的审计结论，否则界面挂着早已修好的旧告警。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeQuestionNo,
  assignGlobalQuestionNumbers,
  dedupePaperRows,
  textSimilarity,
} from '../server/services/paperBankService.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8')
const SERVICE = 'server/services/paperBankService.js'
const ROUTES = 'server/routes/paperBank.js'
const VIEW = 'src/workbench/views/PaperBankWorkbench.vue'

// ── ① 题号解析 ────────────────────────────────────────────────────────────────
test('题号解析：模型的各种写法都要认出来', () => {
  // 真实出现过的写法（"第6题"/"6." 曾被 Number() 判成 NaN，直接引发整页重编）
  const cases = [
    [6, 6], ['6', 6], ['6.', 6], ['6、', 6], ['6、10分', 6],
    ['第6题', 6], ['第 6 题', 6], ['（6）', 6], ['(6)', 6], ['【6】', 6], [' 6 ', 6],
    [{ value: '7' }, 7], [{ no: 8 }, 8],
  ]
  for (const [input, want] of cases) {
    assert.equal(normalizeQuestionNo(input), want, `题号 ${JSON.stringify(input)} 应解析为 ${want}`)
  }
})

test('题号解析：认不出就返回 null，⛔ 不许猜成 1', () => {
  for (const bad of [null, undefined, '', '   ', '一', '第题', 'abc', 'A', 0, -3, {}, [], NaN, Infinity, '第题十']) {
    const got = normalizeQuestionNo(bad)
    assert.equal(got, null, `题号 ${JSON.stringify(bad)} 应返回 null，实际 ${got}`)
  }
})

// ── ② 全卷唯一补号（本次事故的核心修复）──────────────────────────────────────
test('补号：第 2 页整页缺号时，绝不能从 1 重来（嘉定一模 p2 7 题被吞 5 题的真因）', () => {
  const rows = [
    // 第 1 页：卷面 1—5，模型给号正常
    ...Array.from({ length: 5 }, (_, i) => ({ page_no: 1, question_no: i + 1, __printedNo: true, sub_no: '' })),
    // 第 2 页：卷面 6—12，模型一个号都没给（"第6题" 之流）
    ...Array.from({ length: 7 }, (_, i) => ({ page_no: 2, question_no: null, __printedNo: false, sub_no: '' })),
  ]
  assignGlobalQuestionNumbers(rows)

  const p2 = rows.filter(r => r.page_no === 2).map(r => r.question_no)
  assert.deepEqual(p2, [6, 7, 8, 9, 10, 11, 12], '第 2 页必须补成 6—12，而不是 1—7')

  // 全卷不得有重复题号 —— 有重复就会在落库去重时被吃掉
  const all = rows.map(r => r.question_no)
  assert.equal(new Set(all).size, all.length, '全卷题号必须唯一')

  // 走一遍真实去重：7 道题一道都不许少
  const { rows: kept, duplicated } = dedupePaperRows(rows)
  assert.equal(duplicated, 0, '补号正确时不应有任何「重复」')
  assert.equal(kept.length, 12, '12 道题必须全部保留')
})

test('补号：卷面题号一律不动，只填空档，且不与任何印刷题号撞号', () => {
  const rows = [
    { page_no: 1, question_no: 1, __printedNo: true, sub_no: '' },
    { page_no: 1, question_no: 2, __printedNo: true, sub_no: '' },
    { page_no: 2, question_no: null, __printedNo: false, sub_no: '' }, // 缺号：2 与 4 之间 → 3
    { page_no: 2, question_no: 4, __printedNo: true, sub_no: '' },     // 卷面印 4
    { page_no: 2, question_no: null, __printedNo: false, sub_no: '' }, // 缺号：3 之后，但 5 已被占用
    { page_no: 3, question_no: 5, __printedNo: true, sub_no: '' },
  ]
  assignGlobalQuestionNumbers(rows)

  assert.deepEqual(rows.map(r => r.question_no), [1, 2, 3, 4, 6, 5],
    '第一处缺号补 3（在 2 与 4 之间）；第二处只能排到 5 之后 —— ⛔ 不许占用第 3 页印刷的 5')
  assert.equal(rows[2].question_no, 3, '缺号补在相邻印刷题号之间，保持页序')
  assert.equal(rows[5].question_no, 5, '卷面印的 5 必须原样不动')
  assert.equal(new Set(rows.map(r => r.question_no)).size, 6, '全卷题号必须唯一')
})

test('补号：同一道题的多个小问共用题号，不会被拆开', () => {
  const rows = [
    { page_no: 1, question_no: 3, __printedNo: true, sub_no: '1' },
    { page_no: 1, question_no: 3, __printedNo: true, sub_no: '2' },
    { page_no: 2, question_no: null, __printedNo: false, sub_no: '' },
  ]
  assignGlobalQuestionNumbers(rows)
  assert.equal(rows[0].question_no, 3)
  assert.equal(rows[1].question_no, 3, '同一题的两个小问必须同号')
  assert.equal(rows[2].question_no, 4)
})

// ── ③ 撞号处理：宁可多一行，绝不静默少一行 ──────────────────────────────────
test('撞号：同一页重复 → 丢后一条（模型把同一题认了两遍）', () => {
  const rows = [
    { page_no: 1, question_no: 6, sub_no: '', content: '如图，正方形 DEFG 的边 EF 在 BC 上' },
    { page_no: 1, question_no: 6, sub_no: '', content: '如图，正方形 DEFG 的边 EF 在 BC 上' },
  ]
  const r = dedupePaperRows(rows)
  assert.equal(r.duplicated, 1)
  assert.equal(r.rows.length, 1)
})

test('撞号：不同页 + 正文相似 → 判为邻页复述，丢后一条（答题卡页）', () => {
  const text = '已知抛物线 y=(m+1)x²+4x-4 有最高点，那么 m 的取值范围是'
  const rows = [
    { page_no: 1, question_no: 8, sub_no: '', content: text },
    { page_no: 9, question_no: 8, sub_no: '', content: text },
  ]
  const r = dedupePaperRows(rows)
  assert.equal(r.duplicated, 1, '同一题在答题卡页被复述，应计入重复')
  assert.equal(r.rows.length, 1)
})

test('撞号：不同页 + 正文不同 → ⛔ 必须改号保留，不许当重复丢掉', () => {
  const rows = [
    { page_no: 1, question_no: 6, sub_no: '', content: '如图，正方形 DEFG 的边 EF 在△ABC 的边 BC 上，顶点 D 在 AB 上' },
    { page_no: 2, question_no: 6, sub_no: '', content: '二次函数 y=ax²+bx+c 的图像经过点（-1，0），求 b 的值' },
  ]
  const r = dedupePaperRows(rows)
  assert.equal(r.duplicated, 0, '正文不同的两道题不许算重复')
  assert.equal(r.renumbered, 1, '应改号保留')
  assert.equal(r.rows.length, 2, '⛔ 一道题都不许少')
  assert.equal(r.rows[0].question_no, 6, '先出现的那道保持原号')
  assert.equal(r.rows[1].question_no, 7, '后出现的改到全卷最大号之后')
})

test('文本相似度：同一题≈1，不同题≈0', () => {
  const a = '已知抛物线 y=(m+1)x²+4x-4 有最高点，那么 m 的取值范围是'
  assert.equal(textSimilarity(a, a), 1)
  assert.ok(textSimilarity(a, '如图，正方形 DEFG 的边 EF 在△ABC 的边 BC 上') < 0.3)
  assert.equal(textSimilarity('', ''), 1)
  assert.equal(textSimilarity('', 'abc'), 0)
})

// ── ④ 落库后逐页清点闸 ──────────────────────────────────────────────────────
test('清点闸在位：解析落库后必须逐页清点题号，失败按「未核对」记而不当没问题', () => {
  const s = read(SERVICE)
  assert.ok(/export async function auditPaperCoverage/.test(s), '必须有 auditPaperCoverage')
  assert.ok(/auditPaperCoverage\(\{[\s\S]{0,200}dbRows/.test(s), '清点要拿库里该页题号做差集')
  assert.ok(/assignGlobalQuestionNumbers\(rows\)/.test(s), '补号必须在解析汇总里执行')
  // 补号必须早于落库，否则撞号又会被去重吃掉
  const iNum = s.indexOf('assignGlobalQuestionNumbers(rows)')
  const iReplace = s.indexOf('await replacePaperQuestions(resourceId, rows)')
  assert.ok(iNum > 0 && iReplace > iNum, '补号必须在 replacePaperQuestions 之前')

  // 清点失败要点名，不许静默
  assert.ok(/pagesUnverified/.test(s), '清点失败必须计入 pagesUnverified')
  assert.ok(/没入库|漏题/.test(s), '漏题必须写进 parseWarnings')
})

test('清点闸反向自检：把「漏题不计入」的写法喂进去必须判红', () => {
  const s = read(SERVICE)
  const broken = s.replace(/if \(audit\.summary\.missingCount > 0\)/, 'if (false)')
  assert.ok(broken !== s, '反向自检的替换点必须命中')
  assert.ok(!/if \(audit\.summary\.missingCount > 0\)/.test(broken))
})

test('旧缺陷不许复发：parsePageToQuestions 不得再按「本页最大题号」顺延补号', () => {
  const s = read(SERVICE)
  const start = s.indexOf('export async function parsePageToQuestions')
  const end = s.indexOf('export async function', start + 10)
  const fn = s.slice(start, end > 0 ? end : start + 20000)
  assert.ok(fn.length > 500, 'parsePageToQuestions 必须能定位到')
  // ① 不许再用裸 Number() 判断题号（"第6题" 会变 NaN）
  assert.ok(!/let qno = Number\(q\?\.question_number\)/.test(fn), '题号解析必须走 normalizeQuestionNo')
  assert.ok(/normalizeQuestionNo\(q\?\.question_number\)/.test(fn), '必须用 normalizeQuestionNo')
  // ② 不许再出现页内 spill 顺延
  assert.ok(!/let spill = maxPrinted/.test(s), '⛔ 页内顺延补号必须彻底移除（漏题根因）')
  assert.ok(!/if \(!Number\.isFinite\(qno\)\) qno = \+\+spill/.test(s), '⛔ 页内顺延补号必须彻底移除（漏题根因）')
})

test('去重口径反向自检：退回「无条件保留首次」必须判红', () => {
  const s = read(SERVICE)
  // 旧实现的特征：只看 key 在不在 seen 里就直接 continue，不看正文
  assert.ok(!/if \(seen\.has\(key\)\) \{ duplicated \+= 1; continue \}/.test(s),
    '⛔ 不许退回「同题号一律当重复」的旧写法')
  assert.ok(/textSimilarity\(prev\.content, r\.content\)/.test(s), '去重必须比对正文相似度')
  assert.ok(/renumbered \+= 1/.test(s), '正文不同的撞号必须改号保留')
})

// ── ⑤ 前后端契约 + 旧告警失效 ────────────────────────────────────────────────
test('前后端字段名逐字对齐：coverage_audit / coverage_summary', () => {
  const r = read(ROUTES)
  const v = read(VIEW)
  for (const f of ['coverage_audit', 'coverage_summary']) {
    assert.ok(r.includes(`${f}:`), `后端 papers 接口须返回 ${f}`)
    assert.ok(v.includes(`p.${f}`), `前端须读 p.${f}`)
  }
  // 徽标必须能点开看明细
  assert.ok(/openCoverage\(p\)/.test(v), '页面必须有清点明细入口')
  assert.ok(/coverage_summary\?\.missingCount/.test(v), '徽标要读漏题数')
})

test('重新解析必须清掉上一轮审计结论（否则旧告警永远挂着）', () => {
  const s = read(SERVICE)
  assert.ok(/async function resetParseAudit/.test(s), '必须有 resetParseAudit')
  assert.ok(/'parseWarnings'/.test(s) && /'coverageAudit'/.test(s), '要清 parseWarnings 与 coverageAudit')
  assert.ok(/await resetParseAudit\(resourceId\)/.test(s), '解析开始时要调用')
})
