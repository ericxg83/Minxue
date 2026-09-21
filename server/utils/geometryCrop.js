/**
 * 几何配图裁剪编排（两管线共享）
 *
 * ── 为什么单独成模块（2026-09-20 第04周《28.2（2）》整卷无配图事故）──
 *
 * 日常批改管线（`processTask`）里有一段「多模态切题」：把手写卷面上的几何图形按
 * `image_bbox` 裁成独立图片、上传 OSS、写进 `questions.geometry_image_url`。
 * 练习册批改管线（`processWorkbookGrading`）**没有这段** —— 它的 OCR prompt 连
 * 配图字段都没有，裁图代码更无从谈起。结果是：
 *
 *   · 练习册全库 26 任务 / 432 题里，引图题 215 道，`geometry_image_url` 全为空；
 *   · 错题本完整性闸（`checkQuestionCompleteness` 规则1）判它「题干引图但缺配图」，
 *     所以练习册管线历史上**不敢开这道闸**（一开就把 215 道题全挡在错题本外）；
 *   · 周末课件题单 / 讲题白板里的几何题没有图，老师对着一道没有图形的证明题讲不了。
 *
 * 两条管线做的是**同一件事**：把「这道题在卷面上的图形」裁出来。同一个算法抄两份
 * 必然漂移（本仓已有 `parseBbox` 抄三份的前车之鉴，故有
 * `test/questionBboxShared.test.mjs` 锁死）。所以编排逻辑收在本模块，两管线共用。
 *
 * ── 入参契约 ──
 *
 * 每个 `q` 需要（可选字段缺失即跳过该题）：
 *   · `id`              题目 UUID（OSS 文件名用）
 *   · `page_number`     题在卷面上的页码（取页 buffer 用）
 *   · `block_coordinates` 题目定位框（退化框判据的参照）
 *   · `image_type` / `image_bbox` / `geometry_image.bbox`  ← 本次新增采集
 *
 * 就地产出：`q.geometry_image_url`。
 *
 * ── 与 `cropAndUploadGeometryImage` 的关系 ──
 *
 * 本模块**只做编排**（筛选 → 继承 → 三道判据 → 降归一化 → 去重 → 调用裁剪），
 * 真正的「裁 + 上传」仍在 `cropAndUploadGeometryImage`（worker.js 导出），
 * 通过 `deps.cropImage` 注入，避免把 sharp / OSS 依赖搬进 utils。
 *
 * @module utils/geometryCrop
 */

import { hasFigureReference } from './questionCompleteness.js'
import { inheritSharedStemFigures, isDegenerateFigureBox, clampImageBboxToBlock } from './figureBoxTrust.js'

/**
 * 归一化 0-1000 坐标 → 像素坐标。
 *
 * ⚠️ `width` 按**图宽**、`height` 按**图高**，不能混用（曾把 height 按图宽算，
 * 在非正方形页面上把配图框纵向拉长）。
 *
 * @param {Object} bbox - {x, y, width, height}，取值 0-1000
 * @param {number} imgW - 目标图片实际宽度(px)
 * @param {number} imgH - 目标图片实际高度(px)
 * @returns {Object|null} 像素坐标 {x, y, width, height}
 */
export function denormalizeBbox(bbox, imgW, imgH) {
  if (!bbox || typeof bbox !== 'object') return bbox
  const n = (v) => (typeof v === 'number' && isFinite(v) ? v : 0)
  const clamp = (v) => Math.max(0, Math.min(1000, n(v)))
  return {
    ...bbox,
    x: Math.round(clamp(bbox.x) / 1000 * imgW),
    y: Math.round(clamp(bbox.y) / 1000 * imgH),
    width: Math.round(clamp(bbox.width) / 1000 * imgW),
    height: Math.round(clamp(bbox.height) / 1000 * imgH),
  }
}

/**
 * 按页裁剪几何配图，就地写 `q.geometry_image_url`。
 *
 * 与 `processTask` 内联版本逐步对齐：
 *   1. `inheritSharedStemFigures` —— 多小问大题拆分后，引图词只在 `parent_stem` 的小问
 *      继承公共配图框（2026-09-17 周末班课件第12题事故）。
 *   2. 筛出 `image_type !== 'none'` 且有 bbox 的题（兼容旧字段 `geometry_image`）。
 *   3. `isDegenerateFigureBox` —— 从题目框机械推出来的「题干下方一条」不要，
 *      裁出来是选项/题干文字，当配图展示纯属误导（宁可不给配图）。
 *   4. `clampImageBboxToBlock` —— 只在框明显失控时用本题 block 兜边界。
 *   5. 降归一化 → 按 `(页码, bbox)` 去重 → 裁剪上传（一图多题复用同一张 OSS 图）。
 *
 * ⛔ 不要在筛选里加「配图框必须与本题 block 纵向有交集」这类判据
 *    （2026-09-18 已实测证伪，假阳性约 28%）：上海作业常把多道题的配图集中排成一行、
 *    图下印「第N题图」，此时配图框必然落在本题 block **上方**。判断配图归属只能靠
 *    读图行标注，不能靠坐标互比。详见 worker.js 里的负面注释。
 *
 * @param {Object}   params
 * @param {Array}    params.questions   本次 OCR 出的全部题目（会就地改写）
 * @param {Map}      params.pageBuffers `Map<number, Buffer>` 页码 → 压缩页图 buffer
 * @param {Function} params.cropImage   裁剪上传实现：(buffer, pixelBbox, studentId, questionId) => Promise<string|null>
 * @param {string}   params.studentId   学生 UUID
 * @param {Object}   [params.fallbackBuffer] 页 buffer 缺失时的兜底 buffer（通常是第 1 页）
 * @param {number}   [params.fallbackPage=1] 题目缺 page_number 时的兜底页码
 * @param {Object}   [params.pageDims]  `Map<number, {w, h}>` 预读的页尺寸；缺省时用 fallbackBuffer 估
 * @param {Function} [params.log=console.log]
 * @param {Function} [params.warn=console.warn]
 * @returns {{ cropped:number, missingRefs:number }} cropped=成功拿到配图的题数；
 *          missingRefs=题干引图但最终无配图的题数（漏框/退化框/归属存疑都计入）
 */
