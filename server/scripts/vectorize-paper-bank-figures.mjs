/**
 * ⛔ 已停止（2026-11-03 10:26 负责人定调）：试卷题库这个场景**不需要矢量**。
 * 原话：「这个场景下没必要矢量了。如果已经矢量的了，钱都花了，你就别删除掉已做了的，
 * 以后按新标准就好了。」⇒ 新标准 = 全部 4x 高清裁片（≈288dpi、q92），无模糊无锯齿。
 *
 * 存量 3 张已验证矢量（徐汇24 / 杨浦23 / 嘉定23）继续生效、**不删**：
 * paperBank 路由的 vec_url 附着保留，列表/讲解版仍是「有 vec 用 vec、没有回落高清裁片」。
 * 只是**不再生产新的**：本脚本默认直接退出，仅 `--legacy` 可进入归档/应急模式。
 *
 * 若将来 --legacy 真要跑，三道关缺一不可：
 *   ① 输入必须 4x 高清裁片；② content gate 硬规则 3.5 字母误读判据必须过；
 *   ③ 逐张人工目验（自动指标全绿 ≠ 画得对）。
 * 历史事故：嘉定 23 字母错位+D/E/F 错配（11-03）；徐汇 25 三面板捏单图（11-02）；
 *          嘉定 24 抛物线画成 V 形折线（11-03）；嘉定 23 首绘 F→H（11-03）。
 */
import { fileURLToPath } from 'url'
import path from 'path'
import crypto from 'crypto'
import dotenv from 'dotenv'
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) })
import sharp from 'sharp'
import { getPool } from '../config/neon.js'
import { uploadBufferToKey } from '../services/ossService.js'
import { reconstructGeometrySvg } from '../geometryWorker.js'
import { detectNonGeometryFigure } from '../utils/geometryContentGate.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'

const args = process.argv.slice(2)
const argOf = (name, def = '') => {
  const hit = args.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=') : def
}
const DRY = args.includes('--dry')
const FORCE = args.includes('--force')
const QLIST = argOf('q', '23,24,25').split(',').map(s => s.trim()).filter(Boolean)

// 停用闸：默认拒跑，防止新卷流程/顺手一跑白烧视觉额度（2026-11-03 10:26）。
if (!args.includes('--legacy')) {
  console.log('⛔ 矢量重绘已停止（2026-11-03 负责人定：此场景不需要矢量，全部走高清明细裁片）。')
  console.log('   存量 3 张已验证 SVG 继续生效；本脚本仅留档，确需应急请显式传 --legacy。')
  process.exit(0)
}

const PROGRESS_PATH = new URL('./logs/paper-vec/progress.json', import.meta.url)
const progress = existsSync(PROGRESS_PATH)
  ? JSON.parse(readFileSync(PROGRESS_PATH, 'utf8'))
  : {}

const pool = getPool()

// --resource=<id 或 id 前缀>：只处理指定卷。不加则扫全部 exam；
// 进度文件里 ok:false 的历史拒绝/失败条目不会自动跳过（只有 ok:true 跳），
// 新卷接入时用它避免重烧旧卷的额度（2026-11-03 嘉定接入实测）。
const RES = argOf('resource', '')

const papers = await pool.query(`
  SELECT id, name FROM resources
  WHERE resource_type = 'exam' ${RES ? 'AND id::text LIKE $1' : ''}
  ORDER BY created_at
`, RES ? [RES + '%'] : [])

// 收集目标行：每套卷的指定题号
const targets = []   // { resource, questionNo, rows, source }
for (const p of papers.rows) {
  const res = await pool.query(`
    SELECT id, question_no, sub_no, content, options, parent_stem, image_url, bbox
    FROM resource_questions
    WHERE resource_id = $1
      AND question_no::text = ANY($2)
      AND image_url IS NOT NULL AND image_url::text <> ''
    ORDER BY LENGTH(question_no::text), question_no, sub_no
  `, [p.id, QLIST])
  const byQ = new Map()
  for (const r of res.rows) {
    const qn = String(r.question_no)
    if (!byQ.has(qn)) byQ.set(qn, [])
    byQ.get(qn).push(r)
  }
  for (const [qn, rows] of byQ) {
    // 源行 = 组内 bbox 高度最大的行（与配图共享同一判据：它才是带图的那行）
    const hOf = (r) => (r.bbox ? Number(r.bbox.height) || 0 : 0)
    const source = [...rows].sort((a, b) => hOf(b) - hOf(a))[0]
    targets.push({ resource: p, questionNo: qn, rows, source })
  }
}

console.log(`目标：${targets.length} 道题（q=${QLIST.join(',')}，dry=${DRY}）`)
if (DRY) {
  for (const t of targets) {
    const done = progress[t.progressKey || '']
    console.log(`  [dry] ${t.resource.name} q${t.questionNo} <- 行${t.source.id.slice(0, 8)}(sub=${t.source.sub_no || '-'}, bboxH=${t.source.bbox ? Math.round(t.source.bbox.height) : '?'}) ${t.rows.length} 行将共享`)
  }
  process.exit(0)
}

