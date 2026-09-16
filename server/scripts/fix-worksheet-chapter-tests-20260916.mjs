/**
 * 定向修复（2026-09-16）：答案册《八上数学_上海作业》被「章级测试卷标题漏识别」污染/覆盖的单元
 *
 * 事故（陈昊煜 0e1d4de7 等三份「第19章测试(一)」卷，参考答案全错）：
 *   PDF p5 末尾是「第19章测试(一)」的答案，p6 开头是它的续题 26/27，随后是
 *   「第 19 章测试 (二)」标题 + 测试(二) 的 1~25 题答案。
 *   旧解析器的章节标题正则不容忍「第」与数字/「章」之间的空白 →
 *   「第 19 章测试 (二)」整行不是标题 → 该页 1~25 题**继承上一个单元**（测试(一)）
 *   并按题号覆盖它 → 测试(一) 卷子批改时取到的全是测试(二) 的值。
 *   同一机制在「第21章测试(一)/(二)」重演（实测库里 21 章测试(一) 的值与
 *   重跑解析出的 21 章测试(二) 逐条吻合）。
 *
 * 代码侧根因已修（answerParseService.isSectionHeader 容忍空白 + 全角括号归一，
 * test/answerChapterHeader.test.mjs 锁定）。本脚本修**数据存量**：
 *   1) 目标 4 个单元：第19章测试(一)/(二)、第21章测试(一)/(二)
 *   2) 数据源：本次全册 OCR（_scan/c19/ocr_pages.json，生产同款提示词/noBackup）+ 修复后解析
 *   3) 跨栏续块归位：模型对双栏页会把右栏内容提到页首输出，故「页首无标题块」若与
 *      **本页某单元的题号恰好衔接**（max+1 == 块首题号），归该单元；否则维持"继承上一页单元"
 *
 * 用法：
 *   node server/scripts/fix-worksheet-chapter-tests-20260916.mjs --dry
 *   node server/scripts/fix-worksheet-chapter-tests-20260916.mjs --apply
 * 回滚：备份见 server/backups/worksheet-abf39957-reparse-*.json
 */
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import fs from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '..', '.env') })

const APPLY = process.argv.includes('--apply')
const WS = 'abf39957-20df-4584-a6c6-369bb4869cc9'
const OCR_JSON = 'D:/Minxue_App_V3/_scan/c19/ocr_pages.json'
const TARGETS = ['第19章测试(一)', '第19章测试(二)', '第21章测试(一)', '第21章测试(二)']

const { parseUnitHeader, parseAnswerText } = await import('../services/answerParseService.js')
const { upsertWorksheetAnswers } = await import('../services/neonService.js')

if (!fs.existsSync(OCR_JSON)) {
  console.error(`❌ 缺少 ${OCR_JSON}（先用 server/_diag_c19_full.mjs 抓全册 OCR）`)
  process.exit(1)
}
const ocrPages = JSON.parse(fs.readFileSync(OCR_JSON, 'utf8'))

/** 把一页文本切成「页首无标题块」与「其余（从第一个单元标题起）」 */
function splitLeadingBlock(text) {
  const lines = String(text || '').split('\n')
  const head = []
  let i = 0
  for (; i < lines.length; i++) {
    const t = lines[i].trim()
    if (!t) continue
    if (parseUnitHeader(t)) break
    head.push(lines[i])
  }
  return { head: head.join('\n'), rest: lines.slice(i).join('\n') }
}

// ── 解析全册，页首跨栏块按"题号衔接"归位 ──
const collected = new Map() // unit_key -> Map('q|sub' -> answer row)
const stats = []
let carry = null

/** 某单元已收集答案里的最大题号 */
function maxQOf(m) {
  let max = 0
  for (const a of m.values()) max = Math.max(max, Number(a.question_no) || 0)
  return max
}

