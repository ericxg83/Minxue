/**
 * 题目定位框工具（坐标系：归一化 0-1000，相对所属页图）
 *
 * 背景：OCR/视觉模型给每道题输出一个矩形框，写进 questions 的
 * block_coordinates / text_bbox / image_bbox（JSONB，可能是对象也可能是 JSON 字符串）。
 * 0-1000 归一化的好处是：渲染时直接当百分比用（x/10 即百分比），
 * 与图片实际像素尺寸解耦，缩略图/放大图/裁剪图都可以复用同一套坐标。
 *
 * 注意：paper 模式（错题重练卷）下，题目行的 image_url 是【原作业页图】，
 * 与当前答题卡页图不是同一张；坐标相对的是原作业页图。这一点在
 * workbench/components/review/PaperViewerPanel.vue 里也有说明。
 */

/** 安全解析任意 bbox 字段（兼容 JSON 字符串 / 对象 / 多种字段命名） */
export function parseBbox (b) {
  if (!b) return null
  if (typeof b === 'string') {
    try { b = JSON.parse(b) } catch { return null }
  }
  if (!b || typeof b !== 'object') return null
  const x = b.x ?? b.x_min ?? b.left
  const y = b.y ?? b.y_min ?? b.top
  const width = b.width ?? b.w ?? (b.x_max != null && x != null ? b.x_max - x : 0)
  const height = b.height ?? b.h ?? (b.y_max != null && y != null ? b.y_max - y : 0)
  if ([x, y, width, height].some((v) => typeof v !== 'number' || Number.isNaN(v))) return null
  if (width <= 0 || height <= 0) return null
  // 越界坐标直接判定不可用，避免把定位框画到图外
  if (x < 0 || y < 0 || x + width > 1000 || y + height > 1000) {
    // 轻微越界（浮点误差）容忍，明显越界才丢弃
    if (x < -5 || y < -5 || x + width > 1005 || y + height > 1005) return null
  }
  return { x, y, width, height }
}

/** 求两个 bbox 的并集（外接矩形），任一为空则返回另一个 */
export function unionBbox (a, b) {
  if (!a) return b || null
  if (!b) return a
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y
  }
}

/** 外扩一圈（归一化单位），并夹紧到 [0,1000]，用于裁剪时保住题号/边缘笔画 */
export function padBbox (box, pad = 0) {
  if (!box) return null
  const p = Math.max(0, Number(pad) || 0)
  if (!p) return box
  const x = Math.max(0, box.x - p)
  const y = Math.max(0, box.y - p)
  const right = Math.min(1000, box.x + box.width + p)
  const bottom = Math.min(1000, box.y + box.height + p)
  return { x, y, width: right - x, height: bottom - y }
}

/**
 * 取题目最贴合的定位框
 * 优先用 text_bbox ∪ image_bbox 的并集（比 AI 粗估的整体区域更贴合题目实际范围），
 * 二者都缺时回退 block_coordinates。
 * @param {Object} q 题目对象
 * @param {{pad?: number}} opts pad 为外扩量（归一化 0-1000）
 */
export function getQuestionDisplayBox (q, opts = {}) {
  if (!q) return null
  const box = unionBbox(parseBbox(q.text_bbox), parseBbox(q.image_bbox)) || parseBbox(q.block_coordinates)
  return padBbox(box, opts.pad)
}

/** 把归一化坐标转成 CSS 百分比样式（相对图片自身尺寸） */
export function bboxToPercentStyle (box) {
  if (!box) return null
  return {
    left: `${box.x / 10}%`,
    top: `${box.y / 10}%`,
    width: `${box.width / 10}%`,
    height: `${box.height / 10}%`
  }
}
