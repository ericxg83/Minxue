/**
 * 「补裁兜底清扫」—— 救回「有合格配图框却因异步补写错过裁图窗口」的配图（B1，2026-09-27）
 *
 * ── 根因（A 阶段诊断实锤，见 _缺图根因归因诊断-错题-20260927.md）──
 * 缺图错题最大一类（N4，占 51%）是：questions 里 image_type='geometry'、image_bbox 有值、
 * 也过了两道运行时闸，但 geometry_image_url 仍为空。原因是配图框常被**异步补写**
 * （答案/重解析/几何重绘阶段才落 image_bbox），而裁图只在 OCR 采集那一刻跑一次 ——
 * 补框时早已过了裁图窗口，于是"有框无图"。这与 wrongBookCompensation 当年修的
 * 「答案异步补齐后无人回写」是同一类时序缺口。
 *
 * ── 为什么这个清扫是安全的（可自动化、无需人工逐张复核）──
 * 复用生产同一个 `cropAndUploadGeometryImage`：它内部先跑 `refineFigureBoxOnPage`
 * （像素墨迹收紧，**非模型调用，零配额成本**），"该区域分不出图形就返回 null、不给配图"。
 * 所以：
 *   · 框压在文字/选项上 → refine 判非图形 → 返回 null → 维持缺图（宁缺毋滥，不污染）；
 *   · 框确实指着真图     → 收紧裁出干净配图 → 写 geometry_image_url（救回）。
 * 这与批改管线正常裁图是**同一个函数、同一套判据**，不引入新口径、不新增漂移风险。
 * 裁成功后由 syncQuestionCompleteness 回写 is_complete，再由「补入兜底清扫」自动入错题本。
 *
 * 幂等：geometry_image_url 已有值的题一律跳过，绝不覆盖既有配图（含老师手补/重绘产物）。
 */
import { query, TABLES } from '../config/neon.js'
import sharp from 'sharp'
import { cropAndUploadGeometryImage, isDegenerateFigureBox, clampImageBboxToBlock } from '../worker.js'
import { denormalizeBbox } from '../utils/geometryCrop.js'
import { isCroppableMissingRow, isInheritableMissingRow } from '../utils/figureRecrop.js'
import { syncQuestionCompleteness } from './questionCompletenessSync.js'

const parseJson = (v) => {
  if (v == null) return null
  if (typeof v === 'object') return v
  try { return JSON.parse(v) } catch { return null }
}

// 候选查询：join tasks 拿原始页图，只取未软删、题所属 task 未删、且 task 有 images 的
const CANDIDATE_SQL = `
  SELECT q.id, q.student_id, q.task_id, q.page_number, q.question_number, q.sub_no,
         q.content, q.parent_stem, q.image_bbox, q.image_type, q.geometry_image_url,
         q.block_coordinates, t.images AS task_images
    FROM ${TABLES.QUESTIONS} q
    JOIN ${TABLES.TASKS} t ON t.id = q.task_id
   WHERE q.geometry_image_url IS NULL
     AND q.image_type = 'geometry'
     AND q.image_bbox IS NOT NULL
     AND q.deleted_at IS NULL
     AND t.deleted_at IS NULL
     AND t.images IS NOT NULL
     AND (COALESCE(q.parent_stem,'') || COALESCE(q.content,'')) ~ '如图|图[0-9]+|图示|附图|见图'
   ORDER BY q.updated_at DESC
   LIMIT $1`

/**
 * 对单题补裁。pageBuffer 必须传（该题所在页的原始图 buffer）。
 * @returns {Promise<{status:'cropped'|'rejected'|'no_page'|'skip_exists'|'error', url?:string, reason?:string}>}
 */
export const recropMissingFigure = async (question, pageBuffer) => {
  if (question.geometry_image_url) return { status: 'skip_exists' }
  if (!pageBuffer) return { status: 'no_page' }
  const bbox = parseJson(question.image_bbox)
  if (!bbox) return { status: 'rejected', reason: 'no-box' }

  // 与 geometryCrop.js 同序：先在归一化坐标上过两道闸，再降归一化裁图
  const block = parseJson(question.block_coordinates)
  if (isDegenerateFigureBox(bbox, block)) return { status: 'rejected', reason: 'degenerate' }
  const safe = clampImageBboxToBlock(bbox, block)
  if (!safe) return { status: 'rejected', reason: 'misplaced' }

  const meta = await sharp(pageBuffer).metadata()
  if (!meta.width || !meta.height) return { status: 'no_page' }
  const pixelBbox = denormalizeBbox(safe, meta.width, meta.height)

  // 生产同一个函数：内部像素收紧，判非图形返回 null（宁缺毋滥）
  const url = await cropAndUploadGeometryImage(pageBuffer, pixelBbox, question.student_id, question.id)
  if (!url) return { status: 'rejected', reason: 'refine-not-figure' }

  await query(
    `UPDATE ${TABLES.QUESTIONS} SET geometry_image_url = $2, updated_at = NOW() WHERE id = $1 AND geometry_image_url IS NULL`,
    [question.id, url]
  )
  await syncQuestionCompleteness([question.id])
  return { status: 'cropped', url }
}