export async function cropGeometryFigures ({
  questions,
  pageBuffers,
  cropImage,
  studentId,
  fallbackBuffer = null,
  fallbackPage = 1,
  pageDims = null,
  log = console.log,
  warn = console.warn,
} = {}) {
  const list = Array.isArray(questions) ? questions : []
  const buffers = pageBuffers instanceof Map ? pageBuffers : new Map()
  if (list.length === 0 || typeof cropImage !== 'function') {
    return { cropped: 0, missingRefs: 0 }
  }

  // 1) 子题继承母题配图
  for (const q of inheritSharedStemFigures(list, fallbackPage)) {
    log(`   [几何图] 第 ${q.question_number} 题${q.sub_no ? `(${q.sub_no})` : ''} 继承公共题干配图框 ${JSON.stringify(q.image_bbox)}`)
  }

  // 2) 收集待裁题
  const tasks = list
    .filter(q => {
      const hasImage = q.image_type && q.image_type !== 'none'
      const hasLegacyImage = q.geometry_image?.has_image && q.geometry_image.bbox
      const imageType = q.image_type || (hasLegacyImage ? 'geometry' : null)
      if (!q.image_type && imageType) q.image_type = imageType
      return hasImage || hasLegacyImage
    })
    .map(q => {
      const imageBbox = q.image_bbox || (q.geometry_image?.bbox || null)
      const imageType = q.image_type || 'geometry'
      if (!imageBbox) {
        if (hasFigureReference(q)) {
          log(`   ⚠️ [几何图] ${q.id}: 题干含"如图"关键词但未返回 bbox`)
        }
        return null
      }
      const pageNo = q.page_number || fallbackPage
      const dims = pageDims instanceof Map ? pageDims.get(pageNo) : null
      if (isDegenerateFigureBox(imageBbox, q.block_coordinates)) {
        log(`   ⚠️ [几何图] 第 ${q.question_number} 题配图框未定位到图形(${JSON.stringify(imageBbox)})，跳过裁剪`)
        return null
      }
      const safeBbox = clampImageBboxToBlock(imageBbox, q.block_coordinates)
      if (!safeBbox) {
        log(`   ⚠️ [几何图] 第 ${q.question_number} 题配图框与题目完全对不上(${JSON.stringify(imageBbox)})，跳过裁剪`)
        return null
      }
      const pixelBbox = dims ? denormalizeBbox(safeBbox, dims.w, dims.h) : safeBbox
      const cacheKey = `${pageNo}:${JSON.stringify(safeBbox)}`
      return { q, pixelBbox, cacheKey, imageType, pageNo }
    })
    .filter(Boolean)

  // 3) 并行裁剪（同页同框复用）
  const cache = new Map()
  if (tasks.length > 0) {
    log(`   [几何图] ⚡ 并行裁剪 ${tasks.length} 张配图...`)
    await Promise.allSettled(tasks.map(async ({ q, pixelBbox, cacheKey, pageNo }) => {
      if (cache.has(cacheKey)) {
        q.geometry_image_url = cache.get(cacheKey)
        return
      }
      const pageBuffer = buffers.get(pageNo) || fallbackBuffer
      if (!pageBuffer) {
        warn(`   ⚠️ [几何图] 第 ${q.question_number} 题缺第 ${pageNo} 页图 buffer，跳过裁剪`)
        return
      }
      q.geometry_image_url = await cropImage(pageBuffer, pixelBbox, studentId, q.id)
      if (q.geometry_image_url) cache.set(cacheKey, q.geometry_image_url)
    }))
  }

  // 4) 兜底统计：引图但最终无配图（漏框 / 退化框 / 收紧判非图形 都算）。
  //    判据统一走 hasFigureReference（= parent_stem + content），不要手写「如图|图1|图示」——
  //    多小问拆行后引图词常只存在于 parent_stem，只读 content 会漏。
  let missingRefs = 0
  for (const q of list) {
    if (q.geometry_image_url) continue
    if (!hasFigureReference(q)) continue
    log(`   ⚠️ [几何图] 第 ${q.question_number} 题${q.sub_no ? `(${q.sub_no})` : ''}: 引图但最终无配图 (${q.id})`)
    missingRefs += 1
  }
  if (missingRefs > 0) {
    warn(`   ⚠️ [几何图] 本次批改有 ${missingRefs} 道引图题没拿到配图（已记入任务结果 figureMissingRefs）`)
  }

  return { cropped: tasks.filter(t => t.q.geometry_image_url).length, missingRefs }
}

export default { cropGeometryFigures, denormalizeBbox }
