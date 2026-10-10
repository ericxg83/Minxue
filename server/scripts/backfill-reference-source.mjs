/**
 * 存量回填：questions.reference_source（迁移 063 配套，2026-10-10）
 *
 * ⛔ 铁律（违反即事故）
 *1. **只写 reference_source，绝不碰 answer_source / is_correct / answer /
 *    student_answer / review_status。** 「学生写没写」是全系统不变量，
 *    40+ 处判据依赖它；本脚本一个字节都不许动它。
 *  2. **不改错题本**：265 道矛盾数据已在错题本里，本脚本不触碰 wrong_questions
 *    （入册/出册是产品口径，须负责人单独裁决）。
 *  3. 幂等：只回填 reference_source IS NULL 的行，重复跑不会覆盖已有判断。
 *
 * ── 分层判据（决定每条填什么，依据可查、不猜）──
 *   cache_id 非空        → 'engine'    答案引擎确曾算出并落过缓存（238 道）
 *   task_type='workbook' → 'worksheet' 练习册答案库匹配（84 道）
 *   其余                 → 'external'  外部给定、未过引擎（52 道）
 *
 * ⚠️ engine 与 worksheet 不可混为一谈：前者代表「引擎算的，可复算」，
 *    后者代表「答案册原值，引擎没参与」。混填会让将来的追溯失真。
 *
 * dry-run 默认 true；--apply 需显式指定。apply 前自动落备份，逐批回读校验。
 */
import '../loadEnv.js'
import pg from 'pg'
import fs from 'fs'
import path from 'path'

const APPLY = process.argv.includes('--apply')
const BATCH = 100
const POOL = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const q = async (sql, p = []) => (await POOL.query(sql, p)).rows

// ── 选出待回填行（严格窄口径：矛盾组合 ∧ reference_source 仍为空）──
const targets = await q(`
  SELECT q.id, q.task_id, q.question_number, q.cache_id, t.task_type,
         left(q.content, 50) AS content,
         left(coalesce(q.answer,''), 30) AS answer,
         q.answer_source, left(coalesce(q.student_answer,''), 20) AS stu,
         q.is_correct, q.review_status
  FROM questions q
  JOIN tasks t ON t.id = q.task_id
  WHERE q.deleted_at IS NULL
    AND q.answer_source = 'blank'
    AND (q.student_answer IS NULL OR btrim(q.student_answer) = '')
    AND q.answer IS NOT NULL AND btrim(q.answer) <> ''
    AND q.reference_source IS NULL
  ORDER BY q.created_at
`)

if (!targets.length) {
  console.log('待回填 = 0，无需执行。')
  await POOL.end()
  process.exit(0)
}

// ── 分层 ──
const decide = r => (r.cache_id ? 'engine' : (r.task_type === 'workbook' ? 'worksheet' : 'external'))
const groups = { engine: 0, worksheet: 0, external: 0 }
for (const r of targets) groups[decide(r)]++

console.log(`待回填 = ${targets.length} 道`)
console.log(`  engine    = ${groups.engine}   （cache_id 非空：引擎算过并落过缓存）`)
console.log(`  worksheet = ${groups.worksheet}   （练习册答案库匹配）`)
console.log(`  external  = ${groups.external}   （外部给定、未过引擎）`)

const inWq = await q(`
  SELECT count(*)::int AS n FROM questions q
  JOIN wrong_questions wq ON wq.question_id = q.id
  WHERE q.id = ANY($1::uuid[])`, [targets.map(t => t.id)])
console.log(`\n其中已在错题本 = ${inWq[0].n} 道（本脚本不触碰错题本，仅告知）`)

console.log('\n=== 抽样预览（前 6 道） ===')
console.table(targets.slice(0, 6).map(r => ({
  qn: r.question_number, type: r.task_type, cache: r.cache_id ? 'Y' : '·',
  ref: decide(r), ans: r.answer, reviewed: r.review_status || '-', content: r.content
})))

if (!APPLY) {
  console.log('\n🔒 dry-run。未加 --apply，不写库。')
  await POOL.end()
  process.exit(0)
}

// ── 备份 ──
const stamp = new Date().toISOString().slice(0, 10)
const LOG = path.join('D:/Minxue_App_V3/logs')
fs.mkdirSync(LOG, { recursive: true })
const backupPath = path.join(LOG, `questions-refsrc-backfill-${stamp}.json`)
fs.writeFileSync(backupPath, JSON.stringify(targets, null, 1))
console.log(`\n📦 备份已落：${backupPath}（${targets.length} 条）`)

// ── 分批回填，每批只 UPDATE reference_source 一列 ──
let done = 0
for (let i = 0; i < targets.length; i += BATCH) {
  const slice = targets.slice(i, i + BATCH)
  const ids = slice.map(r => r.id)
  const cases = slice.map((r, idx) => `WHEN '${r.id}'::uuid THEN '${decide(r)}'`).join(' ')
  await q(
    `UPDATE questions
        SET reference_source = CASE id ${cases} END,
            updated_at = updated_at   -- ⛔ 不动 updated_at：本脚本不改判题数据
      WHERE id = ANY($1::uuid[])
        AND reference_source IS NULL`,
    [ids]
  )
  // 回读校验
  const back = await q(
    `SELECT count(*)::int AS n,
            count(*) FILTER (WHERE reference_source IS NOT NULL)::int AS filled
     FROM questions WHERE id = ANY($1::uuid[])`, [ids])
  const ok = back[0].n === back[0].filled
  done += back[0].filled
  console.log(`${ok ? '✅' : '❌'} 批次 ${i / BATCH + 1}: ${back[0].filled}/${back[0].n} 已填`)
  if (!ok) {
    console.error('⚠️ 本批存在未回填行，终止后续批次（避免半途状态不明）')
    break
  }
}

console.log(`\n回填完成：${done}/${targets.length}`)

// ── 最终校验：不变量必须完好 ──
const final = await q(`
  SELECT
    count(*) FILTER (WHERE answer_source='blank' AND (student_answer IS NULL OR btrim(student_answer)=''))::int AS blank_ok,
    count(*) FILTER (WHERE answer_source<>'blank' AND (student_answer IS NULL OR btrim(student_answer)=''))::int AS broken,
    count(*) FILTER (WHERE reference_source IS NOT NULL)::int AS ref_filled
  FROM questions WHERE deleted_at IS NULL`)
console.log('\n=== 不变量校验 ===')
console.log(JSON.stringify(final[0]))
console.log(final[0].broken === 0
  ? '✅ blank ⇔ student_answer 为空 的不变量完好'
  : `⚠️ 有 ${final[0].broken} 道反向破损（本次修复范围外，历史遗留）`)

await POOL.end()