if (!existsSync(path.dirname(fileURLToPath(PROGRESS_PATH)))) mkdirSync(path.dirname(fileURLToPath(PROGRESS_PATH)), { recursive: true })

const results = []
for (const t of targets) {
  const progressKey = `${t.resource.id.slice(0, 8)}|q${t.questionNo}`
  const label = `${t.resource.name} q${t.questionNo}`
  if (!FORCE && progress[progressKey]?.ok) {
    console.log(`[跳] ${label} 已有成功产物（--force 可重跑）`)
    results.push({ label, status: 'skipped_done' })
    continue
  }
  try {
    const cropUrl = t.source.image_url
    const resp = await fetch(cropUrl)
    if (!resp.ok) throw new Error(`裁片下载失败 http=${resp.status}`)
    const jpgBuf = Buffer.from(await resp.arrayBuffer())

    // ── 注册侧同款闸：非几何图（流程图/表格/格点/多面板）不重绘 ──
    // 闸文本 = 组内全部题面文本：多面板引用（图1+图2）可能分散在两个小问行，
    // 只看源行会漏（2026-11-02 杨浦24「图1/图2 抛物线双面板」实测漏网）。
    const groupText = [t.source.parent_stem, ...t.rows.map(r => r.content)].filter(Boolean).join('\n')
    const nonGeom = detectNonGeometryFigure(groupText)
    if (nonGeom.skip) {
      console.log(`[拒] ${label}: ${nonGeom.kind} —— ${nonGeom.reason}（保持裁片）`)
      progress[progressKey] = { ok: false, reason: nonGeom.kind, at: new Date().toISOString() }
      results.push({ label, status: 'rejected', reason: nonGeom.kind })
      writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2))
      continue
    }

    // ── 小图放大（2026-11-02 徐汇24 教训）：裁片里的图形太小时模型读错字母
    //    （梯形左下顶点 D 被误读成 P）。按 09-21 手工补裁同款判据：短边放大到 800。
    let img = sharp(jpgBuf)
    const meta = await img.metadata()
    const w = meta.width || 800
    const h = meta.height || 800
    const minSide = Math.min(w, h)
    if (minSide < 800) {
      const scale = Math.min(800 / minSide, 6)
      img = sharp(jpgBuf).resize({ width: Math.round(w * scale), height: Math.round(h * scale) })
    }
    // reconstructGeometrySvg 的 dataURL 写死 image/png：统一转 PNG（视觉/复核两条通道同源）
    const pngBuf = await img.png().toBuffer()

    const r = await reconstructGeometrySvg(
      pngBuf,
      t.source.id,
      String(t.source.content || ''),
      Array.isArray(t.source.options) ? t.source.options : [],
      String(t.source.parent_stem || ''),
      false
    )
    if (!r.ok) {
      console.log(`[拒] ${label}: ${r.reason}${r.detail ? ' — ' + r.detail.join('；') : ''}（保持裁片）`)
      progress[progressKey] = { ok: false, reason: r.reason, at: new Date().toISOString() }
      results.push({ label, status: 'rejected', reason: r.reason })
    } else {
      const key = `paper-bank/vec/${t.resource.id}/${t.questionNo}.svg`
      const svgBuf = Buffer.from(r.svg, 'utf8')
      const url = await uploadBufferToKey(svgBuf, key, 'image/svg+xml')
      const sizeHash = crypto.createHash('sha256').update(svgBuf).digest('hex').slice(0, 8)
      progress[progressKey] = {
        ok: true, at: new Date().toISOString(), url: key, sha8: sizeHash,
        sourceRow: t.source.id, rows: t.rows.map(x => x.id),
        structure: r.structure,
      }
      console.log(`[成] ${label}: ${key}（${svgBuf.length}B, sha8=${sizeHash}，${t.rows.length} 行共享）`)
      results.push({ label, status: 'ok', key })
    }
  } catch (e) {
    console.log(`[败] ${label}: ${String(e.message || e).slice(0, 160)}`)
    progress[progressKey] = { ok: false, reason: 'error', error: String(e.message || e).slice(0, 200), at: new Date().toISOString() }
    results.push({ label, status: 'error', error: String(e.message || e).slice(0, 100) })
  }
  writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2))
}

const ok = results.filter(r => r.status === 'ok').length
console.log(`\n完成：成功 ${ok} / 拒绝 ${results.filter(r => r.status === 'rejected').length} / 失败 ${results.filter(r => r.status === 'error').length} / 跳过 ${results.filter(r => r.status === 'skipped_done').length}`)
console.log('⚠️ 重跑后必须逐张目视验收（指标好看 ≠ 画得对）——rasterize SVG 对照原图。')
process.exit(0)
