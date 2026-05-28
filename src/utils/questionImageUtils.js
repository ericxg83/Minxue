/**
 * 题目图片处理工具模块
 * 
 * 功能：
 * 1. 检测题目区域内的图片块
 * 2. 生成缩略图
 * 3. 根据空间位置自动绑定图片到题目
 * 4. 裁剪和增强图片
 */

/**
 * 检测试卷图片中的图片块区域
 * 基于边缘密度和颜色变化检测非文字区域
 * 
 * @param {HTMLImageElement} img - 试卷图片
 * @param {Array} questions - 题目列表（包含 block_coordinates）
 * @param {Object} options - 配置选项
 * @returns {Promise<Array>} 图片块列表 [{bbox: {x, y, width, height}, thumbnail: string}]
 */
export async function detectImageBlocks(img, questions, options = {}) {
  const {
    minBlockWidth = 80,      // 最小图片块宽度（像素）
    minBlockHeight = 60,     // 最小图片块高度
    edgeThreshold = 30,      // 边缘检测阈值
    minImageArea = 5000      // 最小图片面积
  } = options

  try {
    // 创建 canvas 分析图片
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const pixels = imageData.data
    
    // 生成灰度图
    const gray = new Uint8Array(canvas.width * canvas.height)
    for (let i = 0; i < pixels.length; i += 4) {
      gray[i / 4] = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]
    }
    
    // 计算边缘密度图（Sobel 算子简化版）
    const edgeMap = new Uint8Array(canvas.width * canvas.height)
    for (let y = 1; y < canvas.height - 1; y++) {
      for (let x = 1; x < canvas.width - 1; x++) {
        const idx = y * canvas.width + x
        const gx = Math.abs(
          gray[idx - canvas.width - 1] + 2 * gray[idx - 1] + gray[idx + canvas.width - 1] -
          gray[idx - canvas.width + 1] - 2 * gray[idx + 1] - gray[idx + canvas.width + 1]
        )
        const gy = Math.abs(
          gray[idx - canvas.width - 1] + 2 * gray[idx - canvas.width] + gray[idx - canvas.width + 1] -
          gray[idx + canvas.width - 1] - 2 * gray[idx + canvas.width] - gray[idx + canvas.width + 1]
        )
        edgeMap[idx] = Math.min(255, Math.sqrt(gx * gx + gy * gy))
      }
    }
    
    // 分块分析边缘密度，找出图片区域
    const blockSize = 20 // 分析块大小
    const densityMap = []
    
    for (let by = 0; by < canvas.height; by += blockSize) {
      for (let bx = 0; bx < canvas.width; bx += blockSize) {
        let edgeSum = 0
        let count = 0
        for (let y = by; y < Math.min(by + blockSize, canvas.height); y++) {
          for (let x = bx; x < Math.min(bx + blockSize, canvas.width); x++) {
            edgeSum += edgeMap[y * canvas.width + x]
            count++
          }
        }
        const avgDensity = edgeSum / count
        densityMap.push({
          x: bx,
          y: by,
          width: blockSize,
          height: blockSize,
          density: avgDensity
        })
      }
    }
    
    // 合并相邻的高密度区域为图片块
    const highDensityBlocks = densityMap.filter(b => b.density > edgeThreshold)
    const mergedBlocks = mergeAdjacentBlocks(highDensityBlocks, blockSize)
    
    // 过滤掉太小或无效的区域
    const validBlocks = mergedBlocks.filter(b => 
      b.width >= minBlockWidth && 
      b.height >= minBlockHeight && 
      b.width * b.height >= minImageArea
    )
    
    // 排除题目文字区域（基于 block_coordinates）
    const filteredBlocks = excludeQuestionAreas(validBlocks, questions)
    
    // 生成缩略图
    const imageBlocks = await Promise.all(
      filteredBlocks.map(async (block) => {
        const thumbnail = await generateThumbnail(canvas, block)
        return {
          ...block,
          thumbnail,
          bbox: {
            x: block.x,
            y: block.y,
            width: block.width,
            height: block.height
          }
        }
      })
    )
    
    console.log(`[图片检测] 找到 ${imageBlocks.length} 个图片块`)
    return imageBlocks
    
  } catch (error) {
    console.error('[图片检测] 检测失败:', error)
    return []
  }
}

/**
 * 合并相邻的区块
 */
