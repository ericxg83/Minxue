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
// --all：候选放宽到「孤立小问行」（同一题号只有 1 行以小问标号开头）。
//   默认只处理成组行（同题号 ≥2 行带小问标号，拆分证据更硬）；用户报告重练卷
//   上半截题无法练习后放开，孤立行同样按几何位置找公共题干。
const ALL = process.argv.includes('--all')
// --no-filter：关闭「确实需要公共条件」预筛（纯计算题的 (1)(2) 本来就独立可作答，
//   公共部分只有“计算：”之类，回填收益低且 OCR 费用高）
const NO_FILTER = process.argv.includes('--no-filter')

const SUB_HEAD_RE = /^[（(]\s*([0-9１-９一二三四五六七八九]{1,2})\s*[)）]/
const SUB_MARKER_ANY_RE = /[（(]\s*\d{1,2}\s*[)）]/
const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

// 「这一行是不是依赖公共条件才可作答」——应用题/几何题/函数题必须带条件；
// 纯计算题（"计算：(1) 3×9^m×27^m=3^21，求m="）的小问各自独立，不必回填。
// 只用于收敛 OCR 范围、省费用；判错最多是多花一次识别（还会被校验闸拦），不会写错数据。
const DEPENDS_ON_STEM_RE = /(求|证明|求证|判断|说明|指出|探究|面积|周长|表达式|解析式|顶点|对称轴|抛物线|函数|图像|图象|如图|已知|取值范围|坐标|关系|条件|归纳|猜想|验证)/
const PURE_CALC_HEAD_RE = /^(\d+\s*[)）])?\s*(计算|化简|解方程|解不等式|解方程组|因式分解|求值)\s*[:：]?\s*$/

const needsParentStem = (content) => {
  const raw = String(content || '')
  // 剥掉开头的小问标号再看剩余文本
  const body = raw.replace(SUB_HEAD_RE, '').trim()
  if (!body) return false
  // 纯指令行（"计算："）没有可回填的公共题干
  if (PURE_CALC_HEAD_RE.test(body)) return false
  return DEPENDS_ON_STEM_RE.test(body)
}

// 自身已含 ≥2 个小问标号的行 = 整题（AI 没拆干净或本来就完整），不需要公共题干
const isSelfCompleteContent = (content) => {
  const marks = String(content || '').match(/[（(]\s*[0-9１-９一二三四五六七八九]{1,2}\s*[)）]/g) || []
  return marks.length >= 2
}

