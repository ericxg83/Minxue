/**
 * 试卷题库配图「按 11-03 存量工序重渲染重裁」（2026-11-10 松江一模第四次报障根因修复）。
 *
 * ⛔ 根因：canvas.toBuffer('image/jpeg', quality) 用的是 **0~100 整数**。
 *    生产管线曾传 0.92 ⇒ 整页图只有 84KB（其他卷 432~558KB），从源头把所有裁片压糊。
 *    其他三套一模卷 11-03 用 `_rehi_papers_1103.mjs` 以 quality=92 重渲染过，所以清晰。
 *    ⇒ 本工具**严格照抄那道工序**，不做任何像素增强 / 插值放大 / 锐化。
 *
 * 工序（与生产 parsePageToQuestions 的裁片段同款实现，11-06「只挂干净图形带」口径）：
 *   ① resources.pdf_url → renderPdfToJpegs(scale=4, maxEdge=4096, quality=92)
 *   ② 每页整页图上传 → 按页 UPDATE page_image_url（老师点「看原卷」也是高清）
 *   ③ 每行按原 bbox → cropQuestionImage → analyzeCropFigure → band || 整张裁片 → 上传
 *   ④ 现网共用同一 URL 的多行（小问组）继续共用同一张新图，保持分组与显示结构不变
 *
 * 用法：
 *   node scripts/ops/rehi_paper_figures.mjs --resource=<uuid>            # 预演
 *   node scripts/ops/rehi_paper_figures.mjs --resource=<uuid> --apply     # 上传 + 写库
 *
 * 写库前逐行备份 `_backup_paper_rehi_<tag>.json`；只动 image_url / page_image_url。
 * 需要重启后端才能让 `CROP_RENDER_QUALITY=92` 对新导入的卷子生效（本脚本只修存量）。
 */
import { fileURLToPath } from 'url'
import fs from 'node:fs/promises'
import dotenv from 'dotenv'
dotenv.config({ path: fileURLToPath(new URL('../../server/.env', import.meta.url)) })
import { getPool } from '../../server/config/neon.js'
import { renderPdfToJpegs } from '../../server/services/pdfService.js'
import { cropQuestionImage } from '../../server/services/paperBankService.js'
import { analyzeCropFigure } from '../../server/services/paperFigureAssign.js'
import { uploadImage } from '../../server/services/ossService.js'

const args = process.argv.slice(2)
const arg = (k, d = '') => {
  const hit = args.find(a => a.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3) : d
}
const RES_ID = arg('resource')
const TAG = arg('tag', RES_ID.slice(0, 8))
const APPLY = args.includes('--apply')
if (!RES_ID) {
  console.error('用法: node scripts/ops/rehi_paper_figures.mjs --resource=<资源id> [--apply]')
  process.exit(1)
}
const DUMP = arg('dump')   // 预演时把新裁片写到该目录，供人工目验对照
const BACKUP = `_backup_paper_rehi_${TAG}.json`
const pool = getPool()

const { rows: papers } = await pool.query(
  `SELECT id, name, pdf_url FROM resources WHERE id=$1`, [RES_ID])
const paper = papers[0]
if (!paper?.pdf_url) { console.error('找不到题集或 pdf_url 为空'); process.exit(1) }
console.log(`paper: ${paper.name} (${RES_ID})`)
console.log(`pdf: ${paper.pdf_url}`)

const { rows } = await pool.query(
  `SELECT id, page_no, question_no, sub_no, bbox, image_url, page_image_url
     FROM resource_questions WHERE resource_id=$1
    ORDER BY page_no NULLS LAST, question_no, sub_no`, [RES_ID])
console.log('rows:', rows.length, 'with figure:', rows.filter(r => r.image_url).length)

const pdfBuf = Buffer.from(await (await fetch(paper.pdf_url)).arrayBuffer())
const rendered = await renderPdfToJpegs(pdfBuf, {
  scale: 4, maxPages: 60, maxEdge: 4096, quality: 92 })
console.log(`4x quality=92 rendered ${rendered.images.length} pages, first=${rendered.images[0]?.length}B (${Math.round(rendered.images[0]?.length / 1024)}KB)`)
if (!rendered.images.length) { console.error('渲染失败'); process.exit(1) }

const backup = []
let pageUpdated = 0, figUpdated = 0, uploaded = 0

