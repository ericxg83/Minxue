/**
 * 「视觉重定位」配图清扫（B2，2026-09-27）—— 治「图确实在卷上、但自动裁/弱视觉没定位到」
 *
 * 与 figureRecropSweep 的分工：
 *   · figureRecropSweep：题已有【合格框】却无图 → 直接用现有框补裁（零模型）。
 *   · 本服务：题【无框或框不可用】→ 调【强视觉模型重新定位】配图框，再裁（有模型成本）。
 *
 * 两个真实失败模式（A 诊断 + 逐页肉眼核实）：
 *   ① 弱视觉链（deepseek-flash）对「图离题干远 / 一页多图集中排」定位不准 → 用强视觉 gemini-3.7-flash。
 *   ② 配图常在题干【下一页】顶部（跨页），只搜本题页必然找不到 → 搜 本题页 ±1。
 *
 * 安全（不放宽任何闸）：定位到的新框仍过 isDegenerateFigureBox / clampImageBboxToBlock 两道闸，
 * 再交生产同一 cropAndUploadGeometryImage（内部像素墨迹收紧，判非图形返回 null）。
 * 模型说「无图」或框被判非图形 → 维持缺图（宁缺毋滥），绝不硬塞文字图。
 * 幂等：geometry_image_url 已有值不覆盖。
 */
import { query, TABLES } from '../config/neon.js'
import sharp from 'sharp'
import { callVisionCompletion } from '../config/ai.js'
import { cropAndUploadGeometryImage, isDegenerateFigureBox, clampImageBboxToBlock } from '../worker.js'
import { denormalizeBbox } from '../utils/geometryCrop.js'
import { hasFigureReference } from '../utils/questionCompleteness.js'
import { normalizeStem } from '../utils/stemNormalize.js'
import { syncQuestionCompleteness } from './questionCompletenessSync.js'
import { compensateWrongBook } from './wrongBookCompensation.js'

const parseJson = (v) => {
  if (v == null) return null
  if (typeof v === 'object') return v
  try { return JSON.parse(v) } catch { return null }
}

// 强视觉定位链：gemini-3.7-flash（强视觉白名单）主，qwen3.8-flash 兜。
const STRONG_VL_CHAIN = [
  { vendor: 'HuihuiyunGemini', model: 'gemini-3.7-flash' },
  { vendor: 'Bailian', model: 'qwen3.8-flash' },
]

const PROMPT = `你是作业图片版面分析助手。用户会指定页面上的某一道题，请只做一件事：
给出**这道题的配图（图形本身）**在这张图上的外接矩形。

只返回 JSON，格式：
{"image_type":"geometry|chart|none","image_bbox":{"x":0,"y":0,"width":0,"height":0},"reason":"简述依据"}

规则：
1. 坐标用 0-1000 的整数，相对整张图归一化；width/height 是【宽和高】，不是右下角坐标。
2. image_bbox 只框【图形本身】（几何图、函数图像、坐标系、统计图、示意图），不要把题干文字、
   选项文字、答题横线、学生手写、老师批改痕迹（√/×/分数）框进去。
3. 配图可能不在题干正下方，而在本页的右侧、上方、页面角落，甚至本题文字延续到的相邻位置；
   请通读整页找到属于本题的那一格图。
4. 若这道题在本页上确实没有任何印刷配图（纯代数计算题、要求"画出图像"但卷上没画），
   image_type 填 "none"、image_bbox 填 null。绝不要用题干区域坐标凑框。`

