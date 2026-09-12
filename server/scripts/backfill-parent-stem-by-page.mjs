/**
 * backfill-parent-stem-by-page.mjs — 整页重识别回填 parent_stem（第二策略）
 *
 * 为什么需要它（2026-09-12）：
 *   第一策略（backfill-parent-stem.mjs）用"区域裁剪 + 单次转录"，依赖
 *   questions.block_coordinates 的几何精度。实测该字段质量参差（同一大题相邻小问的框
 *   会互相重叠、有的小问行高仅 30‰），导致 60% 的组裁剪带落空 → 模型返回空。
 *   但**页图一直可用**：整页重新识别一次，上下文完整，且新提示词已要求输出
 *   parent_stem，再用「现有小问题干」做锚点匹配回填，可靠性远高于区域裁剪。
 *
 * 匹配口径（关键）：不靠题号（OCR 题号可能错位），而是拿库里已有的 content 做锚点，
 *   与整页 OCR 结果的 content 做归一化相似度匹配，取对应条目的 parent_stem。
 *
 * 用法（在 server/ 目录）：
 *   node scripts/backfill-parent-stem-by-page.mjs                 # dry-run
 *   node scripts/backfill-parent-stem-by-page.mjs --limit 3       # 只处理 3 页
 *   node scripts/backfill-parent-stem-by-page.mjs --apply         # 写入（带 JSON 快照）
 *
 * 质量：noBackup=true 锁主力视觉模型（弱模型降级会污染题干，参考 2026-09-09 答案库事故）。
 * 写入范围：仅 UPDATE questions.parent_stem（展示字段），可随时清空回滚。
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })

import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import sharp from 'sharp'
import { callVisionCompletion } from '../config/ai.js'

const APPLY = process.argv.includes('--apply')
const limitIdx = process.argv.indexOf('--limit')
const LIMIT = limitIdx > -1 ? parseInt(process.argv[limitIdx + 1], 10) || 0 : 0

const SUB_HEAD_RE = /^[（(]\s*([0-9１-９一二三四五六七八九]{1,2})\s*[)）]/
const SUSPECT_TAIL = /[，,；;：:、=＝]$|[当的和或在为时若则此求交即得是有与及等]$/
// 页标题/课时号形态（页眉，不是题干）：实测模型会把「课后练习 27.2(2)」当公共题干写进去
const PAGE_TITLE_LIKE_RE = /^(课后练习|堂堂练|同步练习|练习册|课后作业|第[一二三四五六七八九十百]{1,3}[章节]|试卷[①-⑩\d]?)/
const LESSON_NO_ONLY_RE = /^\d{1,2}\.\d{1,2}(\(\d{1,2}\))?$/

const stripCodeFence = (t) => String(t || '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/i, '').trim()

/** 归一化：用于锚点匹配（去掉一切格式差异） */
const norm = (s) => String(s || '')
  .normalize('NFKC')
  .replace(/[\s\u3000]+/g, '')
  .replace(/[，。；：、,.;:!！?？"'“”‘’()（）【】\[\]{}<>《》·—\-_~`|/\\]/g, '')
  .toLowerCase()

const commonPrefixLen = (a, b) => {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i] === b[i]) i++
  return i
}

/** 现有行 ↔ 整页 OCR 条目的匹配分（0-1） */
function scoreMatch(existing, ocr) {
  const a = norm(existing.content)
  const b = norm(ocr.content)
  if (!a || !b) return 0
  let s = commonPrefixLen(a, b) / Math.max(1, Math.min(a.length, b.length))
  if (a.includes(b) || b.includes(a)) s = Math.max(s, 0.85)
  if (existing.sub_no && ocr.sub_no != null && String(existing.sub_no) === String(ocr.sub_no)) s += 0.08
  return Math.min(s, 1)
}

const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

