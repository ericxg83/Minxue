/**
 * 修复 answer_sign_mismatch 命中的 4 条明显 AI 错题。
 *
 * ⚠️ 默认 dry-run：只打印 SQL 与目标行，不修改任何数据。
 *    加 --apply 才真正 UPDATE / INSERT。
 *
 * 4 条目标（用 question.id 唯一定位，task_id + question_number 不唯一）：
 *   1. 53dd6b56  抛物线 y=ax² 过 A(-1,4)、B(m,4)：AI 漏解（只给 m=-1 应是 ±1）
 *                  + D 坐标多了字母 a（应是 -4n² 不是 -4an²）
 *   2. 5c1caa0d  抛物线 y=½(x+m)² 过 A(2,2)：AI m=-2 应是 m=-4（解方程漏 ±2 分支）
 *   5. 79727824  √81 的平方根：AI 9 应是 ±3（用户 2026-09-03 截图案例）
 *   6. c579e7ab  同 #2 题面另一 task：AI m=-2 应是 m=-4
 *
 * 每个修复都做三件事（参考旧迁移启动即删数据陷阱，全部事务化 + shadow 留痕）：
 *   - UPDATE questions SET is_correct=true, ai_answer_risk_reason=...
 *     WHERE id=$1 AND is_correct=false  -- 加 is_correct 守卫防止误改
 *   - UPDATE questions SET ai_self_check_issues = ai_self_check_issues || 'sign_mismatch_corrected'
 *   - INSERT INTO judgements (source='pc_edit', ...)  -- shadow 审计
 *
 * 风险：
 *   - 改 is_correct 会影响错题统计/掌握度，但本次都是把"学生被错判"翻成"答对"，
 *     符合业务逻辑（学生本来就该得的分）。
 *   - ai_answer_risk_reason 会被覆盖：4 条原来都是空，覆盖安全。
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })
process.env.DATABASE_URL = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL

const APPLY = process.argv.includes('--apply')

const TARGETS = [
  {
    id: '53dd6b56-e5fa-41c6-803e-c792a2d3d143',
    label: '#1 抛物线漏解 (task 7639eee3 q=4)',
    risk_reason: 'AI 参考答案错误：4m²=4 应得 m=±1，AI 只给 m=-1；D(n,-4an²) 多余字母 a 应是 D(-n,4n²)',
  },
  {
    id: '5c1caa0d-28fa-4953-8f6c-3d8e21a9f3dc',
    label: '#2 m=-2 应为 m=-4 (task 73e54aef q=5)',
    risk_reason: 'AI 参考答案错误：(2+m)²=4 应得 m=0 或 m=-4，AI 只取 m=-2；表达式/对称轴/顶点全部错误',
  },
  {
    id: '79727824-697a-4a7c-93a8-4a3118ee3ce8',
    label: '#5 √81 平方根 (task b967a0af q=4)',
    risk_reason: 'AI 参考答案错误：√81 的平方根 = ±3（先算 √81=9 再求 9 的平方根），AI 按算术平方根分支误答 9',
  },
  {
    id: 'c579e7ab-fff6-41a8-8110-fd5027bfc489',
    label: '#6 同 #2 另一 task (task 85e391bf q=5)',
    risk_reason: 'AI 参考答案错误：同 #2，m=-2 应是 m=-4',
  },
]

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2
})

console.log(APPLY ? '🔧 APPLY 模式：将执行 UPDATE + INSERT' : '🔍 DRY-RUN 模式：只读不写（加 --apply 才执行）\n')

let skipped = 0
let applied = 0
let notFound = 0

for (const t of TARGETS) {
  // 1) 读当前状态
  const { rows } = await pool.query(
    `SELECT id, is_correct, ai_answer_risk_reason, ai_self_check_issues, student_id
     FROM questions WHERE id = $1`,
    [t.id]
  )
  if (rows.length === 0) {
    console.log(`❌ ${t.label}: 找不到 id=${t.id}`)
    notFound++
    continue
  }
  const q = rows[0]

  // 2) 守卫：已 is_correct=true 的不重复改
  if (q.is_correct === true) {
    console.log(`⏭️  ${t.label}: 已是 is_correct=true，跳过`)
    skipped++
    continue
  }

  console.log(`━━━ ${t.label} ━━━`)
  console.log(`  id:                  ${q.id}`)
  console.log(`  is_correct (当前):   ${q.is_correct}`)
  console.log(`  risk_reason (当前):  ${q.ai_answer_risk_reason || '(空)'}`)
  console.log(`  self_check_issues:   ${JSON.stringify(q.ai_self_check_issues)}`)
  console.log(`  student_id:          ${q.student_id}`)
  console.log(`  → 将 UPDATE:`)
  console.log(`       is_correct = true`)
  console.log(`       ai_answer_risk_reason = '${t.risk_reason}'`)
  console.log(`       ai_self_check_issues = ai_self_check_issues || 'sign_mismatch_corrected'`)
  console.log(`  → 将 INSERT INTO judgements:`)
  console.log(`       question_id=${q.id}  student_id=${q.student_id}`)
  console.log(`       source='pc_edit'  is_correct=true`)
  console.log(`       content='answer_sign_mismatch 历史脏数据修正 2026-09-03'`)
  console.log()

  if (APPLY) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // UPDATE 1: 主修复 + 风险标注
      const upd1 = await client.query(
        `UPDATE questions
         SET is_correct = true,
             ai_answer_risk_reason = $2,
             ai_self_check_issues = COALESCE(ai_self_check_issues, '[]'::jsonb) || '["sign_mismatch_corrected"]'::jsonb,
             updated_at = NOW()
         WHERE id = $1 AND is_correct = false
         RETURNING id`,
        [q.id, t.risk_reason]
      )
      if (upd1.rowCount === 0) {
        throw new Error('UPDATE 0 行（is_correct 已被并发改动？）')
      }

      // INSERT: judgements shadow 留痕
      await client.query(
        `INSERT INTO judgements (question_id, student_id, source, is_correct, content, created_at)
         VALUES ($1, $2, 'pc_edit', true, 'answer_sign_mismatch 历史脏数据修正 2026-09-03', NOW())`,
        [q.id, q.student_id]
      )

      await client.query('COMMIT')
      applied++
      console.log(`  ✅ 已应用\n`)
    } catch (e) {
      await client.query('ROLLBACK')
      console.error(`  ❌ 失败: ${e.message}\n`)
    } finally {
      client.release()
    }
  }
}

console.log(`━━━ 汇总 ━━━`)
console.log(`  目标: ${TARGETS.length}`)
console.log(`  跳过（已是 true）: ${skipped}`)
console.log(`  找不到: ${notFound}`)
if (APPLY) console.log(`  已应用: ${applied}`)
else console.log(`  (DRY-RUN, 加 --apply 才执行)`)

await pool.end()