/** 在给定页 buffer 上定位本题配图并裁出；成功返回 url，失败返回 null（不写库） */
const locateAndCropOnPage = async (pageBuf, q, dryRun) => {
  const meta = await sharp(pageBuf).metadata()
  if (!meta.width || !meta.height) return null
  const qtext = ((q.parent_stem || '') + ' ' + (q.content || '')).replace(/\s+/g, ' ').slice(0, 220)
  const userText = `这张图是学生作业的整页照片。请定位【第 ${q.question_number} 题】${q.sub_no ? `第 (${q.sub_no}) 小问` : ''}的配图。\n该题题干：${qtext}\n\n给出配图外接矩形。`
  let out
  try {
    out = await callVisionCompletion({
      imageDataURL: `data:image/jpeg;base64,${pageBuf.toString('base64')}`,
      systemPrompt: PROMPT,
      userText,
      temperature: 0.1,
      maxTokens: 400,
      vendorChain: STRONG_VL_CHAIN,
    })
  } catch (e) {
    return null // 该页调模型失败 → 试下一页
  }
  const text = typeof out === 'string' ? out : (out?.content || out?.text || '')
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  let parsed
  try { parsed = JSON.parse(m[0]) } catch { return null }
  const box = parsed.image_bbox
  const itype = parsed.image_type || 'geometry'
  if (!box || itype === 'none') return null
  const block = parseJson(q.block_coordinates)
  if (isDegenerateFigureBox(box, block)) return null
  const safe = clampImageBboxToBlock(box, block)
  if (!safe) return null
  const pixelBbox = denormalizeBbox(safe, meta.width, meta.height)
  if (dryRun) return { dry: true, box: safe }
  // 强视觉定位的框已过退化/超大两道 JS 闸；像素墨迹收紧对数轴/方格/线稿等稀疏图形会误杀
  // （实测 gemini 定位的干净图 17/18 被它拒），故本路径 skipRefine，直接按强模型框裁。
  const url = await cropAndUploadGeometryImage(pageBuf, pixelBbox, q.student_id, q.id, { skipRefine: true })
  return url || null
}

/**
 * 对单题重定位：搜 本题页 ±1（跨页配图），任一页定位到干净真图即裁出写库。
 * @param {Object} q 题目行（含 id/student_id/task_id/page_number/question_number/sub_no/content/parent_stem/block_coordinates）
 * @param {Array<{page:number, buffer:Buffer}>} pages 该 task 已下载的页 buffer 列表
 */
export const relocateOneFigure = async (q, pages, { dryRun = false } = {}) => {
  if (q.geometry_image_url) return { status: 'skip_exists' }
  const pg = Number(q.page_number) || 1
  // 优先本题页，再 ±1（跨页配图）
  const order = [pg, pg + 1, pg - 1]
    .map(p => pages.find(x => Number(x.page) === p))
    .filter(Boolean)
  for (const cand of order) {
    const res = await locateAndCropOnPage(cand.buffer, q, dryRun)
    if (!res) continue
    if (dryRun && res.dry) return { status: 'croppable', page: cand.page }
    if (res && typeof res === 'string') {
      await query(
        `UPDATE ${TABLES.QUESTIONS} SET geometry_image_url = $2, image_type = COALESCE(image_type,'geometry'), updated_at = NOW() WHERE id = $1 AND geometry_image_url IS NULL`,
        [q.id, res]
      )
      await syncQuestionCompleteness([q.id])
      // 闭环：补图后题转完整，若为真判错未入册题→自动入错题本（经置信度/完整性闸，低置信留老师）
      try { await compensateWrongBook({ studentId: q.student_id, questionIds: [q.id], reason: 'figure_relocate' }) } catch { /* 入册失败不阻断补图，下次清扫重试 */ }
      return { status: 'cropped', url: res, page: cand.page }
    }
  }
  return { status: 'no_figure' }
}

const CANDIDATE_SQL = `
  SELECT q.id, q.student_id, q.task_id, q.page_number, q.question_number, q.sub_no,
         q.content, q.parent_stem, q.block_coordinates, q.image_bbox, q.image_type, q.geometry_image_url
    FROM ${TABLES.QUESTIONS} q
    JOIN ${TABLES.TASKS} t ON t.id = q.task_id
   WHERE q.geometry_image_url IS NULL
     AND q.deleted_at IS NULL
     AND t.deleted_at IS NULL
     AND t.images IS NOT NULL
     AND (COALESCE(q.parent_stem,'') || COALESCE(q.content,'')) ~ '如图|图[0-9]+|图示|附图|见图'
     AND (q.is_correct = FALSE OR q.answer_source = 'blank')
   ORDER BY q.updated_at DESC
   LIMIT $1`