/** 按页缓存 buffer，同 task 同页只下载一次 */
const makePageLoader = () => {
  const cache = new Map() // key = `${taskId}:${page}` -> Buffer|null
  return async (taskId, page, images) => {
    const key = `${taskId}:${page}`
    if (cache.has(key)) return cache.get(key)
    let buf = null
    try {
      const imgs = parseJson(images) || []
      const target = imgs.find(x => Number(x?.page_number) === Number(page)) || imgs[0]
      const url = target?.image_url
      if (url) buf = Buffer.from(await (await fetch(url)).arrayBuffer())
    } catch (e) {
      console.warn(`[补裁清扫] 页图下载失败 task=${taskId} p${page}: ${e.message}`)
    }
    cache.set(key, buf)
    return buf
  }
}

let _running = false

/**
 * 执行一次补裁兜底清扫。
 * @param {{limit?:number, dryRun?:boolean, logTag?:string}} [opts]
 * @returns {Promise<{scanned:number, cropped:number, rejected:number, noPage:number, ids:string[], skippedRun?:boolean}>}
 */
export const sweepFigureRecrop = async ({ limit = 50, dryRun = false, logTag = 'figure_recrop_sweep' } = {}) => {
  if (_running) return { scanned: 0, cropped: 0, rejected: 0, noPage: 0, ids: [], skippedRun: true }
  _running = true
  try {
    const { rows } = await query(CANDIDATE_SQL, [Math.max(1, Math.min(500, Number(limit) || 50))])
    const loadPage = makePageLoader()
    let cropped = 0, rejected = 0, noPage = 0
    const ids = []
    for (const row of rows) {
      if (!isCroppableMissingRow(row)) continue // 谓词二次校验，防 SQL 与 JS 判据漂移
      const page = row.page_number || 1
      const buf = await loadPage(row.task_id, page, row.task_images)
      if (!buf) { noPage++; continue }
      if (dryRun) {
        // 预演：不上传不写库，只统计会走哪条分支（闸口拒绝的当场判定）
        const bbox = parseJson(row.image_bbox)
        const block = parseJson(row.block_coordinates)
        const ok = bbox && !isDegenerateFigureBox(bbox, block) && !!clampImageBboxToBlock(bbox, block)
        if (ok) { cropped++; ids.push(row.id) } else rejected++
        continue
      }
      const res = await recropMissingFigure(row, buf)
      if (res.status === 'cropped') { cropped++; ids.push(row.id) }
      else if (res.status === 'no_page') noPage++
      else rejected++
    }
    if (cropped || rejected || noPage) {
      console.log(`  ✂️ [${logTag}] 补裁清扫：候选 ${rows.length}，${dryRun ? '可裁(预演) ' : '裁成功 '}${cropped}，判非图形/闸拒 ${rejected}，无页图 ${noPage}`)
    }
    return { scanned: rows.length, cropped, rejected, noPage, ids }
  } finally {
    _running = false
  }
}

/**
 * N5 兄弟配图继承（零裁图、零模型）：同 task + parent_stem 逐字相同 + 同页，
 * 兄弟小问已裁出 geometry_image_url → 直接复用同一张图（一道大题的多个小问共用一张配图）。
 * 根因：inheritSharedStemFigures 只在 OCR 采集时跑一次，而兄弟的框/图常被异步补写，
 * 继承那一刻兄弟还没图 → 本清扫在库现况上重做一次继承。
 * 幂等：geometry_image_url 已有值的不写（SQL 已过滤 + UPDATE 再卫）。
 */
