import crypto from 'crypto'
import sharp from 'sharp'

export const PARSER_VERSION = 'v1'

export const TEXT_SIMILARITY_THRESHOLD = 0.85

export const normalizeQuestionContent = (content) => {
  if (!content) return ''
  
  let normalized = String(content)
  
  normalized = normalized.replace(/\r\n/g, '\n')
  
  normalized = normalized.replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
  
  normalized = normalized.replace(/\u3000/g, ' ')
  
  normalized = normalized.replace(/[，。；：！？、（）【】《》""''·…—\-_\s]+/g, '')
  
  normalized = normalized.replace(/[\(\)\[\]{}〈〉「」『』]/g, '')
  
  normalized = normalized.toLowerCase()
  
  normalized = normalized.trim()
  
  console.log(`[Fingerprint] 内容标准化: "${content.substring(0, 50)}..." -> "${normalized.substring(0, 50)}..."`)
  
  return normalized
}

export const generateTextFingerprint = (content, options = [], questionType = 'choice') => {
  try {
    const normalizedContent = normalizeQuestionContent(content)
    
    const sortedOptions = Array.isArray(options) 
      ? [...options].map(opt => normalizeQuestionContent(opt)).sort() 
      : []
    
    const fingerprintInput = JSON.stringify({
      content: normalizedContent,
      options: sortedOptions,
      questionType: questionType || 'choice'
    })
    
    const hash = crypto.createHash('sha256').update(fingerprintInput).digest('hex')
    
    console.log(`[Fingerprint] 文本指纹生成: 输入长度=${fingerprintInput.length}, SHA256=${hash.substring(0, 16)}...`)
    
    return hash
  } catch (error) {
    console.error('[Fingerprint] 文本指纹生成失败:', error.message)
    return null
  }
}

export const generatePHash = async (imageBuffer) => {
  try {
    const resized = await sharp(imageBuffer)
      .resize(9, 8, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true })
    
    const pixelData = resized.data
    
    const bits = []
    
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const currentPixel = pixelData[row * 9 + col]
        const nextPixel = pixelData[row * 9 + col + 1]
        bits.push(currentPixel > nextPixel ? '1' : '0')
      }
    }
    
    const phash = bits.join('')
    
    console.log(`[Fingerprint] 感知哈希生成: 图像大小=${imageBuffer.length} bytes, dHash=${phash.substring(0, 16)}...`)
    
    return phash
  } catch (error) {
    console.error('[Fingerprint] 感知哈希生成失败:', error.message)
    return null
  }
}

export const calculateHammingDistance = (phash1, phash2) => {
  if (!phash1 || !phash2 || phash1.length !== phash2.length) {
    return -1
  }
  
  let distance = 0
  for (let i = 0; i < phash1.length; i++) {
    if (phash1[i] !== phash2[i]) {
      distance++
    }
  }
  return distance
}

export const calculateLevenshteinDistance = (str1, str2) => {
  const m = str1.length
  const n = str2.length
  
  if (m === 0) return n
  if (n === 0) return m
  
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      )
    }
  }
  
  return dp[m][n]
}

export const calculateTextSimilarity = (text1, text2) => {
  try {
    const normalized1 = normalizeQuestionContent(text1)
    const normalized2 = normalizeQuestionContent(text2)
    
    if (normalized1 === normalized2) {
      console.log(`[Fingerprint] 文本相似度: 完全匹配 (1.0)`)
      return 1.0
    }
    
    if (!normalized1 || !normalized2) {
      return 0.0
    }
    
    const distance = calculateLevenshteinDistance(normalized1, normalized2)
    const maxLength = Math.max(normalized1.length, normalized2.length)
    
    if (maxLength === 0) {
      return 0.0
    }
    
    const similarity = 1 - (distance / maxLength)
    
    console.log(`[Fingerprint] 文本相似度: 编辑距离=${distance}, 最大长度=${maxLength}, 相似度=${similarity.toFixed(4)}`)
    
    return similarity
  } catch (error) {
    console.error('[Fingerprint] 文本相似度计算失败:', error.message)
    return 0.0
  }
}