function mergeAdjacentBlocks(blocks, blockSize) {
  if (blocks.length === 0) return []
  
  // 按位置排序
  const sorted = [...blocks].sort((a, b) => a.y - b.y || a.x - b.x)
  
  // 使用连通域分析合并
  const visited = new Set()
  const merged = []
  
  for (let i = 0; i < sorted.length; i++) {
    if (visited.has(i)) continue
    
    const group = [sorted[i]]
    visited.add(i)
    
    for (let j = i + 1; j < sorted.length; j++) {
      if (visited.has(j)) continue
      
      const block = sorted[j]
      const isAdjacent = group.some(g => 
        Math.abs(g.x - block.x) <= blockSize * 1.5 &&
        Math.abs(g.y - block.y) <= blockSize * 1.5
      )
      
      if (isAdjacent) {
        group.push(block)
        visited.add(j)
      }
    }
    
    // 计算合并后的边界
    const minX = Math.min(...group.map(b => b.x))
    const minY = Math.min(...group.map(b => b.y))
    const maxX = Math.max(...group.map(b => b.x + b.width))
    const maxY = Math.max(...group.map(b => b.y + b.height))
    
    merged.push({
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    })
  }
  
  return merged
}

/**
 * 排除题目文字区域
 */
function excludeQuestionAreas(blocks, questions) {
  if (!questions || questions.length === 0) return blocks
  
  return blocks.filter(block => {
    // 检查图片块是否与题目区域重叠
    const overlap = questions.some(q => {
      if (!q.block_coordinates) return false
      const qc = q.block_coordinates
      return !(
        block.x + block.width < qc.x ||
        block.x > qc.x + qc.width ||
        block.y + block.height < qc.y ||
        block.y > qc.y + qc.height
      )
    })
    // 只保留不重叠的块（即非题目文字区域的图片）
    return !overlap
  })
}

/**
 * 生成缩略图
 * 
 * @param {HTMLCanvasElement} sourceCanvas - 源图片 canvas
 * @param {Object} bbox - 图片块边界框 {x, y, width, height}
 * @param {number} maxThumbnailSize - 最大缩略图尺寸（默认 150px）
 * @returns {Promise<string>} 缩略图 dataURL
 */
export async function generateThumbnail(sourceCanvas, bbox, maxThumbnailSize = 150) {
  try {
    const { x, y, width, height } = bbox
    
    // 计算缩放比例
    const scale = Math.min(maxThumbnailSize / width, maxThumbnailSize / height, 1)
    const thumbW = Math.round(width * scale)
    const thumbH = Math.round(height * scale)
    
    // 创建缩略图 canvas
    const canvas = document.createElement('canvas')
    canvas.width = thumbW
    canvas.height = thumbH
    const ctx = canvas.getContext('2d')
    
    // 平滑缩放
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(sourceCanvas, x, y, width, height, 0, 0, thumbW, thumbH)
    
    return canvas.toDataURL('image/jpeg', 0.7)
  } catch (error) {
    console.error('[缩略图] 生成失败:', error)
    return null
  }
}

/**
 * 将图片块绑定到题目
 * 使用多维度评分规则：
 * 1. 图片中心点距离哪个题号最近
 * 2. 图片位于哪个题目的 top/bottom 范围、左右列范围
 * 3. IoU (Intersection over Union) 最大
 * 4. 支持一题多图、图文分离、横向布局
 * 
 * @param {Array} questions - 题目列表（包含 block_coordinates）
 * @param {Array} imageBlocks - 图片块列表
 * @param {HTMLImageElement} examImage - 原始试卷图片
 * @returns {Map<questionId, Array<{imageBlock, fullImage: string, debugInfo}>>}
 */
