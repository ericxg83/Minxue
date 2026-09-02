// 重置 task 87240cbf-abd5-45ea-972d-55befd4037f8（朱思诺作业）的 retry_count 和 last_error，
// 让用户在部署修复代码后，可以点移动端的"重新处理"按钮触发 /api/tasks/:id/retry 重新入队。
//
// 背景：这条 task 因为 q.options 是字符串，PG jsonb 列报 "invalid input syntax for type json"，
// retry_count 已经到 3，pendingTaskRecovery 黑名单 + MAX_AUTO_RETRIES 都不会再自动恢复。
// 必须人工把 retry_count 清零 + 清掉 last_error，否则即使代码修了也不会再被自动接管。
//
// 用法：
//   1) 先 dry-run 看计划：  node server/scripts/reset-task-87240cbf.mjs
//   2) 确认后真正执行：    node server/scripts/reset-task-87240cef.mjs --apply
//                         ⚠️ 文件名笔误，请用真实脚本名
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import pg from 'pg'
const { Pool } = pg

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })

const TASK_ID = '87240cbf-abd5-45ea-972d-55befd4037f8'
const APPLY = process.argv.includes('--apply')

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
})

async function main() {
  console.log(APPLY ? '⚠️  APPLY 模式：以下操作会真实改数据库。\n' : '🔍 DRY-RUN 模式。加 --apply 才会改库。\n')

  // 1. 看现状
  const { rows: cur } = await pool.query(
    `SELECT id, student_id, status, retry_count, last_error, result, original_name, created_at
     FROM tasks WHERE id = $1`,
    [TASK_ID]
  )
  if (cur.length === 0) {
    console.log('❌ 找不到 task')
    await pool.end()
    return
  }
  const t = cur[0]
  console.log('📍 现状：')
  console.log(`  id        ${t.id}`)
  console.log(`  student_id ${t.student_id}`)
  console.log(`  name      ${t.original_name}`)
  console.log(`  status    ${t.status}`)
  console.log(`  retry_count ${t.retry_count}`)
  console.log(`  last_error ${t.last_error}`)
  console.log(`  created_at ${t.created_at?.toISOString()}`)

  // 2. 学生校验（确认是朱思诺）
  const { rows: stu } = await pool.query(
    `SELECT id, name FROM students WHERE id = $1`,
    [t.student_id]
  )
  if (stu.length === 0) {
    console.log('❌ 学生不存在，跳过操作')
    await pool.end()
    return
  }
  console.log(`  student   ${stu[0].name}`)
  if (!stu[0].name.includes('朱')) {
    console.log('⚠️  学生名不是"朱*"，请人工确认是否同一 task')
  }

  console.log('\n═══════════════════════════════════════════════════════')
  console.log('📋 计划：')
  console.log('═══════════════════════════════════════════════════════')
  console.log(`  UPDATE tasks
    SET status = 'pending',
        retry_count = 0,
        last_error = NULL,
        result = jsonb_set(
          COALESCE(result, '{}'::jsonb),
          '{previousError}',
          to_jsonb($last_error$)
        ),
        updated_at = NOW()
    WHERE id = $task_id$
  `)
  console.log(`  -- 保留原始 result.progress / started_at / failedAt 等历史信息`)
  console.log(`  -- 在 result.previousError 留一份原 last_error 留痕`)
  console.log(`  -- 部署修复代码后，老师在 PC 工作台/移动端点"重新处理"即触发重跑`)

  if (!APPLY) {
    console.log('\n💡 加 --apply 才会真正执行。')
    await pool.end()
    return
  }

  // 3. 执行
  console.log('\n⏳ 开始重置...')
  const previousError = t.last_error || null
  const { rowCount } = await pool.query(
    `UPDATE tasks
     SET status = 'pending',
         retry_count = 0,
         last_error = NULL,
         result = jsonb_set(
           COALESCE(result, '{}'::jsonb),
           ARRAY['previousError']::text[],
           to_jsonb($2::text)
         ),
         updated_at = NOW()
     WHERE id = $1`,
    [TASK_ID, previousError]
  )
  console.log(`✅ 重置完成: ${rowCount} 行`)

  // 4. 验证
  const { rows: v } = await pool.query(
    `SELECT id, status, retry_count, last_error, result FROM tasks WHERE id = $1`,
    [TASK_ID]
  )
  console.log('\n📋 重置后：')
  console.log(JSON.stringify({
    status: v[0].status,
    retry_count: v[0].retry_count,
    last_error: v[0].last_error,
    result_previousError: v[0].result?.previousError || null,
  }, null, 2))

  await pool.end()
}

main().catch(e => { console.error('❌ 失败:', e.message); pool.end() })