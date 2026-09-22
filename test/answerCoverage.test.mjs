import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAnswerCoverage } from '../server/services/answerCoverageService.js'

// 练习册答案册完整性体检（2026-09-22）。
// 目的：把「批改时才发现没有参考答案」提前到「上传答案册时就告知老师哪里缺」。
// 判据必须**保守**（宁可漏报不误报）——误报会让老师去补本来就有的答案，比不报更糟。
//
// 判据演进（2026-09-22 当天实测后收紧）：
//   v1「1..max(题号) 全量报缺」在 f8cf5d96 上给出「第28章评价测试(一) 缺 25～63 共 39 个题号」——
//   纯属幻觉：该单元真实题号只到 24，多出来的 40/64 是两条长答案被 OCR 拆碎后塞进来的碎片。
//   v2 只报**内部空洞**（n 缺席且 n-1、n+1 都在），并把远处的孤立题号单列为「疑似串行」。
//   下面 27.2(3) / 28.2(5) / 第28章评价测试(一) 三个用例都是当天从库里捞出的真实形态。

const row = (question_no, opts = {}) => ({
  question_no,
  sub_no: opts.sub_no != null ? opts.sub_no : '',
  section: opts.section || null,
  // 注意用 `in` 而不是 `!= null`：`unit_key: null` 是"显式不归属单元"的有效入参，
  // 用 != null 判会把 null 当成"没传"，静默换成默认单元，测出来的就不是想测的东西。
  unit_key: 'unit_key' in opts ? opts.unit_key : '28.2(4)',
  unit_title: opts.unit_title || null,
  answer: opts.answer != null ? opts.answer : 'x',
})

test('题号连续 → 无缺口，ok=true', () => {
  const cov = buildAnswerCoverage([1, 2, 3, 4, 5].map(n => row(n)))
  assert.equal(cov.ok, true)
  assert.equal(cov.messages.length, 0)
  assert.equal(cov.summary.units_with_gaps, 0)
  assert.equal(cov.summary.answer_count, 5)
})

test('中间缺题号 → 报出全部内部空洞（不是只报第一个）', () => {
  // worker.js 的 unitGapStart 只取首个缺口当"弃用起点"；这里要列全，老师才知道补哪几个。
  // 1,2,[3],4,5,[6],7,8 —— 两个洞的左右邻居都在，都是"这一题确实漏了"的强证据。
  const cov = buildAnswerCoverage([1, 2, 4, 5, 7, 8].map(n => row(n)))
  assert.equal(cov.ok, false)
  assert.deepEqual(cov.problem_units[0].missing_nos, [3, 6])
  assert.equal(cov.summary.missing_count, 2)
  assert.ok(cov.messages[0].includes('单元「28.2(4)」'))
  assert.ok(cov.messages[0].includes('缺题号 3、6'), cov.messages[0])
})

test('⛔ 幻觉防护：题号被碎片抬到 40 时，不得报「缺 2～39」（真实案例：第28章评价测试(一)）', () => {
  // 库里该单元真实形态：1..24 连续 + 两条长答案被 OCR 拆出的碎片挂在题号 40、64。
  // v1 判据会报「缺 25～63 共 39 个题号」——老师照着去补，全是根本不存在的缺口。
  const cov = buildAnswerCoverage([...Array.from({ length: 24 }, (_, i) => row(i + 1)), row(40), row(64)])
  const u = cov.problem_units[0]
  assert.deepEqual(u.missing_nos, [], '尾部连续缺席不是缺口证据，一个都不许报')
  assert.deepEqual(u.stray_nos, [40, 64], '孤立题号应单列为「疑似串行/归属错配」')
  assert.equal(u.contiguous_prefix, 24)
  assert.ok(cov.messages[0].includes('题号孤立'), cov.messages[0])
  assert.ok(!cov.messages[0].includes('缺题号'), `不得出现"缺题号"字样：${cov.messages[0]}`)
})

test('真实案例 27.2(3)：缺第 7 题（左右邻居都在）→ 报，且不把尾部 8~12 当缺口', () => {
  const cov = buildAnswerCoverage([1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12].map(n => row(n)))
  assert.deepEqual(cov.problem_units[0].missing_nos, [7])
  assert.deepEqual(cov.problem_units[0].stray_nos, [])
})

test('真实案例 28.2(5)：缺第 3 题 + 18/24 两条孤立碎片（v1 会误报 15 个缺口）', () => {
  const cov = buildAnswerCoverage([1, 2, 4, 5, 6, 7, 8, 18, 24].map(n => row(n)))
  const u = cov.problem_units[0]
  assert.deepEqual(u.missing_nos, [3], '9~17、19~23 是 max 被 24 抬高后的幻觉，不得报')
  assert.deepEqual(u.stray_nos, [18, 24])
})

test('连续段之后的第一个洞（如 1~12 后缺 13 再续 14~25）算内部空洞', () => {
  const cov = buildAnswerCoverage([...Array.from({ length: 12 }, (_, i) => row(i + 1)),
    ...Array.from({ length: 12 }, (_, i) => row(i + 14))])
  assert.deepEqual(cov.problem_units[0].missing_nos, [13])
  assert.deepEqual(cov.problem_units[0].stray_nos, [])
})

