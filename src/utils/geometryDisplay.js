/**
 * 几何图显示工具 — 统一 URL 解析和 TikZ 状态判断。
 *
 * 第二阶段：支持 AI 视觉模型提取的 TikZ 代码（存储在 clean_geometry_image_url 中）
 * 与旧的 Sharp 净化图 URL 兼容。
 */

/**
 * 检测字符串是否为 TikZ 代码（而非 URL）
 * TikZ 代码以 \begin{tikzpicture} 开头，URL 以 http 开头
 */
export function isTikzCode(str) {
  if (!str || typeof str !== 'string') return false
  return str.trim().startsWith('\\begin{tikzpicture}')
}

/**
 * 根据 question 对象返回前端应显示的几何图 URL/TikZ 代码，以及显示类型。
 *
 * 优先级：
 * 1. display_image_type === 'tikz' && tikz_svg_url → type='tikz'
 * 2. clean_geometry_image_url 是 TikZ 代码 → type='tikz_code'（新 AI 提取）
 * 3. clean_geometry_image_url 是 URL → type='clean'（旧 Sharp 处理）
 * 4. geometry_image_url → type='raw'（原始裁剪图）
 * 5. image_url → type='raw'（整页图回退）
 */
export function getGeometryDisplayUrl(question) {
  if (!question) return { url: null, type: 'none' }

  // display_image_type === 'tikz' && tikz_svg_url 存在 → 用 TikZ
  if (question.display_image_type === 'tikz' && question.tikz_svg_url) {
    return { url: question.tikz_svg_url, type: 'tikz' }
  }

  // clean_geometry_image_url 是 TikZ 代码 → 用 tikz_code 类型（新 AI 提取）
  if (isTikzCode(question.clean_geometry_image_url)) {
    return { url: question.clean_geometry_image_url, type: 'tikz_code' }
  }

  // 否则优先用净化图 URL（旧 Sharp 处理）
  if (question.clean_geometry_image_url) {
    return { url: question.clean_geometry_image_url, type: 'clean' }
  }

  // 回退到原始裁剪几何图
  if (question.geometry_image_url) {
    return { url: question.geometry_image_url, type: 'raw' }
  }

  // 最后回退到 image_url（整页图）
  if (question.image_url) {
    return { url: question.image_url, type: 'raw' }
  }

  return { url: null, type: 'none' }
}

/**
 * 返回 TikZ 生成状态：
 * - 'done'    — tikz_svg_url 存在，或 clean_geometry_image_url 是 TikZ 代码（新 AI 提取）
 * - 'pending' — clean_geometry_image_url 存在但不是 TikZ 代码（等待异步生成中）
 * - 'none'    — 无几何图，不需要 TikZ
 */
export function getTikzStatus(question) {
  if (!question) return 'none'
  if (question.tikz_svg_url) return 'done'
  // 新增：clean_geometry_image_url 是 TikZ 代码也视为 'done'
  if (isTikzCode(question.clean_geometry_image_url)) return 'done'
  if (question.clean_geometry_image_url) return 'pending'
  if (question.geometry_image_url) return 'pending'
  return 'none'
}