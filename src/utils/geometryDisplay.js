/**
 * 几何图显示工具 — 统一 URL 解析和显示类型判断。
 *
 * 第三阶段：几何重建（geometry reconstruction）
 * - clean_geometry_svg: 视觉模型识别几何结构后，服务端确定性渲染的干净 SVG 源码。
 *   这是当前主显示来源（白底黑线，仅含几何元素）。
 * - 兼容旧数据：clean_geometry_image_url 可能是 TikZ 代码（第二阶段）或 OSS URL（第一阶段）。
 */

/**
 * 检测字符串是否为内联 SVG 源码（而非 URL）。
 */
export function isSvgCode(str) {
  if (!str || typeof str !== 'string') return false
  return str.trim().startsWith('<svg')
}

/**
 * 检测字符串是否为 TikZ 代码（而非 URL）。
 * TikZ 代码以 \begin{tikzpicture} 开头，URL 以 http 开头。
 */
export function isTikzCode(str) {
  if (!str || typeof str !== 'string') return false
  return str.trim().startsWith('\\begin{tikzpicture}')
}

/**
 * 根据 question 对象返回前端应显示的几何图内容及显示类型。
 *
 * 优先级：
 * 1. clean_geometry_svg 是 SVG 源码 → type='svg_code'（新几何重建，主流程）
 * 2. display_image_type === 'tikz' && tikz_svg_url → type='tikz'
 * 3. clean_geometry_image_url 是 SVG 源码 → type='svg_code'（兼容）
 * 4. clean_geometry_image_url 是 TikZ 代码 → type='tikz_code'（第二阶段旧数据）
 * 5. clean_geometry_image_url 是 URL → type='clean'（第一阶段旧数据）
 * 6. geometry_image_url → type='raw'（原始裁剪图）
 * 7. image_url → type='raw'（整页图回退）
 */
export function getGeometryDisplayUrl(question) {
  if (!question) return { url: null, type: 'none' }

  // 1. clean_geometry_svg 是干净 SVG 源码 → 内联渲染（新主流程）
  if (isSvgCode(question.clean_geometry_svg)) {
    return { url: question.clean_geometry_svg, type: 'svg_code' }
  }

  // 2. display_image_type === 'tikz' && tikz_svg_url 存在 → 用 TikZ
  if (question.display_image_type === 'tikz' && question.tikz_svg_url) {
    return { url: question.tikz_svg_url, type: 'tikz' }
  }

  // 3. clean_geometry_image_url 是 SVG 源码（兼容）
  if (isSvgCode(question.clean_geometry_image_url)) {
    return { url: question.clean_geometry_image_url, type: 'svg_code' }
  }

  // 4. clean_geometry_image_url 是 TikZ 代码（第二阶段旧数据）
  if (isTikzCode(question.clean_geometry_image_url)) {
    return { url: question.clean_geometry_image_url, type: 'tikz_code' }
  }

  // 5. clean_geometry_image_url 是 URL（第一阶段旧数据）
  if (question.clean_geometry_image_url) {
    return { url: question.clean_geometry_image_url, type: 'clean' }
  }

  // 6. 回退到原始裁剪几何图
  if (question.geometry_image_url) {
    return { url: question.geometry_image_url, type: 'raw' }
  }

  // 7. 最后回退到 image_url（整页图）
  if (question.image_url) {
    return { url: question.image_url, type: 'raw' }
  }

  return { url: null, type: 'none' }
}

/**
 * 返回几何图重建状态：
 * - 'done'    — clean_geometry_svg 是 SVG 源码，或 tikz_svg_url 存在，或 clean_geometry_image_url 是代码
 * - 'pending' — clean_geometry_image_url 存在但不是代码（等待处理中），或有原始裁剪图但尚未重建
 * - 'none'    — 无几何图，不需要处理
 */
export function getTikzStatus(question) {
  if (!question) return 'none'
  if (isSvgCode(question.clean_geometry_svg)) return 'done'
  if (question.tikz_svg_url) return 'done'
  if (isSvgCode(question.clean_geometry_image_url)) return 'done'
  if (isTikzCode(question.clean_geometry_image_url)) return 'done'
  if (question.clean_geometry_image_url) return 'pending'
  if (question.geometry_image_url) return 'pending'
  return 'none'
}
