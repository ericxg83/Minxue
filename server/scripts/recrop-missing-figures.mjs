/**
 * recrop-missing-figures.mjs — 补裁「原卷有图但采集时漏裁」的配图
 *
 * 背景（2026-09-17 排查）：配图裁剪发生在 OCR 采集阶段（worker.js），条件是模型返回
 * `image_type` + `image_bbox`。有一批题原卷明明有图，但 OCR 响应里**整个 image_type 字段缺失**
 * （= NULL，既不是 'none' 也不是 'geometry'），于是没裁 → 课件与错题本都没图。
 *
 * 本脚本只处理这一类（`image_type IS NULL` 且题干含「如图」）：
 *   1. 下载原卷页图
 *   2. 视觉模型只做一件事：定位这道题的配图外接框（0-1000 归一化）
 *   3. 过生产同款两道闸（isDegenerateFigureBox / clampImageBboxToBlock）
 *   4. 调**生产同一个函数** cropAndUploadGeometryImage 裁图上传 OSS
 *   5. 写回 questions.geometry_image_url / image_type / image_bbox
 *
 * 仅用于「识别当次确实漏框」的补救，必须先 dry-run 看预览图再 --apply。
 *
 * ⛔ 不要加「配图框必须与本题 block 纵向有交集」这类闸（2026-09-18 实测证伪）：
 *   上海作业常把多道题的图集中排成一行、图下印「第N题图」，此时补裁给的框必然落在本题
 *   block **上方**。用「纵向错开」当判据假阳性率约 28%（`_diag_figure_risk_baseline.mjs`），
 *   会把正确配图全部拦掉。实测反例 `2958a4e3`（框 y273~413 vs block y490~590，纵向完全错开）
 *   经读图行标注确认正落在「第4题图」格上 —— 是**正确**的。
 *   判断归属只能读图行标注（`_diag_figure_label_check.mjs`），不能靠坐标互比。
 *
 * 用法（在 server/ 目录下）：
 *   node scripts/recrop-missing-figures.mjs              # dry-run：识别 + 本地裁片预览，不写库不上传
 *   node scripts/recrop-missing-figures.mjs --apply      # 真裁 + 上传 + 写库（先落快照）
 *   node scripts/recrop-missing-figures.mjs --limit 3    # 只处理前 N 条
 *   node scripts/recrop-missing-figures.mjs --task <前缀> # 只处理某个 task
 *   node scripts/recrop-missing-figures.mjs --all        # 不限「已入错题本」，扫全部符合条件的题
 *   node scripts/recrop-missing-figures.mjs --force-id a,b # 定向补裁（绕过默认候选条件，仍不覆盖已有配图）
 *
 * 写入范围：仅 geometry_image_url / image_type / image_bbox 三列（展示用），可整列回滚。
 * --apply 完成后按动态口径回填 is_complete（引图判据含 parent_stem，见 utils/questionCompleteness.js）。
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import sharp from 'sharp'
import { callVisionCompletion } from '../config/ai.js'
import { cropAndUploadGeometryImage, isDegenerateFigureBox, clampImageBboxToBlock, estimatePaperBackground } from '../worker.js'
import { refineFigureBoxOnPage } from '../utils/figureRegionRefiner.js'
import { syncQuestionCompleteness } from '../services/questionCompletenessSync.js'

const APPLY = process.argv.includes('--apply')
// --all：不限定「已入错题本」。默认只处理已入册题（错题本/课件真正在用的那批），
// 加 --all 才扫全部漏裁题，避免一次性对大量未入册题调视觉模型。
const ALL = process.argv.includes('--all')
const argOf = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null }
const LIMIT = Number(argOf('--limit') || 0)
const TASK = argOf('--task')
const GRADE = argOf('--grade')
// --skip-id a,b：跳过指定 question id 前缀（例如模型给出的框两次不一致、页上多图易混的题）
const SKIP = (argOf('--skip-id') || '').split(',').map(x => x.trim()).filter(Boolean)
// --force-id a,b：定向补裁指定 question id 前缀，绕过默认候选三条件
// （geometry_image_url IS NULL + image_type IS NULL + 题干关键词）。用于「模型判了
// image_type=geometry 但管线没产出裁片」（如 2026-09-21 练习册旧 prompt 批次）的题。
// 仍保留 deleted_at IS NULL 与 geometry_image_url IS NULL（绝不覆盖已有配图）。
const FORCE = (argOf('--force-id') || '').split(',').map(x => x.trim()).filter(Boolean)

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

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

// 参数按出现顺序动态编号，避免占位符与数组错位（$1/$2 顺序问题）
const params = []
// 引图判据与 utils/questionCompleteness.js 的 FIGURE_KEYWORDS 同源（含 parent_stem），
// 不能用只匹配「如图」的 LIKE：完整性闸认的是 /如图|图1|图示|附图|见图/，两边必须一致。
let where = FORCE.length
  ? `WHERE q.geometry_image_url IS NULL AND q.deleted_at IS NULL`
  : `WHERE q.geometry_image_url IS NULL
    AND q.image_type IS NULL
    AND (COALESCE(q.parent_stem,'') || COALESCE(q.content,'')) ~ '如图|图1|图示|附图|见图'
    AND q.deleted_at IS NULL`
if (FORCE.length) { params.push(FORCE.map(x => x + '%')); where += `\n    AND (q.id::text LIKE ANY($${params.length}))` }
if (TASK) { params.push(TASK + '%'); where += `\n    AND q.task_id::text LIKE $${params.length}` }
if (GRADE) { params.push(String(GRADE)); where += `\n    AND s.grade = $${params.length}` }

const rows = (await pool.query(`
  SELECT q.id, q.task_id, q.student_id, q.question_number, q.sub_no, q.page_number,
         q.block_coordinates, q.image_type, q.geometry_image_url,
         COALESCE(q.parent_stem,'') AS parent_stem, q.content, t.images AS task_images, s.name, s.grade
  FROM questions q
  ${ALL ? '' : 'JOIN wrong_questions wq ON wq.question_id = q.id'}
  JOIN students s ON s.id = q.student_id
  JOIN tasks t ON t.id = q.task_id
  ${where}
  ORDER BY q.created_at DESC
  ${LIMIT ? `LIMIT $${params.length + 1}` : ''}`,
  LIMIT ? [...params, LIMIT] : params)).rows

console.log(`${APPLY ? '🛠  APPLY' : '🔍 DRY-RUN'} — 待补裁 ${rows.length} 条${SKIP.length ? `（跳过 ${SKIP.join(',')}）` : ''}\n`)
if (!rows.length) { await pool.end(); process.exit(0) }

const previewDir = 'D:/Minxue_App_V3/server/backups/figure-preview'
fs.mkdirSync(previewDir, { recursive: true })

const results = []
for (const [i, r] of rows.entries()) {
  const label = `[${i + 1}/${rows.length}] ${r.name} 卷面第${r.question_number}题${r.sub_no ? `(${r.sub_no})` : ''}`
  if (SKIP.some(p => r.id.startsWith(p))) {
    console.log(`${label}: ⏭ 按 --skip-id 跳过`)
    results.push({ label, ok: false, reason: 'skip-id' })
    continue
  }
  let imgs = r.task_images
  if (typeof imgs === 'string') { try { imgs = JSON.parse(imgs) } catch { imgs = null } }
  const pgNo = r.page_number || 1
  const url = (imgs || []).find(x => Number(x?.page_number) === pgNo)?.image_url || (imgs || [])[0]?.image_url
  if (!url) { console.log(`${label}: ❌ 无页图`); results.push({ label, ok: false, reason: '无页图' }); continue }

  try {
    const pageBuf = Buffer.from(await (await fetch(url)).arrayBuffer())
    const meta = await sharp(pageBuf).metadata()
    const qtext = (r.parent_stem ? r.parent_stem + ' ' : '') + (r.content || '')
    const userText = `这张图是学生作业的整页照片。请定位【第 ${r.question_number} 题】${r.sub_no ? `第 (${r.sub_no}) 小问` : ''}的配图。\n该题题干：${qtext.slice(0, 220)}\n\n给出配图外接矩形。`

    const out = await callVisionCompletion({
      imageDataURL: `data:image/jpeg;base64,${pageBuf.toString('base64')}`,
      systemPrompt: PROMPT,
      userText,
      temperature: 0.1,
      maxTokens: 500,
      noBackup: true,
    })
    const text = typeof out === 'string' ? out : (out?.content || out?.text || JSON.stringify(out))
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) { console.log(`${label}: ❌ 模型没返回 JSON: ${text.slice(0, 80)}`); results.push({ label, ok: false, reason: '无 JSON' }); continue }
    const parsed = JSON.parse(m[0])
    const box = parsed.image_bbox
    const itype = parsed.image_type || 'geometry'

    if (!box || itype === 'none') {
      console.log(`${label}: ⏭ 模型判定原卷无配图（${String(parsed.reason || '').slice(0, 40)}）`)
      results.push({ label, ok: false, reason: '模型判定无图' })
      continue
    }
    if (isDegenerateFigureBox(box, r.block_coordinates)) {
      console.log(`${label}: ⛔ 退化框被拦 ${JSON.stringify(box)}`)
      results.push({ label, ok: false, reason: '退化框' })
      continue
    }
    const safe = clampImageBboxToBlock(box, r.block_coordinates)
    if (!safe) {
      console.log(`${label}: ⛔ 框与题干完全对不上，被拦 ${JSON.stringify(box)}`)
      results.push({ label, ok: false, reason: '框与题干对不上' })
      continue
    }
    const previewPath = path.join(previewDir, `${r.id.slice(0, 8)}_Q${r.question_number}${r.sub_no ? '_' + r.sub_no : ''}.png`)
    const px = {
      x: Math.round(safe.x / 1000 * meta.width),
      y: Math.round(safe.y / 1000 * meta.height),
      width: Math.round(safe.width / 1000 * meta.width),
      height: Math.round(safe.height / 1000 * meta.height),
    }

    // 生产同款「区域收紧」：分不出图形就判定"这里不是配图"（模型框错时的兜底）
    let finalBox = px
    try {
      const refined = await refineFigureBoxOnPage(pageBuf, px, estimatePaperBackground)
      if (!refined) {
        console.log(`${label}: ⛔ 收紧判定"该区域分不出图形"（模型框错/框到文字），跳过`)
        results.push({ label, ok: false, reason: '收紧判定非图形' })
        continue
      }
      finalBox = refined
    } catch (e) {
      console.log(`${label}: ⚠ 收紧异常 ${e.message}，回退模型框`)
    }

    await sharp(pageBuf).extract({
      left: Math.max(0, Math.round(finalBox.x)), top: Math.max(0, Math.round(finalBox.y)),
      width: Math.min(meta.width - Math.max(0, Math.round(finalBox.x)), Math.round(finalBox.width)),
      height: Math.min(meta.height - Math.max(0, Math.round(finalBox.y)), Math.round(finalBox.height)),
    }).resize({ width: 900 }).png().toFile(previewPath)

    if (!APPLY) {
      console.log(`${label}: ✅ 最终裁片框 ${JSON.stringify(finalBox)} → 预览 ${previewPath}`)
      results.push({ id: r.id, label, ok: true, box: safe, finalBox, preview: previewPath, applied: false })
      continue
    }

    const upUrl = await cropAndUploadGeometryImage(pageBuf, px, r.student_id, r.id)
    if (!upUrl) {
      console.log(`${label}: ⛔ 生产线收紧判定"分不出图形"，不给配图`)
      results.push({ label, ok: false, reason: '收紧判定非图形' })
      continue
    }
    await pool.query(
      `UPDATE questions SET geometry_image_url = $2, image_type = COALESCE(image_type, $3),
              image_bbox = $4, updated_at = NOW() WHERE id = $1`,
      [r.id, upUrl, itype === 'none' ? 'geometry' : itype, JSON.stringify(safe)])
    console.log(`${label}: ✅ 已裁并写库 → ${upUrl}`)
    results.push({ id: r.id, label, ok: true, box: safe, url: upUrl, preview: previewPath, applied: true })
  } catch (e) {
    console.log(`${label}: ❌ ${e.message}`)
    results.push({ label, ok: false, reason: e.message })
  }
}

// 快照
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const snap = `D:/Minxue_App_V3/server/backups/recrop-missing-figures-${stamp}.json`
fs.mkdirSync(path.dirname(snap), { recursive: true })
fs.writeFileSync(snap, JSON.stringify({ at: new Date().toISOString(), apply: APPLY, before: rows.map(r => ({ id: r.id, geometry_image_url: r.geometry_image_url, image_type: r.image_type })), results }, null, 2), 'utf8')

const ok = results.filter(r => r.ok).length
console.log(`\n──── 汇总 ────\n识别到配图 ${ok} / 共 ${rows.length} 条；写库 ${results.filter(r => r.applied).length} 条`)

// ── 回填 is_complete（闭环） ──
// 补上图之后，动态口径（引图判定含 parent_stem）才判它完整；不回填就会出现
// 「图已经补上了，但错题本/课件仍按 is_complete=FALSE 过滤掉」的假阴性。
// 反向同理：本次补裁失败的题保持 FALSE，继续被挡住，避免残题流进重练。
if (APPLY) {
  const appliedIds = results.filter(r => r.applied && r.id).map(r => r.id)
  if (appliedIds.length > 0) {
    try {
      const { checked, updated } = await syncQuestionCompleteness(appliedIds)
      console.log(`🧮 is_complete 回填：检查 ${checked} 题、更新 ${updated} 题`)
    } catch (e) {
      console.error(`⚠️ is_complete 回填失败（配图已写入，可重跑 backfill-question-completeness.mjs）: ${e.message}`)
    }
  }
}

console.log(`快照/预览根目录：${previewDir}\n记录：${snap}`)
if (!APPLY) console.log('（dry-run 未写库、未上传。确认预览图后加 --apply 执行）')
await pool.end()
