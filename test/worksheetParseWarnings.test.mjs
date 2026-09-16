// 回归测试：答案页「题号连续性异常」告警必须在两条解析路径都生成
//
// 事故背景（2026-09-16 八上数学_上海作业 56 页）：
//   答案册「第 19 章测试 (二)」标题行因带空白未被识别 → 该单元 1~25 题答案
//   继承上一个单元「第19章测试(一)」并按题号覆盖它。
//   这个错位在答案库里**看不出来**（题号 1..27 连续、无缺口），
//   唯一的强信号是解析期产生的 `question_seq_anomaly`（27 之后又出现 1 → reset）。
//   但该信号只在**单趟路径**（≤15 页）被转成 parse_warning，
//   **分批路径**（>15 页的册子，绝大多数教辅）把它整条丢弃 →
//   管理端 parse_warning 为空 → 结构性错位零提示，老师批改时才发现参考答案张冠李戴。
//
// 本测试锁定：
//   ① buildSeqAnomalyWarning 行为正确（有异常则出文案，无异常返回 null，条数如实呈现）；
//   ② 两条路径都必须调用它（源码级锁死"只有单趟路径有"这个历史缺口）。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildSeqAnomalyWarning } from '../server/routes/worksheets.js'

const SRC = fs.readFileSync(new URL('../server/routes/worksheets.js', import.meta.url), 'utf8')

test('buildSeqAnomalyWarning：有结构性异常时必须出文案并列出条数与样例', () => {
  const lc = [
    { kind: 'question_seq_anomaly', reason: 'reset', question_no: 1, prev_question_no: 27, unit_key: '第19章测试(一)', message: '答案页OCR可能漏识别大题组/单元标题：第1题与第27题在同 section 内题号重置到 1' },
    { question_no: 3, answer: 'x' }, // 普通低置信度，不参与
  ]
  const w = buildSeqAnomalyWarning(lc)
  assert.ok(w && w.includes('1 处答案页题号连续性异常'), '必须报出异常条数')
  assert.ok(w.includes('第19章测试(一)'), '必须带上具体单元，便于定位')
  assert.ok(w.includes('重新解析'), '必须给出可执行入口')
})

test('buildSeqAnomalyWarning：无异常返回 null（不得凭空告警）', () => {
  assert.equal(buildSeqAnomalyWarning([]), null)
  assert.equal(buildSeqAnomalyWarning(null), null)
  assert.equal(buildSeqAnomalyWarning([{ question_no: 1, answer: 'A' }]), null)
})

test('分批路径（>15 页）必须生成题号错位告警 —— 历史缺口防复发', () => {
  // doParseOcrBatched：以 `const warnings = []` 到 updateWorksheetParseStatus 为界
  const i = SRC.indexOf('const warnings = []')
  assert.ok(i > 0, '未找到分批路径的 warnings 段')
  const seg = SRC.slice(i, i + 3000)
  assert.ok(/buildSeqAnomalyWarning\s*\(/.test(seg),
    '分批路径必须调用 buildSeqAnomalyWarning，否则 >15 页册子的单元标题漏识别不会有任何告警')
})

test('告警文案只允许有一份实现（单趟/分批共用，防止再次漂移）', () => {
  const defs = SRC.match(/function\s+buildSeqAnomalyWarning\s*\(/g) || []
  assert.equal(defs.length, 1, 'buildSeqAnomalyWarning 只能定义一次')
  // 文案主体（注释里不含这句），只应出现在该函数内部；调用点内联拼接会再出现一次
  const inline = SRC.match(/处答案页题号连续性异常（可能漏识别单元\/大题组标题）/g) || []
  assert.equal(inline.length, 1, `文案不得在调用点内联拼接（只应存在于 buildSeqAnomalyWarning），实际出现 ${inline.length} 次`)
  const calls = SRC.match(/buildSeqAnomalyWarning\s*\(/g) || []
  assert.ok(calls.length >= 3, `应有 ≥2 处调用（定义 1 + 单趟 1 + 分批 1），实际 ${calls.length}`)
})
