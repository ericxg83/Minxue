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
 */
export async function printPdfOnDevice(blob, title = '敏学试卷') {
  if (!isNative()) throw new Error('当前环境不支持原生打印')
  if (!blob || blob.size === 0) throw new Error('PDF 内容为空，无法打印')
  const data = await blobToBase64(blob)
  return NativePrint.printPdf({ data, title })
}

export function isNativePrintAvailable() {
  return isNative()
}
