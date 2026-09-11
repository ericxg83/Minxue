/**
 * backfill-parent-stem.mjs — 存量被拆小问行的 parent_stem / sub_no 回填
 *
 * 背景（2026-09-11 评审定稿）：迁移 057 加了 questions.parent_stem / sub_no，
 * 但存量被拆行（同一大题拆成多条、content 以 (1)(2) 开头、共享题干在采集层已丢）
 * 两列都是 NULL。本脚本用「原卷页图 + 区域重 OCR + 题干一致性校验」回填。
 *
 * ⚠️ 红线（来自 block_coordinates 质量实测）：block 只是「题干行」级框，直接外扩
 *    裁剪必然吃进邻题。所以本脚本：
 *      1) 裁剪带取【上一题 bottom 与本组 top 之间的空隙 + 本组首行上半部】，
 *         几何上恰好是共享题干所在行，而不是无脑外扩；
 *      2) VLM 只允许输出 (1) 标号之前的文字；
 *      3) 输出过四道校验闸，任一不过即拒绝（宁缺勿错）：
 *         长度闸 / 小问标号闸 / 垃圾文本闸 / 邻题撞车闸（归一化前缀与同页
 *         其他题行相同即视为裁剪误吃，拒绝）。
 *
 * 用法（在 server/ 目录下）：
 *   node scripts/backfill-parent-stem.mjs                # dry-run，只识别不写库
 *   node scripts/backfill-parent-stem.mjs --limit 6      # 只处理前 6 组（控制视觉模型费用）
 *   node scripts/backfill-parent-stem.mjs --apply        # 真实写入（先落 JSON 快照）
 *
 * 写入范围：仅 UPDATE questions.parent_stem / sub_no 两列（展示字段，不碰
 * content / answer / is_correct / 判题引擎），可随时整列清空回滚。
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })

import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import sharp from 'sharp'
import { callVisionCompletion } from '../config/ai.js'
import { normalizeStemForCompare } from '../utils/questionStem.js'

const APPLY = process.argv.includes('--apply')
const limitIdx = process.argv.indexOf('--limit')
const LIMIT = limitIdx > -1 ? parseInt(process.argv[limitIdx + 1], 10) || 0 : 0

const SUB_HEAD_RE = /^[（(]\s*([0-9１-９一二三四五六七八九]{1,2})\s*[)）]/
const SUB_MARKER_ANY_RE = /[（(]\s*\d{1,2}\s*[)）]/
const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

const toArabic = (s) => {
  const t = String(s || '').trim()
  if (/^\d+$/.test(t)) return String(parseInt(t, 10))
  if (CN_NUM[t]) return String(CN_NUM[t])
  return ''
}

const stripCodeFence = (text) =>
  String(text || '')
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/i, '')
    .trim()

const hasHanziOrDigit = (s) => /[\u4e00-\u9fff0-9a-zA-Z]/.test(String(s || ''))

const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

async function downloadImage(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/** 归一化 0-1000 block → 像素矩形（钳位） */
function blockToPx(block, imgW, imgH) {
  if (!block || typeof block !== 'object') return null
  const clamp = (v) => Math.max(0, Math.min(1000, Number(v) || 0))
  const x = clamp(block.x), y = clamp(block.y)
  const w = clamp(block.width), h = clamp(block.height)
  return {
    left: Math.round(x / 1000 * imgW),
    top: Math.round(y / 1000 * imgH),
    width: Math.round(w / 1000 * imgW),
    height: Math.round(h / 1000 * imgH)
  }
}

/** 邻题撞车闸：候选 stem 与同页其他题行归一化后互含或前 14 字相同 → 拒绝 */
function collidesWithNeighbors(stem, pageRows) {
  const ns = normalizeStemForCompare(stem)
  if (!ns) return true
  for (const row of pageRows) {
    const nc = normalizeStemForCompare(row.content)
    if (!nc) continue
    if (nc.includes(ns) || ns.includes(nc)) return true
    if (ns.slice(0, 14) && ns.slice(0, 14) === nc.slice(0, 14)) return true
  }
  return false
}