export function bindImagesToQuestions(questions, imageBlocks, examImage) {
  const questionImages = new Map()
  
  // 按 Y 坐标排序题目（从上到下），保留原始索引用于题号
  const sortedQuestions = [...questions]
    .filter(q => q.block_coordinates)
    .sort((a, b) => a.block_coordinates.y - b.block_coordinates.y)
  
  // 为每个图片块计算与所有题目的关联分数
  for (const imgBlock of imageBlocks) {
    const imgBbox = {
      x: imgBlock.x,
      y: imgBlock.y,
      width: imgBlock.width,
      height: imgBlock.height
    }
    
    // 计算该图片与所有题目的分数
    const scores = sortedQuestions.map((q, idx) => {
      const qc = q.block_coordinates
      const score = calculateImageQuestionScore(imgBbox, qc)
      return { question: q, index: idx, score, questionIndex: questions.findIndex(origQ => origQ.id === q.id) }
    })
    
    // 按分数降序排列
    scores.sort((a, b) => b.score - a.score)
    
    // 找到最佳匹配的题目
    const bestMatch = scores[0]
    
    // 分数阈值：如果最佳分数 < 0，说明这个图片与任何题目都不相关
    if (bestMatch.score < 0) {
      console.log(`[图片绑定] IMG 跳过: 分数=${bestMatch.score.toFixed(2)} < 0`)
      continue
    }
    
    // 绑定图片到题目
    const qId = bestMatch.question.id
    if (!questionImages.has(qId)) {
      questionImages.set(qId, [])
    }
    
    // 裁剪完整图片
    const fullImage = cropImageFromCanvas(examImage, imgBbox)
    
    // 记录调试信息
    const debugInfo = {
      imgBbox: imgBbox,
      matchedQuestionId: qId,
      matchedQuestionIndex: bestMatch.questionIndex + 1,
      score: bestMatch.score.toFixed(2),
      topCandidates: scores.slice(0, 3).map(s => ({
        qIndex: s.questionIndex + 1,
        score: s.score.toFixed(2)
      }))
    }
    
    questionImages.get(qId).push({
      imageBlock: imgBlock,
      fullImage,
      thumbnail: imgBlock.thumbnail,
      debugInfo
    })
    
    console.log(`[图片绑定] IMG(${imgBbox.x},${imgBbox.y},${imgBbox.width}x${imgBbox.height}) → Q${bestMatch.questionIndex + 1} (分数: ${bestMatch.score.toFixed(2)})`)
  }
  
  console.log(`[图片绑定] 已绑定 ${questionImages.size} 个题目`)
  return questionImages
}

/**
 * 计算图片与题目的关联分数（多维度评分）
 * 分数越高表示关联越强
 * 
 * @param {Object} imgBbox - 图片边界框 {x, y, width, height}
 * @param {Object} qBbox - 题目边界框 {x, y, width, height}
 * @returns {number} 关联分数（-1 到 1+）
 */
function calculateImageQuestionScore(imgBbox, qBbox) {
  let score = 0
  
  // ========== 规则 1：图片中心点距离题目中心的距离 ==========
  const imgCenterX = imgBbox.x + imgBbox.width / 2
  const imgCenterY = imgBbox.y + imgBbox.height / 2
  const qCenterX = qBbox.x + qBbox.width / 2
  const qCenterY = qBbox.y + qBbox.height / 2
  
  // 归一化距离（以题目对角线长度为单位）
  const qDiagonal = Math.sqrt(qBbox.width ** 2 + qBbox.height ** 2)
  const centerDistance = Math.sqrt(
    (imgCenterX - qCenterX) ** 2 + (imgCenterY - qCenterY) ** 2
  )
  const normalizedDistance = centerDistance / qDiagonal
  
  // 距离分数：越近分数越高，0距离=1分，超过2倍对角线=负分
  const distanceScore = Math.max(-1, 1 - normalizedDistance)
  score += distanceScore * 30 // 权重 30
  
  // ========== 规则 2：图片中心是否在题目的 Y 范围内 ==========
  const imgCenterYInQuestionRange = (
    imgCenterY >= qBbox.y - imgBbox.height * 0.5 &&
    imgCenterY <= qBbox.y + qBbox.height + imgBbox.height * 0.5
  )
  if (imgCenterYInQuestionRange) {
    score += 25 // Y 范围匹配加分
  } else {
    // Y 范围不匹配，计算垂直距离惩罚
    const verticalGap = imgCenterY < qBbox.y
      ? qBbox.y - imgCenterY
      : imgCenterY - (qBbox.y + qBbox.height)
    const verticalPenalty = Math.min(verticalGap / qBbox.height, 2)
    score -= verticalPenalty * 15
  }
  
  // ========== 规则 3：图片与题目的 X 范围关系（支持左右列布局） ==========
  // 判断图片是否在题目的水平范围内（考虑左右布局，允许一定偏差）
  const xOverlap = Math.max(0, Math.min(imgBbox.x + imgBbox.width, qBbox.x + qBbox.width) - Math.max(imgBbox.x, qBbox.x))
  const xOverlapRatio = xOverlap / Math.min(imgBbox.width, qBbox.width)
  
  if (xOverlapRatio > 0.3) {
    // X 重叠 > 30%，认为是同列
    score += xOverlapRatio * 20
  } else {
    // X 不重叠，检查是否是左右布局（同一行）
    const yOverlap = Math.max(0, Math.min(imgBbox.y + imgBbox.height, qBbox.y + qBbox.height) - Math.max(imgBbox.y, qBbox.y))
    const yOverlapRatio = yOverlap / Math.min(imgBbox.height, qBbox.height)
    
    if (yOverlapRatio > 0.5) {
      // Y 重叠 > 50%，认为是同一行的左右布局
      const horizontalGap = imgBbox.x < qBbox.x
        ? qBbox.x - (imgBbox.x + imgBbox.width)
        : imgBbox.x - (qBbox.x + qBbox.width)
      const horizontalPenalty = Math.min(horizontalGap / qBbox.width, 3)
      score -= horizontalPenalty * 5 // 左右布局惩罚较小
    } else {
      // 既不在同一列也不在同一行，严重惩罚
      score -= 20
    }
  }
  
  // ========== 规则 4：IoU (Intersection over Union) ==========
  const intersection = Math.max(0, Math.min(imgBbox.x + imgBbox.width, qBbox.x + qBbox.width) - Math.max(imgBbox.x, qBbox.x)) *
                       Math.max(0, Math.min(imgBbox.y + imgBbox.height, qBbox.y + qBbox.height) - Math.max(imgBbox.y, qBbox.y))
  const imgArea = imgBbox.width * imgBbox.height
  const qArea = qBbox.width * qBbox.height
  const union = imgArea + qArea - intersection
  const iou = union > 0 ? intersection / union : 0
  
  score += iou * 25 // IoU 加分
  
  // ========== 规则 5：图片是否在题目区域内（图片中心在题目框内） ==========
  const imgCenterInQuestion = (
    imgCenterX >= qBbox.x && imgCenterX <= qBbox.x + qBbox.width &&
    imgCenterY >= qBbox.y && imgCenterY <= qBbox.y + qBbox.height
  )
  if (imgCenterInQuestion) {
    score += 15 // 图片中心在题目框内，额外加分
  }
  
  // ========== 规则 6：图片是否在题目上方（题干前方） ==========
  // 如果图片紧贴题目上方（y + height ≈ qBbox.y），且 X 范围有重叠，认为是题干配图
  const imgBottom = imgBbox.y + imgBbox.height
  const distanceToQuestionTop = Math.abs(imgBottom - qBbox.y)
  if (distanceToQuestionTop < qBbox.height * 0.2 && xOverlapRatio > 0.2) {
    score += 10 // 图片紧贴题目上方
  }
  
  return score
}