let _running = false
/**
 * 视觉重定位清扫（默认只处理缺图错题）。
 * @param {{limit?:number, dryRun?:boolean, logTag?:string}} [opts]
 */
export const sweepFigureRelocate = async ({ limit = 30, dryRun = false, logTag = 'figure_relocate_sweep' } = {}) => {
  if (_running) return { scanned: 0, cropped: 0, noFigure: 0, ids: [], skippedRun: true }
  _running = true
  try {
    const { rows } = await query(CANDIDATE_SQL, [Math.max(1, Math.min(200, Number(limit) || 30))])
    // 按 task 缓存页 buffer（含 ±1 页）
    const pageCache = new Map() // taskId -> [{page, buffer}]
    const getPages = async (taskId, images) => {
      if (pageCache.has(taskId)) return pageCache.get(taskId)
      const imgs = parseJson(images) || []
      const list = []
      for (const im of imgs) {
        const p = Number(im?.page_number) || (list.length + 1)
        if (!im?.image_url) continue
        try { list.push({ page: p, buffer: Buffer.from(await (await fetch(im.image_url)).arrayBuffer()) }) }
        catch { /* 单页下载失败跳过 */ }
      }
      pageCache.set(taskId, list)
      return list
    }
    // 需要 task.images：重新按 taskId 群取（CANDIDATE_SQL 未取 images，单独查一次缓存）
    const taskImgs = new Map()
    const { rows: trows } = await query(
      `SELECT id, images FROM ${TABLES.TASKS} WHERE id = ANY($1::uuid[])`,
      [[...new Set(rows.map(r => r.task_id))]]
    )
    for (const t of trows) taskImgs.set(t.id, t.images)

    let cropped = 0, noFigure = 0
    const ids = []
    for (const q of rows) {
      if (!hasFigureReference(q) || q.geometry_image_url) continue
      const pages = await getPages(q.task_id, taskImgs.get(q.task_id))
      if (pages.length === 0) { noFigure++; continue }
      const res = await relocateOneFigure(q, pages, { dryRun })
      if (res.status === 'cropped' || res.status === 'croppable') { cropped++; ids.push(q.id) }
      else noFigure++
    }
    console.log(`  👁 [${logTag}] 视觉重定位：候选 ${rows.length}，${dryRun ? '可裁(预演) ' : '裁成功 '}${cropped}，无干净图/失败 ${noFigure}`)
    return { scanned: rows.length, cropped, noFigure, ids }
  } finally {
    _running = false
  }
}

/**
 * 跨学生同题配图共享（零模型）：同一份练习卷题发给多个学生，
 * 若某个学生的扫描拍到了配图、另一个学生的扫描把图切在页外（跨页/页底），
 * 则按【归一化题干精确相等】（AGENTS #9：禁相似度阈值合并）把有图实例的配图
 * 复用给无图实例。图是同一张印刷配图，展示给谁都对。
 * 幂等：已有图不覆盖。
 */
