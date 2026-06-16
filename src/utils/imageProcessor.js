/**
 * 题目图片自动处理工具
 * 功能：去除脏边、白底化、增强对比度、去手写、裁剪多余空白
 */

/**
 * 处理截取的题目图片
 * @param {string|Canvas} source - 图片源（base64 URL 或 Canvas 对象）
 * @param {Object} options - 处理选项
 * @param {boolean} options.autoEnhance - 是否自动增强（默认 true）
 * @param {boolean} options.removeHandwriting - 是否去除手写笔迹（默认 false）
 * @param {number} options.padding - 裁剪后保留的边距像素（默认 10）
 * @returns {Promise<string>} 处理后的 base64 PNG URL
 */
export async function processExamImage(source, options = {}) {
  const {
    autoEnhance = true,
    removeHandwriting = false,
    padding = 10
  } = options

  // 获取 Canvas 和图片数据
  let canvas, ctx, width, height
  if (source instanceof HTMLCanvasElement) {
    canvas = source
    ctx = canvas.getContext('2d')
    width = canvas.width
    height = canvas.height
  } else {
    // 从 base64 或 URL 加载图片
    const img = await loadImage(source)
    canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    width = img.naturalWidth
    height = img.naturalHeight
  }

  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data

  if (autoEnhance) {
    // 1. 去手写（可选，在增强之前执行以保留原始笔迹位置信息）
    if (removeHandwriting) {
      removeHandwritingPixels(data, width, height)
    }

    // 2. 分析背景色（采样四角）
    const bgColor = analyzeBackgroundColor(data, width, height)

    // 3. 白底化处理 + 增强对比度
    enhanceAndWhiteBackground(data, width, height, bgColor)

    // 4. 写回处理后的数据
    ctx.putImageData(imageData, 0, 0)

    // 5. 裁剪多余空白
    const trimmedCanvas = trimWhitespace(canvas, padding)

    // 6. 输出 PNG
    return trimmedCanvas.toDataURL('image/png')
  } else {
    // 不增强，仅转 PNG
    return canvas.toDataURL('image/png')
  }
}

/**
 * 去手写处理：擦除扫描试卷中的蓝色圆珠笔/钢笔笔迹
 * 通过颜色通道差异识别蓝色墨水并设为白色
 * 打印文字通常是纯黑色(R≈G≈B且值很低)，蓝色墨水则B通道明显偏高
 */
function removeHandwritingPixels(data, width, height) {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const avg = (r + g + b) / 3

    // 蓝色墨水检测（最常见的圆珠笔/钢笔颜色）
    // 特征：蓝通道显著高于红绿通道，非纯白非纯黑
    if (b > r + 20 && b > g + 15 && avg > 40 && avg < 230) {
      data[i] = data[i + 1] = data[i + 2] = 255
    }
  }
}

/**
 * 分析背景颜色（采样四角区域）
 */
function analyzeBackgroundColor(data, width, height) {
  const sampleSize = Math.min(20, Math.floor(width / 10), Math.floor(height / 10))
  const corners = [
    { x: 0, y: 0 },
    { x: width - sampleSize, y: 0 },
    { x: 0, y: height - sampleSize },
    { x: width - sampleSize, y: height - sampleSize }
  ]

  let r = 0, g = 0, b = 0, count = 0
  for (const corner of corners) {
    for (let y = corner.y; y < corner.y + sampleSize; y++) {
      for (let x = corner.x; x < corner.x + sampleSize; x++) {
        const idx = (y * width + x) * 4
        r += data[idx]
        g += data[idx + 1]
        b += data[idx + 2]
        count++
      }
    }
  }

  return {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count)
  }
}

/**
 * 白底化 + 增强对比度
 * 算法：
 * 1. 将接近背景色的像素设为纯白（去除脏边/灰底）
 * 2. 增强文字/线条的对比度
 */
function enhanceAndWhiteBackground(data, width, height, bgColor) {
  // 背景容差：与背景色差异在这个范围内视为背景
  const bgTolerance = 35

  // 增强参数
  const contrastFactor = 1.3 // 对比度增强系数
  const brightnessOffset = 5 // 亮度微调

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    // 计算与背景色的差异
    const diff = Math.sqrt(
      Math.pow(r - bgColor.r, 2) +
      Math.pow(g - bgColor.g, 2) +
      Math.pow(b - bgColor.b, 2)
    )

    if (diff < bgTolerance) {
      // 接近背景色 → 设为纯白
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
    } else {
      // 非背景像素（文字/线条）→ 增强对比度
      // 转换为灰度判断深浅
      const gray = 0.299 * r + 0.587 * g + 0.114 * b

      if (gray < 180) {
        // 深色内容（文字、线条）→ 加深
        const factor = contrastFactor
        data[i] = Math.max(0, Math.min(255, (r - 128) * factor + 128 - brightnessOffset))
        data[i + 1] = Math.max(0, Math.min(255, (g - 128) * factor + 128 - brightnessOffset))
        data[i + 2] = Math.max(0, Math.min(255, (b - 128) * factor + 128 - brightnessOffset))
      } else {
        // 浅色噪点 → 变白
        data[i] = 255
        data[i + 1] = 255
        data[i + 2] = 255
      }
    }
  }
}

/**
 * 裁剪四周多余空白
 */
function trimWhitespace(canvas, padding = 10) {
  const ctx = canvas.getContext('2d')
  const width = canvas.width
  const height = canvas.height
  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data

  // 查找内容边界（非纯白像素）
  let minX = width, minY = height, maxX = 0, maxY = 0
  const threshold = 250 // 灰度阈值，低于此视为内容

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]
      const gray = 0.299 * r + 0.587 * g + 0.114 * b

      if (gray < threshold) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }

  // 添加边距
  minX = Math.max(0, minX - padding)
  minY = Math.max(0, minY - padding)
  maxX = Math.min(width - 1, maxX + padding)
  maxY = Math.min(height - 1, maxY + padding)

  const trimWidth = maxX - minX + 1
  const trimHeight = maxY - minY + 1

  // 创建裁剪后的 canvas
  const trimmedCanvas = document.createElement('canvas')
  trimmedCanvas.width = trimWidth
  trimmedCanvas.height = trimHeight
  const trimmedCtx = trimmedCanvas.getContext('2d')
  trimmedCtx.drawImage(canvas, minX, minY, trimWidth, trimHeight, 0, 0, trimWidth, trimHeight)

  return trimmedCanvas
}

/**
 * 加载图片
 */
function loadImage(source) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = source
  })
}
