/**
 * 修复 2026-11-24 截图报障：复核页参考答案空 + 「AI标记需要人工补充」。
 *
 * 根因（已对照原卷照片核实）：
 *   作业原卷第 2 题印刷体是 `-3(x-2y)+4(x-2y)`，学生用铅笔圈住了首项负号/系数，
 *   OCR 把被圈住的印刷负号漏掉，写成 `3(x-2y)+4(x-2y)` ⇒ 化简得 7x-14y，
 *   与四个选项（x-2y / x+2y / -x-2y / -x+2y）全都不符。
 *   答案引擎因此诚实返回「待人工补充」，worker 把 answer 置空并标注
 *   answer_exception_reason='AI标记需要人工补充'——系统没有错判，错在题干 OCR。
 *
 * 修法（照抄 server/scripts/_fix_wrong_reference_answer.mjs 的既有链路）：
 *   走 HTTP PUT /api/questions/:id 改 content / answer / analysis / is_correct，
 *   复用 answerRewritten 清异常标注 + finalizeRejudgeResult 结算 + judgement 审计。
 *   不写裸 SQL，不绕过状态机。
 *
 * 用法：
 *   node server/scripts/fix-occluded-minus-answer-20261124.mjs          # dry-run
 *   node server/scripts/fix-occluded-minus-answer-20261124.mjs --apply  # 写库
 */
import '../loadEnv.js'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k]

const APPLY = process.argv.includes('--apply')
const PORT = Number(process.env.PORT) || 4000
const QID = '355649a8-01e3-40a9-9fe1-4a065017ee84'
const WRONG_CONTENT = '计算 3(x-2y)+4(x-2y) 的结果是( )'
const RIGHT_CONTENT = '计算 -3(x-2y)+4(x-2y) 的结果是( )'
const RIGHT_ANSWER = 'A'
const RIGHT_ANALYSIS = '原式=-3(x-2y)+4(x-2y)=(-3+4)(x-2y)=x-2y，所以选 A。（2026-11-24 按原卷印刷体订正：首项系数为 -3，OCR 曾漏掉被铅笔圈住的负号。）'

const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  keepAlive: true
})

const req = (method, urlPath, body) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null
  const r = http.request({
    host: '127.0.0.1', port: PORT, path: urlPath, method,
    headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
  }, (res) => {
    let buf = ''
    res.on('data', chunk => { buf += chunk })
    res.on('end', () => {
      let json = null
      try { json = JSON.parse(buf) } catch { /* 非 JSON 响应 */ }
      resolve({ status: res.statusCode, json, raw: buf.slice(0, 800) })
    })
  })
  r.on('error', reject)
  if (data) r.write(data)
  r.end()
})

const SELECT_FIELDS = `id, task_id, student_id, content, options, answer, analysis, ai_answer,
  is_correct, status, review_status, answer_source, confidence, student_answer,
  answer_exception, answer_exception_reason, is_complete, updated_at`
const { rows: beforeRows } = await pool.query(`SELECT ${SELECT_FIELDS} FROM questions WHERE id=$1`, [QID])
if (!beforeRows.length) {
  console.error(`题目不存在: ${QID}`)
  await pool.end()
  process.exit(1)
}
const before = beforeRows[0]
const { rows: wqBefore } = await pool.query(`SELECT id, lifecycle_status FROM wrong_questions WHERE question_id=$1`, [QID])
const { rows: judgeBefore } = await pool.query(`SELECT source, is_correct, created_at FROM judgements WHERE question_id=$1 ORDER BY created_at DESC LIMIT 5`, [QID])

console.log('=== 改前 ===')
console.log(JSON.stringify(before, null, 2))
console.log(`错题本: ${wqBefore.length ? JSON.stringify(wqBefore) : '（不在册）'}`)
console.log(`最近判定: ${judgeBefore.map(j => `${j.source}(${j.is_correct})`).join(' , ') || '（无）'}`)

const guards = [
  [before.content === WRONG_CONTENT, '题干仍是 OCR 漏负号版本'],
  [!String(before.answer || '').trim(), '参考答案仍为空'],
  [String(before.student_answer || '').trim() === 'A', '学生答案仍为 A'],
  [before.answer_exception === true && before.answer_exception_reason === 'AI标记需要人工补充', '异常标注仍是「AI标记需要人工补充」']
]
const failedGuards = guards.filter(([ok]) => !ok).map(([, msg]) => msg)
if (failedGuards.length) {
  console.error(`前置守卫不通过，拒绝写库：${failedGuards.join('；')}`)
  await pool.end()
  process.exit(1)
}

const payload = {
  content: RIGHT_CONTENT,
  answer: RIGHT_ANSWER,
  analysis: RIGHT_ANALYSIS,
  ai_answer: RIGHT_ANSWER,
  answer_source: 'teacher_verified',
  is_correct: true
}
console.log('\n=== 将发送 ===')
console.log(`PUT http://127.0.0.1:${PORT}/api/questions/${QID}`)
console.log(JSON.stringify(payload, null, 2))

if (!APPLY) {
  console.log('\n[dry-run] 未写库。确认无误后加 --apply 执行。')
  await pool.end()
  process.exit(0)
}

const backupDir = path.resolve('server/backups')
fs.mkdirSync(backupDir, { recursive: true })
const backupFile = path.join(backupDir, `fix-occluded-minus-${QID.slice(0, 8)}-${Date.now()}.json`)
fs.writeFileSync(backupFile, JSON.stringify({
  at: new Date().toISOString(),
  before,
  wrongQuestions: wqBefore,
  judgements: judgeBefore
}, null, 2))
console.log(`\n已备份 → ${backupFile}`)

const res = await req('PUT', `/api/questions/${QID}`, payload)
console.log(`\n=== 响应 status=${res.status} ===`)
console.log(res.json ? JSON.stringify(res.json, null, 2).slice(0, 4000) : res.raw)
if (res.status >= 400) {
  console.error('写入失败')
  await pool.end()
  process.exit(1)
}

await new Promise(resolve => setTimeout(resolve, 800))
const { rows: afterRows } = await pool.query(`SELECT ${SELECT_FIELDS} FROM questions WHERE id=$1`, [QID])
const after = afterRows[0]
const { rows: wqAfter } = await pool.query(`SELECT id, lifecycle_status FROM wrong_questions WHERE question_id=$1`, [QID])
const { rows: judgeAfter } = await pool.query(`SELECT source, is_correct, created_at FROM judgements WHERE question_id=$1 ORDER BY created_at DESC LIMIT 3`, [QID])

const checks = [
  ['题干已补负号', after.content === RIGHT_CONTENT],
  ['参考答案=A', after.answer === RIGHT_ANSWER],
  ['判定为对', after.is_correct === true],
  ['异常标注已清', after.answer_exception !== true && !after.answer_exception_reason],
  ['完整性为真', after.is_complete === true],
  ['未误入错题本', wqAfter.length === 0]
]
console.log('\n=== 改后 ===')
console.log(JSON.stringify(after, null, 2))
console.log(`错题本: ${wqAfter.length ? JSON.stringify(wqAfter) : '（不在册）'}`)
console.log(`最近判定: ${judgeAfter.map(j => `${j.source}(${j.is_correct})`).join(' , ') || '（无）'}`)
console.log('\n=== 验收 ===')
for (const [label, ok] of checks) console.log(`  ${ok ? 'OK' : 'FAIL'}  ${label}`)
if (checks.some(([, ok]) => !ok)) {
  console.error('验收未通过')
  await pool.end()
  process.exit(1)
}
await pool.end()
