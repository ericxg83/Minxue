/**
 * 配图框（geometry figure box）归属判据（纯函数，零依赖）
 *
 * ── 为什么单独成模块（2026-09-21）──
 *
 * 这三个判据原先内联在 `server/worker.js` 里，只有日常批改管线用得到；
 * 练习册批改管线补配图能力后也要用**同一套**判据。算法抄两份必然漂移
 * （本仓已有 `parseBbox` 抄三份的前车之鉴），故抽成本模块，两管线共用。
 *
 * 判据本体与注释逐字沿用 worker.js 原实现，**语义未做任何放宽或收紧**。
 *
 * @module utils/figureBoxTrust
 */

import { hasFigureReference } from './questionCompleteness.js'

/**
 * 配图框体检：AI 没真正定位到配图时，会拿题目框机械推一个「题干下方的一条」交差。
 * 这种框裁出来是纯文字（题干续行 / 选项行），当配图展示等于把错东西端给用户看，
 * 宁可不显示配图。判据只看归一化 0-1000 坐标，零成本、无需下载原图。
 *
 * 线上实例（「复习七 三角形(2)」第 1 页 9 道题，配图集中排成两行、图下标注"第N题图"）：
 *   #2 block{x:150,y:240,w:700,h:70} → image_bbox{x:150,y:280,w:700,h:30}
 *   #9 block{x:150,y:750,w:700,h:40} → image_bbox{x:150,y:790,w:700,h:40}
 * 9 个配图框的左边界和宽度全部与题目框一字不差、且都压在题目框里或紧贴其下方——
 * 这是从 block 算出来的，不是看着图框出来的。真正定位到的配图框不会有这种巧合
 * （同任务第 2 页三道题的配图框 x 都与 block 相差数百）。
 *
 * 刻意不拿「宽高比过大」当判据：数轴、长条示意图这类合法配图本就极扁，会被连带误杀。
 *
 * @param {Object} box - 配图框（归一化 0-1000）
 * @param {Object|null} blockBox - 本题 block_coordinates（归一化 0-1000）
 * @returns {boolean} true = 退化框，不应裁剪
 */
export function isDegenerateFigureBox(box, blockBox) {
  if (!box || typeof box !== 'object') return true
  const x = Number(box.x), y = Number(box.y)
  const w = Number(box.width), h = Number(box.height)
  if (![x, y, w, h].every(Number.isFinite)) return true
  // 任一边不足页面 2.5%：几何图不可能这么小，属退化框
  if (w < 25 || h < 25) return true

  if (blockBox && typeof blockBox === 'object') {
    const bx = Number(blockBox.x), by = Number(blockBox.y)
    const bw = Number(blockBox.width), bh = Number(blockBox.height)
    if ([bx, by, bw, bh].every(Number.isFinite) && bw > 0 && bh > 0
      && Math.abs(x - bx) <= 2 && Math.abs(w - bw) <= 2 && y >= by - 2) {
      return true
    }
  }
  return false
}

/**
 * 配图 bbox 收紧：只在框大得异常时用本题 block_coordinates 兜边界。
 *
 * 早先这里是无条件与 block 求交集，代价太大：
 *  - 「多题配图集中排成一行」的版式（图下标注"第N题图"）里，配图本就落在题目
 *    block 之外，甚至比题干起始位置更靠上（右上角配图）。无条件求交会把配图切掉
 *    大半，或交集为空。
 *  - 交集为空时旧代码退回 block 自身范围，而 block 是题干文字区——等于把选项文字
 *    裁出来当「配图」展示，比不给配图更误导人。
 * 角点形态修正（normalizeBlockBoxSemantics）落地后，"配图框纵向跨到下一题"的主因
 * 已经消失，所以这里只保留对超大框的兜底。
 *
 * @param {Object} imageBbox - 配图 bbox（归一化 0-1000）
 * @param {Object|null} blockBox - 本题 block_coordinates（归一化 0-1000）
 * @returns {Object|null} 收紧后的 bbox；无法定位配图时返回 null
 */
