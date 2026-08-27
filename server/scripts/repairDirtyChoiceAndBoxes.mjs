/**
 * 一次性数据修复（默认 dry-run，加 --apply 才落库）
 *
 * 修两类历史脏数据：
 *  1) 选择题参考答案被存成「字母+选项内容+markdown」（如 "A（21/2）**"），
 *     严格字母比对失配 → 学生选对却判错。清掉 markdown 残留并用新判分逻辑重判。
 *  2) block_coordinates 是角点形态（x2/y2 写进 width/height），
 *     题目定位框纵向拉到下一题，前端圈住大半页。按 (task_id, page_number) 整页换算。
 *
 * 幂等：两类修复都只在「与目标值不同」时才写；重复执行不会二次改动。
 * 用法：node scripts/repairDirtyChoiceAndBoxes.mjs [--apply] [--task <taskId>]
 */
import 'dotenv/config'
import pg from 'pg'
import fs from 'node:fs/promises'
import { judgeAnswer, normalizeChoiceAnswer, extractChoiceLetters, normalizeQuestionType } from '../services/judgeService.js'
import { normalizeBlockBoxSemantics } from '../worker.js'

const APPLY = process.argv.includes('--apply')
const taskArg = process.argv.indexOf('--task')
const ONLY_TASK = taskArg >= 0 ? process.argv[taskArg + 1] : null

const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})
const q = (t, p) => pool.query(t, p).then(r => r.rows)