const INHERIT_SQL = `
  SELECT DISTINCT ON (q.id) q.id, q.student_id, q.content, q.parent_stem, q.image_bbox, q.image_type, donor.geometry_image_url AS donor_url
    FROM ${TABLES.QUESTIONS} q
    JOIN ${TABLES.QUESTIONS} donor
      ON donor.task_id = q.task_id
     AND COALESCE(donor.parent_stem, '') = COALESCE(q.parent_stem, '')
     AND donor.page_number = q.page_number
     AND donor.id <> q.id
     AND donor.geometry_image_url IS NOT NULL
     AND donor.deleted_at IS NULL
   WHERE q.geometry_image_url IS NULL
     AND q.deleted_at IS NULL
     AND COALESCE(q.parent_stem, '') <> ''
     AND (q.image_bbox IS NULL OR q.image_type IS DISTINCT FROM 'geometry')
     AND (COALESCE(q.parent_stem,'') || COALESCE(q.content,'')) ~ '如图|图[0-9]+|图示|附图|见图'
   ORDER BY q.id, q.updated_at DESC, donor.id
   LIMIT $1`

let _inheritRunning = false
export const sweepFigureInherit = async ({ limit = 200, dryRun = false, logTag = 'figure_inherit_sweep' } = {}) => {
  if (_inheritRunning) return { scanned: 0, inherited: 0, ids: [], skippedRun: true }
  _inheritRunning = true
  try {
    // DISTINCT ON (q.id) 已保证每题一行（多个兄弟有图时按 donor.id 确定性取一条）
    const { rows } = await query(INHERIT_SQL, [Math.max(1, Math.min(500, Number(limit) || 200))])
    let inherited = 0
    const ids = []
    for (const r of rows) {
      if (!isInheritableMissingRow(r) || !r.donor_url) continue // 谓词二次校验（防 SQL/JS 漂移）
      if (dryRun) { inherited++; ids.push(r.id); continue }
      const res = await query(
        `UPDATE ${TABLES.QUESTIONS} SET geometry_image_url = $2, updated_at = NOW() WHERE id = $1 AND geometry_image_url IS NULL`,
        [r.id, r.donor_url]
      )
      if ((res.rowCount || 0) > 0) {
        await syncQuestionCompleteness([r.id])
        inherited++; ids.push(r.id)
      }
    }
    if (inherited) console.log(`  \ud83d\udd17 [${logTag}] 兄弟配图继承：${dryRun ? '可继承(预演) ' : '已继承 '}${inherited} 题（复用同题组已有配图）`)
    return { scanned: rows.length, inherited, ids }
  } finally {
    _inheritRunning = false
  }
}

/**
 * 排程：启动后延迟首扫（补上服务未运行期间异步补框的题），此后每 N 小时一次。
 * 开关 FIGURE_RECROP_SWEEP_ENABLED=false 可整体关停（默认开）。
 * 与「补入兜底清扫」是一对：本清扫补出图 → 完整性翻真 → 补入清扫自动入错题本。
 */
export function scheduleFigureRecropSweep() {
  if (/^(0|false|off)$/i.test(String(process.env.FIGURE_RECROP_SWEEP_ENABLED || ''))) {
    console.log('✂️ 配图补裁清扫：已通过 FIGURE_RECROP_SWEEP_ENABLED 关闭')
    return
  }
  const hours = Number(process.env.FIGURE_RECROP_SWEEP_INTERVAL_HOURS) || 6
  const limit = Number(process.env.FIGURE_RECROP_SWEEP_LIMIT) || 50
  const run = async (trigger) => {
    // 先补裁（产生新 donor 图），再继承（把图共享给同题组无框小问）
    try { await sweepFigureRecrop({ limit, logTag: `figure_recrop_sweep:${trigger}` }) } catch (e) { console.error(`[配图补裁清扫] (${trigger}) 异常:`, e.message) }
    try { await sweepFigureInherit({ logTag: `figure_inherit_sweep:${trigger}` }) } catch (e) { console.error(`[兄弟配图继承] (${trigger}) 异常:`, e.message) }
  }
  // 启动后延迟 3 分钟首扫（比补入清扫更晚，错开启动 I/O 高峰），随后周期化
  setTimeout(() => run('startup'), 180_000).unref?.()
  setInterval(() => run('interval'), hours * 3600_000).unref?.()
  console.log(`✂️ 配图补裁清扫：已排程（启动后 3min 首扫，之后每 ${hours}h，每次上限 ${limit} 题）`)
}

export default { sweepFigureRecrop, sweepFigureInherit, recropMissingFigure, isCroppableMissingRow, scheduleFigureRecropSweep }
