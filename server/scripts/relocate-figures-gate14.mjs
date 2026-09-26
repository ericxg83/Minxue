/**
 * relocate-figures-gate14.mjs — 对「被『无可重绘』闸门挡住、但裁片本身裁错」的题
 * 用视觉模型重新定位配图框并重裁（默认 dry-run）
 *
 * 背景（2026-09-26 P0-2）：`geometryDisplay.js` 的「无可重绘的几何结构」闸门是**一刀切**，
 * 它把「重绘判不出几何结构」当成「裁片不可信」。实测 14 条被拦的题里 11 条裁片可用、
 * 3~4 条裁到了学生手写/邻题文字。修法分两步：
 *   ① 本脚本：对裁错的题用视觉模型重新定位框 → 重裁（复用 `recrop-missing-figures.mjs`
 *      同款 prompt 与两道生产闸 + `cropAndUploadGeometryImage` 的生产收紧）；
 *   ② 放松闸门：把「无可重绘」闸从优先级 0 下移到 raw 回退之前，只拦未经验证的原始裁片。
 *
 * ⛔ fail-closed 纪律：视觉定位失败 / 模型判无图 / 生产收紧判不出图形 → **清掉该题的
 * clean 产物**（questions + question_assets 两处），让闸门继续挡住，宁可留空不显示错图。
 *    （错的答案比空答案更糟 —— 与 2026-09-24 读图解题纪律同源）
 *
 * 用法（在 server/ 目录下）：
 *   node scripts/relocate-figures-gate14.mjs --ids ef27a135,3bf6cd04   # dry-run：出对照图
 *   node scripts/relocate-figures-gate14.mjs --ids ... --apply         # 写库（先落快照）
 *   node scripts/relocate-figures-gate14.mjs --all                     # 扫全部被闸门挡住的题
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
  delete process.env[k]
}
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import sharp from 'sharp'
import { callVisionCompletion, WORKBOOK_OCR_VENDOR_CHAIN } from '../config/ai.js'
import { cropAndUploadGeometryImage, isDegenerateFigureBox, clampImageBboxToBlock } from '../worker.js'
import { downloadImageBufferNoProxy } from '../utils/noProxyHttp.js'
import { hasFigureReference } from '../utils/questionCompleteness.js'
import { getGeometryDisplayUrl } from '../../src/utils/geometryDisplay.js'

const APPLY = process.argv.includes('--apply')
const ALL = process.argv.includes('--all')
const argOf = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null }
const IDS = (argOf('--ids') || '').split(',').map(s => s.trim()).filter(Boolean)
const LOGDIR = new URL('./logs/relocate-gate14/', import.meta.url)
// --plan <file>：用已人工目检过的框落库，不再调视觉模型。
//   ⛔ 必须这样：视觉模型非确定性（同题两次框不同），"先目检再 apply" 必须复用同一个框，
//   否则 apply 那次重新调模型可能给出没被目检过的框 —— 违反「不能画错」。
//   典型用法：dry-run 落盘 plan-*.json → 人工看预览图 → --apply --plan <那个文件>
const PLAN = argOf('--plan')
const plan = PLAN ? JSON.parse(await fsp.readFile(PLAN, 'utf8')) : null
const planBoxOf = (id) => (plan?.items || []).find(x => id.startsWith(x.id))?.box || null

// prompt 与 recrop-missing-figures.mjs 逐字一致（同一件事只允许一套口径）
const PROMPT = `你是作业图片版面分析助手。用户会指定页码上的某一道题，请只做一件事：
给出**这道题的配图（图形本身）**在这张作业图上的外接矩形。

只返回 JSON，格式：
{"image_type":"geometry|chart|none","image_bbox":{"x":0,"y":0,"width":0,"height":0},"reason":"简述依据"}

规则：
1. 坐标用 0-1000 的整数，相对整张图归一化；width/height 是【宽和高】，不是右下角坐标。右下角 = x+width、y+height。
2. image_bbox 只框【图形本身】（几何图、函数图像、统计图、示意图），不要把题干文字、选项文字、
   答题横线、学生手写、老师的批改痕迹（√/×/分数）框进去。
3. 常见排版陷阱：一份卷子常把多道题的图集中排成一行，图下方标注「第1题图」「第2题图」。
   遇到这种排版，必须找到属于本题的那一格图，只框那一格，绝不把整行图全框进来。
4. 如果这道题在原卷上确实没有配图（纯代数计算题、没有画出图像），image_type 填 "none"、
   image_bbox 填 null。不要用题干区域的坐标凑一个框 —— 凑出来的框裁出的是文字，会被当成配图展示给学生。`

const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

const rows = (await pool.query(`
  SELECT q.id, q.student_id, q.task_id, q.question_number, q.sub_no, q.page_number,
         q.content, q.parent_stem, q.image_bbox, q.block_coordinates,
         q.geometry_image_url, q.clean_geometry_image_url, q.image_type, q.tikz_svg_url,
         q.display_image_type, q.geometry_manual_override, q.clean_geometry_svg,
         t.images,
         a.tikz_status, a.last_error AS asset_last_error, a.id AS asset_id,
         a.cropped_image_url AS asset_cropped_url, a.clean_geometry_image_url AS asset_clean_url
  FROM questions q
  JOIN tasks t ON t.id = q.task_id
  LEFT JOIN LATERAL (
    SELECT id, tikz_status, last_error, cropped_image_url, clean_geometry_image_url
    FROM question_assets WHERE question_id = q.id AND asset_type = 'geometry_image'
    ORDER BY created_at DESC LIMIT 1
  ) a ON TRUE
  WHERE q.deleted_at IS NULL
`)).rows

let cands = rows.filter(r => hasFigureReference({ content: r.content, parent_stem: r.parent_stem }))
if (IDS.length) {
  cands = cands.filter(r => IDS.some(p => r.id.startsWith(p)))
} else if (!ALL) {
  // 默认：被「无可重绘」闸门挡住的那批
  cands = cands.filter(r => {
    const d = getGeometryDisplayUrl({
      clean_geometry_svg: r.clean_geometry_svg, tikz_svg_url: r.tikz_svg_url,
      clean_geometry_image_url: r.clean_geometry_image_url, geometry_image_url: r.geometry_image_url,
      tikz_status: r.tikz_status, asset_last_error: r.asset_last_error,
      display_image_type: r.display_image_type, geometry_manual_override: r.geometry_manual_override,
    })
    return d.type === 'none' && r.tikz_status === 'none'
      && typeof r.asset_last_error === 'string' && /无可重绘的几何结构/.test(r.asset_last_error)
  })
}

console.log(`${APPLY ? '🛠  APPLY' : '🔍 DRY-RUN'} — 候选 ${cands.length} 条\n`)
await fsp.mkdir(LOGDIR, { recursive: true })

const results = []
const pageCache = new Map()
for (const r of cands) {
  const tag = `${r.id.slice(0, 8)} 第${r.question_number ?? '?'}题`
  let imgs = r.images
  if (typeof imgs === 'string') { try { imgs = JSON.parse(imgs) } catch { imgs = null } }
  const pgNo = r.page_number || 1
  const page = Array.isArray(imgs)
    ? (imgs.find(i => Number(i?.page_number) === Number(pgNo)) || imgs[0])
    : null
  if (!page?.image_url) { console.log(`  ${tag}: ❌ 无页图`); results.push({ id: r.id, ok: false, reason: '无页图' }); continue }

  let pageBuf
  if (pageCache.has(page.image_url)) pageBuf = pageCache.get(page.image_url)
  else {
    try { pageBuf = await downloadImageBufferNoProxy(page.image_url); pageCache.set(page.image_url, pageBuf) }
    catch (e) { console.log(`  ${tag}: ❌ 页图下载失败 ${e.message.slice(0, 50)}`); results.push({ id: r.id, ok: false, reason: '页图下载失败' }); continue }
  }
  const meta = await sharp(pageBuf).metadata()

  // ① 视觉定位（--plan 时直接复用已目检的框，不调模型）
  let parsed = null
  const planned = planBoxOf(r.id)
  if (planned) {
    parsed = { image_type: 'geometry', image_bbox: planned, reason: 'plan（已人工目检）' }
    console.log(`  ${tag}: 📋 复用 plan 框 ${JSON.stringify(planned)}`)
  } else {
    try {
      const qtext = (r.parent_stem ? r.parent_stem + ' ' : '') + (r.content || '')
      const out = await callVisionCompletion({
        imageDataURL: `data:image/jpeg;base64,${pageBuf.toString('base64')}`,
        systemPrompt: PROMPT,
        userText: `这张图是学生作业的整页照片。请定位【第 ${r.question_number} 题】${r.sub_no ? `第 (${r.sub_no}) 小问` : ''}的配图。\n该题题干：${qtext.slice(0, 220)}\n\n给出配图外接矩形。`,
        temperature: 0.1,
        maxTokens: 500,
        vendorChain: WORKBOOK_OCR_VENDOR_CHAIN,
      })
      const text = typeof out === 'string' ? out : (out?.content || out?.text || JSON.stringify(out))
      const m = text.match(/\{[\s\S]*\}/)
      if (m) parsed = JSON.parse(m[0])
      else console.log(`  ${tag}: ❌ 模型没返回 JSON: ${text.slice(0, 60)}`)
    } catch (e) { console.log(`  ${tag}: ❌ 视觉调用失败 ${e.message.slice(0, 60)}`) }
  }

  // ② 两道生产闸（plan 框已在目检前过闸，这里只复核是否被改动）
  const box = parsed?.image_bbox
  if (!parsed || !box || parsed.image_type === 'none') {
    results.push({ id: r.id, ok: false, reason: `模型判定无图(${String(parsed?.reason || '调用失败').slice(0, 30)})` })
    console.log(`  ${tag}: ⛔ ${parsed ? '模型判定原卷无配图' : '定位失败'}`)
    continue
  }
  if (isDegenerateFigureBox(box, r.block_coordinates)) {
    results.push({ id: r.id, ok: false, reason: '退化框' }); console.log(`  ${tag}: ⛔ 退化框被拦`); continue
  }
  const safe = clampImageBboxToBlock(box, r.block_coordinates)
  if (!safe) {
    results.push({ id: r.id, ok: false, reason: '框与题干对不上' }); console.log(`  ${tag}: ⛔ 框与题干完全对不上`); continue
  }
  if (planned && JSON.stringify(safe) !== JSON.stringify(planned)) {
    console.log(`  ${tag}: ⚠ plan 框被 clamp 改动 → ${JSON.stringify(safe)}`)
  }
  const px = {
    x: Math.round(safe.x / 1000 * meta.width), y: Math.round(safe.y / 1000 * meta.height),
    width: Math.round(safe.width / 1000 * meta.width), height: Math.round(safe.height / 1000 * meta.height),
  }

  // 模型框原样预览（判收紧是否误伤时用）
  const cropTo = (box, suffix) => sharp(pageBuf).extract({
    left: Math.max(0, box.x), top: Math.max(0, box.y),
    width: Math.max(1, Math.min(meta.width - Math.max(0, box.x), box.width)),
    height: Math.max(1, Math.min(meta.height - Math.max(0, box.y), box.height)),
  }).png().toFile(fileURLToPath(new URL(`${r.id.slice(0, 8)}${suffix}.png`, LOGDIR)))
  await cropTo(px, '_model')

  // ③ 生产同款收紧（分不出图形 → fail-closed）
  //   ⚠️ `--no-refine` 时才跳过收紧：用于「模型框已人工目检确认正确、但收紧启发式误伤」的题。
  //   例（2026-09-26）：e801e7aa 是 3×3 格点图 + 学生作图，墨迹覆盖率 21.5% 超过
  //   MAX_INK_COVERAGE=0.14 的「文字带」阈值 → 收紧把整张图判成文字而拒；
  //   5cb0484d 图带找得到但后续收紧步骤失败。两者的模型框裁出来都是完整正确的图。
  //   跳过后由 cropAndUploadGeometryImage 走 FIGURE_REFINE=0 分支（模型框 + 20% padding）。
  const NO_REFINE = process.argv.includes('--no-refine') || plan?.noRefine === true
  let finalBox = px
  // 传给生产的框：--no-refine 时按 1/1.4 预缩，使生产那 20% padding 正好落回已目检的模型框
  // （模型框宽度 w → 传入 0.714w → 输出 1.4×0.714w = w，左边界同样对齐；见 cropAndUploadGeometryImage
  //   第 502~507 行的 padX/padY 公式）。这样既复用生产代码，又不会把邻题文字 padding 进来。
  let boxForProd = px
  if (NO_REFINE) {
    const k = 1 / 1.4
    boxForProd = {
      x: Math.round(px.x + px.width * (1 - k) / 2), y: Math.round(px.y + px.height * (1 - k) / 2),
      width: Math.max(1, Math.round(px.width * k)), height: Math.max(1, Math.round(px.height * k)),
    }
    finalBox = px
    // 预览按生产实际输出（预缩框 + 20% padding）画，便于逐条比对
    const pX = Math.round(boxForProd.width * 0.20), pY = Math.round(boxForProd.height * 0.20)
    const l = Math.max(0, boxForProd.x - pX), t = Math.max(0, boxForProd.y - pY)
    finalBox = {
      x: l, y: t,
      width: Math.min(boxForProd.x + boxForProd.width + pX, meta.width) - l,
      height: Math.min(boxForProd.y + boxForProd.height + pY, meta.height) - t,
    }
    console.log(`  ${tag}: ⚠ --no-refine：按模型框精确裁（框已人工目检，预缩 ${JSON.stringify(boxForProd)}）`)
  } else {
    try {
      const refined = await refineBox(pageBuf, px)
      if (!refined) {
        results.push({ id: r.id, ok: false, reason: '收紧判定非图形', modelBox: safe })
        console.log(`  ${tag}: ⛔ 收紧判定"分不出图形"（模型框 ${JSON.stringify(safe)}）`)
        continue
      }
      finalBox = refined
    } catch (e) { console.log(`  ${tag}: ⚠ 收紧异常 ${e.message.slice(0, 50)}，用模型框`) }
  }

  // 本地预览（新裁片）
  const previewPath = fileURLToPath(new URL(`${r.id.slice(0, 8)}_new.png`, LOGDIR))
  await cropTo(finalBox, '_new')

  const oldBox = r.image_bbox || {}
  const dBox = `Δx${Math.round((safe.x - oldBox.x) || 0)} Δy${Math.round((safe.y - oldBox.y) || 0)}`
  console.log(`  ${tag}: ✅ 新框 ${JSON.stringify(safe)} (${dBox}) → 预览 ${previewPath}`)

  let newUrl = null
  if (APPLY) {
    try {
      // --no-refine 时必须同步关掉生产收紧，否则 cropAndUploadGeometryImage 会再拒一次
      if (NO_REFINE) process.env.FIGURE_REFINE = '0'
      newUrl = await cropAndUploadGeometryImage(pageBuf, boxForProd, r.student_id, r.id)
      if (NO_REFINE) delete process.env.FIGURE_REFINE
      if (!newUrl) { results.push({ id: r.id, ok: false, reason: '生产收紧判不出图形' }); console.log(`  ${tag}: ⛔ 生产收紧判不出图形，不改`); continue }
    } catch (e) { results.push({ id: r.id, ok: false, reason: e.message.slice(0, 60) }); console.log(`  ${tag}: ❌ 上传失败 ${e.message.slice(0, 50)}`); continue }
  }

  results.push({
    id: r.id, ok: true, label: tag,
    old: { image_bbox: r.image_bbox, geometry_image_url: r.geometry_image_url, clean_geometry_image_url: r.clean_geometry_image_url },
    box: safe, finalBox, newUrl, assetId: r.asset_id,
    oldAssetCropped: r.asset_cropped_url, oldAssetClean: r.asset_clean_url,
    preview: previewPath,
  })
}

const okN = results.filter(r => r.ok).length
console.log(`\n──── 汇总 ────\n定位成功 ${okN} / 候选 ${cands.length} 条`)
if (!APPLY) {
  // 落 plan：把本次目检用的框固定下来，供 --apply --plan 复用（视觉模型非确定性）
  const planPath = fileURLToPath(new URL(`plan-${Date.now()}.json`, LOGDIR))
  await fsp.writeFile(planPath, JSON.stringify({
    at: new Date().toISOString(), noRefine: process.argv.includes('--no-refine'),
    items: results.filter(r => r.ok).map(r => ({ id: r.id.slice(0, 8), box: r.box, preview: r.preview })),
    failed: results.filter(r => !r.ok).map(r => ({ id: r.id.slice(0, 8), reason: r.reason })),
  }, null, 1), 'utf8')
  console.log(`📋 plan: ${planPath}`)
  console.log('（dry-run：未上传、未写库）')
  await pool.end(); process.exit(0)
}

// ── 落库 ──
const backupPath = new URL(`./logs/relocate-gate14-backup-${Date.now()}.json`, import.meta.url)
await fsp.writeFile(backupPath, JSON.stringify(results, null, 1), 'utf8')
console.log(`💾 回滚快照: ${backupPath.pathname}`)

const client = await pool.connect()
try {
  await client.query('BEGIN')
  let written = 0
  for (const r of results) {
    if (!r.ok || !r.newUrl) continue
    await client.query(
      `UPDATE questions SET geometry_image_url = $2, image_bbox = $3, image_type = COALESCE(image_type,'geometry'), updated_at = NOW() WHERE id = $1`,
      [r.id, r.newUrl, JSON.stringify(r.box)])
    if (r.assetId) {
      await client.query(`UPDATE question_assets SET cropped_image_url = $2, updated_at = NOW() WHERE id = $1`, [r.assetId, r.newUrl])
    }
    written++
  }
  // ── fail-closed：定位失败的题，清掉 clean 产物，让闸门继续挡住 ──
  let cleared = 0
  for (const r of results) {
    if (r.ok) continue
    const c1 = await client.query(`UPDATE questions SET clean_geometry_image_url = NULL, updated_at = NOW() WHERE id = $1 AND clean_geometry_image_url IS NOT NULL`, [r.id])
    const c2 = await client.query(`UPDATE question_assets SET clean_geometry_image_url = NULL, updated_at = NOW() WHERE question_id = $1 AND clean_geometry_image_url IS NOT NULL`, [r.id])
    if (c1.rowCount || c2.rowCount) { cleared++; console.log(`  🧹 ${r.id.slice(0, 8)} 清 clean 产物（${r.reason}）→ 保持闸门屏蔽`) }
  }
  await client.query('COMMIT')
  console.log(`\n✅ 已重裁写库 ${written} 条；fail-closed 清产物 ${cleared} 条`)
} catch (e) {
  await client.query('ROLLBACK')
  console.error('❌ 已回滚：', e.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}

// 生产收紧的薄封装（复用 figureRegionRefiner 的整页收紧）
async function refineBox(pageBuf, pixelBox) {
  const { refineFigureBoxOnPage } = await import('../utils/figureRegionRefiner.js')
  const { estimatePaperBackground } = await import('../worker.js')
  return refineFigureBoxOnPage(pageBuf, pixelBox, estimatePaperBackground)
}