/**
 * 生成绑定调试信息
 * @param {Array} questions - 题目列表
 * @param {Array} imageBlocks - 图片块列表
 * @param {Map} questionImages - 绑定结果
 * @returns {Array} 调试信息数组 [{type, bbox, label, color}]
 */
export function generateDebugOverlay(questions, imageBlocks, questionImages) {
  const overlays = []
  
  // 题目框（蓝色）
  questions.forEach((q, idx) => {
    if (!q.block_coordinates) return
    overlays.push({
      type: 'question',
      bbox: q.block_coordinates,
      label: `Q${idx + 1}`,
      color: '#2563EB',
      borderColor: '#2563EB'
    })
  })
  
  // 图片框（绿色）+ 绑定关系
  imageBlocks.forEach((imgBlock, idx) => {
    const imgBbox = { x: imgBlock.x, y: imgBlock.y, width: imgBlock.width, height: imgBlock.height }
    
    // 查找绑定的题目
    let boundQuestion = null
    for (const [qId, images] of questionImages.entries()) {
      if (images.some(img => img.imageBlock === imgBlock)) {
        const qIdx = questions.findIndex(q => q.id === qId)
        boundQuestion = qIdx + 1
        break
      }
    }
    
    overlays.push({
      type: 'image',
      bbox: imgBbox,
      label: boundQuestion ? `IMG${idx + 1}→Q${boundQuestion}` : `IMG${idx + 1}?`,
      color: boundQuestion ? '#16A34A' : '#EF4444',
      borderColor: boundQuestion ? '#16A34A' : '#EF4444'
    })
  })
  
  return overlays
}

/**
 * 从 Canvas 裁剪指定区域
 */
function cropImageFromCanvas(examImage, bbox) {
  const canvas = document.createElement('canvas')
  canvas.width = bbox.width
  canvas.height = bbox.height
  const ctx = canvas.getContext('2d')
  
  ctx.drawImage(
    examImage,
    bbox.x, bbox.y, bbox.width, bbox.height,
    0, 0, bbox.width, bbox.height
  )
  
  return canvas.toDataURL('image/png')
}

/**
 * 处理 AI 返回的 geometry_image 字段，生成缩略图和完整图片
 * 
 * @param {Object} question - 题目对象
 * @param {HTMLImageElement} examImage - 原始试卷图片
 * @returns {Promise<Object|null>} 处理后的图片信息 {thumbnail, fullImage, bbox}
 */
