/**
 * shareCardService.js — 家长分享卡渲染服务
 *
 * 数据与周报同源（fetchStudentWeeklyReport），HTML 模板见 shareCardTemplate.js（纯函数），
 * 光栅化复用 examPdfRenderer 的常驻 Chromium（renderHtmlPNG，2x 高清）。
 * 输出直接返回 PNG Buffer，不落 OSS、不落库 —— 未成年人图片即用即生成，不留存。
 */
import { buildShareCardHTML } from './shareCardTemplate.js'
import { renderHtmlPNG } from './examPdfRenderer.js'

/**
 * 生成家长分享卡 PNG
 * @param {Object} reportData - fetchStudentWeeklyReport 的返回值
 * @param {Object} [opt]
 * @param {boolean} [opt.maskName=false] - true = 转发版（姓名打码）
 * @returns {Promise<Buffer>} PNG buffer（1500×2668 物理 @2x）
 */
export async function generateShareCardPNG(reportData, { maskName = false } = {}) {
  const html = buildShareCardHTML(reportData, { maskName })
  return renderHtmlPNG({ html, width: 750, height: 1334, scale: 2 })
}
