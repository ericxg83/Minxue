import { createCanvas, Path2D, DOMMatrix, ImageData } from '@napi-rs/canvas'
import { createRequire } from 'module'
import path from 'path'

// pdfjs 在 Node 端渲染时依赖这些全局对象（字形路径缓存、变换矩阵等）
if (!globalThis.Path2D) globalThis.Path2D = Path2D
if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrix
if (!globalThis.ImageData) globalThis.ImageData = ImageData

const require = createRequire(import.meta.url)
// 渲染含标准 14 字体（Helvetica 等）的 PDF 时需要字体数据目录
// 注意：Node 环境下 pdfjs 用 fs 读取，需传文件系统路径而非 file:// URL
const STANDARD_FONT_DATA_URL =
  path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep

let pdfjsPromise = null
const loadPdfjs = () => {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs')
  }
  return pdfjsPromise
}

// 提取文字版 PDF 的全文（保留换行，供逐行解析答案）
export const extractPdfText = async (fileBuffer) => {
  const pdfjs = await loadPdfjs()
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fileBuffer), useSystemFonts: true }).promise
  try {
    let text = ''
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      let lastY = null
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue
        const y = item.transform?.[5]
        // Y 坐标变化视为换行（getTextContent 不保证 hasEOL 可靠）
        if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) text += '\n'
        text += item.str
        if (item.hasEOL) text += '\n'
        if (y !== undefined) lastY = y
      }
      text += '\n'
      page.cleanup()
    }
    return text
  } finally {
    await doc.destroy()
  }
}

// 将扫描版 PDF 逐页渲染为 JPEG buffer（供视觉模型 OCR）
export const renderPdfToJpegs = async (fileBuffer, { scale = 2, maxPages = 20, quality = 0.85 } = {}) => {
  const pdfjs = await loadPdfjs()
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(fileBuffer),
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
  }).promise
  try {
    const pageCount = Math.min(doc.numPages, maxPages)
    const images = []
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i)
      const viewport = page.getViewport({ scale })
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport }).promise
      images.push(canvas.toBuffer('image/jpeg', quality))
      page.cleanup()
    }
    return { images, totalPages: doc.numPages }
  } finally {
    await doc.destroy()
  }
}
