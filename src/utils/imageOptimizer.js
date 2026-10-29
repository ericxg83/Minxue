/**
 * imageOptimizer.js — 上传暂存区图片落盘辅助
 *
 * 仅保留两个被 useUploadFlow 实际调用的工具：
 *  - dataURLtoFile：裁剪/旋转后的 dataURL → File（上传管道只认 File）
 *  - rotateImageByUrl：拍照方向不对时把图转正
 *
 * ⚠️ 历史：本文件曾含一批「去黑 / 对比度 / 锐化 / 自动裁黑边 / 文字背景化」的逐像素处理
 * 函数（含 O(像素²) 的 BFS 连通域分析 removeTextBackground、O(像素×9) 的 sharpenImage）。
 * 它们自出生起零调用方——上传压缩走 imageUtils.compressImagesForUpload，不走这里。
 * 2026-10-29 r357 按死代码清理整组删除：既服务于「小而美、警惕系统膨胀」原则，
 * 也消除这批重函数一旦被误接线到主线程造成卡顿的隐患。
 */

/**
 * 将 dataURL 转换为 File 对象（用于上传）
 */
export function dataURLtoFile(dataUrl, filename = 'optimized_image.png') {
  const arr = dataUrl.split(',')
  const mimeMatch = arr[0].match(/:(.*?);/)
  const mime = mimeMatch ? mimeMatch[1] : 'image/png'
  const bstr = atob(arr[1])
  let n = bstr.length
  const u8arr = new Uint8Array(n)
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n)
  }
  return new File([u8arr], filename, { type: mime })
}

/**
 * 按角度旋转图片（上传暂存区"旋转摆正"用，2026-09-20）。
 * 用户拍照没端平/方向不对时，在暂存区点旋转按钮自己把图转正，
 * 转正后的图就是正常图片——后续压缩、上传、批改、原卷展示、裁题全部是正的。
 *
 * @param {string} srcUrl 图片源（objectURL 或远程 URL）
 * @param {number} degrees 旋转角度，正数=顺时针（默认 90）
 * @returns {Promise<string>} 旋转后的 JPEG dataURL
 */
export async function rotateImageByUrl(srcUrl, degrees = 90) {
  const img = await new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('图片加载失败'))
    el.src = srcUrl
  })
  const w = img.naturalWidth
  const h = img.naturalHeight
  const clockwise = ((degrees % 360) + 360) % 360
  const swap = clockwise === 90 || clockwise === 270
  const canvas = document.createElement('canvas')
  canvas.width = swap ? h : w
  canvas.height = swap ? w : h
  const ctx = canvas.getContext('2d')
  // 白底（照片/作业纸背景，避免透明像素变黑）
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((clockwise * Math.PI) / 180)
  ctx.drawImage(img, -w / 2, -h / 2)
  return canvas.toDataURL('image/jpeg', 0.92)
}