export async function processGeometryImage(question, examImage) {
  if (!question.geometry_image?.has_image || !question.geometry_image.bbox) {
    return null
  }
  
  try {
    const bbox = question.geometry_image.bbox
    const thumbnail = await generateThumbnailFromImage(examImage, bbox, 150)
    const fullImage = cropImageFromCanvas(examImage, bbox)
    
    return {
      thumbnail,
      fullImage,
      bbox,
      description: question.geometry_image.description || ''
    }
  } catch (error) {
    console.error('[几何图处理] 失败:', error)
    return null
  }
}

/**
 * 从图片元素生成缩略图
 */
async function generateThumbnailFromImage(img, bbox, maxSize) {
  const { x, y, width, height } = bbox
  const scale = Math.min(maxSize / width, maxSize / height, 1)
  
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d')
  
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, x, y, width, height, 0, 0, canvas.width, canvas.height)
  
  return canvas.toDataURL('image/jpeg', 0.7)
}

/**
 * 合并 AI 检测的图片和自动检测的图片
 * 优先使用 AI 返回的 geometry_image，如果没有则使用自动检测的结果
 * 
 * @param {Array} questions - 题目列表
 * @param {HTMLImageElement} examImage - 原始试卷图片
 * @param {Array|null} autoDetectedImages - 自动检测的图片块（可选）
 * @returns {Promise<Map<questionId, Array<{thumbnail, fullImage, bbox, source}>>>}
 */
export async function mergeQuestionImages(questions, examImage, autoDetectedImages = null) {
  const result = new Map()
  
  for (const q of questions) {
    const images = []
    
    // 1. 处理 AI 返回的 geometry_image
    const geoImage = await processGeometryImage(q, examImage)
    if (geoImage) {
      images.push({
        ...geoImage,
        source: 'ai'
      })
    }
    
    // 2. 如果没有 AI 检测的图片，使用自动检测的结果
    if (autoDetectedImages && images.length === 0) {
      const autoImages = autoDetectedImages.filter(img => 
        belongsToQuestion(img, q, questions)
      )
      for (const autoImg of autoImages) {
        images.push({
          thumbnail: autoImg.thumbnail,
          fullImage: cropImageFromCanvas(examImage, autoImg.bbox),
          bbox: autoImg.bbox,
          source: 'auto'
        })
      }
    }
    
    if (images.length > 0) {
      result.set(q.id, images)
    }
  }
  
  return result
}

/**
 * 判断图片块是否属于某个题目
 */
function belongsToQuestion(imgBlock, question, allQuestions) {
  const qc = question.block_coordinates
  if (!qc) return false
  
  const img = imgBlock.bbox
  const imgCenterX = img.x + img.width / 2
  const imgCenterY = img.y + img.height / 2
  
  // 检查图片中心是否在题目区域内
  const isInArea = (
    imgCenterX >= qc.x &&
    imgCenterX <= qc.x + qc.width &&
    imgCenterY >= qc.y &&
    imgCenterY <= qc.y + qc.height
  )
  
  if (isInArea) return true
  
  // 检查图片是否与题目区域有重叠
  const hasOverlap = !(
    img.x + img.width < qc.x ||
    img.x > qc.x + qc.width ||
    img.y + img.height < qc.y ||
    img.y > qc.y + qc.height
  )
  
  // 如果有重叠，检查是否是最近的题目
  if (hasOverlap) {
    const qCenterY = qc.y + qc.height / 2
    let isClosest = true
    
    for (const otherQ of allQuestions) {
      if (otherQ.id === question.id) continue
      const oqc = otherQ.block_coordinates
      if (!oqc) continue
      
      const otherCenterY = oqc.y + oqc.height / 2
      if (Math.abs(imgCenterY - otherCenterY) < Math.abs(imgCenterY - qCenterY)) {
        isClosest = false
        break
      }
    }
    
    return isClosest
  }
  
  return false
}

/**
 * 压缩图片用于上传
 * 
 * @param {string} dataURL - 原始图片 dataURL
 * @param {Object} options - 配置选项
 * @returns {Promise<string>} 压缩后的 dataURL
 */
export async function compressImage(dataURL, options = {}) {
  const {
    maxWidth = 1920,
    maxHeight = 1920,
    quality = 0.8
  } = options
  
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      let width = img.naturalWidth
      let height = img.naturalHeight
      
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }
      
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, width, height)
      
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = reject
    img.src = dataURL
  })
}
