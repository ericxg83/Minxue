/**
 * 图片优化工具函数
 * 用于裁剪后的图片处理：去黑、调整对比度、清晰度增强等
 */

/**
 * 将 dataURL 转换为 Image 对象
 */
function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = dataUrl
  })
}

/**
 * 将 Canvas 转换为 dataURL
 */
function canvasToDataURL(canvas, format = 'image/png', quality = 0.95) {
  return canvas.toDataURL(format, quality)
}

/**
 * 去除图片的黑色区域，转换为白色背景
 * 检测像素亮度，如果低于阈值则认为是黑色区域
 */
export async function removeBlackRegions(imageSrc, threshold = 30) {
  const img = await loadImage(imageSrc)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  
  ctx.drawImage(img, 0, 0)
  
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data
  
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    
    // 计算亮度
    const brightness = (r + g + b) / 3
    
    if (brightness < threshold) {
      // 将暗色区域转换为白色
      data[i] = 255     // R
      data[i + 1] = 255 // G
      data[i + 2] = 255 // B
      // 保持 alpha 不变
    }
  }
  
  ctx.putImageData(imageData, 0, 0)
  return canvasToDataURL(canvas)
}

/**
 * 调整图片对比度
 * @param {number} factor - 对比度因子，> 1 增加对比度，< 1 降低对比度
 */
export async function adjustContrast(imageSrc, factor = 1.2) {
  const img = await loadImage(imageSrc)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  
  ctx.drawImage(img, 0, 0)
  
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data
  
  // 对比度调整因子
  const contrastFactor = (259 * (factor * 255 + 255)) / (255 * (259 - factor * 255))
  
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const value = data[i + c]
      // 应用对比度公式
      const newValue = contrastFactor * (value - 128) + 128
      data[i + c] = Math.max(0, Math.min(255, Math.round(newValue)))
    }
  }
  
  ctx.putImageData(imageData, 0, 0)
  return canvasToDataURL(canvas)
}

/**
 * 增强图片清晰度（锐化）
 * 使用简单的卷积核进行锐化处理
 */
export async function sharpenImage(imageSrc, amount = 1.0) {
  const img = await loadImage(imageSrc)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  
  ctx.drawImage(img, 0, 0)
  
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data
  const width = canvas.width
  const height = canvas.height
  
  // 创建原始数据的副本
  const originalData = new Uint8ClampedArray(data)
  
  // 锐化卷积核
  // [ 0 -1  0 ]
  // [-1  5 -1 ]
  // [ 0 -1  0 ]
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0]
  const kernelSize = 3
  const halfKernel = Math.floor(kernelSize / 2)
  
  for (let y = halfKernel; y < height - halfKernel; y++) {
    for (let x = halfKernel; x < width - halfKernel; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0
        
        for (let ky = 0; ky < kernelSize; ky++) {
          for (let kx = 0; kx < kernelSize; kx++) {
            const pixelY = y - halfKernel + ky
            const pixelX = x - halfKernel + kx
            const pixelIndex = (pixelY * width + pixelX) * 4 + c
            sum += originalData[pixelIndex] * kernel[ky * kernelSize + kx]
          }
        }
        
        // 混合原始值和锐化值
        const originalValue = originalData[(y * width + x) * 4 + c]
        const sharpenedValue = originalValue + (sum - originalValue) * amount
        data[(y * width + x) * 4 + c] = Math.max(0, Math.min(255, Math.round(sharpenedValue)))
      }
    }
  }
  
  ctx.putImageData(imageData, 0, 0)
  return canvasToDataURL(canvas)
}

/**
 * 综合图片优化处理
 * 1. 去除黑色区域
 * 2. 调整对比度
 * 3. 锐化处理
 */
export async function optimizeImage(imageSrc, options = {}) {
  const {
    removeBlack = true,
    blackThreshold = 40,
    contrastFactor = 1.3,
    sharpenAmount = 0.8,
    outputFormat = 'image/png',
    outputQuality = 0.95
  } = options
  
  let result = imageSrc
  
  // 1. 去黑处理
  if (removeBlack) {
    result = await removeBlackRegions(result, blackThreshold)
  }
  
  // 2. 调整对比度
  if (contrastFactor !== 1.0) {
    result = await adjustContrast(result, contrastFactor)
  }
  
  // 3. 锐化处理
  if (sharpenAmount > 0) {
    result = await sharpenImage(result, sharpenAmount)
  }
  
  // 4. 转换输出格式
  if (outputFormat !== 'image/png') {
    const img = await loadImage(result)
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    result = canvasToDataURL(canvas, outputFormat, outputQuality)
  }
  
  return result
}

/**
 * 裁剪并优化图片
 * 结合裁剪和优化处理的完整流程
 */
export async function cropAndOptimizeImage(imageSrc, cropArea, options = {}) {
  const { x, y, width, height } = cropArea
  
  // 1. 加载原图
  const img = await loadImage(imageSrc)
  
  // 2. 创建裁剪 canvas
  const cropCanvas = document.createElement('canvas')
  cropCanvas.width = width
  cropCanvas.height = height
  const cropCtx = cropCanvas.getContext('2d')
  
  // 3. 执行裁剪
  cropCtx.drawImage(img, x, y, width, height, 0, 0, width, height)
  let croppedDataUrl = canvasToDataURL(cropCanvas)
  
  // 4. 应用优化处理
  const optimizedDataUrl = await optimizeImage(croppedDataUrl, options)
  
  return optimizedDataUrl
}

/**
 * 智能检测黑色区域并裁剪
 * 自动检测并去除周围的黑色边框
 */
export async function autoCropBlackBorders(imageSrc, threshold = 40, margin = 5) {
  const img = await loadImage(imageSrc)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  
  ctx.drawImage(img, 0, 0)
  
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data
  const width = canvas.width
  const height = canvas.height
  
  // 检测边界
  let minX = width, minY = height, maxX = 0, maxY = 0
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4
      const r = data[index]
      const g = data[index + 1]
      const b = data[index + 2]
      const brightness = (r + g + b) / 3
      
      if (brightness >= threshold) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }
  
  // 添加边距
  minX = Math.max(0, minX - margin)
  minY = Math.max(0, minY - margin)
  maxX = Math.min(width - 1, maxX + margin)
  maxY = Math.min(height - 1, maxY + margin)
  
  // 如果没有找到有效区域，返回原图
  if (minX >= maxX || minY >= maxY) {
    return imageSrc
  }
  
  // 裁剪
  const cropWidth = maxX - minX + 1
  const cropHeight = maxY - minY + 1
  
  const cropCanvas = document.createElement('canvas')
  cropCanvas.width = cropWidth
  cropCanvas.height = cropHeight
  const cropCtx = cropCanvas.getContext('2d')
  
  cropCtx.drawImage(img, minX, minY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)
  
  return canvasToDataURL(cropCanvas)
}

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