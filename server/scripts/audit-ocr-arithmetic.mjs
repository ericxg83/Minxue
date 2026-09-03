/**
 * 历史脏数据诊断：扫 questions 表，标记潜在"AI 算术幻觉"+"answer 串行污染"行。
 *
 * 背景（2026-09-02）：
 *   截图中 y=3(x-1)²+2 代入 x=6，AI 展开步骤全对、"最终答案为 83"实际应为 77。
 *   同一 prompt 还把学生手写答案污染进 answer 列。建 migration 053 + worker.js
 *   自检闸门后，新题会被自动标 ai_self_check_passed=false，但历史题是迁移前
 *   入库的，没有自检结果。本脚本只读扫盘，输出 CSV 给用户判断是否要批量人工
 *   复核 / 修正。**绝不自动改数据**（参考 feedback_dryrun_before_dedupe.md）。
 *
 * 用法：
 *   node scripts/audit-ocr-arithmetic.mjs            # 默认 dry-run
 *   node scripts/audit-ocr-arithmetic.mjs --output=audit.csv  # 同时写 CSV
 *
 * 输出 stdout 汇总 + 可选 CSV，每行格式：
 *   ws_id, question_no, answer, student_answer, issues, is_correct, ai_self_check_passed
 *
 * 跑完会汇总：
 *   - 总扫描行数
 *   - 潜在 serial_pollution N 条
 *   - 潜在 arithmetic_mismatch M 条
 *   - 两路都中招 K 条
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { Pool } from 'pg'
import { aiParseSelfCheck } from '../utils/aiParseSelfCheck.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })
process.env.DATABASE_URL = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL

const args = process.argv.slice(2)
const outputArg = args.find(a => a.startsWith('--output='))
const outputPath = outputArg ? outputArg.split('=')[1] : null
const APPLY = process.argv.includes('--apply')  // 占位：本脚本永远不写库，留作一致接口

if (!APPLY) {
  console.log('🔍 诊断模式（只读不写）。\n')
}

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2
})

const BATCH_SIZE = 500

async function main() {
  const start = Date.now()
  const counts = { total: 0, serial_pollution: 0, arithmetic_mismatch: 0, self_check_skipped: 0, answer_sign_mismatch: 0, multi: 0 }
  const csvLines = ['task_id,question_number,answer,student_answer,issues,is_correct,ai_self_check_passed']

  // 全表扫：OCR 阶段所有 question 都可能中招，is_correct 不是筛选条件
  // （串行污染常见于"AI 把学生答案当参考答案"，可能仍被判对，污染面更大）
  // 用真列名 task_id / question_number（dev DB 里没有 ws_id，且历史表
  // 没有 ai_self_check_* 列，所以这里每次都重算）
  const { rows: totalRows } = await pool.query(`SELECT COUNT(*)::int as n FROM questions`)
  const total = totalRows[0].n
  console.log(`📊 questions 表共 ${total} 行，batch=${BATCH_SIZE} 开扫...\n`)

  let lastId = null
  let scanned = 0
  while (true) {
    const { rows } = await pool.query(
      `SELECT id, task_id, question_number, answer, student_answer, analysis,
              is_correct
       FROM questions
       WHERE ($1::uuid IS NULL OR id > $1::uuid)
       ORDER BY id
       LIMIT $2`,
      [lastId, BATCH_SIZE]
    )
    if (rows.length === 0) break
    lastId = rows[rows.length - 1].id

    for (const r of rows) {
      counts.total += 1
      // 历史行（迁移 053 前入库）每次重算 —— 库里没有 ai_self_check_issues
      // 可读，只能跑 aiParseSelfCheck 现场抽
      const check = aiParseSelfCheck({
        answer: r.answer,
        student_answer: r.student_answer,
        analysis: r.analysis
      })
      const issues = check.pass ? [] : check.issues

      for (const issue of issues) {
        if (counts[issue] !== undefined) counts[issue] += 1
      }
      if (issues.length >= 2) counts.multi += 1

      if (issues.length > 0) {
        csvLines.push([
          r.task_id || '',
          r.question_number ?? '',
          csvEscape(r.answer),
          csvEscape(r.student_answer),
          issues.join('|'),
          r.is_correct === null ? '' : (r.is_correct ? 'true' : 'false'),
          ''
        ].join(','))
      }
    }

    scanned += rows.length
    process.stdout.write(`\r   扫描中: ${scanned}/${total}（${Math.round(scanned / total * 100)}%）`)
    if (rows.length < BATCH_SIZE) break
  }
  console.log('\n')

  console.log('━━━ 汇总 ━━━')
  console.log(`  扫描总行数:        ${counts.total}`)
  console.log(`  serial_pollution:  ${counts.serial_pollution}`)
  console.log(`  arithmetic_mismatch: ${counts.arithmetic_mismatch}`)
  console.log(`  self_check_skipped: ${counts.self_check_skipped}`)
  console.log(`  answer_sign_mismatch: ${counts.answer_sign_mismatch}`)
  console.log(`  多 issue 同时中招:  ${counts.multi}`)
  console.log(`  耗时:              ${((Date.now() - start) / 1000).toFixed(1)}s`)

  if (outputPath) {
    const fs = await import('fs')
    fs.writeFileSync(outputPath, csvLines.join('\n') + '\n', 'utf8')
    console.log(`\n📄 命中行已写到 ${outputPath}（${csvLines.length - 1} 条）`)
  } else {
    console.log('\n💡 想保存命中行加 --output=audit.csv')
  }

  console.log('\n⚠️  本脚本只读不写，不自动修正任何历史数据。')
  console.log('   拿到清单后由用户决定：(a) UI 批量复核；(b) 改用怎样的修正策略。')
}

function csvEscape(v) {
  if (v == null) return ''
  const s = String(v)
  if (/[,"\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

main().then(
  () => pool.end(),
  err => { console.error('❌ 失败:', err); pool.end(); process.exit(1) }
)