// 剥掉题干开头的题号前缀（题号已由 question_number 承载）。练习册印刷常写成
// "18 已知抛物线…"（数字+空格）、"10. 已知…"（数字+点+空格），OCR 也可能把
// ". " 读成破折号 → "10—经销商…"。剥完必须再跑一遍标号/悬空闸，否则会出现
// "2.（1）二次函数…" 剥成 "（1）二次函数…" 漏网（2026-09-12 实测漏网 1 条）。
const stripLeadingNumber = (s) => String(s || '')
  .replace(/^\s*\d{1,2}\s*[.、．:：,，]\s*/, '')
  .replace(/^\s*\d{1,2}\s*[—－-]\s*/, '')
  .replace(/^\s*\d{1,2}\s+/, '')
  .trim()

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
  // ── 1. 候选组：content 以 (n) 开头的行（--all 时含孤立单行）──
  // 注：只要求 parent_stem IS NULL；不再要求 sub_no IS NULL —— 昨天回滚 batch 保留了
  //     sub_no，那些行同样需要重试。
  const { rows: groups } = await pool.query(`
    WITH cand AS (
      SELECT q.task_id, q.page_number, q.question_number AS qno,
             count(*) FILTER (
               WHERE btrim(coalesce(q.content,'')) ~ '^[（(]\\s*[0-9１-９一二三四五六七八九]{1,2}\\s*[)）]'
             ) AS sub_rows,
             count(*) AS total_rows
      FROM questions q
      WHERE q.parent_stem IS NULL
        AND q.question_number IS NOT NULL AND q.page_number IS NOT NULL
      GROUP BY q.task_id, q.page_number, q.question_number
      HAVING count(*) FILTER (
               WHERE btrim(coalesce(q.content,'')) ~ '^[（(]\\s*[0-9１-９一二三四五六七八九]{1,2}\\s*[)）]'
             ) >= ${ALL ? 1 : 2}
    )
    SELECT c.task_id, c.page_number, c.qno, c.total_rows, c.sub_rows,
           jsonb_agg(jsonb_build_object(
             'id', q.id, 'content', btrim(coalesce(q.content,'')),
             'block', q.block_coordinates, 'sub', q.sub_no
           ) ORDER BY q.created_at) AS rows,
           t.images AS task_images, t.image_url AS task_image_url
    FROM cand c
    JOIN questions q ON q.task_id = c.task_id AND q.page_number = c.page_number AND q.question_number = c.qno
    JOIN tasks t ON t.id = c.task_id
    GROUP BY c.task_id, c.page_number, c.qno, c.total_rows, c.sub_rows, t.images, t.image_url
    ORDER BY c.task_id, c.page_number, c.qno
  `)

  // 「确实需要公共条件」预筛：组内只要有一行是依赖条件才能作答的（应用题/几何题/
  // 函数题），这组就值得回填；全是纯计算小问的组跳过，省视觉模型费用。
  const beforeFilter = groups.length
  const kept = NO_FILTER
    ? groups
    : groups.filter(g => {
        const subRows = g.rows.filter(r => SUB_HEAD_RE.test(r.content))
        // 组内所有带标号的行都自身完整（含 ≥2 个标号）→ 本来就不缺条件，跳过
        if (subRows.length > 0 && subRows.every(r => isSelfCompleteContent(r.content))) return false
        return g.rows.some(r => needsParentStem(r.content))
      })
  const skipped = beforeFilter - kept.length

  console.log(`候选组: ${beforeFilter} 组（模式=${ALL ? '--all 含孤立行' : '仅成组'}）`)
  console.log(`需要公共条件: ${kept.length} 组${skipped ? `（跳过 ${skipped} 组纯计算题）` : ''}${LIMIT ? `，本次处理前 ${Math.min(LIMIT, kept.length)} 组` : ''}`)
  if (kept.length === 0) {
    await pool.end()
    return
  }

  const selected = LIMIT ? kept.slice(0, LIMIT) : kept
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
    // 裁剪带上边：优先用「上一题 bottom」（精确，只含两题之间的空隙 = 公共题干行）。
    // 但 block_coordinates 实测质量参差——同一大题相邻小问的框会互相重叠（如
    // 2e39d5d4 Q11：(1) y=620 h=120 与 (2) y=660 重叠）、或每行高仅 30‰ 且紧贴，
    // 此时 prevBottom 不可信（gap 过小），改用固定上探：从本行顶部往上 130‰ 页高。
    // 落在带内的上一题文字会被「邻题撞车闸」拦下，不会写错。
    const gap = groupTop - prevBottom
    const bandTop = (prevBottom > 0 && gap >= 20) ? prevBottom : Math.max(0, groupTop - 130)
    // 下边取首行的 80%：让模型能看见 (1) 标号本体，才能准确判断"标号之前的文字"到哪结束。
    // 取 45% 时实测多次在段落中途截断（"…例如：方程 x²−x="、"…与x轴交"）。
    const bandBottom = Math.min(1000, groupTop + firstRowH * 0.8)
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

    // 同组几何/标号一致性闸：同页同题号可能分属不同栏目（“一、填空题 1”与
    // “三、解答题 1”各自从 1 编号），此时组内会出现重复的小问标号。
    // 但同一题被过度拆分时也会重复（(2) 的 ①② 被拆成两条 (2)）——用几何距离区分：
    // 同标号各行 y 跨度 < 250‰ 视为同题拆分（容忍），≥ 250‰ 视为栏目冲突（拒绝整组），
    // 因为把 A 题的公共条件写到 B 题上是最坏的结果。
    const byMark = new Map()
    for (const r of g.rows) {
      if (!SUB_HEAD_RE.test(r.content)) continue
      const mark = toArabic(String(r.content).match(SUB_HEAD_RE)[1])
      if (!mark) continue
      const y = Number(r.block?.y) || 0
      if (!byMark.has(mark)) byMark.set(mark, [])
      byMark.get(mark).push(y)
    }
    let columnConflict = false
    for (const [, ys] of byMark) {
      if (ys.length > 1 && Math.max(...ys) - Math.min(...ys) >= 250) columnConflict = true
    }
    if (columnConflict) {
      rejectCount++
      results.push({ label, ok: false, reason: '同组小问标号重复且纵向跨度大（疑同页同题号不同栏目）' })
      console.log(`⛔ ${label}: 拒绝 [同组小问标号重复且纵向跨度大，疑不同栏目]`)
      continue
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

    // ── 校验闸（全部对「剥掉题号前缀后的 cleanStem」判定，避免 "2.（1）…" 漏网）──
    const reasons = []
    // 题号闸（强校验）：原始 stem 若自带题号，必须等于本组题号，
    // 否则说明裁剪带吃进了上一题/别的题 —— 这是邻题误吃最可靠的证据。
    const stemQnoMatch = stem.match(/^\s*(\d{1,2})\s*[.、．]/)
    if (stemQnoMatch && String(parseInt(stemQnoMatch[1], 10)) !== String(Number(g.qno))) {
      reasons.push(`stem 题号 ${stemQnoMatch[1]} ≠ 组题号 ${g.qno}（裁到了别的题）`)
    }
    const cleanStem = stripLeadingNumber(stem)
    if (cleanStem.length < 8) reasons.push(`过短(${cleanStem.length}字)`)
    if (cleanStem.length > 300) reasons.push(`过长(${cleanStem.length}字)`)
    if (SUB_HEAD_RE.test(cleanStem)) reasons.push('以小问标号开头（截取失败）')
    // 悬空结尾闸：以逗号/分号/冒号或「当/的/和/或/在/为/时/若/则/此/求」收尾，
    // 说明转录在句中被截断（弱模型或裁剪带过窄的典型产物）
    if (/[，,；;：:、=＝]$|[当的和或在为时若则此求交即得是有与及等]$/.test(cleanStem)) reasons.push('结尾悬空（转录疑似截断）')
    if (!hasHanziOrDigit(cleanStem)) reasons.push('无有效文字')
    if (!reasons.length && collidesWithNeighbors(cleanStem, pageRows.filter(r => !g.rows.some(gr => gr.id === r.id)))) {
      reasons.push('与同页其他题行撞车（疑裁剪误吃邻题）')
    }
    if (reasons.length) {
      rejectCount++
      results.push({ label, ok: false, reason: reasons.join(';'), stem: cleanStem })
      console.log(`⛔ ${label}: 拒绝 [${reasons.join('; ')}] stem="${cleanStem.slice(0, 60)}"`)
      continue
    }

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
