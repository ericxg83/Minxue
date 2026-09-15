/**
 * 修复脚本 #2：《九上上海作业答案》(f8cf5d96) 练习册错题 error_count 虚高清洗
 *
 * 事实依据（探针 _diag_workbook_error_count / _worksheet_scan / _tasks_align / _worksheet_truth）：
 *  - 5 个学生（丁嘉炜/张诗蕊/李哲瀚/程思豪/陈施君）共 8 个 workbook 任务，全部指向本练习册，
 *    每人每个章节只做过一次；36 条 err>1 的 wq 行各自 question_id 唯一指向一个真实判错题行。
 *  - 虚增机制：09-09「九上答案全本错位」事故后的多波重评（09-10 06:54~07:29、09-12 15:01~15:12、
 *    09-13 10:09/11:08/11:49/11:53），每次重跑 addSelfContainedWrongQuestion 的
 *    ON CONFLICT DO UPDATE error_count = error_count + 1 ⇒ err 被刷到 2~9。
 *  - 判题审计（judgements）每题最多 1 条 false（丁嘉炜两题甚至 0 条）⇒ 无任何真实多次做错证据。
 *
 * 修复口径：
 *  - 本练习册全部 error_count > 1 的行 → error_count = 1（唯一真实做错事件）。
 *  - 不动 lifecycle/status/practice_count/last_wrong_at（练习册行 prac=0、lc=new 本来就正确）。
 *  - 备份表 wrong_questions_bak_20260914_workbook；幂等；--rollback 可还原。
 */
import 'dotenv/config'
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })

import pg from 'pg'
const { Pool } = pg
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})
const q = (sql, params) => pool.query(sql, params)

const WSID = 'f8cf5d96-d01c-4450-b752-38c3658b01a8'
const BACKUP_TABLE = 'wrong_questions_bak_20260914_workbook'
const rollback = process.argv.includes('--rollback')

async function main() {
  if (rollback) {
    const { rowCount } = await q(`
      UPDATE wrong_questions wq SET
        error_count = b.error_count,
        practice_count = b.practice_count,
        lifecycle_status = b.lifecycle_status,
        status = b.status,
        updated_at = NOW()
      FROM ${BACKUP_TABLE} b
      WHERE wq.id = b.id
    `)
    console.log(`[rollback] 已从 ${BACKUP_TABLE} 还原 ${rowCount} 行`)
    await pool.end()
    return
  }

  // 1. 现况
  const before = await q(`
    SELECT s.name, wq.id::text AS wq_id, wq.question_no, wq.error_count,
           COALESCE(wq.practice_count,0) AS practice_count,
           COALESCE(wq.lifecycle_status,'new') AS lc
    FROM wrong_questions wq JOIN students s ON s.id=wq.student_id
    WHERE wq.worksheet_id=$1 AND COALESCE(wq.error_count,0) > 1
    ORDER BY s.name, wq.question_no
  `, [WSID])
  console.log(`待清洗（err>1）：${before.rowCount} 条`)
  console.table(before.rows.map(r => ({
    name: r.name, wq: r.wq_id.slice(0, 8), no: r.question_no,
    err: r.error_count, prac: r.practice_count, lc: r.lc
  })))

  if (before.rowCount === 0) { console.log('无需修复（幂等重跑）'); await pool.end(); return }

  // 2. 备份（幂等）
  await q(`CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} AS
           SELECT * FROM wrong_questions WHERE worksheet_id=$1 AND false`, [WSID])
  const bak = await q(`SELECT COUNT(*)::int AS n FROM ${BACKUP_TABLE}`)
  if (bak.rows[0].n === 0) {
    await q(`INSERT INTO ${BACKUP_TABLE}
             SELECT * FROM wrong_questions WHERE worksheet_id=$1 AND COALESCE(error_count,0) > 1`, [WSID])
    console.log(`备份 → ${BACKUP_TABLE}（${before.rowCount} 行）`)
  } else {
    console.log(`备份表已存在（${bak.rows[0].n} 行），跳过重复备份`)
  }

  // 3. 清洗（带守卫，幂等）
  const { rowCount } = await q(`
    UPDATE wrong_questions
    SET error_count = 1, updated_at = NOW()
    WHERE worksheet_id=$1 AND COALESCE(error_count,0) > 1
  `, [WSID])
  console.log(`\n已清洗 ${rowCount} 行（error_count → 1）`)

  // 4. 修复后核验
  const after = await q(`
    SELECT COALESCE(wq.error_count,0) AS err, COUNT(*)::int AS n
    FROM wrong_questions wq WHERE wq.worksheet_id=$1
    GROUP BY 1 ORDER BY 1
  `, [WSID])
  console.log('修复后该练习册 error_count 分布:')
  console.table(after.rows)

  // 5. 全站复查：不应再有 err>4 的练习册行
  const rest = await q(`
    SELECT s.name, COUNT(*)::int AS n, MAX(wq.error_count)::int AS max_err
    FROM wrong_questions wq JOIN students s ON s.id=wq.student_id
    WHERE COALESCE(wq.error_count,0) > 4
    GROUP BY s.name ORDER BY max_err DESC
  `)
  console.log('全站剩余 err>4 行（应只剩作业/重练来源的合法行或另案处理）:')
  console.table(rest.rows)

  await pool.end()
}

main().catch(e => { console.error(e); process.exitCode = 1; pool.end() })
