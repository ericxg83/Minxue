/**
 * P5：掌握度清空重建
 * ═══════════════════════════════════════════════════════════════
 * ⛔ 为什么必须清空而不能「直接重跑」：
 *   `upsertMasteryRecord` 是**增量累加**（total_questions + 1）。在已有旧行上重跑
 *   会把每道题重复计数，数据彻底烂掉。**先清空再跑，从零累加才是对的。**
 *   （这也是 `recomputeQuestionKnowledge.mjs` 不敢动掌握度的原因。）
 *
 * ⛔ 重建来源：`questions.is_correct`（2458 道可判定题）+ 当前 ai_tags。
 *   按 created_at 升序喂，`consecutive_correct` 才是对的。
 *   无法重建的：`history` 数组（原行被 HISTORY_CAP=50 截断过，细节不可复原）。
 *
 * ⛔ 副作用：老师端会看到所有考点掌握度短暂归零后重建。已获负责人确认。
 *
 * 默认 dry-run，--apply 才写库。
 */
import '../loadEnv.js'
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const APPLY = process.argv.includes('--apply')
const { default: pg } = await import('pg')
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const { syncQuestionsKnowledgeAndMastery: sync } = await import('../services/knowledgeMasteryService.js')

const { rows: before } = await pool.query(`
  SELECT count(*)::int AS rows, count(DISTINCT student_id)::int AS students FROM knowledge_mastery`)
console.log(`重建前：${before[0].rows} 行 / ${before[0].students} 个学生`)

const { rows: studs } = await pool.query(`
  SELECT DISTINCT student_id FROM questions
   WHERE is_correct IS NOT NULL AND COALESCE(answer_source,'') <> 'blank'`)
console.log(`可重建的学生：${studs.length} 个`)

const { rows: gradable } = await pool.query(`
  SELECT count(*)::int AS n FROM questions
   WHERE is_correct IS NOT NULL AND COALESCE(answer_source,'') <> 'blank'`)
console.log(`可判定题：${gradable[0].n} 道`)

if (!APPLY) { console.log('\n── dry-run 结束，未写库 ──'); await pool.end(); process.exit(0) }

// 备份
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const bak = path.resolve(ROOT, `server/_backup_knowledge_mastery_${stamp}.json`)
fs.writeFileSync(bak, JSON.stringify({ at: new Date().toISOString(), rows: (await pool.query(`SELECT * FROM knowledge_mastery`)).rows }), 'utf8')
console.log('✅ 已备份 → ' + bak)

const del = await pool.query(`DELETE FROM knowledge_mastery`)
console.log(`✅ 已清空 ${del.rowCount} 行`)

let done = 0, linked = 0, mastery = 0, skipped = 0
for (const s of studs) {
  // 按时间升序喂，consecutive_correct 才正确
  const { rows: qs } = await pool.query(`
    SELECT id, content, subject, options, ai_tags, is_correct, answer_source, parent_stem
      FROM questions WHERE student_id = $1 ORDER BY created_at ASC`, [s.student_id])
  try {
    const st = await sync({ studentId: s.student_id, questions: qs })
    linked += st.linked; mastery += st.mastery; skipped += st.skipped
  } catch (e) { console.log(`  ⚠️ 学生 ${s.student_id.slice(0, 8)} 失败: ${e.message}`) }
  done++
  if (done % 5 === 0) console.log(`  ... ${done}/${studs.length}`)
}

const { rows: after } = await pool.query(`
  SELECT count(*)::int AS rows, count(DISTINCT student_id)::int AS students,
         round(avg(mastery)::numeric, 1) AS avg_mastery FROM knowledge_mastery`)
const { rows: qk } = await pool.query(`SELECT count(*)::int AS n FROM question_knowledge`)
console.log('')
console.log(`✅ 重建完成：${after[0].rows} 行 / ${after[0].students} 个学生，平均掌握度 ${after[0].avg_mastery}`)
console.log(`   （重建前 ${before[0].rows} 行 / ${before[0].students} 个学生）`)
console.log(`   question_knowledge：${qk[0].n} 条边`)
const { rows: top } = await pool.query(`
  SELECT kp.name, km.mastery, km.total_questions FROM knowledge_mastery km
    JOIN knowledge_points kp ON kp.id = km.kp_id
   ORDER BY km.total_questions DESC LIMIT 8`)
console.log('   样本（题目数最多的掌握度行）：')
for (const r of top) console.log(`     ${r.name}  掌握度 ${Math.round(r.mastery)}%  ${r.total_questions} 题`)
await pool.end()
