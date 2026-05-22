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
  
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const value = data[i + c]
      // Simple contrast multiplier: value' = 128 + factor * (value - 128)
      const newValue = 128 + factor * (value - 128)
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
 * 去除题目文字背景，保留图形和标记
 * 通过识别文字区域并将其背景化处理，保留图形、字母等非文字内容
 */
export async function removeTextBackground(imageSrc, options = {}) {
  const {
    textThreshold = 200,
    minStrokeWidth = 1,
    maxStrokeWidth = 15,
    preserveLetters = true,
    preserveGraphics = true
  } = options

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

  // 步骤1: 识别文字区域
  const isTextPixel = new Uint8Array(width * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]

      // 计算亮度和饱和度
      const brightness = (r + g + b) / 3
      const maxC = Math.max(r, g, b)
      const minC = Math.min(r, g, b)
      const saturation = maxC === 0 ? 0 : (maxC - minC) / maxC

      // 文字特征: 低饱和度、高亮度对比
      if (brightness < textThreshold && saturation < 0.3) {
        isTextPixel[y * width + x] = 1
      }
    }
  }

  // 步骤2: 通过连通区域分析识别图形和字母
  const visited = new Uint8Array(width * height)
  const regions = []

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pos = y * width + x
      if (isTextPixel[pos] && !visited[pos]) {
        // BFS 查找连通区域
        const region = []
        const queue = [pos]
        visited[pos] = 1

        while (queue.length > 0) {
          const current = queue.shift()
          const cx = current % width
          const cy = Math.floor(current / width)
          region.push({ x: cx, y: cy })

          // 检查四邻域
          const neighbors = [
            { x: cx - 1, y: cy },
            { x: cx + 1, y: cy },
            { x: cx, y: cy - 1 },
            { x: cx, y: cy + 1 }
          ]

          for (const n of neighbors) {
            if (n.x >= 0 && n.x < width && n.y >= 0 && n.y < height) {
              const nPos = n.y * width + n.x
              if (isTextPixel[nPos] && !visited[nPos]) {
                visited[nPos] = 1
                queue.push(nPos)
              }
            }
          }
        }

        if (region.length > 0) {
          // 计算区域边界
          let minX = width, minY = height, maxX = 0, maxY = 0
          for (const p of region) {
            minX = Math.min(minX, p.x)
            minY = Math.min(minY, p.y)
            maxX = Math.max(maxX, p.x)
            maxY = Math.max(maxY, p.y)
          }

          const regionWidth = maxX - minX + 1
          const regionHeight = maxY - minY + 1
          const aspectRatio = regionWidth / regionHeight

          regions.push({
            pixels: region,
            bounds: { minX, minY, maxX, maxY },
            width: regionWidth,
            height: regionHeight,
            aspectRatio,
            size: region.length
          })
        }
      }
    }
  }

  // 步骤3: 标记要保留的图形和字母区域
  const preserveMask = new Uint8Array(width * height)

  for (const region of regions) {
    const { width: rw, height: rh, aspectRatio, size } = region

    // 图形特征判断:
    // - 较大的区域(size>100)
    // - 特殊的宽高比(字母通常0.3-1.5, 图形可能更大)
    // - 笔画宽度特征

    if (preserveGraphics && size > 100) {
      // 保留较大的图形区域
      for (const p of region.pixels) {
        preserveMask[p.y * width + p.x] = 1
      }
    }

    if (preserveLetters && size > 20 && size < 5000) {
      if (aspectRatio >= 0.2 && aspectRatio <= 3.0) {
        // 保留字母和符号
        for (const p of region.pixels) {
          preserveMask[p.y * width + p.x] = 1
        }
      }
    }
  }

  // 步骤4: 将非保留的文字区域背景化
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pos = y * width + x
      const idx = pos * 4

      if (isTextPixel[pos] && !preserveMask[pos]) {
        // 渐变背景化: 根据周围像素调整
        const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3
        const blendFactor = brightness / textThreshold

        // 混合到浅色背景
        data[idx] = Math.round(data[idx] + (255 - data[idx]) * blendFactor * 0.8)
        data[idx + 1] = Math.round(data[idx + 1] + (255 - data[idx + 1]) * blendFactor * 0.8)
        data[idx + 2] = Math.round(data[idx + 2] + (255 - data[idx + 2]) * blendFactor * 0.8)
      }
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return canvasToDataURL(canvas)
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