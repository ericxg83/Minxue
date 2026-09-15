/**
 * 重跑前盘点 + 备份（只读 + 写备份文件，不改库）
 * 目标任务：练习册重跑会删题重建，跑前必须备份。
 *
 * 用法：
 *   node server/scripts/backup-before-workbook-retry.mjs                 # 默认三份
 *   node server/scripts/backup-before-workbook-retry.mjs 2ed887cd 100c18eb
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import pg from 'pg'
import { writeFileSync, mkdirSync } from 'node:fs'

const CLI = process.argv.slice(2).filter(a => !a.startsWith('--'))
const TASKS = CLI.length ? CLI : ['2ed887cd', '100c18eb', 'cd9c22f1']
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const q = async (s, p) => (await pool.query(s, p)).rows

const ids = (await q(`SELECT id FROM tasks WHERE ${TASKS.map((_, i) => `id::text LIKE $${i + 1}`).join(' OR ')}`, TASKS.map(t => t + '%'))).map(r => r.id)
console.log('目标任务数:', ids.length)

console.log('\n===== 1. 将被删题重建的数据量 =====')
console.table(await q(`
  SELECT t.id, t.status,
         COUNT(q.id)::int AS 题数,
         COUNT(*) FILTER (WHERE q.review_status IS NOT NULL)::int AS 有老师复核结论,
         COUNT(*) FILTER (WHERE q.review_status = 'correct')::int AS 复核为对,
         COUNT(*) FILTER (WHERE q.review_status IN ('wrong','wrong_no_book'))::int AS 复核为错,
         COUNT(*) FILTER (WHERE q.answer IS NOT NULL AND btrim(q.answer) <> '')::int AS 有参考答案,
         COUNT(*) FILTER (WHERE q.answer_source = 'worksheet')::int AS 答案库命中
  FROM tasks t LEFT JOIN questions q ON q.task_id = t.id
  WHERE t.id = ANY($1::uuid[]) GROUP BY t.id, t.status`, [ids]))

console.log('\n===== 2. 关联错题 / 判题审计 / 题目资源 =====')
console.table(await q(`
  SELECT t.id,
         (SELECT COUNT(*)::int FROM wrong_questions w WHERE w.question_id::text = ANY(ARRAY_AGG(q.id::text))) AS 关联错题,
         (SELECT COUNT(*)::int FROM judgements j WHERE j.question_id::text = ANY(ARRAY_AGG(q.id::text))) AS 判题审计
  FROM tasks t JOIN questions q ON q.task_id = t.id
  WHERE t.id = ANY($1::uuid[]) GROUP BY t.id`, [ids]).catch(e => { console.log('  err', e.message); return [] }))

console.log('\n===== 3. 有老师复核结论的题明细（重跑后这些结论会丢，需人工对照重录）=====')
console.table(await q(`
  SELECT t.id, q.question_number AS qno, q.sub_no AS sub, q.review_status AS 复核,
         q.is_correct AS AI判定, LEFT(regexp_replace(COALESCE(q.student_answer,''),'\\s+',' ','g'), 20) AS 学生答案,
         LEFT(regexp_replace(COALESCE(q.answer,''),'\\s+',' ','g'), 20) AS 参考答案
  FROM tasks t JOIN questions q ON q.task_id = t.id
  WHERE t.id = ANY($1::uuid[]) AND q.review_status IS NOT NULL
  ORDER BY t.id, q.question_number`, [ids]))

// 备份
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backup = {
  createdAt: new Date().toISOString(),
  reason: `workbook 任务重跑前备份（${TASKS.join('/')}）`,
  taskIds: ids,
  questions: await q(`SELECT * FROM questions WHERE task_id::text = ANY($1)`, [ids]),
  wrongQuestions: await q(`
    SELECT w.* FROM wrong_questions w
    JOIN questions qq ON qq.id = w.question_id
    WHERE qq.task_id::text = ANY($1)`, [ids]),
  judgements: await q(`
    SELECT j.* FROM judgements j
    JOIN questions qq ON qq.id::text = j.question_id
    WHERE qq.task_id::text = ANY($1)`, [ids]),
}
const dir = 'D:/Minxue_App_V3/server/backups'
mkdirSync(dir, { recursive: true })
const file = `${dir}/workbook-retry-backup-${ts}.json`
writeFileSync(file, JSON.stringify(backup, null, 1))
console.log(`\n✅ 备份已写入: ${file}`)
console.log(`   questions=${backup.questions.length} wrongQuestions=${backup.wrongQuestions.length} judgements=${backup.judgements.length}`)

await pool.end()