export const sweepFigureCrossStudentShare = async ({ dryRun = false, logTag = 'figure_crossshare' } = {}) => {
  // 1) 全库有配图的引图题 → normalizeStem 建索引（同干取首个有图 URL）
  const { rows: donors } = await query(
    `SELECT id, COALESCE(parent_stem,'') AS parent_stem, content, geometry_image_url
       FROM ${TABLES.QUESTIONS}
      WHERE geometry_image_url IS NOT NULL AND deleted_at IS NULL`
  )
  const donorByUrl = new Map()
  for (const d of donors) {
    const key = normalizeStem(`${d.parent_stem} ${d.content || ''}`)
    if (key && !donorByUrl.has(key)) donorByUrl.set(key, d.geometry_image_url)
  }
  // 2) 缺图引图错题（目标）
  const { rows: targets } = await query(
    `SELECT q.id, q.student_id, COALESCE(q.parent_stem,'') AS parent_stem, q.content, q.geometry_image_url
       FROM ${TABLES.QUESTIONS} q LEFT JOIN ${TABLES.TASKS} t ON t.id = q.task_id
      WHERE q.geometry_image_url IS NULL AND q.deleted_at IS NULL
        AND (t.id IS NULL OR t.deleted_at IS NULL)
        AND (q.is_correct = FALSE OR q.answer_source = 'blank')
        AND (COALESCE(q.parent_stem,'') || COALESCE(q.content,'')) ~ '如图|图[0-9]+|图示|附图|见图'`
  )
  let shared = 0
  const ids = []
  for (const q of targets) {
    if (!hasFigureReference(q)) continue
    const key = normalizeStem(`${q.parent_stem} ${q.content || ''}`)
    const url = key && donorByUrl.get(key)
    if (!url) continue
    if (dryRun) { shared++; ids.push(q.id); continue }
    const res = await query(
      `UPDATE ${TABLES.QUESTIONS} SET geometry_image_url = $2, updated_at = NOW() WHERE id = $1 AND geometry_image_url IS NULL`,
      [q.id, url]
    )
    if ((res.rowCount || 0) > 0) {
      await syncQuestionCompleteness([q.id])
      try { await compensateWrongBook({ studentId: q.student_id, questionIds: [q.id], reason: 'figure_crossshare' }) } catch { /* 不阻断 */ }
      shared++; ids.push(q.id)
    }
  }
  if (shared) console.log(`  🔁 [${logTag}] 跨学生同题配图共享：${dryRun ? '可共享(预演) ' : '已共享 '}${shared} 题`)
  return { scanned: targets.length, shared, ids }
}

/**
 * 排程：周期对新增缺图错题跑一次强视觉重定位（付费模型，频率保守）。
 * 开关 FIGURE_RELOCATE_SWEEP_ENABLED=false 可关停；默认开（负责人要求用视觉把缺图补齐）。
 * 上限小 + 间隔长，避免对存量不可救题反复烧配额。
 */
export function scheduleFigureRelocateSweep() {
  if (/^(0|false|off)$/i.test(String(process.env.FIGURE_RELOCATE_SWEEP_ENABLED || ''))) {
    console.log('👁 配图视觉重定位清扫：已通过 FIGURE_RELOCATE_SWEEP_ENABLED 关闭')
    return
  }
  const hours = Number(process.env.FIGURE_RELOCATE_SWEEP_INTERVAL_HOURS) || 24
  const limit = Number(process.env.FIGURE_RELOCATE_SWEEP_LIMIT) || 20
  const run = async (trigger) => {
    // 先零成本跨学生同题共享（同卷题图直接复用），再对仍缺图的跑付费强视觉重定位（降低配额消耗）
    try { await sweepFigureCrossStudentShare({ logTag: `figure_crossshare:${trigger}` }) }
    catch (e) { console.error(`[跨学生配图共享] (${trigger}) 异常:`, e.message) }
    try { await sweepFigureRelocate({ limit, logTag: `figure_relocate_sweep:${trigger}` }) }
    catch (e) { console.error(`[配图视觉重定位] (${trigger}) 异常:`, e.message) }
  }
  // 启动后 8 分钟首扫（晚于补裁/继承/补入，错开启动 I/O），随后周期化
  setTimeout(() => run('startup'), 480_000).unref?.()
  setInterval(() => run('interval'), hours * 3600_000).unref?.()
  console.log(`👁 配图视觉重定位清扫：已排程（启动后 8min 首扫，之后每 ${hours}h，上限 ${limit} 题/次，付费强视觉）`)
}

export default { relocateOneFigure, sweepFigureRelocate, sweepFigureCrossStudentShare, scheduleFigureRelocateSweep }
