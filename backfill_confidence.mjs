import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import dotenv from 'dotenv'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, 'server/.env') })
import { query } from './server/config/neon.js'

const APPLY = process.argv.includes('--apply')

const run = async () => {
  // ── Step 1: 检查 confidence 列是否存在 ──
  const { rows: cols } = await query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'questions' AND column_name = 'confidence'`
  )
  const columnExists = cols.length > 0

  if (!columnExists) {
    console.log('⚠️  confidence 列不存在，需要添加')
    if (APPLY) {
      await query(
        `ALTER TABLE questions ADD COLUMN confidence DECIMAL(3,2) DEFAULT 0.00`
      )
      console.log('✅  ALTER TABLE 添加 confidence 列成功')
    } else {
      console.log('    ALTER TABLE questions ADD COLUMN confidence DECIMAL(3,2) DEFAULT 0.00')
    }
  } else {
    console.log('✅  confidence 列已存在')
  }

  // ── Step 2: 统计分布 ──
  const { rows: breakdown } = await query(`
    SELECT
      answer_source,
      is_correct,
      CASE WHEN student_answer IS NOT NULL AND student_answer != '' THEN 'yes' ELSE 'no' END AS has_answer,
      COUNT(*) AS cnt
    FROM questions
    WHERE deleted_at IS NULL
    GROUP BY answer_source, is_correct, has_answer
    ORDER BY cnt DESC
  `)

  console.log('\n当前数据分布：')
  let total = 0
  for (const r of breakdown) {
    console.log(`  ${r.answer_source}  is_correct=${r.is_correct}  has_answer=${r.has_answer}  → ${r.cnt} 题`)
    total += parseInt(r.cnt)
  }
  console.log(`  总计 ${total} 题\n`)

  if (!APPLY) {
    console.log('DRY-RUN 模式 — 确认后执行： node backfill_confidence.mjs --apply')
    process.exit(0)
  }

  // ── Step 3: 批量回填 ──
  // 类别 A: AI 高置信度 — is_correct 明确且有 student_answer →
  //   confidence = 0.95（AI正确/AI错误）
  const { rowCount: updatedA } = await query(`
    UPDATE questions
    SET confidence = 0.95, updated_at = NOW()
    WHERE deleted_at IS NULL
      AND answer_source = 'recognized'
      AND student_answer IS NOT NULL AND student_answer != ''
      AND is_correct IS NOT NULL
      AND (confidence IS NULL OR confidence = 0)
  `)
  console.log(`✅  高置信度（is_correct 明确, 有答案）: ${updatedA} 题 → confidence=0.95`)

  // 类别 B: AI 不确定 — is_correct = null 但有 student_answer →
  //   confidence = 0.5（AI 能读但无法判断正误，待人工复核）
  const { rowCount: updatedB } = await query(`
    UPDATE questions
    SET confidence = 0.5, updated_at = NOW()
    WHERE deleted_at IS NULL
      AND answer_source = 'recognized'
      AND student_answer IS NOT NULL AND student_answer != ''
      AND is_correct IS NULL
      AND (confidence IS NULL OR confidence = 0)
  `)
  console.log(`✅  不确定（is_correct=null, 有答案）: ${updatedB} 题 → confidence=0.5`)

  // 类别 C: 未作答 — answer_source = 'blank' →
  //   保持 confidence=0（显示为 未作答/异常）
  const { rows: blanks } = await query(`
    SELECT COUNT(*) AS cnt FROM questions
    WHERE deleted_at IS NULL AND answer_source = 'blank'
  `)
  console.log(`✅  未作答（保持 confidence=0）: ${blanks[0].cnt} 题`)

  console.log('\n回填完成')
  process.exit(0)
}

run().catch(e => { console.error(e); process.exit(1) })
