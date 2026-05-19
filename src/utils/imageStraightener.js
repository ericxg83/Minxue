/**
 * 客户端图像拉直工具
 * 使用投影分析法和霍夫变换检测试卷倾斜角度
 * 用于在裁剪前对试卷图像进行预处理
 */

/**
 * 加载图像
 */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

/**
 * 将图像二值化，返回黑白像素数组
 */
function binarize(imageData, threshold = 180) {
  const { data, width, height } = imageData
  const binary = new Uint8Array(width * height)
  
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4
    const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3
    // 深色像素(文字)标记为1，浅色像素(背景)标记为0
    binary[i] = brightness < threshold ? 1 : 0
  }
  
  return binary
}

/**
 * 使用投影分析法检测倾斜角度
 * 原理：当图像旋转到正确角度时，文本行的水平投影方差最大
 */
function detectSkewByProjection(imageData, angleRange = 15, step = 0.5) {
  const { width, height } = imageData
  
  // 缩小采样以提升性能
  const scaleFactor = Math.max(1, Math.floor(Math.max(width, height) / 800))
  const sw = Math.ceil(width / scaleFactor)
  const sh = Math.ceil(height / scaleFactor)
  
  // 二值化并缩放
  const binary = binarize(imageData, 160)
  const smallBinary = new Uint8Array(sw * sh)
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const srcX = Math.min(x * scaleFactor, width - 1)
      const srcY = Math.min(y * scaleFactor, height - 1)
      smallBinary[y * sw + x] = binary[srcY * width + srcX]
    }
  }
  
  let bestAngle = 0
  let bestVariance = -Infinity
  
  // 尝试不同角度
  for (let angle = -angleRange; angle <= angleRange; angle += step) {
    const radians = angle * Math.PI / 180
    
    // 计算旋转后的边界
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    
    // 对每行进行投影：将旋转后的图像投影到水平轴
    const projection = new Float32Array(sh)
    
    for (let y = 0; y < sh; y++) {
      let rowSum = 0
      for (let x = 0; x < sw; x++) {
        // 反向映射：旋转后的(x,y)对应原图中的位置
        const srcX = x * cos + y * sin
        const srcY = -x * sin + y * cos
        
        const sx = Math.round(srcX)
        const sy = Math.round(srcY)
        
        if (sx >= 0 && sx < sw && sy >= 0 && sy < sh) {
          rowSum += smallBinary[sy * sw + sx]
        }
      }
      projection[y] = rowSum
    }
    
    // 计算投影的方差（文本行清晰时方差大）
    const mean = projection.reduce((a, b) => a + b, 0) / sh
    const variance = projection.reduce((a, b) => a + (b - mean) * (b - mean), 0) / sh
    
    if (variance > bestVariance) {
      bestVariance = variance
      bestAngle = angle
    }
  }
  
  return bestAngle
}

/**
 * 使用霍夫变换检测直线角度（辅助方法）
 * 检测试卷边缘或横线的倾斜角度
 */