async function downloadImage(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

const PAGE_PROMPT = `你是专业的数学试卷OCR助手。图片是一页试卷/练习册（可能有手写作答与批改痕迹）。

【任务】逐题转录这一页的【印刷体题干】，并把含多个小问的大题按小问拆开输出。

对每一道题输出一个对象：
{
  "question_number": 印刷体题号（阿拉伯数字；读不出填 null）,
  "sub_no": "若该题含多个小问(如(1)(2))填小问号 "1"/"2"…；否则填 null",
  "parent_stem": "多小问大题填【第一个小问标号(1)之前的公共题干原文】（公共已知条件、公共图形文字描述、公共设问前提）；没有小问或没有公共题干填 null",
  "content": "该小问自己的题干原文（含 (1)(2) 标号与文字）；整题的题则填整题题干"
}

严格要求：
1. 只转录【印刷体】，绝不把学生手写答案、老师红笔批改当题干。
2. parent_stem 必须逐字完整转录，不得改写、不得省略；公共题干跨多行（含图形说明、表格、"其中…"补充条件）必须完整并入。
3. 同一大题拆出的各小问，parent_stem 必须逐字相同。
4. content 不要重复 parent_stem 里已有的内容。
5. 数学式完整准确：分数用 a/b、乘号 ×、除号 ÷、根号 √、平方 ² 原样保留；
   区分乘号 × 与未知数 x；模糊处用 □ 占位，禁止臆造。
6. 漏识别某题没关系，绝对不要编造题目。

只输出 JSON 对象，不要其他文字：
{ "questions": [ { "question_number": 10, "sub_no": "1", "parent_stem": "…", "content": "…" } ] }`

async function ocrPage(imageUrl) {
  const buf = await downloadImage(imageUrl)
  const compressed = await sharp(buf)
    .rotate()
    .resize(1800, 1800, { fit: 'inside' })
    .jpeg({ quality: 90 })
    .toBuffer()
  const { content } = await callVisionCompletion({
    imageDataURL: `data:image/jpeg;base64,${compressed.toString('base64')}`,
    systemPrompt: PAGE_PROMPT,
    userText: '请逐题转录本页印刷体题干，多小问大题务必给出 parent_stem。',
    temperature: 0.05,
    maxTokens: 8192,
    noBackup: true
  })
  if (!content) return { error: '视觉模型返回为空' }
  let parsed
  try {
    parsed = JSON.parse(stripCodeFence(content))
  } catch (e) {
    return { error: `JSON 解析失败: ${e.message}` }
  }
  const list = Array.isArray(parsed?.questions) ? parsed.questions : []
  return { questions: list }
}

async function main() {
  // 待修页：含 content 以小问标号开头且 parent_stem 为空的行。
  // 页级预筛：只处理「有小问依赖公共条件才能作答」的页（应用题/几何题/函数题），
  // 纯计算题的 (1)(2) 本来就独立可作答，重新识别只会返回"6、计算："这类无意义结果。
  const { rows: pages } = await pool.query(`
    SELECT DISTINCT q.task_id, q.page_number,
           count(*) OVER (PARTITION BY q.task_id, q.page_number) AS pending_rows
    FROM questions q
    WHERE q.parent_stem IS NULL
      AND q.page_number IS NOT NULL
      AND btrim(coalesce(q.content,'')) ~ '^[（(]\\s*[0-9１-９一二三四五六七八九]{1,2}\\s*[)）]'
      AND btrim(coalesce(q.content,'')) ~ '(求|证明|求证|判断|说明|指出|探究|面积|周长|表达式|解析式|顶点|对称轴|抛物线|函数|图像|图象|如图|已知|取值范围|坐标|关系|条件)'
    ORDER BY q.task_id, q.page_number
  `)

  console.log(`待修页: ${pages.length} 页${LIMIT ? `（本次处理前 ${Math.min(LIMIT, pages.length)} 页）` : ''}`)
  if (pages.length === 0) { await pool.end(); return }
  const selected = LIMIT ? pages.slice(0, LIMIT) : pages

  const results = []
  let pageOk = 0, rowFilled = 0, rowRejected = 0, pageError = 0

  for (const p of selected) {
    const label = `task=${String(p.task_id).slice(0, 8)} p${p.page_number}`
    const { rows: taskRows } = await pool.query(
      `SELECT images, image_url, original_name FROM tasks WHERE id = $1`, [p.task_id]
    )
    const pageNameNorm = norm(taskRows[0]?.original_name || '')
    let images = taskRows[0]?.images
    if (typeof images === 'string') { try { images = JSON.parse(images) } catch { images = null } }
    const pageImg = Array.isArray(images) && images[p.page_number - 1]?.image_url
      ? images[p.page_number - 1].image_url
      : taskRows[0]?.image_url
    if (!pageImg) { pageError++; console.log(`❌ ${label}: 无页图`); continue }

    // 该页待修行（含同页其他题行，用于撞车校验）
    const { rows: pending } = await pool.query(`
      SELECT id, question_number AS qno, sub_no, btrim(coalesce(content,'')) AS content
      FROM questions
      WHERE task_id = $1 AND page_number = $2 AND parent_stem IS NULL
        AND btrim(coalesce(content,'')) ~ '^[（(]\\s*[0-9１-９一二三四五六七八九]{1,2}\\s*[)）]'
    `, [p.task_id, p.page_number])
    if (pending.length === 0) continue

    const { questions: ocrList, error } = await ocrPage(pageImg)
    if (error) { pageError++; console.log(`❌ ${label}: ${error}`); continue }

    // 建立锚点匹配
    const assignments = new Map() // groupKey -> { stem, ids: [] }
    for (const row of pending) {
      let best = null, bestScore = 0
      for (const ocr of ocrList) {
        const s = scoreMatch(row, ocr)
        if (s > bestScore) { bestScore = s; best = ocr }
      }
      const stemRaw = best && typeof best.parent_stem === 'string' ? best.parent_stem.trim() : ''
      const reasons = []
      if (!best || bestScore < 0.55) reasons.push(`锚点未命中(最高分 ${bestScore.toFixed(2)})`)
      if (!stemRaw) reasons.push('该条目无 parent_stem')
      const stem = stemRaw.replace(/^\s*\d{1,2}\s*[.、．:：,，]?\s*/, '').trim()
      // 空 stem 必须无条件拒绝 —— 早期版本写成 `if (stem && …)`，空串会绕过所有检查直接写库
      // （2026-09-12 实测 3 组 9 行被写成空字符串，等于把条件清空，比不填更糟）。
      if (!stem) {
        reasons.push('公共题干为空')
      } else {
        if (stem.length < 8) reasons.push(`过短(${stem.length}字)`)
        if (stem.length > 300) reasons.push(`过长(${stem.length}字)`)
        if (SUB_HEAD_RE.test(stem)) reasons.push('以小问标号开头')
        if (SUSPECT_TAIL.test(stem)) reasons.push('结尾悬空')
        // 页标题闸：模型偶尔把页眉/课时号当公共题干（实测「课后练习 27.2(2)」被写进 6 组）。
        // 判据：短文本 + 命中课时号/栏目形态，或与任务卷名归一化后互相包含。
        if (PAGE_TITLE_LIKE_RE.test(stem)) reasons.push('像页标题/课时号，不是公共题干')
        if (LESSON_NO_ONLY_RE.test(stem)) reasons.push('整条只是课时号，不是公共题干')
        if (!reasons.length && pageNameNorm && stem.length <= 24 && pageNameNorm.includes(norm(stem))) {
          reasons.push('与卷名重合（疑页标题）')
        }
        if (!/[\u4e00-\u9fff0-9]/.test(stem)) reasons.push('无有效文字')
      }

      if (reasons.length) {
        rowRejected++
        results.push({ label, qno: row.qno, sub: row.sub_no, ok: false, reason: reasons.join(';'), content: row.content.slice(0, 40) })
        console.log(`   ⛔ ${label} Q${row.qno}(${row.sub_no || '-'}): ${reasons.join('; ')}`)
        continue
      }
      const gkey = `${p.task_id}|${p.page_number}|${row.qno}`
      if (!assignments.has(gkey)) assignments.set(gkey, { stem, ids: [] })
      assignments.get(gkey).ids.push(row.id)
    }

    // 同组几何冲突保护：同一 (页, 题号) 若被匹配到**不同** stem，说明锚点不可靠 → 放弃该组
    const conflictGroups = new Set()
    const stemByGroup = new Map()
    for (const row of pending) {
      const gkey = `${p.task_id}|${p.page_number}|${row.qno}`
      const a = assignments.get(gkey)
      if (!a) continue
      if (stemByGroup.has(gkey) && stemByGroup.get(gkey) !== a.stem) conflictGroups.add(gkey)
      else stemByGroup.set(gkey, a.stem)
    }

    let filledThisPage = 0
    // 组内继承：同一 (页, 题号) 就是同一道大题（题号在页内唯一），只要组内任一小问
    // 匹配成功，其余小问直接继承该公共题干——比逐行单独匹配可靠得多
    // （小问文本越短越容易匹配失败，如 "(2)点B的坐标;" 仅 8 字）。
    let inherited = 0
    for (const row of pending) {
      const gkey = `${p.task_id}|${p.page_number}|${row.qno}`
      const a = assignments.get(gkey)
      if (!a || a.ids.includes(row.id)) continue
      a.ids.push(row.id)
      inherited++
    }
    for (const [gkey, a] of assignments) {
      if (conflictGroups.has(gkey)) { console.log(`   ⛔ ${label} Q${gkey.split('|')[2]}: 同组匹配到不同 stem，放弃`); continue }
      rowFilled += a.ids.length
      filledThisPage += a.ids.length
      results.push({ label, gkey, ok: true, stem: a.stem, ids: a.ids })
      console.log(`   ✅ ${label} Q${gkey.split('|')[2]}: "${a.stem.slice(0, 66)}"（${a.ids.length} 行）`)
    }
    if (inherited > 0) console.log(`   ↪️ ${label}: 组内继承补齐 ${inherited} 行`)
    if (filledThisPage > 0) pageOk++
    console.log(`   ── ${label}: OCR ${ocrList.length} 条 / 待修 ${pending.length} 行 → 回填 ${filledThisPage} 行`)
  }

  console.log(`\n──── 汇总 ────`)
  console.log(`页: 成功 ${pageOk} / 失败 ${pageError}（共 ${selected.length}）`)
  console.log(`行: 回填 ${rowFilled} / 拒绝 ${rowRejected}`)

  if (APPLY && rowFilled > 0) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const dir = 'D:/Minxue_App_V3/server/backups'
    fs.mkdirSync(dir, { recursive: true })
    const snap = path.join(dir, `parent-stem-bypage-${ts}.json`)
    fs.writeFileSync(snap, JSON.stringify({ at: new Date().toISOString(), results }, null, 2), 'utf8')
    console.log(`📦 快照: ${snap}`)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const r of results) {
        if (!r.ok) continue
        await client.query(`UPDATE questions SET parent_stem = $1, updated_at = NOW() WHERE id = ANY($2::uuid[])`, [r.stem, r.ids])
      }
      await client.query('COMMIT')
      console.log(`✅ 已写入 ${rowFilled} 行 parent_stem`)
    } catch (e) {
      await client.query('ROLLBACK')
      console.error(`❌ 写库失败已回滚: ${e.message}`)
      process.exitCode = 1
    } finally { client.release() }
  } else if (!APPLY) {
    console.log('（dry-run，未写库；确认后加 --apply）')
  }
  await pool.end()
}

main().catch(async (e) => { console.error('脚本异常:', e); try { await pool.end() } catch {}; process.exit(1) })