async function ocrCommonStem(imageUrl, band) {
  let imageBuffer
  try {
    imageBuffer = await downloadImage(imageUrl)
  } catch (e) {
    return { error: `图片下载失败: ${e.message}` }
  }
  const meta = await sharp(imageBuffer).metadata()
  const imgW = meta.width, imgH = meta.height
  if (!imgW || !imgH) return { error: '无法读取图片尺寸' }

  const px = blockToPx(band, imgW, imgH)
  if (!px || px.width < 20 || px.height < 10) return { error: '裁剪区域无效（过小）' }

  let cropped
  try {
    cropped = await sharp(imageBuffer)
      .rotate()
      .extract({ left: px.left, top: px.top, width: px.width, height: px.height })
      .resize(1800, 1800, { fit: 'inside' })
      .jpeg({ quality: 90 })
      .toBuffer()
  } catch (e) {
    return { error: `裁剪失败: ${e.message}` }
  }

  const prompt = `你是专业的数学试卷OCR助手。这张图片是从试卷上裁剪出的【一条水平区域】，
它位于某道多小问大题的第一个小问标号 (1) 附近。

【任务】逐字转录该大题的【公共题干原文】——即第一个小问标号 (1) 之前的公共已知条件文字（含公共图形文字描述、"其中…"补充条件），数学式必须完整准确。
- 分数用 a/b 格式，乘号 ×、除号 ÷、根号 √、平方 ²、小数点、百分号必须原样保留。
- 严格区分乘号 × 与未知数字母 x。
- 若区域内能看到 "(1)" 或 "（1）" 标号：只输出标号之前的文字，标号及其之后的内容一律不要。
- 若区域内没有 (1) 标号也没有公共题干（只有别的题的文字、答案或空白）：输出空字符串，不要编造。
- 印刷体模糊处用 □ 占位，禁止臆造。

只输出 JSON 对象，不要其他文字：
{
  "stem": "公共题干原文，没有则填空字符串"
}`

  try {
    const { content } = await callVisionCompletion({
      imageDataURL: `data:image/jpeg;base64,${cropped.toString('base64')}`,
      systemPrompt: prompt,
      userText: '请转录图中 (1) 标号之前的公共题干原文；没有就输出空字符串。',
      temperature: 0.05,
      maxTokens: 1024
    })
    if (!content) return { error: '视觉模型返回为空' }
    const parsed = JSON.parse(stripCodeFence(content))
    const stem = (parsed && typeof parsed === 'object') ? String(parsed.stem || '').trim() : ''
    return { stem }
  } catch (e) {
    return { error: `识别失败: ${e.message}` }
  }
}

