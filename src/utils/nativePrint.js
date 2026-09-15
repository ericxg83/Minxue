import { registerPlugin } from '@capacitor/core'

const NativePrint = registerPlugin('NativePrint')

const isNative = () => {
  try {
    return !!window.Capacitor?.isNativePlatform?.()
  } catch {
    return false
  }
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/**
 * Android 原生打印：把 PDF 交给系统 PrintManager，直接打开打印服务选择框。
 * Web 端不调用此方法，由 browserPrint 继续处理浏览器打印。
 *
 * 【2026-09-15 弃用倾向】大 PDF → base64 → Capacitor 桥 在部分手机上会
 * 静默失败/卡死（「网页能打印、App 没反应」的根因），新代码请用 printHtmlOnDevice。
 */
export async function printPdfOnDevice(blob, title = '敏学试卷') {
  if (!isNative()) throw new Error('当前环境不支持原生打印')
  if (!blob || blob.size === 0) throw new Error('PDF 内容为空，无法打印')
  const data = await blobToBase64(blob)
  return NativePrint.printPdf({ data, title })
}

/**
 * 直接打印已渲染好的卷面 HTML（推荐路径）。
 * HTML 在客户端本地渲染（KaTeX 字体 data-URL 内联、公式已展开成静态 DOM），
 * 原生侧用离屏 WebView 加载后交给系统打印 —— 全程不过 blob/base64 桥，
 * 不依赖服务端 PDF，弱网/离线也能打印。
 */
export async function printHtmlOnDevice(html, title = '敏学试卷') {
  if (!isNative()) throw new Error('当前环境不支持原生打印')
  if (!html || typeof html !== 'string' || html.length < 100) {
    throw new Error('打印内容为空，无法打印')
  }
  return NativePrint.printHtml({ html, title })
}

export function isNativePrintAvailable() {
  return isNative()
}