function detectSkewByHough(imageData) {
  const { data, width, height } = imageData
  
  // 缩小尺寸
  const scaleFactor = Math.max(1, Math.floor(Math.max(width, height) / 600))
  const sw = Math.ceil(width / scaleFactor)
  const sh = Math.ceil(height / scaleFactor)
  
  // 边缘检测：检测文字区域
  const edgeMap = new Uint8Array(sw * sh)
  const binary = binarize(imageData, 160)
  
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const srcX = Math.min(x * scaleFactor, width - 1)
      const srcY = Math.min(y * scaleFactor, height - 1)
      const center = binary[srcY * width + srcX]
      
      // 简单的边缘检测
      const left = binary[Math.min((y) * width + srcX - 1, binary.length - 1)]
      const right = binary[Math.min((y) * width + Math.min(srcX + 1, width - 1), binary.length - 1)]
      const up = binary[Math.min(Math.min(srcY + 1, height - 1) * width + srcX, binary.length - 1)]
      const down = binary[Math.min(Math.max(srcY - 1, 0) * width + srcX, binary.length - 1)]
      
      if (center && (!left || !right || !up || !down)) {
        edgeMap[y * sw + x] = 1
      }
    }
  }
  
  // 霍夫变换参数空间
  const maxR = Math.ceil(Math.sqrt(sw * sw + sh * sh))
  const angles = []
  const angleStep = 0.5 // 度
  
  for (let theta = -15; theta <= 15; theta += angleStep) {
    const rad = theta * Math.PI / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    
    let lineScore = 0
    
    // 采样水平线检测
    for (let y = 0; y < sh; y += 3) {
      let consecutivePixels = 0
      let maxConsecutive = 0
      
      for (let x = 0; x < sw; x++) {
        // 计算沿该角度的直线上的点
        const lineY = Math.round(y + (x - sw / 2) * Math.tan(rad))
        if (lineY >= 0 && lineY < sh) {
          if (edgeMap[lineY * sw + x]) {
            consecutivePixels++
            maxConsecutive = Math.max(maxConsecutive, consecutivePixels)
          } else {
            consecutivePixels = 0
          }
        }
      }
      
      if (maxConsecutive > sw * 0.1) {
        lineScore += maxConsecutive
      }
    }
    
    angles.push({ angle: theta, score: lineScore })
  }
  
  // 找到得分最高的角度
  angles.sort((a, b) => b.score - a.score)
  
  return angles.length > 0 ? angles[0].angle : 0
}

/**
 * 综合检测倾斜角度
 * 结合投影法和霍夫变换的结果
 */
function detectSkewAngle(imageData) {
  // 方法1：投影分析（主要方法，对文本行检测效果好）
  const projectionAngle = detectSkewByProjection(imageData, 15, 0.25)
  
  // 方法2：霍夫变换（辅助验证）
  const houghAngle = detectSkewByHough(imageData)
  
  // 如果两种方法结果接近，取平均值；否则以投影法为准
  const diff = Math.abs(projectionAngle - houghAngle)
  
  let finalAngle
  if (diff < 2) {
    // 两种方法一致，取加权平均
    finalAngle = (projectionAngle * 0.7 + houghAngle * 0.3)
  } else {
    // 以投影法为准
    finalAngle = projectionAngle
  }
  
  // 限制角度范围
  return Math.max(-15, Math.min(15, finalAngle))
}

/**
 * 旋转图像
 * 使用 Canvas 进行旋转，填充白色背景
 */
function rotateImage(img, angle) {
  const radians = angle * Math.PI / 180
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  
  // 计算旋转后的画布尺寸
  const absCos = Math.abs(Math.cos(radians))
  const absSin = Math.abs(Math.sin(radians))
  const newWidth = Math.ceil(img.naturalWidth * absCos + img.naturalHeight * absSin)
  const newHeight = Math.ceil(img.naturalWidth * absSin + img.naturalHeight * absCos)
  
  canvas.width = newWidth
  canvas.height = newHeight
  
  // 填充白色背景
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, newWidth, newHeight)
  
  // 旋转并绘制图像
  ctx.save()
  ctx.translate(newWidth / 2, newHeight / 2)
  ctx.rotate(radians)
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
  ctx.restore()
  
  return canvas
}

/**
 * 透视校正：检测试卷四边并进行校正
 * 使用边缘检测找到试卷边界
 */
