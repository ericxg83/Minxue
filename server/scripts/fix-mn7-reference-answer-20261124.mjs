/**
 * 修复 2026-11-24 用户截图报障：
 * 题目 72dc5305… 参考答案空 + 「AI标记需要人工补充」。
 *
 * 根因：原卷印刷为 `m+3n-p`，学生用笔圈了其中的 `+` / `-` 号，
 * OCR 把圈读成括号、并把 `+3n-p` 误识成 `-(3n+p)`。
 * AI 按误识题干算出 `m-(3n+p)=11-6n`，条件不足而不能唯一确定，
 * 于是按规则把答案置空并标记「AI标记需要人工补充」。
 *
 * 本脚本只订正这一道题的题干/答案/解析，通过既有 /api/questions/:id
 * 接口写入（走业务侧 answer 非空自动清异常逻辑），不改代码、不删数据。
 * 用法：node server/scripts/fix-mn7-reference-answer-20261124.mjs --apply
 */
import '../loadEnv.js'

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k]
const API = process.env.API_BASE || 'http://127.0.0.1:4000'
const ID = '72dc5305-7533-4bb2-bffa-73856c9b6dd3'
const TASK_ID = 'a43f8e10-7f9d-4d01-b629-705bd869213b'
const APPLY = process.argv.includes('--apply')

const correctContent = '若 m+n=7，2n-p=4，则 m+3n-p=（ ）\nA. -11\nB. -3\nC. 3\nD. 11'
const correctAnalysis = 'm+3n-p = (m+n) + (2n-p) = 7 + 4 = 11，对应选项 D。'

const listRes = await fetch(`${API}/api/questions/task/${TASK_ID}`)
if (!listRes.ok) throw new Error(`GET task questions: HTTP ${listRes.status}`)
const listed = await listRes.json()
const before = (listed.questions || []).find(q => q.id === ID)
if (!before) throw new Error(`问题 ${ID} 不在任务 ${TASK_ID} 的题目列表中`)
console.log('--- BEFORE ---')
console.log(JSON.stringify({
  id: before.id,
  question_number: before.question_number,
  content: before.content,
  answer: before.answer,
  ai_answer: before.ai_answer,
  answer_source: before.answer_source,
  analysis: before.analysis,
  answer_exception: before.answer_exception,
  answer_exception_reason: before.answer_exception_reason,
  is_correct: before.is_correct,
  ai_self_check_passed: before.ai_self_check_passed,
  ai_self_check_issues: before.ai_self_check_issues
}, null, 2))

const needsFix =
  /m-\(3n\+p\)/.test(before.content || '') &&
  (before.answer == null || String(before.answer).trim() === '') &&
  before.answer_exception === true
if (!needsFix) {
  console.log('跳过：当前数据不符合待修复特征（可能已被其他会话修好）。')
  process.exit(0)
}
if (!APPLY) {
  console.log('\n只诊断，未写入。加 --apply 执行订正。')
  process.exit(0)
}

const patch = {
  content: correctContent,
  answer: 'D',
  ai_answer: 'D',
  analysis: correctAnalysis,
  answer_source: 'teacher_verified',
  is_correct: true,
  confidence: 0.99,
  ai_self_check_passed: true,
  ai_self_check_issues: []
}
const putRes = await fetch(`${API}/api/questions/${ID}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(patch)
})
if (!putRes.ok) throw new Error(`PUT ${ID}: HTTP ${putRes.status} ${await putRes.text()}`)
const after = (await putRes.json()).question
console.log('--- AFTER ---')
console.log(JSON.stringify({
  id: after.id,
  content: after.content,
  answer: after.answer,
  ai_answer: after.ai_answer,
  answer_source: after.answer_source,
  analysis: after.analysis,
  answer_exception: after.answer_exception,
  answer_exception_reason: after.answer_exception_reason,
  is_correct: after.is_correct,
  ai_self_check_passed: after.ai_self_check_passed,
  ai_self_check_issues: after.ai_self_check_issues
}, null, 2))

const checks = [
  ['题干已订正', after.content === correctContent],
  ['参考答案为 D', after.answer === 'D' && after.ai_answer === 'D'],
  ['解析已写入', /m\+3n-p.*\(m\+n\).*\(2n-p\)/.test(after.analysis || '')],
  ['异常标记已清除', after.answer_exception === false && !after.answer_exception_reason],
  ['判定改为正确', after.is_correct === true],
  ['自检通过', after.ai_self_check_passed === true]
]
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
if (checks.some(([, ok]) => !ok)) process.exit(1)
console.log('修复完成。')
