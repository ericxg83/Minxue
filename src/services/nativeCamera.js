/**
 * 原生相机 / 相册取图服务。
 *
 * 为什么需要它：
 * App 里原来的「拍照」按钮点的是 <input type="file" capture="environment">。
 * capture 是给浏览器用的提示，Capacitor 的 WebView 走的是 BridgeActivity 的
 * onShowFileChooser（ACTION_GET_CONTENT/ACTION_CHOOSER），完全不看 capture 属性，
 * 所以点「拍照」和点「相册」弹出的是同一个系统文件选择器 —— 只能从相册选。
 *
 * @capacitor/camera 已经随包安装并同步进 Android 工程，但前端此前从未调用过。
 * 这里在原生平台走插件（真正的相机 / 原生相册多选），Web 端回退到原来的 input。
 */
import { Camera, CameraDirection, CameraResultType, CameraSource } from '@capacitor/camera'
import { Capacitor } from '@capacitor/core'

// 相册一次最多选多少张。再多会让 FormData 过大，上传失败率显著上升。
const MAX_PICK = 20

// 拍照质量：0-100。90 足够 OCR/VLM 识别，再高只会拖慢上传。
const QUALITY = 90

export const isNativeCameraAvailable = () =>
  typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()

// ── 文件命名 ──
// 不能用固定名：handleFileSelect 会按 file.name 与历史任务的 image.file_name
// 做去重，同名会被判定为"已上传过"直接跳过。时间戳 + 序号 + 随机数保证唯一。
let seq = 0
const pad = (n) => String(n).padStart(2, '0')
const uniqueName = (ext = 'jpg') => {
  const d = new Date()
  seq = (seq + 1) % 1000
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  const rand = Math.random().toString(36).slice(2, 6)
  return `MINXUE_${stamp}_${pad(seq)}${rand}.${ext}`
}

const extFromMime = (mime) => {
  if (/png/i.test(mime)) return 'png'
  if (/webp/i.test(mime)) return 'webp'
  if (/heic/i.test(mime)) return 'heic'
  if (/heif/i.test(mime)) return 'heif'
  return 'jpg'
}

/**
 * 把插件返回的 webPath（capacitor://localhost/_capacitor_file_/... 之类）
 * 读成真正的 File。插件只给路径，上传链路（压缩 / FormData / OCR）要的是 File。
 */
async function mediaToFile(media) {
  const src = media?.webPath || media?.uri || media?.path
  if (!src) return null
  const res = await fetch(src)
  if (!res.ok) return null
  const blob = await res.blob()
  if (!blob || blob.size === 0) return null
  const mime = blob.type || 'image/jpeg'
  return new File([blob], uniqueName(extFromMime(mime)), {
    type: mime,
    lastModified: Date.now()
  })
}

async function toFiles(list) {
  const files = []
  for (const media of list || []) {
    try {
      const f = await mediaToFile(media)
      if (f) files.push(f)
    } catch (e) {
      console.warn('[nativeCamera] 读取图片失败，跳过:', e?.message)
    }
  }
  return files
}

/**
 * 确保相机权限。
 * @returns {Promise<boolean>} 已授权返回 true；被拒绝返回 false（不抛错，由调用方提示）
 */
export async function ensureCameraPermission() {
  if (!isNativeCameraAvailable()) return true
  try {
    const current = await Camera.checkPermissions()
    if (current.camera === 'granted') return true
    const asked = await Camera.requestPermissions({ permissions: ['camera'] })
    return asked.camera === 'granted' || asked.camera === 'limited'
  } catch (e) {
    console.warn('[nativeCamera] 权限检查失败:', e?.message)
    // 查询失败时不拦住流程，交由插件自己触发系统授权
    return true
  }
}

/**
 * 调用系统相机拍一张，返回 File[]（0 或 1 个，用户取消时为空数组）。
 * @throws 插件不可用时抛错，调用方应回退到 Web 的 input[type=file]
 */
export async function takePhotoFiles() {
  const ok = await ensureCameraPermission()
  if (!ok) {
    const err = new Error('没有相机权限，请在系统设置里允许使用相机')
    err.code = 'CAMERA_PERMISSION_DENIED'
    throw err
  }

  // v8 的 takePhoto 是当前主 API；老版本插件只有 getPhoto，做一次兼容回退。
  if (typeof Camera.takePhoto === 'function') {
    const result = await Camera.takePhoto({
      quality: QUALITY,
      saveToGallery: false,
      correctOrientation: true,
      cameraDirection: CameraDirection.Rear
    })
    return toFiles([result])
  }

  const photo = await Camera.getPhoto({
    quality: QUALITY,
    allowEditing: false,
    resultType: CameraResultType.Uri,
    source: CameraSource.Camera,
    saveToGallery: false,
    correctOrientation: true
  })
  return toFiles([photo])
}

/**
 * 打开原生相册多选，返回 File[]（用户取消时为空数组）。
 */
export async function pickPhotoFiles(limit = MAX_PICK) {
  // v8 的 chooseFromGallery 支持多选；老版本只有 pickImages，逐个兼容。
  if (typeof Camera.chooseFromGallery === 'function') {
    const res = await Camera.chooseFromGallery({
      limit,
      allowMultipleSelection: true,
      quality: QUALITY,
      correctOrientation: true
    })
    return toFiles(res?.results)
  }

  if (typeof Camera.pickImages === 'function') {
    const res = await Camera.pickImages({ limit, quality: QUALITY })
    return toFiles(res?.photos)
  }

  const photo = await Camera.getPhoto({
    quality: QUALITY,
    allowEditing: false,
    resultType: CameraResultType.Uri,
    source: CameraSource.Photos
  })
  return toFiles([photo])
}

/**
 * 统一的错误文案。用户取消不属于错误，调用方据此静默返回。
 */
export function describeCameraError(e) {
  if (!e) return ''
  const msg = String(e?.message || e || '')
  if (/cancel/i.test(msg) || /no image|cancelled|User cancelled/i.test(msg)) return ''
  if (e?.code === 'CAMERA_PERMISSION_DENIED') return '没有相机权限，请在系统设置里允许使用相机'
  if (/permission/i.test(msg)) return '没有相册/相机权限，请在系统设置里允许后重试'
  return msg || '打开相机失败，请重试'
}
