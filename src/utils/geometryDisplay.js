/**
 * 几何图显示工具 — 统一 URL 解析和 TikZ 状态判断。
 *
 * 根据 question 对象返回前端应显示的几何图 URL，以及 TikZ 生成状态。
 */
export function getGeometryDisplayUrl(question) {
  if (!question) return { url: null, type: 'none' }

  // display_image_type === 'tikz' && tikz_svg_url 存在 → 用 TikZ
  if (question.display_image_type === 'tikz' && question.tikz_svg_url) {
    return { url: question.tikz_svg_url, type: 'tikz' }
  }

  // 否则优先用净化图 clean_geometry_image_url
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
 * - 'done'    — tikz_svg_url 存在，TikZ 已生成
 * - 'pending' — clean_geometry_image_url 存在但 tikz_svg_url 不存在（等待生成中）
 * - 'failed'  — 非 pending 但 tikz_status 可判断失败
 * - 'none'    — 无几何图，不需要 TikZ
 */
export function getTikzStatus(question) {
  if (!question) return 'none'
  if (question.tikz_svg_url) return 'done'
  if (question.clean_geometry_image_url) return 'pending'
  if (question.geometry_image_url) return 'pending'
  return 'none'
}