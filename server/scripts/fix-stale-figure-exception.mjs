/**
 * 修复「缺配图闸陈旧红条」窄口径集合（2026-10-10）
 *
 * 集合定义（三条件同时成立，缺一不可）：
 *   ① answer_exception_reason LIKE '%未采集到配图%'
 *   ② 现在 geometry_image_url 非空（图后来补上了）
 *   ③ answer 仍为空（确实没算出来）
 *
 * 分两种处置：
 *   T1「提升」：ai_answer 已有值且与 student_answer 一致 —— 直接把 ai_answer 提到
 *      answer，标 teacher_verified，清 exception。**不烧额度**。
 *   T2「重算」：无ai_answer —— 走 /api/questions/:id/recompute 视觉求解。
 *
 * ⚠️ dry-run 默认 true，apply 需显式 --apply。
 * ⚠️ 写库前自动落备份 logs/questions-fixfig-*.json。
 */
import '../loadEnv.js'
import pg from 'pg'
import fs from 'fs'
import path from 'path'

const APPLY = process.argv.includes('--apply')
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7)
const POOL = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

const q = async (sql, p = []) => (await POOL.query(sql, p)).rows

const rows = await q(
  `SELECT id, task_id, question_number, page_number,
     left(content,60) AS content,
     left(coalesce(geometry_image_url,''),70) AS fig,
     left(coalesce(answer,''),30) AS answer,
     left(coalesce(ai_answer,''),30) AS ai_answer,
     left(coalesce(student_answer,''),30) AS student_answer,
     answer_source, answer_exception, left(coalesce(answer_exception_reason,''),60) AS reason,
     created_at, updated_at
   FROM questions
   WHERE answer_exception_reason LIKE '%未采集到配图%'
     AND geometry_image_url IS NOT NULL AND geometry_image_url <> ''
     AND (answer IS NULL OR btrim(answer) = '')
     AND deleted_at IS NULL
   ORDER BY created_at DESC`
)

console.log(`窄口径集合 = ${rows.length} 道${ONLY ? `（--only=${ONLY}）` : ''}\n`)
if (!rows.length) { console.log('无需处理'); await POOL.end(); process.exit(0) }

// ── 分类 ──
const t1 = [], t2 = []
for (const r of rows) {
  const ai = (r.ai_answer || '').trim()
  const stu = (r.student_answer || '').trim()
  // T1 判据（三条全中才算，缺一不可）：
  //  ① ai_answer 与 student_answer 一致 ⇒ 这道题实际已判对
  //  ② answer_source === 'recognized' ⇒ 答案来源是识别而非人工填/空
  //  ③ 排除「学生答案本身没有语义」的形态（如 '如图所示' —— 作图题的占位回答）
  const isPlaceholder = /^(如图所示|如图|见图|略|无|不填)$/.test(stu)
  if (ai && stu && ai === stu && r.answer_source === 'recognized' && !isPlaceholder) t1.push(r)
  else t2.push(r)
}

console.log('=== T1 提升（ai_answer 已与 student_answer 一致，不烧额度） ===')
console.table(t1.map(r => ({ qn: r.question_number, ai: r.ai_answer, stu: r.student_answer, content: r.content })))
console.log('\n=== T2 需重算（走视觉求解，会烧额度） ===')
console.table(t2.map(r => ({ qn: r.question_number, ai: r.ai_answer || '(空)', stu: r.student_answer || '(空)', content: r.content })))

if (!APPLY) {
  console.log('\n🔒 dry-run。未加--apply，不写库。')
  await POOL.end()
  process.exit(0)
}

// ── 备份 ──
const stamp = new Date().toISOString().slice(0, 10)
const LOG = path.join('D:/Minxue_App_V3/logs')
fs.mkdirSync(LOG, { recursive: true })
const backupPath = path.join(LOG, `questions-fixfig-${stamp}.json`)
fs.writeFileSync(backupPath, JSON.stringify(rows, null, 1))
console.log(`\n📦 备份已落：${backupPath}（${rows.length} 条）`)

// ── T1 提升 ──
for (const r of t1) {
  await q(
    `UPDATE questions
        SET answer = $2,
            answer_source = 'teacher_verified',
            answer_exception = FALSE,
            answer_exception_reason = NULL,
            updated_at = NOW()
      WHERE id = $1`,
    [r.id, r.ai_answer]
  )
  // 回读校验
  const [back] = await q(`SELECT answer, answer_source, answer_exception FROM questions WHERE id=$1`, [r.id])
  const ok = back && back.answer === r.ai_answer && back.answer_exception === false
  console.log(`${ok ? '✅' : '❌'} ${r.id.slice(0, 8)} 第${r.question_number}题 → answer="${back?.answer}" src=${back?.answer_source} exc=${back?.answer_exception}`)
}

console.log(`\nT1 完成 ${t1.length}/${t1.length}。T2 共 ${t2.length} 道需走 recompute 接口（脚本不代调，避免阻塞与重复扣额）。`)
console.log('T2 清单已写入：' + path.join(LOG, `t2-recompute-${stamp}.json`))
fs.writeFileSync(path.join(LOG, `t2-recompute-${stamp}.json`), JSON.stringify(t2.map(r => ({ id: r.id, qn: r.question_number, content: r.content })), null, 1))

await POOL.end()