async function main() {
  // ── 1. 候选组：同 task+页+题号 ≥2 行、≥2 行 content 以 (n) 开头、两列均为空 ──
  const { rows: groups } = await pool.query(`
    WITH cand AS (
      SELECT q.task_id, q.page_number, q.question_number AS qno,
             count(*) FILTER (
               WHERE btrim(coalesce(q.content,'')) ~ '^[（(]\\s*[0-9１-９一二三四五六七八九]{1,2}\\s*[)）]'
             ) AS sub_rows,
             count(*) AS total_rows
      FROM questions q
      WHERE q.parent_stem IS NULL AND q.sub_no IS NULL
        AND q.question_number IS NOT NULL AND q.page_number IS NOT NULL
      GROUP BY q.task_id, q.page_number, q.question_number
      HAVING count(*) FILTER (
               WHERE btrim(coalesce(q.content,'')) ~ '^[（(]\\s*[0-9１-９一二三四五六七八九]{1,2}\\s*[)）]'
             ) >= 2
    )
    SELECT c.task_id, c.page_number, c.qno, c.total_rows,
           jsonb_agg(jsonb_build_object(
             'id', q.id, 'content', btrim(coalesce(q.content,'')),
             'block', q.block_coordinates, 'sub', q.sub_no
           ) ORDER BY q.created_at) AS rows,
           t.images AS task_images, t.image_url AS task_image_url
    FROM cand c
    JOIN questions q ON q.task_id = c.task_id AND q.page_number = c.page_number AND q.question_number = c.qno
    JOIN tasks t ON t.id = c.task_id
    GROUP BY c.task_id, c.page_number, c.qno, c.total_rows, t.images, t.image_url
    ORDER BY c.task_id, c.page_number, c.qno
  `)

  console.log(`候选组: ${groups.length} 组${LIMIT ? `（本次处理前 ${Math.min(LIMIT, groups.length)} 组）` : ''}`)
  if (groups.length === 0) {
    await pool.end()
    return
  }

  const selected = LIMIT ? groups.slice(0, LIMIT) : groups
  const results = []
  let passCount = 0, rejectCount = 0, errorCount = 0

  for (const g of selected) {
    const label = `task=${g.task_id.slice(0, 8)} p${g.page_number} Q${g.qno}`
    // 页图：tasks.images 顺序即 1-based 页号
    let images = g.task_images
    if (typeof images === 'string') { try { images = JSON.parse(images) } catch { images = null } }
    const pageImg = Array.isArray(images) && images[g.page_number - 1]?.image_url
      ? images[g.page_number - 1].image_url
      : g.task_image_url
    if (!pageImg) {
      errorCount++
      results.push({ label, ok: false, reason: '无页图' })
      console.log(`❌ ${label}: 无页图`)
      continue
    }

    // 同页全部行（算上一题 bottom 用），含其他题号的行
    const { rows: pageRows } = await pool.query(`
      SELECT q.id, btrim(coalesce(q.content,'')) AS content, q.question_number, q.sub_no, q.block_coordinates
      FROM questions q
      WHERE q.task_id = $1 AND q.page_number = $2
    `, [g.task_id, g.page_number])

    const groupBlocks = g.rows.map(r => r.block).filter(b => b && typeof b === 'object')
    if (groupBlocks.length === 0) {
      errorCount++
      results.push({ label, ok: false, reason: '组内无 block_coordinates' })
      console.log(`❌ ${label}: 组内无 block_coordinates`)
      continue
    }
    const groupTop = Math.min(...groupBlocks.map(b => Number(b.y) || 0))
    const firstRowH = Math.max(...groupBlocks.map(b => Number(b.height) || 0))
    // 上一题 bottom：同页其他行中，几何上位于本组上方（bottom ≤ groupTop+20）的最高者
    let prevBottom = 0
    for (const r of pageRows) {
      if (g.rows.some(gr => gr.id === r.id)) continue
      const b = r.block_coordinates
      if (!b || typeof b !== 'object') continue
      const bottom = (Number(b.y) || 0) + (Number(b.height) || 0)
      if (bottom <= groupTop + 20 && bottom > prevBottom) prevBottom = bottom
    }
    // 裁剪带：[prevBottom, groupTop + 首行高度的 45%] —— 带上 (1) 行上半部做锚点上下文
    const bandTop = prevBottom
    const bandBottom = Math.min(1000, groupTop + firstRowH * 0.45)
    if (bandBottom - bandTop < 8) {
      rejectCount++
      results.push({ label, ok: false, reason: `共享题干区域过窄(${Math.round(bandBottom - bandTop)})，跳过` })
      console.log(`⚠️ ${label}: 共享题干区域过窄（${Math.round(bandBottom - bandTop)}‰页高），跳过`)
      continue
    }
    const band = {
      x: 0, y: bandTop,
      width: 1000,
      height: bandBottom - bandTop
    }

    const { stem, error } = await ocrCommonStem(pageImg, band)
    if (error) {
      errorCount++
      results.push({ label, ok: false, reason: error })
      console.log(`❌ ${label}: ${error}`)
      continue
    }
    if (!stem) {
      rejectCount++
      results.push({ label, ok: false, reason: '区域内无公共题干（模型返回空）' })
      console.log(`⚠️ ${label}: 区域内无公共题干`)
      continue
    }

    // ── 五道校验闸 ──
    const reasons = []
    // 正向题号闸（强校验）：stem 若自带题号前缀（如 "8."），必须等于本组题号，
    // 否则说明裁剪带吃进了上一题/别的题 —— 这是邻题误吃最可靠的证据。
    const stemQnoMatch = stem.match(/^\s*(\d{1,2})\s*[.、．]/)
    if (stemQnoMatch && String(parseInt(stemQnoMatch[1], 10)) !== String(Number(g.qno))) {
      reasons.push(`stem 题号 ${stemQnoMatch[1]} ≠ 组题号 ${g.qno}（裁到了别的题）`)
    }
    if (stem.length < 8) reasons.push(`过短(${stem.length}字)`)
    if (stem.length > 300) reasons.push(`过长(${stem.length}字)`)
    if (SUB_HEAD_RE.test(stem)) reasons.push('以小问标号开头（截取失败）')
    // 悬空结尾闸：以逗号/分号/冒号或「当/的/和/或/在/为/时/若/则」收尾，
    // 说明转录在句中被截断（弱模型或裁剪带过窄的典型产物）
    if (/[，,；;：:、]$|[当的和或在为时若则]$/.test(stem)) reasons.push('结尾悬空（转录疑似截断）')
    if (!hasHanziOrDigit(stem)) reasons.push('无有效文字')
    if (!reasons.length && collidesWithNeighbors(stem, pageRows.filter(r => !g.rows.some(gr => gr.id === r.id)))) {
      reasons.push('与同页其他题行撞车（疑裁剪误吃邻题）')
    }
    if (reasons.length) {
      rejectCount++
      results.push({ label, ok: false, reason: reasons.join(';'), stem })
      console.log(`⛔ ${label}: 拒绝 [${reasons.join('; ')}] stem="${stem.slice(0, 60)}"`)
      continue
    }

    // 存储前剥掉题号前缀（题号已由 question_number 列承载，题干不再重复）
    const cleanStem = stem.replace(/^\s*\d{1,2}\s*[.、．]\s*/, '').trim()
    passCount++
    const subRows = g.rows.filter(r => SUB_HEAD_RE.test(r.content))
    results.push({ label, ok: true, stem: cleanStem, ids: g.rows.map(r => r.id), subRows: subRows.map(r => r.id) })
    console.log(`✅ ${label}: stem="${cleanStem.slice(0, 70)}"（${g.rows.length} 行，其中 ${subRows.length} 行带小问标号）`)
  }

  console.log(`\n──── 汇总 ────\n通过 ${passCount} / 拒绝 ${rejectCount} / 错误 ${errorCount}（共 ${selected.length} 组）`)

  // ── apply：写库 + 快照 ──
  if (APPLY && passCount > 0) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const backupDir = 'D:/Minxue_App_V3/server/backups'
    fs.mkdirSync(backupDir, { recursive: true })
    const snapshotPath = path.join(backupDir, `parent-stem-backfill-${ts}.json`)
    fs.writeFileSync(snapshotPath, JSON.stringify({ at: new Date().toISOString(), results }, null, 2), 'utf8')
    console.log(`📦 快照已写入: ${snapshotPath}`)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const r of results) {
        if (!r.ok) continue
        // parent_stem 写整组所有行；sub_no 只回填 content 以 (n) 开头的行（从题干提取）
        await client.query(
          `UPDATE questions SET parent_stem = $1, updated_at = NOW() WHERE id = ANY($2::uuid[])`,
          [r.stem, r.ids]
        )
        for (const id of r.subRows || []) {
          const row = selected.flatMap(g => g.rows).find(x => x.id === id)
          const m = row && String(row.content || '').match(SUB_HEAD_RE)
          if (!m) continue
          const subNo = toArabic(m[1])
          if (subNo) {
            await client.query(
              `UPDATE questions SET sub_no = $1, updated_at = NOW() WHERE id = $2`,
              [subNo, id]
            )
          }
        }
      }
      await client.query('COMMIT')
      console.log(`✅ 已写入 ${passCount} 组的 parent_stem / sub_no`)
    } catch (e) {
      await client.query('ROLLBACK')
      console.error(`❌ 写库失败已回滚: ${e.message}`)
      process.exitCode = 1
    } finally {
      client.release()
    }
  } else if (!APPLY) {
    console.log('（dry-run 模式，未写库。确认结果后加 --apply 执行写入）')
  }

  await pool.end()
}

main().catch(async (e) => {
  console.error('脚本异常:', e)
  try { await pool.end() } catch {}
  process.exit(1)
})
