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

// ── C. 同页框互相「压盖」判据（2026-09-20）──────────────────────────────
//
// 事故：任务 7debfcc9（第04周）p2 六道题，block 高度全部 250（=页面 1/4），
// 相邻框 y 间距仅 100~250 → 每一框都横跨 2 道题。老师看到的「题图」里
// 上半是本题手写、下半是下一题的题号 + 题干 —— 五张截图全是这个形态。
//
// 为什么前两道闸都没拦住：
//   ① 越界闸只查右下角 ≤1000，这批框 x+w=880 / y+h=1050 里只有 2 条超界；
//   ② 均分占位闸要「宽同≥80% 且 高同≥80% 且 间距同≥80%」，实测
//      p2 = 宽同71% 高同71% 间距同33%（题9/10 高 100 混在 250 里把占比拉下来了）
//      → 不是「等距占位」，是「测量粗糙 + 框给得比真题大」。
//
// 判据本体：同一页内，若某框与**另一题**的框在**纵向**重叠超过较矮者的 OVERLAP_RATIO，
// 且**横向也有重叠**（必须同时成立！），两框不可能各自独立圈住一道题 → 该框裁出来必然带上下邻题。
// 纯算术，零模型调用。
//
// ⚠️ 横向重叠条件是必需的，不是保险：上海作业常把多道题的图集中排成一行（图下印「第N题图」），
//    并排题的框纵向必然完全重叠，只按纵向判会 100% 误伤 —— 这正是 2026-09-18「坐标互比」判据
//    翻车的同一个坑。加了横向条件后，并排题（x 区间不相交）正确放行。
//
// 取向（同头部原则）：命中即回退「不显示」，宁可不出图，也不给老师看邻题的图。
const OVERLAP_RATIO = 0.35 // 纵向重叠超过较矮框的 35%，且横向有重叠，即判压盖

/**
 * 同一页内是否存在「框与框纵向压盖」。
 * @param {Array} boxes - 该页各题的 block_coordinates（原始 JSONB 值即可）
 * @param {number} ratio - 纵向重叠占比阈值
 * @returns {{overlapping:boolean, reason:string, pairs:Array}}
 */
export function detectOverlappingBlockBoxes(boxes, ratio = OVERLAP_RATIO) {
  const list = (Array.isArray(boxes) ? boxes : []).map(parseBlockBox).filter(Boolean)
  if (list.length < 2) return { overlapping: false, reason: `样本不足(n=${list.length})`, pairs: [] }

  const pairs = []
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]
      const b = list[j]
      // 纵向重叠
      const vOverlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
      if (vOverlap <= 0) continue
      // 横向重叠：并排题（上海作业图行排版）必须在这里被排除
      const hOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
      if (hOverlap <= 0) continue
      const shorter = Math.min(a.height, b.height)
      if (shorter <= 0) continue
      const r = vOverlap / shorter
      if (r > ratio) {
        pairs.push({ i, j, vOverlap, hOverlap, ratio: Number(r.toFixed(3)), a, b })
      }
    }
  }
  return {
    overlapping: pairs.length > 0,
    reason: pairs.length ? `${pairs.length} 对框压盖（最高 ${Math.max(...pairs.map(p => p.ratio))}）` : '无压盖',
    pairs,
  }
}

/**
 * 找出「block 框互相压盖」的页。与占位页同构，key = `${taskId}|${pageNumber}`。
 * @param {Array} rows - 至少含 { taskId, pageNumber, block }
 */
export function findOverlappingBlockPages(rows, ratio = OVERLAP_RATIO) {
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
    if (detectOverlappingBlockBoxes(boxes, ratio).overlapping) hit.add(k)
  }
  return hit
}