function detectPaperBounds(imageData) {
  const { data, width, height } = imageData
  
  // 缩小尺寸处理
  const scaleFactor = Math.max(1, Math.floor(Math.max(width, height) / 1000))
  const sw = Math.ceil(width / scaleFactor)
  const sh = Math.ceil(height / scaleFactor)
  
  // 二值化
  const binary = binarize(imageData, 140)
  
  // 检测四条边的深色像素
  const topEdge = []
  const bottomEdge = []
  const leftEdge = []
  const rightEdge = []
  
  // 上边缘：从顶部往下扫描
  for (let x = 0; x < sw; x += 2) {
    for (let y = 0; y < sh * 0.4; y++) {
      const srcX = Math.min(x * scaleFactor, width - 1)
      const srcY = Math.min(y * scaleFactor, height - 1)
      if (binary[srcY * width + srcX]) {
        topEdge.push({ x: srcX, y: srcY })
        break
      }
    }
  }
  
  // 下边缘：从底部往上扫描
  for (let x = 0; x < sw; x += 2) {
    for (let y = sh - 1; y >= sh * 0.6; y--) {
      const srcX = Math.min(x * scaleFactor, width - 1)
      const srcY = Math.min(y * scaleFactor, height - 1)
      if (binary[srcY * width + srcX]) {
        bottomEdge.push({ x: srcX, y: srcY })
        break
      }
    }
  }
  
  // 左边缘：从左侧往右扫描
  for (let y = 0; y < sh; y += 2) {
    for (let x = 0; x < sw * 0.4; x++) {
      const srcX = Math.min(x * scaleFactor, width - 1)
      const srcY = Math.min(y * scaleFactor, height - 1)
      if (binary[srcY * width + srcX]) {
        leftEdge.push({ x: srcX, y: srcY })
        break
      }
    }
  }
  
  // 右边缘：从右侧往左扫描
  for (let y = 0; y < sh; y += 2) {
    for (let x = sw - 1; x >= sw * 0.6; x--) {
      const srcX = Math.min(x * scaleFactor, width - 1)
      const srcY = Math.min(y * scaleFactor, height - 1)
      if (binary[srcY * width + srcX]) {
        rightEdge.push({ x: srcX, y: srcY })
        break
      }
    }
  }
  
  // 计算每条边的拟合直线
  function fitLine(points) {
    if (points.length < 3) return null
    
    const n = points.length
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
    
    for (const p of points) {
      sumX += p.x
      sumY += p.y
      sumXY += p.x * p.y
      sumX2 += p.x * p.x
    }
    
    const denom = n * sumX2 - sumX * sumX
    if (Math.abs(denom) < 0.001) return null
    
    const slope = (n * sumXY - sumX * sumY) / denom
    const intercept = (sumY - slope * sumX) / n
    
    return { slope, intercept }
  }
  
  const topLine = fitLine(topEdge)
  const bottomLine = fitLine(bottomEdge)
  const leftLine = fitLine(leftEdge)
  const rightLine = fitLine(rightEdge)
  
  return { topLine, bottomLine, leftLine, rightLine, topEdge, bottomEdge, leftEdge, rightEdge }
}

/**
 * 应用透视校正
 * 使用 Canvas 的变换来实现简单的错切校正
 */
function applyPerspectiveCorrection(img, bounds) {
  if (!bounds) return null
  
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  
  // 填充白色背景
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  
  // 使用简单的错切变换校正
  const { topLine, bottomLine } = bounds
  
  if (topLine && bottomLine) {
    // 计算垂直方向的倾斜
    const topSlope = topLine.slope
    const bottomSlope = bottomLine.slope
    const avgSlope = (topSlope + bottomSlope) / 2
    
    // 如果倾斜很小，不需要校正
    if (Math.abs(avgSlope) < 0.02) return null
    
    // 使用逐行偏移的方法校正
    const sliceHeight = 2
    for (let y = 0; y < canvas.height; y += sliceHeight) {
      // 计算该行相对于中心线的偏移
      const centerY = canvas.height / 2
      const yOffset = y - centerY
      const xShift = avgSlope * yOffset
      
      ctx.drawImage(
        img,
        0, y, img.naturalWidth, sliceHeight,
        xShift, y, img.naturalWidth, sliceHeight
      )
    }
  } else {
    // 回退：使用简单的水平校正
    if (bounds.leftLine && bounds.rightLine) {
      const leftSlope = bounds.leftLine.slope
      const rightSlope = bounds.rightLine.slope
      const avgSlope = (leftSlope + rightSlope) / 2
      
      if (Math.abs(avgSlope) < 0.02) return null
      
      const sliceHeight = 2
      for (let y = 0; y < canvas.height; y += sliceHeight) {
        const centerY = canvas.height / 2
        const yOffset = y - centerY
        const xShift = avgSlope * yOffset
        
        ctx.drawImage(
          img,
          0, y, img.naturalWidth, sliceHeight,
          xShift, y, img.naturalWidth, sliceHeight
        )
      }
    } else {
      return null
    }
  }
  
  return canvas
}