export function clampImageBboxToBlock(imageBbox, blockBox) {
  if (!imageBbox || typeof imageBbox !== 'object') return null

  const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d)

  const ix = num(imageBbox.x)
  const iy = num(imageBbox.y)
  const iw = num(imageBbox.width)
  const ih = num(imageBbox.height)
  if (iw <= 0 || ih <= 0) return null

  // 只有明显失控的框才需要 block 兜边界：纵向过半页，或面积超过页面 40%
  const oversized = ih > 500 || iw * ih > 400000
  if (!oversized || !blockBox || typeof blockBox !== 'object') return { ...imageBbox }

  const bx = num(blockBox.x)
  const by = num(blockBox.y)
  const bw = num(blockBox.width)
  const bh = num(blockBox.height)
  if (bw <= 0 || bh <= 0) return { ...imageBbox }

  // 与本题 block 求交集（block 略放宽，避免把贴边的顶点字母裁掉）
  const pad = 10 // 归一化 0-1000 下约 1%
  const left = Math.max(ix, bx - pad)
  const top = Math.max(iy, by - pad)
  const right = Math.min(ix + iw, bx + bw + pad)
  const bottom = Math.min(iy + ih, by + bh + pad)

  // 交集无效说明 AI 的框和本题完全对不上 → 判为未定位到配图，绝不退回 block 自身
  if (right - left <= 0 || bottom - top <= 0) return null

  const clamp01000 = (v) => Math.max(0, Math.min(1000, Math.round(v)))
  const result = {
    ...imageBbox,
    x: clamp01000(left),
    y: clamp01000(top),
    width: clamp01000(right - left),
    height: clamp01000(bottom - top),
  }

  if (result.x !== ix || result.y !== iy || result.width !== iw || result.height !== ih) {
    console.log(`   [几何图] 超大 bbox 按题目框收紧: ${JSON.stringify({ x: ix, y: iy, width: iw, height: ih })} → ${JSON.stringify({ x: result.x, y: result.y, width: result.width, height: result.height })}`)
  }
  return result
}

/**
 * 子题共享母题配图（2026-09-17）
 *
 * 背景：多小问大题被拆行落库后，「如图」只存在于 `parent_stem`，模型常常只把
 * `image_type` / `image_bbox` 挂在其中一个小问上、甚至整组都不给。漏给的小问于是
 * 既没有裁图，完整性闸又按 `parent_stem + content` 判它引图 → 题被判不完整、错题本
 * 与周末课件都拿不到图（2026-09-17 周末班课件第12题：两个小问 content 无引图词、
 * geometry_image_url 全空，公共题干含「如图」）。
 *
 * 处理：按 `(页码, 公共题干原文)` 分组，组内任一题拿到框，其余「引图且自身无框」的小问
 * 共享同一框。后续裁剪走 geometryImageCache（key = 页码 + 框），天然复用同一张 OSS 图，
 * 不会重复上传，也不会把图挂到不相关的题上。
 *
 * 严格限定「同页 + 公共题干逐字相同」，绝不跨题组或跨页继承。
 * 原地修改传入的题目对象，返回被继承的题目列表（供日志/断言）。
 *
 * @param {Array<Object>} questions 同一 task 本次 OCR 出的全部题目
 * @param {number} [fallbackPageNumber=1] 题目缺 page_number 时的兜底页码
 * @returns {Array<Object>} 实际发生继承的题目
 */
export function inheritSharedStemFigures(questions, fallbackPageNumber = 1) {
  const list = Array.isArray(questions) ? questions : []
  const inherited = []

  const groups = new Map()
  for (const q of list) {
    const stem = String(q?.parent_stem || '').trim()
    if (!stem) continue
    const key = `${q.page_number || fallbackPageNumber}|${stem}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(q)
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue
    const donor = group.find(g => {
      const bbox = g.image_bbox || g.geometry_image?.bbox || null
      const itype = g.image_type || (g.geometry_image?.has_image ? 'geometry' : null)
      return bbox && itype && itype !== 'none'
    })
    if (!donor) continue
    const donorBbox = donor.image_bbox || donor.geometry_image?.bbox
    const donorType = donor.image_type && donor.image_type !== 'none' ? donor.image_type : 'geometry'
    for (const q of group) {
      if (q === donor) continue
      if (!hasFigureReference(q)) continue
      if (q.image_bbox || q.geometry_image?.bbox) continue
      q.image_bbox = donorBbox
      q.image_type = donorType
      if (!q.geometry_image && donor.geometry_image) q.geometry_image = donor.geometry_image
      inherited.push(q)
    }
  }

  return inherited
}

export default { isDegenerateFigureBox, clampImageBboxToBlock, inheritSharedStemFigures }
