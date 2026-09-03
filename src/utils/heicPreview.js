// HEIC/HEIF 浏览器端预览图生成。
//
// iPhone / 华为 P80 默认拍照是 HEIC/HEIF (HEVC/H.265 编码)，但
//   (a) Android WebView file.type 经常是空字符串（不是 image/heic），
//       原 f.type?.startsWith('image/') 检查漏掉，URL.createObjectURL 不生成
//   (b) 即使 type 正确，浏览器原生 <img> 也解不开 HEIC
//
// 解决：拿到 File 后，扩展名是 .heic/.heif 时调 heic-decode (WASM libheif)
// 解出 RGBA → canvas → image/jpeg Blob → URL.createObjectURL 给 <img>。
//
// 返回 null 表示无法生成预览（交给原组件显示 broken image / 图标兜底）。
//
// 不处理"上传前转 jpg"：仍然送原 HEIC 到后端，由后端 fixFileIfNeeded 用同样的
// heic-decode 解码转 jpg 后再上 OSS（这条路径在 server/services/uploadValidator.js
// fixFileIfNeeded needsHeicTranscode 分支，2026-09-03 已上线）。

import { default as heicDecode } from 'heic-decode'

const HEIC_EXT = /\.heic$|\.heif$/i

export function isHeicFile(file) {
  if (!file) return false
  if ((file.type || '').match(/^image\/(heic|heif)$/i)) return true
  return HEIC_EXT.test(file.name || '')
}

// 同步部分：可显示的图片（type starts with image/）走原生 URL.createObjectURL。
// HEIC 走 async heic-decode → canvas → jpeg blob URL。
// 普通 jpg/png/webp 立即返回 url（同步路径）。
export async function getPreviewUrl(file) {
  if (!file) return null

  // 非 HEIC：type 是 image/* 直接原生 URL.createObjectURL
  if (file.type?.startsWith('image/')) {
    return URL.createObjectURL(file)
  }

  // HEIC：异步解码
  if (isHeicFile(file)) {
    try {
      const buf = await file.arrayBuffer()
      const decoded = await heicDecode({ buffer: new Uint8Array(buf) })
      const canvas = document.createElement('canvas')
      canvas.width = decoded.width
      canvas.height = decoded.height
      const ctx = canvas.getContext('2d')
      const imageData = new ImageData(
        new Uint8ClampedArray(decoded.data),
        decoded.width,
        decoded.height
      )
      ctx.putImageData(imageData, 0, 0)
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
      if (!blob) return null
      return URL.createObjectURL(blob)
    } catch (e) {
      // HEIC 解码失败（损坏 / 不支持的编码），返回 null 让原组件显示占位
      console.warn('[heicPreview] HEIC decode failed:', e?.message || e)
      return null
    }
  }

  return null
}
