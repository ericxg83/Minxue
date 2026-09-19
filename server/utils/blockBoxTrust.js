/**
 * block_coordinates 可信度判据（纯算术，零依赖，零成本）。
 *
 * 为什么单独成模块：这套判据要同时用在**写入侧**（`utils/cropAndUpload.js` 决定要不要裁）
 * 和**读取侧**（`lib/weekendHandout.js` 决定要不要把裁片当「题图」展示），
 * 两处必须用同一份逻辑，否则必然漂移。
 *
 * 两类判据，都是「不可能成立」级别的硬判据，不是启发式：
 *
 *   A. 越界/退化（`isOutOfRangeBox`）—— 归一化 0-1000 下右下角越界不可能成立。
 *      此前只校验左上角，于是 y=920,height=300 被判合法，clamp 后裁片变成页面最底部
 *      一条 220px 横条，与本题毫无关系。存量实测：wrong_questions 125 条里 24 条命中（19%），
 *      含用户报过的 a775a783 第11题（y920 h300）与 9eff748b 第9题（y920 h200）。
 *
 *   B. 均分占位（`isPlaceholderBlockBoxes`）—— 模型不逐题测量，把整页按题数均分。
 *      实例 fd8b6bc9 第1页（12 题）：y = 250,310,370,…,910，步长恒为 60，width 全为 800。
 *      真实题距约 120px 而框距 132px → 误差逐题累积，页尾偏出约 1.2 题。
 *      存量实测：全库 278 页里 3 页命中（1.4%）。
 *
 * ⚠️ 这不是「坐标互比」判据 —— 那类判据（拿 image_bbox 与 block_coordinates 比纵向是否错开）
 *    2026-09-18 已被证伪：上海作业常把多题图集中排成一行，配图框**必然**落在本题 block 上方，
 *    用「纵向错开」当判据假阳性率约 28%。详见 worker.js 里的负面注释。
 *    本模块判的是「框自身在 0-1000 坐标系里是否合法」与「同页框与框之间的形态」，
 *    不涉及两个不同语义的框之间的位置关系。
 *
 * 取向：假阳性（真实框被误判）→ 取图侧回退整页图，整页图永远正确，只是不够聚焦，属安全方向；
 *       假阴性（坏框被放行）→ 老师看到邻题的图，属错误方向。故宁可多拦。
 */

const MIN_N = 3      // 少于此题数无法判断「均分」
const TOL = 2        // 归一化 0-1000 下的容差（0.2% 页宽/页高）
const RATIO = 0.8    // 众数占比阈值

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v))

/**
 * 解析 block_coordinates，兼容 {x,y,width,height} 与 {x,y,w,h}。
 * 数组形态（[x,y,w,h]）与字段异常形态（如 {"x":[140,650,880,720]}）一律返回 null。
 */
export function parseBlockBox(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null
  const x = num(b.x)
  const y = num(b.y)
  const width = num(b.width ?? b.w)
  const height = num(b.height ?? b.h)
  if (![x, y, width, height].every(Number.isFinite)) return null
  return { x, y, width, height }
}

/**
 * 框是否越界或退化。传 null 视为不可信。
 * 注意：x/y 贴边（如 x=1000,width=0 已被退化拦下；x=1000,width=50 → 右下角 1050 越界）会被拦；
 *       x=0,y=0,width=1000,height=1000 是合法整页框，放行。
 */
export function isOutOfRangeBox(box) {
  if (!box) return true
  const { x, y, width, height } = box
  // 左上角必须落在 0-1000 归一化区间；越过 1000 多为像素坐标（高分辨率照片）。
  if (x < -1 || x > 1001 || y < -1 || y > 1001) return true
  if (!(width >= 1) || !(height >= 1)) return true
  // 宽高本身不应超过 1000（归一化上界）。
  if (width > 1001 || height > 1001) return true
  // 右下角同样不得越界（2026-09-18 补：此前漏判，导致裁片落到页面底部/页外）。
  if (x + width > 1001 || y + height > 1001) return true
  return false
}

/** 原始 JSONB 值直接判断是否越界/不可解析。 */
export function isUntrustworthyBlock(b) {
  const box = parseBlockBox(b)
  if (!box) return true
  return isOutOfRangeBox(box)
}

/** 出现次数最多的值所占比例（按 |a-b| <= TOL 归组） */
function dominantRatio(values) {
  if (!values.length) return 0
  let best = 0
  for (const v of values) {
    const c = values.filter((w) => Math.abs(w - v) <= TOL).length
    if (c > best) best = c
  }
  return best / values.length
}

/**
 * 同一页的一组 block_coordinates 是否属「均分占位」。
 * @param {Array} boxes - 该页各题的 block_coordinates（原始 JSONB 值即可，内部会解析）
 * @returns {{placeholder:boolean, reason:string}}
 */
export function isPlaceholderBlockBoxes(boxes) {
  const list = (Array.isArray(boxes) ? boxes : []).map(parseBlockBox).filter(Boolean)
  if (list.length < MIN_N) return { placeholder: false, reason: `样本不足(n=${list.length})` }

  const wR = dominantRatio(list.map((b) => b.width))
  const hR = dominantRatio(list.map((b) => b.height))

  const sorted = [...list].sort((a, b) => a.y - b.y)
  const steps = []
  for (let i = 0; i + 1 < sorted.length; i++) steps.push(sorted[i + 1].y - sorted[i].y)
  const sR = dominantRatio(steps)

  const placeholder = wR >= RATIO && hR >= RATIO && sR >= RATIO
  return {
    placeholder,
    reason: `n=${list.length} 宽同${(wR * 100).toFixed(0)}% 高同${(hR * 100).toFixed(0)}% 间距同${(sR * 100).toFixed(0)}%`,
  }
}

/**
 * 从一批行里找出「block_coordinates 是均分占位」的页。
 * @param {Array} rows - 至少含 { taskId, pageNumber, block }
 * @returns {Set<string>} 命中页的 key 集合，key = `${taskId}|${pageNumber}`
 */
export function findPlaceholderBlockPages(rows) {
  const pages = new Map()
  for (const r of rows) {
    if (!r || r.block == null) continue
    if (!parseBlockBox(r.block)) continue
    const k = `${r.taskId ?? ''}|${r.pageNumber ?? ''}`
    if (!pages.has(k)) pages.set(k, [])
    pages.get(k).push(r.block)
  }
  const hit = new Set()
  for (const [k, boxes] of pages) {
    if (isPlaceholderBlockBoxes(boxes).placeholder) hit.add(k)
  }
  return hit
}