for (let page = 1; page <= 56; page++) {
  const raw = ocrPages[String(page)] || ''
  const { head, rest } = splitLeadingBlock(raw)
  // 页首块的默认归属 = **上一页遗留单元**（解析器原有行为，最保守）
  const prevCarryUnit = carry?.unit?.unit_key ?? null
  const parsedRest = parseAnswerText(rest, [], carry, page)
  const curCarry = parsedRest.lastState
  const rows = [...parsedRest.answers]

  if (head.trim()) {
    // 用上一页的 carry 解析页首块：续行（"(2) ..."）才能正确归并进它上面的整题答案，
    // 否则会被 splitInlineAnswers 误拆成新题号（实测把 "(2) 1、2、3" 拆成 q2）。
    const parsedHead = parseAnswerText(head, [], carry, page)
    const headRows = parsedHead.answers
    const headInts = headRows.map(a => Number(a.question_no)).filter(Number.isFinite)
    const headMin = headInts.length ? Math.min(...headInts) : null

    // 跨栏续块归位：模型对双栏页会把右栏内容提到页首输出，此时"上一页遗留单元"是错的。
    // 判据：本块起始题号 == 某单元已有最大题号 + 1（严格衔接）。
    // 候选优先级：① 已累积（跨页连续，更可信）② 本页 rest 中出现的单元。
    let owner = null
    if (headMin != null) {
      for (const [k, m] of collected) {
        const max = maxQOf(m)
        if (max > 0 && max + 1 === headMin) { owner = k; break }
      }
      if (!owner) {
        const restMax = new Map()
        for (const a of rows) {
          if (!a.unit_key) continue
          restMax.set(a.unit_key, Math.max(restMax.get(a.unit_key) ?? 0, Number(a.question_no) || 0))
        }
        for (const [k, max] of restMax) {
          if (TARGETS.includes(k) && max + 1 === headMin) { owner = k; break }
        }
      }
    }
    stats.push(`p${page} 页首块 ${headRows.length} 条·首题号 ${headMin} → ${owner ? '归 ' + owner + '（跨栏续块，衔接 ' + (headMin - 1) + '）' : '保持继承 ' + (prevCarryUnit || '<null>')}`)
    // 过滤伪题号：页首块的续行（如 "(2) 1、2、3"）会被 splitInlineAnswers 误拆成新题号，
    // 若直接合并会**覆盖**目标单元已有的正确题号（实测把 测试(一) 的 2.A 改成 "、3$ (3)..."）。
    // 判据：① 相对**前一条已接受行**不得回退（回退的必是续行残片）；
    //       ② 不得落回目标单元已收集的题号区间内（同号已有更完整版本）。
    const targetUnit = owner ?? prevCarryUnit
    const alreadyMax = targetUnit && collected.has(targetUnit) ? maxQOf(collected.get(targetUnit)) : 0
    const dropped = []
    let prevAccepted = 0
    for (const a of headRows) {
      const q = Number(a.question_no)
      if (Number.isFinite(q)) {
        if (q < prevAccepted) { dropped.push(`${q}(逆序)`); continue }
        if (targetUnit && q <= alreadyMax) { dropped.push(`${q}(≤${targetUnit}已有${alreadyMax})`); continue }
        prevAccepted = q
      }
      rows.push({ ...a, unit_key: owner ?? a.unit_key ?? prevCarryUnit })
    }
    if (dropped.length) stats.push(`      ↳ 丢弃续行残片 ${dropped.join(', ')}`)
  }
  carry = curCarry

  for (const a of rows) {
    const k = a.unit_key
    if (!k || !TARGETS.includes(k)) continue
    if (!collected.has(k)) collected.set(k, new Map())
    collected.get(k).set(`${a.question_no}|${a.sub_no || ''}`, a)
  }
}

console.log('\n===== 页首跨栏块处理 =====')
for (const s of stats) console.log('  ' + s)

console.log('\n===== 待写入（修复后） =====')
for (const k of TARGETS) {
  const m = collected.get(k) || new Map()
  const qs = [...new Set([...m.values()].map(a => Number(a.question_no)))].filter(Number.isFinite).sort((a, b) => a - b)
  const max = qs[qs.length - 1]
  const missing = []
  for (let i = 1; i <= max; i++) if (!qs.includes(i)) missing.push(i)
  console.log(`${k.padEnd(16)} ${String(m.size).padStart(3)} 条  题号 ${qs[0]}..${max}${missing.length ? '  ⚠缺 ' + missing.join(',') : '  ✓连续'}`)
  for (const [key, a] of m) {
    const [q, sub] = key.split('|')
    console.log(`    ${q.padStart(2)}${sub ? '(' + sub + ')' : '   '}  ${String(a.answer || '').replace(/\n/g, ' ').slice(0, 72)}  [${a.answer_type}]`)
  }
}

if (!APPLY) {
  console.log('\n--dry 模式：未写入。确认无误后加 --apply')
  process.exit(0)
}

// ── 写入：先删目标单元的旧行，再按修复结果 upsert ──
const { Pool } = await import('pg')
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const del = await pool.query(`
  DELETE FROM resource_answers
  WHERE resource_id = $1::uuid
    AND unit_id IN (SELECT id FROM resource_units WHERE resource_id = $1::uuid AND unit_key = ANY($2::text[]))`,
[WS, TARGETS])
console.log(`\n已删除旧行 ${del.rowCount} 条`)

const payload = []
for (const k of TARGETS) {
  for (const a of (collected.get(k) || new Map()).values()) {
    payload.push({
      unit_key: k,
      question_no: a.question_no,
      sub_no: a.sub_no || '',
      answer: a.answer,
      answer_type: a.answer_type || 'answer',
      section: a.section || null,
      content: a.content || null,
    })
  }
}
const written = await upsertWorksheetAnswers(WS, payload)
console.log(`已写入 ${written.length} 行（目标 ${payload.length}）`)
await pool.end()