const stripMd = (s) => String(s ?? '').replace(/[*~`]/g, '').replace(/\s+/g, ' ').trim()

const rows = await q(
  `SELECT id, task_id, page_number, question_number, question_type, options, answer,
          student_answer, is_correct, block_coordinates
   FROM questions
   WHERE deleted_at IS NULL ${ONLY_TASK ? 'AND task_id = $1' : ''}
   ORDER BY task_id, page_number NULLS FIRST, question_number NULLS LAST`,
  ONLY_TASK ? [ONLY_TASK] : []
)
console.log(`${APPLY ? '🛠  APPLY' : '🔍 DRY-RUN'} — 扫描 ${rows.length} 道题${ONLY_TASK ? `（任务 ${ONLY_TASK}）` : ''}\n`)

// ── 1. 脏参考答案 → 清 markdown + 只把「错判为错」的救回来 ──
// 有意保守：is_correct 从 null（待人工复核）改成 false 不在本次修复范围，
// 那属于把人工判断从队列里抹掉，应由老师定；这里只清文本 + 救回选对却判错的。
const answerFixes = []
for (const r of rows) {
  const type = normalizeQuestionType(r.question_type, r.options || [])
  if (type !== 'choice') continue
  if (!r.answer) continue
  // 只挑「严格字母归一失败、但能提取出选项字母」的脏答案，避免误伤正常答案
  if (normalizeChoiceAnswer(r.answer)) continue
  if (!extractChoiceLetters(r.answer)) continue

  const cleanAnswer = stripMd(r.answer)
  const rejudged = judgeAnswer(r.student_answer, cleanAnswer, r.question_type).isCorrect
  const rescue = r.is_correct === false && rejudged === true
  if (cleanAnswer === r.answer && !rescue) continue
  answerFixes.push({ ...r, cleanAnswer, rescue, rejudged })
}

console.log(`── 脏选择题参考答案: ${answerFixes.length} 处 ──`)
for (const f of answerFixes) {
  const verdict = f.rescue
    ? `  判分 false → true（选对却判错，救回）`
    : `  判分保持 ${f.is_correct}（重判得 ${f.rejudged}，不在本次修复范围）`
  console.log(`  任务 ${String(f.task_id).slice(0, 8)} 第${f.question_number}题  学生=${JSON.stringify(f.student_answer)}`)
  console.log(`    答案 ${JSON.stringify(f.answer)} → ${JSON.stringify(f.cleanAnswer)}${verdict}`)
}

// 判对了却还挂在错题本里的，要摘掉
const flipped = answerFixes.filter(f => f.rescue).map(f => f.id)
let staleWrong = []
if (flipped.length) {
  staleWrong = await q(
    `SELECT wq.id, wq.question_id, wq.status FROM wrong_questions wq WHERE wq.question_id = ANY($1::uuid[])`,
    [flipped]
  )
  console.log(`  其中 ${flipped.length} 道由错判正，错题本残留 ${staleWrong.length} 条`)
}

// ── 2. 角点形态坐标 → 整页换算 ──
const pages = new Map()
for (const r of rows) {
  if (!r.block_coordinates) continue
  const key = `${r.task_id}|${r.page_number ?? 'null'}`
  if (!pages.has(key)) pages.set(key, [])
  pages.get(key).push(r)
}
const boxFixes = []
const pageReasons = []
for (const [key, pageRows] of pages) {
  const before = pageRows.map(r => JSON.stringify(r.block_coordinates))
  const probes = pageRows.map(r => ({ block_coordinates: { ...r.block_coordinates } }))
  normalizeBlockBoxSemantics(probes)
  const changed = probes.filter((p, i) => JSON.stringify(p.block_coordinates) !== before[i])
  if (changed.length === 0) continue
  // 复述触发信号，便于人工核对没有被弱证据带偏
  const bs = pageRows.map(r => r.block_coordinates).map(b => ({ x: +b.x, y: +b.y, w: +b.width, h: +b.height }))
  const overflow = bs.filter(b => b.x + b.w > 1000 || b.y + b.h > 1000).length
  const sorted = [...bs].sort((a, b) => a.y - b.y)
  let chained = 0
  for (let i = 0; i + 1 < sorted.length; i++) if (Math.abs(sorted[i].h - sorted[i + 1].y) <= 2) chained++
  pageReasons.push(`${key.slice(0, 8)}…页${key.split('|')[1]}: ${pageRows.length}题 越界${overflow}个 链式${chained}/${Math.max(0, sorted.length - 1)}`)
  probes.forEach((p, i) => {
    if (JSON.stringify(p.block_coordinates) !== before[i]) {
      boxFixes.push({ row: pageRows[i], key, box: p.block_coordinates })
    }
  })
}
console.log(`\n── 角点形态坐标: ${boxFixes.length} 处（${new Set(boxFixes.map(b => b.key)).size}/${pages.size} 页命中）──`)
for (const r of pageReasons) console.log('  信号 ' + r)
for (const b of boxFixes.slice(0, 6)) {
  console.log(`  任务 ${String(b.row.task_id).slice(0, 8)} 页${b.row.page_number} 第${b.row.question_number}题  ` +
    `${JSON.stringify(b.row.block_coordinates)} → ${JSON.stringify(b.box)}`)
}
if (boxFixes.length > 6) console.log(`  …其余 ${boxFixes.length - 6} 处同理`)

// ── 3. 答案库 markdown 残留（避免重判时又被脏答案覆盖）──
const libDirty = await q(
  `SELECT id, question_no, sub_no, answer FROM resource_answers WHERE answer ~ '[*~]' LIMIT 200`)
console.log(`\n── 答案库 markdown 残留: ${libDirty.length} 条 ──`)
for (const a of libDirty.slice(0, 8)) {
  console.log(`  #${a.question_no}${a.sub_no ? '(' + a.sub_no + ')' : ''} ${JSON.stringify(a.answer)} → ${JSON.stringify(stripMd(a.answer))}`)
}

if (!APPLY) {
  console.log('\n（dry-run，未写库。确认无误后加 --apply）')
  await pool.end()
  process.exit(0)
}

// ── 落库 ──
// 坐标覆盖后原值不可再推导，先落一份回滚快照
const backup = {
  at: new Date().toISOString(),
  answers: answerFixes.map(f => ({ id: f.id, answer: f.answer, is_correct: f.is_correct })),
  boxes: boxFixes.map(b => ({ id: b.row.id, block_coordinates: b.row.block_coordinates })),
  library: libDirty.map(a => ({ id: a.id, answer: a.answer })),
  wrong_questions: staleWrong,
}
const backupPath = new URL(`./logs/repair-backup-${Date.now()}.json`, import.meta.url)
await fs.mkdir(new URL('./logs/', import.meta.url), { recursive: true })
await fs.writeFile(backupPath, JSON.stringify(backup, null, 1), 'utf8')
console.log(`\n💾 回滚快照: ${backupPath.pathname}`)

const client = await pool.connect()
try {
  await client.query('BEGIN')
  for (const f of answerFixes) {
    if (f.rescue) {
      await client.query(`UPDATE questions SET answer = $2, is_correct = true, updated_at = NOW() WHERE id = $1`,
        [f.id, f.cleanAnswer])
    } else if (f.cleanAnswer !== f.answer) {
      await client.query(`UPDATE questions SET answer = $2, updated_at = NOW() WHERE id = $1`,
        [f.id, f.cleanAnswer])
    }
  }
  if (staleWrong.length) {
    await client.query(`DELETE FROM wrong_questions WHERE id = ANY($1::uuid[])`, [staleWrong.map(w => w.id)])
  }
  for (const b of boxFixes) {
    await client.query(`UPDATE questions SET block_coordinates = $2, updated_at = NOW() WHERE id = $1`,
      [b.row.id, JSON.stringify(b.box)])
  }
  for (const a of libDirty) {
    const cleaned = stripMd(a.answer)
    if (cleaned !== a.answer) {
      await client.query(`UPDATE resource_answers SET answer = $2 WHERE id = $1`, [a.id, cleaned])
    }
  }
  await client.query('COMMIT')
  console.log(`\n✅ 已提交：答案 ${answerFixes.length} 处、错题本清理 ${staleWrong.length} 条、坐标 ${boxFixes.length} 处、答案库 ${libDirty.length} 条`)
} catch (e) {
  await client.query('ROLLBACK')
  console.error('\n❌ 已回滚：', e.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