test('缺口清单过长时用「等 N 个」收尾，不刷屏', () => {
  // 每 3 题一组、组间缺 1 题 → 11 个内部空洞（超过 MAX_LIST=10）
  const nos = []
  for (let base = 1; base <= 45; base += 4) nos.push(base, base + 1, base + 2)
  const cov = buildAnswerCoverage(nos.map(n => row(n)))
  assert.equal(cov.problem_units[0].missing_nos.length, 11)
  assert.ok(cov.messages[0].includes('等 11 个'), cov.messages[0])
})

test('同一单元不同 section 允许同题号，不算重复/冲突', () => {
  // 「一、填空题 1」与「三、解答题 1」是两道题，答案不同也是合法的
  const cov = buildAnswerCoverage([
    row(1, { section: '一、填空题', answer: 'A' }),
    row(1, { section: '三、解答题', answer: '证明：…' }),
    row(2, { section: '三、解答题' }),
  ])
  assert.equal(cov.ok, true, JSON.stringify(cov.messages))
  assert.equal(cov.summary.conflict_count, 0)
})

test('同一 section + 题号 + 小问 出现两个不同答案 → 报冲突（答案册串行）', () => {
  const cov = buildAnswerCoverage([
    row(1, { section: '一、填空题', answer: 'A' }),
    row(1, { section: '一、填空题', answer: 'B' }),
  ])
  assert.equal(cov.summary.conflict_count, 1)
  assert.ok(cov.messages[0].includes('同题号答案不一致'), cov.messages[0])
})

test('同一 section + 题号 重复但答案相同 → 只算冗余，不报警', () => {
  const cov = buildAnswerCoverage([
    row(1, { section: '一、填空题', answer: 'A' }),
    row(1, { section: '一、填空题', answer: 'A' }),
  ])
  assert.equal(cov.ok, true, JSON.stringify(cov.messages))
  assert.equal(cov.summary.redundant_count, 1)
})

test('小问缺号：题号各行全带数字小问时才判', () => {
  const cov = buildAnswerCoverage([
    row(4), row(5, { sub_no: '1' }), row(5, { sub_no: '3' }), row(5, { sub_no: '4' }),
  ])
  assert.deepEqual(cov.problem_units[0].sub_gaps, [{ question_no: 5, missing: [2] }])
  assert.ok(cov.messages[0].includes('第5题(2)'), cov.messages[0])
})

test('混着整题行（sub_no 为空）的题号不判小问缺口 —— 答案册按整题存一条是合法形态', () => {
  // 这正是 28.2(4) 题12 的真实形态：整题行 + 若干小问行共存。
  // 题号必须连续，否则会被「缺题号」判据先命中，测不到小问这条规则。
  const cov = buildAnswerCoverage([
    row(1), row(2),
    row(3, { sub_no: '' }), row(3, { sub_no: '1' }), row(3, { sub_no: '2' }),
  ])
  assert.equal(cov.ok, true, JSON.stringify(cov.messages))
  assert.equal(cov.summary.sub_gap_count, 0)
})

test('非数字小问号（如「①②」）不参与小问缺口判定', () => {
  const cov = buildAnswerCoverage([
    row(7, { sub_no: '①' }), row(7, { sub_no: '③' }),
  ])
  assert.equal(cov.summary.sub_gap_count, 0)
})

test('单单元册子不带 unit_key 属正常，不报「未归属单元」', () => {
  const cov = buildAnswerCoverage([1, 2, 3].map(n => row(n, { unit_key: null })))
  assert.equal(cov.ok, true, JSON.stringify(cov.messages))
})

test('多单元册子里出现未归属单元的答案 → 报出来', () => {
  const cov = buildAnswerCoverage([
    row(1, { unit_key: 'A' }), row(2, { unit_key: 'A' }),
    row(1, { unit_key: 'B' }), row(2, { unit_key: 'B' }),
    row(1, { unit_key: null }),
  ])
  assert.equal(cov.ok, false)
  assert.ok(cov.messages.some(m => m.includes('未归属')), JSON.stringify(cov.messages))
})

test('每个单元各自独立判缺口（不跨单元借题号）', () => {
  const cov = buildAnswerCoverage([
    ...['A', 'B'].flatMap(u => [1, 2, 3].map(n => row(n, { unit_key: u }))),
    row(4, { unit_key: 'A' }),
  ])
  const a = cov.problem_units.find(u => u.unit_key === 'A')
  const b = cov.problem_units.find(u => u.unit_key === 'B')
  assert.equal(a, undefined, 'A 单元 1~4 连续，不该报缺口')
  assert.equal(b, undefined, 'B 单元 1~3 连续，不该报缺口')
  assert.equal(cov.ok, true)
})

test('空输入不炸，且判定为干净', () => {
  const cov = buildAnswerCoverage([])
  assert.equal(cov.ok, true)
  assert.equal(cov.summary.answer_count, 0)
  assert.deepEqual(cov.messages, [])
  // 非数组入参同样安全（调用方可能传 undefined）
  assert.equal(buildAnswerCoverage(undefined).ok, true)
})

test('缺口多的单元排前面，老师先看到最该补的', () => {
  const cov = buildAnswerCoverage([
    // 单元 B：缺 2 个（3、6）
    ...[1, 2, 4, 5, 7, 8].map(n => row(n, { unit_key: 'B' })),
    // 单元 A：缺 1 个（4）
    ...[1, 2, 3, 5, 6].map(n => row(n, { unit_key: 'A' })),
  ])
  assert.equal(cov.problem_units[0].unit_key, 'B')
  assert.equal(cov.problem_units[1].unit_key, 'A')
})
