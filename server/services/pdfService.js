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

// 为可能卡住的操作添加超时兜底
const withTimeout = (promise, ms, label = 'Operation') => {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

// 提取文字版 PDF 的全文（保留换行，供逐行解析答案）
// timeoutMs: 文档加载超时（默认 30s），之后抛出异常让调用方走 OCR 兜底
export const extractPdfText = async (fileBuffer, timeoutMs = 30000) => {
  const pdfjs = await loadPdfjs()
  const doc = await withTimeout(
    pdfjs.getDocument({ data: new Uint8Array(fileBuffer), useSystemFonts: true }).promise,
    timeoutMs,
    `PDF document loading (>${Math.round(timeoutMs / 1000)}s)`
  )
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

// 只读取 PDF 总页数（分批解析前先探明规模）。
// 注意 new Uint8Array(fileBuffer) 是拷贝：pdfjs 会 transfer/detach 传入的 buffer，
// 传拷贝保证同一 fileBuffer 可被后续每批的 getDocument 重复使用。
export const getPdfPageCount = async (fileBuffer, timeoutMs = 15000) => {
  const pdfjs = await loadPdfjs()
  const doc = await withTimeout(
    pdfjs.getDocument({ data: new Uint8Array(fileBuffer) }).promise,
    timeoutMs,
    `PDF page count loading (>${Math.round(timeoutMs / 1000)}s)`
  )
  try {
    return doc.numPages
  } finally {
    await doc.destroy()
  }
}

// 将扫描版 PDF 逐页渲染为 JPEG buffer（供视觉模型 OCR）
// timeoutMs: 每页渲染超时（默认 30s），避免卡在某页
// maxEdge: 渲染后最长边像素上限。扫描版 PDF 单页原始尺寸可能极大（高 DPI 扫描），
// 无条件按 scale 放大会产生数亿像素的 canvas，在 512MB 容器上直接 OOM 打死进程
// startPage/endPage: 1-based 闭区间，用于大文件分批渲染；不传时从第 1 页起、受 maxPages 截断（与旧行为一致）。
// 每次调用独立 getDocument/destroy：批间彻底释放 pdfjs 内部字体/图像缓存，内存峰值 = 单批
export const renderPdfToJpegs = async (fileBuffer, { scale = 2, maxPages = 20, quality = 0.85, timeoutMs = 30000, maxEdge = 2400, startPage = 1, endPage = null } = {}) => {
  const pdfjs = await loadPdfjs()
  const doc = await withTimeout(
    pdfjs.getDocument({
      data: new Uint8Array(fileBuffer),
      standardFontDataUrl: STANDARD_FONT_DATA_URL,
    }).promise,
    timeoutMs,
    `PDF document loading for render (>${Math.round(timeoutMs / 1000)}s)`
  )
  try {
    const first = Math.max(1, startPage)
    const last = Math.min(endPage ?? (first + maxPages - 1), doc.numPages, first + maxPages - 1)
    const images = []
    for (let i = first; i <= last; i++) {
      const page = await doc.getPage(i)
      const baseViewport = page.getViewport({ scale: 1 })
      const maxBase = Math.max(baseViewport.width, baseViewport.height) || 1
      const effectiveScale = Math.min(scale, maxEdge / maxBase)
      const viewport = page.getViewport({ scale: effectiveScale })
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await withTimeout(
        page.render({ canvasContext: ctx, viewport }).promise,
        timeoutMs,
        `PDF page ${i} rendering (>${Math.round(timeoutMs / 1000)}s)`
      )
      images.push(canvas.toBuffer('image/jpeg', quality))
      page.cleanup()
    }
    return { images, totalPages: doc.numPages }
  } finally {
    await doc.destroy()
  }
}
