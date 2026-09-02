// Phase 2: 复用 canvas，减少内存分配
let sharedCanvas = null
const getSharedCanvas = () => {
  if (!sharedCanvas) {
    sharedCanvas = document.createElement('canvas')
  }
  return sharedCanvas
}

// 将图片转换为 base64
export const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => resolve(reader.result)
    reader.onerror = (error) => reject(error)
  })
}

// 上传前置压缩：手机原图常见 8–12MB，跨境链路（前端 → Render → OSS）
// 越大的 body 越容易撞上 OSS 的响应超时，且整单失败会连带同批其它页。
// 下限守 1200px/100KB——低于 worker 的分辨率闸门，压过头会被判"图片太模糊"。
const COMPRESS_TRIGGER_BYTES = 1_500_000
const COMPRESS_TARGET_BYTES = 1_200_000
const COMPRESS_MIN_BYTES = 110_000
const COMPRESS_MAX_EDGE = 2200

export const compressImageForUpload = (file) =>
  new Promise((resolve) => {
    const isHeic = (file?.type || '').match(/^image\/(heic|heif)$/i)
      || /\.heic$|\.heif$/i.test(file?.name || '')
    if (isHeic) return resolve(file)
    if (!file?.type?.startsWith('image/') || file.size <= COMPRESS_TRIGGER_BYTES) {
      return resolve(file)
    }
    const reader = new FileReader()
    reader.onerror = () => resolve(file)
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => resolve(file)
      img.onload = () => {
        try {
          const ratio = Math.min(1, COMPRESS_MAX_EDGE / Math.max(img.width, img.height))
          const width = Math.round(img.width * ratio)
          const height = Math.round(img.height * ratio)
          const canvas = getSharedCanvas()
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d', { willReadFrequently: true })
          ctx.drawImage(img, 0, 0, width, height)

          let best = null
          let quality = 0.85
          while (quality >= 0.4) {
            const dataUrl = canvas.toDataURL('image/jpeg', quality)
            const bytes = Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75)
            best = dataUrl
            if (bytes <= COMPRESS_TARGET_BYTES) break
            quality -= 0.1
          }
          if (!best) return resolve(file)

          const blob = dataURLToBlob(best)
          if (blob.size < COMPRESS_MIN_BYTES || blob.size >= file.size) return resolve(file)
          const name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg'
          resolve(new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified || Date.now() }))
        } catch {
          resolve(file)
        }
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })

export const compressImagesForUpload = async (files) => {
  const compressed = await Promise.all((files || []).map(compressImageForUpload))
  return {
    files: compressed,
    savedBytes: (files || []).reduce((sum, f, i) => sum + Math.max(0, f.size - compressed[i].size), 0)
  }
}

function dataURLToBlob(dataUrl) {
  const [head, b64] = [dataUrl.slice(0, dataUrl.indexOf(',')), dataUrl.slice(dataUrl.indexOf(',') + 1)]
  const mime = head.replace(/^data:/, '').split(';')[0]
  const bin = atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return new Blob([buf], { type: mime })
}

// 把后端/网络层的失败原因归成人能看懂的一句话。
// 笼统的"上传失败"让用户以为照片有问题，反复重拍同一张只是再次超时。
export const describeUploadFailure = (errorMsg) => {
  const e = String(errorMsg || '')
  if (/timeout|超时|ETIMEDOUT/i.test(e)) return '网络不稳定，图片上传超时，请稍后重试'
  if (/Failed to fetch|NetworkError|network|ERR_/.test(e)) return '网络连接中断，请检查网络后重试'
  if (/不支持|格式|format/i.test(e)) return '图片格式不支持，请使用 JPG/PNG/WEBP'
  if (/过大|20MB|LIMIT_FILE_SIZE/i.test(e)) return '图片过大（超过 20MB），请压缩后重试'
  if (/认证|AccessDenied|403|401/.test(e)) return '存储服务鉴权失败，请联系管理员'
  return e ? `上传失败：${e}` : '上传失败'
}

// 压缩图片（Phase 2优化：复用 canvas）
export const compressImage = (file, maxWidth = 1920, maxHeight = 1920, quality = 0.8) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = (e) => {
      const img = new Image()
      img.src = e.target.result
      img.onload = () => {
        const canvas = getSharedCanvas()
        let width = img.width
        let height = img.height

        // 计算缩放比例
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height)
          width *= ratio
          height *= ratio
        }

        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(img, 0, 0, width, height)

        // 转换为压缩后的 base64
        const compressedBase64 = canvas.toDataURL('image/jpeg', quality)
        resolve(compressedBase64)
      }
      img.onerror = reject
    }
    reader.onerror = reject
  })
}