// ① 整页图：按页去重上传
const pageNos = [...new Set(rows.map(r => Number(r.page_no)).filter(Number.isFinite))]
for (const pn of pageNos) {
  const buf = rendered.images[pn - 1]
  if (!buf) { console.log(`  [跳] 无 p${pn} 渲染页`); continue }
  console.log(`  [page] p${pn} ${buf.length}B`)
  if (!APPLY) continue
  const url = await uploadImage(buf, `paper-rehi-${TAG}-p${pn}.jpg`, 'paper-bank')
  if (!url) continue
  const affected = rows.filter(r => Number(r.page_no) === pn && r.page_image_url)
  const res = await pool.query(
    `UPDATE resource_questions SET page_image_url=$2 WHERE resource_id=$1 AND page_no=$3`,
    [RES_ID, url, pn])
  pageUpdated += res.rowCount
  for (const r of affected) backup.push({ id: r.id, kind: 'page', oldUrl: r.page_image_url, newUrl: url })
  uploaded++
}

// ② 配图：按现网 URL 分组（小问组继续共用），组内选 bbox 最高的行做图源
const groups = new Map()
for (const r of rows) {
  if (!r.image_url || !r.bbox) continue
  const key = String(r.image_url)
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(r)
}
console.log('figure groups:', groups.size)
for (const [oldUrl, rs] of groups) {
  const srcRows = [...rs].sort((a, b) => (Number(b.bbox?.height) || 0) - (Number(a.bbox?.height) || 0))
  let chosen = null
  for (const r of srcRows) {
    const hi = rendered.images[Number(r.page_no) - 1]
    if (!hi) continue
    const cropped = await cropQuestionImage(hi, r.bbox)
    if (!cropped) continue
    const fig = await analyzeCropFigure(cropped)
    const buf = fig.band || cropped
    chosen = { row: r, buf, band: !!fig.band }
    if (fig.band) break
  }
  if (!chosen) { console.log(`  [败] 组 ${oldUrl.split('/').pop().slice(0, 12)} 无可用裁片`); continue }
  console.log(`  [fig] p${chosen.row.page_no} q${chosen.row.question_no} ${chosen.buf.length}B band=${chosen.band} rows=${rs.length}`)
  if (DUMP) {
    await fs.mkdir(DUMP, { recursive: true })
    await fs.writeFile(`${DUMP}/p${chosen.row.page_no}q${chosen.row.question_no}.jpg`, chosen.buf)
  }
  if (!APPLY) continue
  const url = await uploadImage(chosen.buf, `paper-rehi-${TAG}-q${chosen.row.question_no}-${rs[0].id.slice(0, 8)}.jpg`, 'paper-bank')
  if (!url) { console.log('  [败] 上传失败'); continue }
  uploaded++
  const ids = rs.map(r => r.id)
  const res = await pool.query(
    `UPDATE resource_questions SET image_url=$2 WHERE id=ANY($1::uuid[]) AND image_url=$3`,
    [ids, url, oldUrl])
  if (res.rowCount !== ids.length) console.log(`  ⚠ 组更新 ${res.rowCount}/${ids.length}`)
  figUpdated += res.rowCount
  for (const r of rs) backup.push({ id: r.id, kind: 'figure', oldUrl, newUrl: url })
}

if (APPLY && backup.length) {
  await fs.writeFile(BACKUP, JSON.stringify({ resourceId: RES_ID, at: new Date().toISOString(), backup }, null, 2))
  console.log(`\n备份 -> ${BACKUP}（${backup.length} 行）`)
  const { rows: after } = await pool.query(
    `SELECT image_url, page_image_url FROM resource_questions WHERE resource_id=$1`, [RES_ID])
  const figUrls = [...new Set(after.map(r => r.image_url).filter(Boolean))]
  const pageUrls = [...new Set(after.map(r => r.page_image_url).filter(Boolean))]
  let ok = 0
  for (const u of [...figUrls, ...pageUrls]) {
    const resp = await fetch(u)
    if (resp.ok) ok++
  }
  console.log(`回读复核: fig URLs=${figUrls.length} page URLs=${pageUrls.length} HTTP ok=${ok}/${figUrls.length + pageUrls.length}`)
}
console.log(`\n完成: apply=${APPLY} uploaded=${uploaded} pageUpdated=${pageUpdated} figUpdated=${figUpdated}`)
await pool.end()
