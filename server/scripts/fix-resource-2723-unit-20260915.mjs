/**
 * 修复《九上上海作业答案》27.2(3) 单元被吞事故（2026-09-15）
 *
 * 事故：
 *   PDF 第 3 页中部印着单元标题「27.2(3) 形如 y=a(x+m)² 的二次函数的图像与性质」，
 *   其下是该单元题 1~12 的答案。但 OCR 把编号读成 "27. 2(3)" 形态，
 *   parseUnitHeader 漏识别 → 整行降级成「题号 27 的答案」→ 27.2(3) 的内容
 *   被并进上一个单元 27.2(2)。两课时题号都从 1 开始 → 同号互相覆盖，
 *   连锚定本来正确的 27.2(2) 卷也被误判。
 *
 * 本脚本：
 *   A. 新建 resource_units 27.2(3)（unit_seq=6，正好是缺失的那个序号）
 *   B. 把实际属于 27.2(3) 的 17 条答案迁过去
 *   C. 删除垃圾记录（question_no=27 的"答案"其实是 27.2(3) 的标题）
 *   D. 补回 27.2(2) 被覆盖掉的题 1/2/3/5/6（值取自 PDF 第 2 页）
 *
 * 用法：
 *   node server/scripts/fix-resource-2723-unit-20260915.mjs            # dry-run
 *   node server/scripts/fix-resource-2723-unit-20260915.mjs --apply    # 执行
 *   node server/scripts/fix-resource-2723-unit-20260915.mjs --rollback # 回滚
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import pg from 'pg'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'

const WS = 'f8cf5d96-d01c-4450-b752-38c3658b01a8'
const APPLY = process.argv.includes('--apply')
const ROLLBACK = process.argv.includes('--rollback')
const BACKUP = 'D:/Minxue_App_V3/server/backups/fix-resource-2723-20260915.json'

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const q = async (s, p) => (await pool.query(s, p)).rows

// 实际属于 27.2(3) 的记录（按 PDF 第 3 页逐条对照确定）
const MOVE_TO_2723 = [
  [1, ''], [2, ''], [3, ''], [4, ''], [5, ''], [6, ''],
  [8, '1'], [8, '2'], [8, '3'], [8, '4'],
  [9, ''],
  [10, '1'], [10, '2'], [10, '3'],
  [11, '1'], [11, '2'],
  [12, ''],
]
// 27.2(2) 被同号覆盖掉的题（值取自 PDF 第 2 页底部 "1.A 2.D 3.2 1" 与右栏 "5.D 6.B"）
const RESTORE_2722 = [
  { no: 1, sub: '', answer: 'A', type: 'choice' },
  { no: 2, sub: '', answer: 'D', type: 'choice' },
  { no: 3, sub: '', answer: '2, 1', type: 'fill' },
  { no: 5, sub: '', answer: 'D', type: 'choice' },
  { no: 6, sub: '', answer: 'B', type: 'choice' },
]

const unitsOf = async () => q(
  `SELECT id, unit_key, unit_seq, lesson_code, unit_title FROM resource_units
   WHERE resource_id=$1::uuid AND unit_key LIKE '27.2%' ORDER BY unit_seq`, [WS])

if (ROLLBACK) {
  if (!existsSync(BACKUP)) { console.error('❌ 找不到备份文件，无法回滚:', BACKUP); process.exit(1) }
  const bk = JSON.parse(readFileSync(BACKUP, 'utf8'))
  console.log(`回滚：将删除 unit ${bk.newUnitId}，还原 ${bk.moved.length} 条 unit_id，删除 ${bk.insertedIds.length} 条新增`)
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    for (const m of bk.moved) await c.query(`UPDATE resource_answers SET unit_id=$1 WHERE id=$2`, [m.unit_id, m.id])
    if (bk.insertedIds.length) await c.query(`DELETE FROM resource_answers WHERE id = ANY($1::uuid[])`, [bk.insertedIds])
    if (bk.deletedRow) {
      await c.query(
        `INSERT INTO resource_answers (id, resource_id, unit_id, question_no, sub_no, answer, answer_type, answer_status, source, confidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [bk.deletedRow.id, bk.deletedRow.resource_id, bk.deletedRow.unit_id, bk.deletedRow.question_no,
         bk.deletedRow.sub_no, bk.deletedRow.answer, bk.deletedRow.answer_type, bk.deletedRow.answer_status,
         bk.deletedRow.source, bk.deletedRow.confidence])
    }
    await c.query(`DELETE FROM resource_units WHERE id=$1`, [bk.newUnitId])
    await c.query('COMMIT')
    console.log('✅ 回滚完成')
  } catch (e) { await c.query('ROLLBACK'); console.error('❌ 回滚失败:', e.message) }
  finally { c.release() }
  await pool.end(); process.exit(0)
}

console.log('\n===== 0. 现状 =====')
console.table(await unitsOf())

const existing2723 = await q(
  `SELECT id FROM resource_units WHERE resource_id=$1::uuid AND unit_key='27.2(3)'`, [WS])
if (existing2723.length) {
  console.error('❌ 27.2(3) 单元已存在，脚本可能已执行过。要重跑请先 --rollback。')
  await pool.end(); process.exit(1)
}

const U2722 = (await unitsOf()).find(u => u.unit_key === '27.2(2)')
if (!U2722) { console.error('❌ 找不到 27.2(2) 单元'); await pool.end(); process.exit(1) }

console.log('\n===== 1. 将迁移到 27.2(3) 的记录（按 PDF P3 逐条核对）=====')
const toMove = []
for (const [no, sub] of MOVE_TO_2723) {
  const r = await q(
    `SELECT id, question_no, sub_no, answer_type, left(regexp_replace(coalesce(answer,''),'\\s+',' ','g'), 54) AS answer
     FROM resource_answers WHERE resource_id=$1::uuid AND unit_id=$2 AND question_no::text=$3 AND coalesce(sub_no,'')=$4`,
    [WS, U2722.id, String(no), sub])
  if (!r.length) { console.log(`  ⚠️ 未找到 题${no}(${sub || '整题'})，跳过`); continue }
  if (r.length > 1) { console.error(`  ❌ 题${no}(${sub}) 命中 ${r.length} 条，无法唯一定位，中止`); await pool.end(); process.exit(1) }
  toMove.push(r[0])
  console.log(`  题${no}(${sub || '整题'})  ${r[0].answer}`)
}
console.log(`  合计 ${toMove.length} 条（期望 17）`)

console.log('\n===== 2. 垃圾记录（其"答案"其实是 27.2(3) 的标题）=====')
const junk = await q(
  `SELECT id, question_no, sub_no, answer, answer_type, answer_status, source, confidence
   FROM resource_answers WHERE resource_id=$1::uuid AND unit_id=$2 AND question_no::text='27'`,
  [WS, U2722.id])
console.table(junk.map(j => ({ no: j.question_no, answer: j.answer })))

console.log('\n===== 3. 要补回的 27.2(2) 被覆盖答案（取自 PDF P2）=====')
console.table(RESTORE_2722)

if (!APPLY) {
  console.log('\n-- dry-run：以上为计划。确认无误后加 --apply 执行。')
  await pool.end(); process.exit(0)
}

// ── 执行 ──
const c = await pool.connect()
try {
  await c.query('BEGIN')

  // A. 新建 27.2(3) 单元
  const unitRow = (await c.query(
    `INSERT INTO resource_units (resource_id, unit_key, unit_title, unit_seq, lesson_code)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [WS, '27.2(3)', '27.2(3)形如y=a(x+m)²的二次函数的图像与性质', 6, '27.2(3)'])).rows[0]
  console.log(`\n✅ 新建单元 27.2(3) id=${unitRow.id}`)

  // B. 迁移
  for (const r of toMove) {
    await c.query(`UPDATE resource_answers SET unit_id=$1, updated_at=NOW() WHERE id=$2`, [unitRow.id, r.id])
  }
  console.log(`✅ 迁移 ${toMove.length} 条答案到 27.2(3)`)

  // C. 删垃圾
  if (junk.length) {
    await c.query(`DELETE FROM resource_answers WHERE id = ANY($1::uuid[])`, [junk.map(j => j.id)])
    console.log(`✅ 删除垃圾记录 ${junk.length} 条`)
  }

  // D. 补回 27.2(2) 被覆盖的答案
  const insertedIds = []
  for (const item of RESTORE_2722) {
    const row = (await c.query(
      `INSERT INTO resource_answers
         (resource_id, unit_id, question_no, sub_no, answer, answer_type, answer_status, source, confidence)
       VALUES ($1,$2,$3,$4,$5,$6,'official_verified','manual_backfill',1.0) RETURNING id`,
      [WS, U2722.id, String(item.no), item.sub, item.answer, item.type])).rows[0]
    insertedIds.push(row.id)
  }
  console.log(`✅ 补回 27.2(2) 被覆盖答案 ${insertedIds.length} 条`)

  await c.query('COMMIT')

  mkdirSync('D:/Minxue_App_V3/server/backups', { recursive: true })
  writeFileSync(BACKUP, JSON.stringify({
    createdAt: new Date().toISOString(),
    resourceId: WS,
    newUnitId: unitRow.id,
    moved: toMove.map(r => ({ id: r.id, unit_id: U2722.id, question_no: r.question_no, sub_no: r.sub_no })),
    deletedRow: junk[0] || null,
    insertedIds,
  }, null, 1))
  console.log(`\n✅ 备份已写入 ${BACKUP}（--rollback 可回滚）`)
} catch (e) {
  await c.query('ROLLBACK')
  console.error('\n❌ 执行失败，已回滚:', e.message)
} finally { c.release() }

console.log('\n===== 执行后 =====')
console.table(await unitsOf())
console.table(await q(
  `SELECT ru.unit_key, COUNT(*)::int AS 答案数 FROM resource_units ru
   JOIN resource_answers ra ON ra.unit_id=ru.id
   WHERE ru.resource_id=$1::uuid AND ru.unit_key LIKE '27.2%'
   GROUP BY 1 ORDER BY 1`, [WS]))

await pool.end()
