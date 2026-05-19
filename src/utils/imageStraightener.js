/**
 * 客户端图像拉直工具
 * 使用 Canvas 进行透视校正和旋转拉直
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
 * 计算图像偏转角度
 * 通过分析图像边缘和内容分布来估算旋转角度
 */
function detectSkewAngle(imageData) {
  const { data, width, height } = imageData
  
  // 采样边缘检测
  const sampleRate = Math.max(1, Math.floor(Math.min(width, height) / 500))
  const edgePoints = []
  
  // 检测上下边缘的黑色/深色像素分布
  for (let y = 0; y < height; y += sampleRate) {
    let firstDark = -1
    let lastDark = -1
    
    for (let x = 0; x < width; x += sampleRate) {
      const idx = (y * width + x) * 4
      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]
      const brightness = (r + g + b) / 3
      
      if (brightness < 80) {
        if (firstDark === -1) firstDark = x
        lastDark = x
      }
    }
    
    if (firstDark !== -1) {
      edgePoints.push({ y, left: firstDark, right: lastDark })
    }
  }
  
  if (edgePoints.length < 2) return 0
  
  // 计算左边缘和右边缘的斜率
  let leftSlopeSum = 0
  let rightSlopeSum = 0
  let leftCount = 0
  let rightCount = 0
  
  for (let i = 1; i < edgePoints.length; i++) {
    const dy = edgePoints[i].y - edgePoints[i - 1].y
    if (dy === 0) continue
    
    if (edgePoints[i].left >= 0 && edgePoints[i - 1].left >= 0) {
      const dx = edgePoints[i].left - edgePoints[i - 1].left
      leftSlopeSum += Math.atan(dx / dy)
      leftCount++
    }
    
    if (edgePoints[i].right >= 0 && edgePoints[i - 1].right >= 0) {
      const dx = edgePoints[i].right - edgePoints[i - 1].right
      rightSlopeSum += Math.atan(dx / dy)
      rightCount++
    }
  }
  
  const avgAngle = leftCount > 0 && rightCount > 0
    ? (leftSlopeSum / leftCount + rightSlopeSum / rightCount) / 2
    : leftCount > 0
      ? leftSlopeSum / leftCount
      : rightSlopeSum / rightCount
  
  // 限制角度范围（试卷通常不会倾斜超过15度）
  const maxAngle = 15 * (Math.PI / 180)
  return Math.max(-maxAngle, Math.min(maxAngle, avgAngle))
}

/**
 * 旋转图像
 * 使用 Canvas 进行旋转，填充白色背景
 */
function rotateImage(img, angle) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  
  // 计算旋转后的画布尺寸
  const absCos = Math.abs(Math.cos(angle))
  const absSin = Math.abs(Math.sin(angle))
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
  ctx.rotate(angle)
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
  ctx.restore()
  
  return canvas
}

/**
 * 透视校正（简化版）
 * 通过检测四角点进行透视变换
 */
function perspectiveCorrection(imageData) {
  const { width, height } = imageData
  
  // 检测图像四角（简化实现）
  // 实际应用中可以使用更复杂的角点检测算法
  // 这里使用边缘检测来估算透视变形
  
  const topPoints = []
  const bottomPoints = []
  const leftPoints = []
  const rightPoints = []
  
  const threshold = 60
  const step = Math.max(1, Math.floor(width / 200))
  
  // 检测顶部边缘
  for (let x = 0; x < width; x += step) {
    for (let y = 0; y < height / 4; y += step) {
      const idx = (y * width + x) * 4
      const brightness = (imageData.data[idx] + imageData.data[idx + 1] + imageData.data[idx + 2]) / 3
      if (brightness < threshold) {
        topPoints.push({ x, y })
        break
      }
    }
  }
  
  // 检测底部边缘
  for (let x = 0; x < width; x += step) {
    for (let y = height - 1; y >= (height * 3) / 4; y -= step) {
      const idx = (y * width + x) * 4
      const brightness = (imageData.data[idx] + imageData.data[idx + 1] + imageData.data[idx + 2]) / 3
      if (brightness < threshold) {
        bottomPoints.push({ x, y })
        break
      }
    }
  }
  
  // 检测左边缘
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width / 4; x += step) {
      const idx = (y * width + x) * 4
      const brightness = (imageData.data[idx] + imageData.data[idx + 1] + imageData.data[idx + 2]) / 3
      if (brightness < threshold) {
        leftPoints.push({ x, y })
        break
      }
    }
  }
  
  // 检测右边缘
  for (let y = 0; y < height; y += step) {
    for (let x = width - 1; x >= (width * 3) / 4; x -= step) {
      const idx = (y * width + x) * 4
      const brightness = (imageData.data[idx] + imageData.data[idx + 1] + imageData.data[idx + 2]) / 3
      if (brightness < threshold) {
        rightPoints.push({ x, y })
        break
      }
    }
  }
  
  // 计算透视参数
  if (topPoints.length > 0 && bottomPoints.length > 0) {
    const topY = topPoints.reduce((sum, p) => sum + p.y, 0) / topPoints.length
    const bottomY = bottomPoints.reduce((sum, p) => sum + p.y, 0) / bottomPoints.length
    
    const topX = topPoints.reduce((sum, p) => sum + p.x, 0) / topPoints.length
    const bottomX = bottomPoints.reduce((sum, p) => sum + p.x, 0) / bottomPoints.length
    
    const skewX = (bottomX - topX) / (bottomY - topY)
    
    return { skewX, topY, bottomY, topX, bottomX }
  }
  
  return null
}

/**
 * 应用透视校正
 */
function applyPerspectiveCorrection(img, params) {
  if (!params) return null
  
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  
  // 使用简单的水平错切校正
  const skewX = params.skewX
  
  if (Math.abs(skewX) < 0.01) return null
  
  const sliceHeight = 1
  let yOffset = 0
  
  for (let y = 0; y < img.naturalHeight; y += sliceHeight) {
    const xOffset = skewX * y
    ctx.drawImage(
      img,
      0, y, img.naturalWidth, sliceHeight,
      xOffset, y + yOffset, img.naturalWidth, sliceHeight
    )
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
      
      if (autoDetectAngle) {
        const imageData = ctx.getImageData(0, 0, currentCanvas.width, currentCanvas.height)
        angle = detectSkewAngle(imageData)
      }
      
      if (Math.abs(angle) > 0.001) {
        const rotatedCanvas = rotateImage(img, angle)
        currentCanvas = rotatedCanvas
      }
    }
    
    // 步骤2: 透视校正
    if (enablePerspective) {
      const tempCtx = currentCanvas.getContext('2d')
      const imageData = tempCtx.getImageData(0, 0, currentCanvas.width, currentCanvas.height)
      const perspectiveParams = perspectiveCorrection(imageData)
      
      if (perspectiveParams) {
        const tempImg = new Image()
        tempImg.src = currentCanvas.toDataURL()
        await new Promise((resolve) => {
          tempImg.onload = resolve
        })
        
        const correctedCanvas = applyPerspectiveCorrection(tempImg, perspectiveParams)
        if (correctedCanvas) {
          currentCanvas = correctedCanvas
        }
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
    return detectSkewAngle(imageData)
  } catch (error) {
    console.error('检测偏转角度失败:', error)
    return 0
  }
}
