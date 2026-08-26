// QR Code detection service
import jsQR from 'jsqr'

export const isRetryPaperQRCode = (value) => {
  const raw = String(value || '').trim()
  if (!raw) return false

  if (/\/retry-task\/[0-9a-fA-F-]{36}(?:[/?#]|$)/.test(raw)) return true
  if (/^MXG:[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(raw)) return true

  try {
    const parsed = JSON.parse(raw)
    return parsed?.type === 'grading' || parsed?.type === 'training'
  } catch {
    return false
  }
}

export const detectQRCode = async (imageFile) => {
  try {
    const imageBitmap = await createImageBitmap(imageFile)

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    const maxDimension = 1024
    let { width, height } = imageBitmap
    if (width > maxDimension || height > maxDimension) {
      const scale = maxDimension / Math.max(width, height)
      width = Math.round(width * scale)
      height = Math.round(height * scale)
    }

    canvas.width = width
    canvas.height = height
    ctx.drawImage(imageBitmap, 0, 0, width, height)

    const imageData = ctx.getImageData(0, 0, width, height)
    const qrCode = jsQR(imageData.data, width, height, {
      inversionAttempts: 'dontInvert'
    })

    if (qrCode?.data) {
      console.debug('[QR] Detected QR code:', qrCode.data)
      return qrCode.data
    }

    console.debug('[QR] No QR code detected')
    return null
  } catch (error) {
    console.debug('[QR] Detection failed:', error.message)
    return null
  }
}

// Group files by valid retry-paper QR content only.
export const groupFilesByQRCode = (filesWithQR) => {
  const groups = new Map()

  filesWithQR.forEach(({ file, qrContent }) => {
    const normalizedQR = isRetryPaperQRCode(qrContent) ? qrContent : null

    if (!normalizedQR) {
      // 无二维码 = 普通多页作业，全部归入同一组，交由后端「多图一任务」合并。
      // 旧代码用带 Math.random 的唯一 key 让每张图各成一组，导致一次选多张普通作业
      // 会被拆成多个单图任务，前后端都看不到「共N页」，合并逻辑形同虚设。
      const key = 'no_qr'
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key).push({ file, qrContent: null })
      return
    }

    if (!groups.has(normalizedQR)) {
      groups.set(normalizedQR, [])
    }
    groups.get(normalizedQR).push({ file, qrContent: normalizedQR })
  })

  return Array.from(groups.entries()).map(([qrContent, files]) => ({
    qrContent,
    files: files.map((f) => f.file),
    isRetryPaper: Boolean(qrContent && isRetryPaperQRCode(qrContent))
  }))
}