/**
 * 拉直图像主函数
 * 自动检测偏转角度并旋转校正
 */
export async function straightenImage(imageSrc, options = {}) {
  const {
    enableRotation = true,
    enablePerspective = true,
    autoDetectAngle = true,
    manualAngle = 0
  } = options
  
  try {
    const img = await loadImage(imageSrc)
    
    let currentCanvas = document.createElement('canvas')
    currentCanvas.width = img.naturalWidth
    currentCanvas.height = img.naturalHeight
    const ctx = currentCanvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    
    // 步骤1: 自动检测并校正旋转角度
    if (enableRotation) {
      let angle = manualAngle
      
      if (autoDetectAngle && Math.abs(manualAngle) < 0.1) {
        const imageData = ctx.getImageData(0, 0, currentCanvas.width, currentCanvas.height)
        angle = detectSkewAngle(imageData)
        console.log(`[Straighten] 检测到的倾斜角度: ${angle.toFixed(2)}°`)
      }
      
      if (Math.abs(angle) > 0.1) {
        const rotatedCanvas = rotateImage(img, angle)
        currentCanvas = rotatedCanvas
        
        // 重新绘制到标准尺寸
        const finalCanvas = document.createElement('canvas')
        finalCanvas.width = img.naturalWidth
        finalCanvas.height = img.naturalHeight
        const finalCtx = finalCanvas.getContext('2d')
        finalCtx.fillStyle = '#FFFFFF'
        finalCtx.fillRect(0, 0, finalCanvas.width, finalCanvas.height)
        
        // 缩放回原始尺寸
        finalCtx.drawImage(rotatedCanvas, 0, 0, img.naturalWidth, img.naturalHeight)
        currentCanvas = finalCanvas
      }
    }
    
    // 步骤2: 透视校正
    if (enablePerspective) {
      const tempCtx = currentCanvas.getContext('2d')
      const imageData = tempCtx.getImageData(0, 0, currentCanvas.width, currentCanvas.height)
      const bounds = detectPaperBounds(imageData)
      
      const tempImg = new Image()
      tempImg.src = currentCanvas.toDataURL()
      await new Promise((resolve) => {
        tempImg.onload = resolve
      })
      
      const correctedCanvas = applyPerspectiveCorrection(tempImg, bounds)
      if (correctedCanvas) {
        currentCanvas = correctedCanvas
      }
    }
    
    return currentCanvas.toDataURL('image/png')
  } catch (error) {
    console.error('图像拉直失败:', error)
    return imageSrc
  }
}

/**
 * 批量拉直多张图像
 */
export async function straightenImages(imageSrcs, options = {}) {
  const results = []
  
  for (const src of imageSrcs) {
    try {
      const straightened = await straightenImage(src, options)
      results.push({ success: true, dataUrl: straightened })
    } catch (error) {
      results.push({ success: false, error: error.message, dataUrl: src })
    }
  }
  
  return results
}

/**
 * 获取图像偏转角度（用于手动调整）
 */
export async function detectImageSkewAngle(imageSrc) {
  try {
    const img = await loadImage(imageSrc)
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const angle = detectSkewAngle(imageData)
    console.log(`[DetectSkew] 检测到的倾斜角度: ${angle.toFixed(2)}°`)
    return angle
  } catch (error) {
    console.error('检测偏转角度失败:', error)
    return 0
  }
}
