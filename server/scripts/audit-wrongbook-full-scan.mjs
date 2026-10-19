/**
 * 错题归属全量大扫描（2026-10-19 定版，常驻复查工具）
 * 面向「这不是我的错题 / 我没做错过」全谱系。只读，不写库。
 * 用法：node scripts/audit-wrongbook-full-scan.mjs
 * 背景：2026-10-19 二次复查确诊并清理 206 条错题（备份表 wrong_questions_backup_p0a/p0b/p0b2/p0f_20261019
 *       在库内，报告《_错题归属全面复查-我没有错过-20261019.md》本机留存）。
 * 健康指标：A=0、B=0（判对在册清零）、C/D=0、F 全空白=0；G 串题需人工对照原卷。
 * 覆盖：
 *   A. error_count=0 且 last_wrong_at NULL（从未做错）
 *   B. 题目当前判对（questions.is_correct=true）却仍在错题本
 *   C. 跨学生串号（wq.student_id ≠ questions.student_id）
 *   D. 同一 question_id 挂多个学生
 *   E. 题目软删除却仍在错题本
 *   F. 空壳错题（question_id 空 或 题干/配图/学生答案全空）
 *   G. 快照 content 与题目本体不一致（去空白/LaTeX 后仍不同 → 串题/串小问）
 *   H. 入册题目在 judgements 中零记录（无判定证据）
 *   I. 学生答案与参考答案逐字相同却仍在册
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })
process.env.DATABASE_URL = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL

const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 })
const client = await pool.connect()

const brief = (s, n = 40) => { const t = String(s ?? '').replace(/\s+/g, ' '); return t.length > n ? t.slice(0, n) + '…' : t }
const norm = (s) => String(s ?? '').replace(/\s+/g, '').replace(/[{}$\\]/g, '').toLowerCase()

try {
  console.log('══ 错题归属全量大扫描（2026-10-19 定版，只读） ══\n')

  // ── A. 从未做错 ──────────────────────────────────────────────
  const A = await client.query(`
    SELECT wq.id, wq.student_id, s.name AS sn, wq.question_id, wq.error_count,
           wq.last_wrong_at, wq.added_at, wq.source_type, wq.lifecycle_status,
           wq.question_no, wq.worksheet_id,
           left(wq.content, 30) AS content30
      FROM wrong_questions wq
      LEFT JOIN students s ON s.id = wq.student_id
     WHERE wq.error_count = 0 AND wq.last_wrong_at IS NULL
     ORDER BY wq.added_at
  `)
  console.log(`◆ A. 从未做错（error_count=0 且 last_wrong_at NULL）：${A.rows.length} 条`)
  for (const r of A.rows) {
    console.log(`   ${String(r.sn || '(无)').padEnd(5, '　')} qid=${String(r.question_id || 'NULL').slice(0, 8)} added=${r.added_at && r.added_at.toISOString().slice(0, 10)} src=${r.source_type ?? '-'} | ${brief(r.content30)}`)
  }

  // ── B. 题目判对却仍在错题本（全量） ──────────────────────────
  const B = await client.query(`
    SELECT wq.id, wq.student_id, s.name AS sn, wq.question_id, wq.error_count,
           wq.last_wrong_at, wq.added_at, wq.source_type, wq.lifecycle_status,
           q.review_status, left(wq.content, 30) AS content30
      FROM wrong_questions wq
      JOIN questions q ON q.id = wq.question_id
      LEFT JOIN students s ON s.id = wq.student_id
     WHERE q.is_correct = true
     ORDER BY wq.added_at
  `)
  const bZero = B.rows.filter((r) => r.error_count === 0).length
  const bReviewCorrect = B.rows.filter((r) => r.error_count >= 1 && r.review_status === 'correct').length
  const bOther = B.rows.length - bZero - bReviewCorrect
  console.log(`\n◆ B. 题目当前判对（is_correct=true）却仍在错题本：${B.rows.length} 条`)
  console.log(`   ├─ 从未做错（err=0）      ：${bZero} 条`)
  console.log(`   ├─ 人工复核判对（err≥1 review=correct）：${bReviewCorrect} 条`)
  console.log(`   └─ 其余（err≥1 无复核标记，判题修复翻案）  ：${bOther} 条`)
  for (const r of B.rows) {
    console.log(`   ${String(r.sn || '(无)').padEnd(5, '　')} qid=${String(r.question_id).slice(0, 8)} err=${r.error_count} lw=${r.last_wrong_at ? r.last_wrong_at.toISOString().slice(0, 10) : 'NULL'} added=${r.added_at && r.added_at.toISOString().slice(0, 10)} lc=${r.lifecycle_status ?? '-'} review=${r.review_status ?? '-'} | ${brief(r.content30)}`)
  }

  // ── C. 跨学生串号 ─────────────────────────────────────────────
  const Cwq = await client.query(`
    SELECT wq.id, wq.student_id AS wq_sid, s.name AS wq_sn, q.student_id AS q_sid, qs.name AS q_sn,
           wq.question_id, left(wq.content, 30) AS c
      FROM wrong_questions wq
      JOIN questions q ON q.id = wq.question_id
      LEFT JOIN students s  ON s.id = wq.student_id
      LEFT JOIN students qs ON qs.id = q.student_id
     WHERE wq.student_id <> q.student_id
  `)
  console.log(`\n◆ C. 跨学生串号（wq.student_id ≠ questions.student_id）：${Cwq.rows.length} 条`)
  for (const r of Cwq.rows) console.log(`   ⚠️ wq=${r.wq_sn}(${String(r.wq_sid).slice(0, 8)}) ≠ q=${r.q_sn}(${String(r.q_sid).slice(0, 8)}) qid=${String(r.question_id).slice(0, 8)} | ${brief(r.c)}`)

  // ── D. 同一 question_id 挂多个学生 ───────────────────────────
  const D = await client.query(`
    SELECT question_id, count(DISTINCT student_id) AS n, array_agg(DISTINCT s.name) AS students
      FROM wrong_questions wq LEFT JOIN students s ON s.id = wq.student_id
     WHERE question_id IS NOT NULL
     GROUP BY question_id HAVING count(DISTINCT student_id) > 1
  `)
  console.log(`\n◆ D. 同一 question_id 挂多个学生：${D.rows.length} 组`)
  for (const r of D.rows) console.log(`   ⚠️ qid=${String(r.question_id).slice(0, 8)} 挂 ${r.n} 个学生：${r.students.join('、')}`)

  // ── E. 题目软删除却仍在错题本 ────────────────────────────────
  const E = await client.query(`
    SELECT wq.id, wq.student_id, s.name AS sn, wq.question_id, left(wq.content, 30) AS c
      FROM wrong_questions wq
      JOIN questions q ON q.id = wq.question_id
      LEFT JOIN students s ON s.id = wq.student_id
     WHERE q.deleted_at IS NOT NULL
       OR (q.task_id IS NOT NULL AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = q.task_id AND t.deleted_at IS NOT NULL))
  `)
  console.log(`\n◆ E. 题目/任务软删除却仍在错题本：${E.rows.length} 条`)
  for (const r of E.rows) console.log(`   ⚠️ ${r.sn} qid=${String(r.question_id).slice(0, 8)} | ${brief(r.c)}`)

  // ── F. 空壳错题 ───────────────────────────────────────────────
  const F = await client.query(`
    SELECT wq.id, wq.student_id, s.name AS sn, wq.question_id, wq.worksheet_id, wq.question_no,
           (wq.content IS NULL OR btrim(wq.content) = '') AS no_content,
           (wq.student_answer IS NULL OR btrim(wq.student_answer) = '') AS no_sa,
           (wq.question_image_url IS NULL OR btrim(wq.question_image_url) = '') AS no_img,
           wq.source_type
      FROM wrong_questions wq LEFT JOIN students s ON s.id = wq.student_id
     WHERE wq.question_id IS NULL
        OR (wq.content IS NULL OR btrim(wq.content) = '')
        OR (wq.question_id IS NOT NULL AND wq.content IS NOT NULL AND btrim(wq.content) <> ''
            AND NOT EXISTS (SELECT 1 FROM questions q WHERE q.id = wq.question_id))
  `)
  console.log(`\n◆ F. 空壳/无关联错题（question_id 空 或 题干空 或 关联的题不存在）：${F.rows.length} 条`)
  const FfullBlank = F.rows.filter((r) => r.no_content && r.no_sa && r.no_img)
  console.log(`   （其中题干+学生答案+配图全空：${FfullBlank.length} 条）`)
  for (const r of F.rows) {
    console.log(`   ${String(r.sn || '(无)').padEnd(5, '　')} qid=${String(r.question_id || 'NULL').slice(0, 8)} ws=${String(r.worksheet_id || 'NULL').slice(0, 8)} qno=${r.question_no ?? '-'} 空题干=${r.no_content} 空答案=${r.no_sa} 空图=${r.no_img} src=${r.source_type ?? '-'}`)
  }

  // ── G. 快照与本体不一致（去空白/LaTeX） ──────────────────────
  const G = await client.query(`
    SELECT wq.id, wq.student_id, s.name AS sn, wq.question_id, q.sub_no,
           wq.content AS wq_content, q.content AS q_content, wq.added_at
      FROM wrong_questions wq
      JOIN questions q ON q.id = wq.question_id
      LEFT JOIN students s ON s.id = wq.student_id
     WHERE wq.content IS NOT NULL AND btrim(wq.content) <> ''
       AND q.content IS NOT NULL AND btrim(q.content) <> ''
       AND wq.content <> q.content
  `)
  const Gmism = G.rows.filter((r) => norm(r.wq_content) !== norm(r.q_content))
  console.log(`\n◆ G. 错题快照与题目本体不一致：去空白/LaTeX 后仍不同 → ${Gmism.length} 条（原始文本不等 ${G.rows.length} 条）`)
  for (const r of Gmism.slice(0, 30)) {
    console.log(`   ⚠️ ${r.sn} qid=${String(r.question_id).slice(0, 8)} added=${r.added_at && r.added_at.toISOString().slice(0, 10)}`)
    console.log(`      快照: ${brief(r.wq_content, 50)}`)
    console.log(`      本体: ${brief(r.q_content, 50)}`)
  }
  if (Gmism.length > 30) console.log(`   …（共 ${Gmism.length} 条）`)

  // ── H. 入册题目 judgements 零记录 ─────────────────────────────
  const H = await client.query(`
    SELECT wq.id, wq.student_id, s.name AS sn, wq.question_id, wq.error_count,
           wq.added_at, wq.source_type, left(wq.content, 30) AS c
      FROM wrong_questions wq
      LEFT JOIN students s ON s.id = wq.student_id
     WHERE wq.question_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM judgements j WHERE j.question_id = wq.question_id::text)
     ORDER BY wq.added_at
  `)
  console.log(`\n◆ H. 入册题目在 judgements 中零记录：${H.rows.length} 条（judgements 仅覆盖迁移后新判定，历史缺失，本项参考）`)

  // ── I. 学生答案=参考答案却判错在册 ───────────────────────────
  const I = await client.query(`
    SELECT wq.id, wq.student_id, s.name AS sn, wq.question_id, wq.error_count,
           left(wq.student_answer, 30) AS sa, left(wq.correct_answer, 30) AS ca, wq.added_at
      FROM wrong_questions wq
      LEFT JOIN students s ON s.id = wq.student_id
     WHERE wq.student_answer IS NOT NULL AND wq.correct_answer IS NOT NULL
       AND btrim(wq.student_answer) <> '' AND btrim(wq.correct_answer) <> ''
       AND btrim(wq.student_answer) = btrim(wq.correct_answer)
     ORDER BY wq.added_at
  `)
  console.log(`\n◆ I. 学生答案与参考答案逐字相同却在册：${I.rows.length} 条`)
  for (const r of I.rows) console.log(`   ${String(r.sn || '(无)').padEnd(5, '　')} qid=${String(r.question_id).slice(0, 8)} err=${r.error_count} added=${r.added_at && r.added_at.toISOString().slice(0, 10)} sa="${brief(r.sa)}" ca="${brief(r.ca)}"`)

  console.log('\n══ 扫描结束。健康指标：A=0、B 仅剩「其余」类、C/D=0（详见报告第八节） ══')
} finally {
  client.release()
  await pool.end()
}