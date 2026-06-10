/**
 * 题目去重工具函数
 * 
 * 核心功能：
 * - 题目指纹生成
 * - 文本相似度计算（阈值90%）
 * - 重复错题合并
 */

/**
 * 计算两个字符串的编辑距离（Levenshtein Distance）
 */
const getEditDistance = (str1, str2) => {
  const len1 = str1.length
  const len2 = str2.length
  const matrix = []

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // 删除
        matrix[i][j - 1] + 1,      // 插入
        matrix[i - 1][j - 1] + cost // 替换
      )
    }
  }

  return matrix[len1][len2]
}

/**
 * 计算文本相似度（0-1之间）
 * 基于编辑距离的相似度
 */
export const calculateSimilarity = (text1, text2) => {
  if (!text1 || !text2) return 0
  if (text1 === text2) return 1

  const distance = getEditDistance(text1, text2)
  const maxLen = Math.max(text1.length, text2.length)
  
  if (maxLen === 0) return 1
  
  return 1 - (distance / maxLen)
}

/**
 * 生成题目指纹
 * 基于题干内容生成唯一标识
 * 处理方式：
 * - 去除空格、换行
 * - 统一标点符号
 * - 生成简化哈希
 */
export const generateQuestionFingerprint = (question) => {
  const content = question.content || ''
  
  // 清洗文本
  const normalized = content
    .replace(/\s+/g, '')           // 去除空白
    .replace(/[，,。；;!！?？]/g, '') // 去除标点
    .toLowerCase()

  // 简单哈希
  let hash = 0
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // 转换为32位整数
  }
  
  return `fp_${Math.abs(hash).toString(36)}_${normalized.length}`
}

/**
 * 判断两道题是否为同一道题
 * 相似度超过90%视为同一题
 */
export const isSameQuestion = (q1, q2, threshold = 0.9) => {
  const content1 = q1.content || q1.question?.content || ''
  const content2 = q2.content || q2.question?.content || ''
  
  return calculateSimilarity(content1, content2) >= threshold
}

/**
 * 为错题列表去重
 * 返回去重后的错题列表，合并重复项的统计信息
 */
export const deduplicateWrongQuestions = (questions, threshold = 0.9) => {
  if (!Array.isArray(questions) || questions.length === 0) return []

  const grouped = []
  const used = new Set()

  for (let i = 0; i < questions.length; i++) {
    if (used.has(i)) continue

    const current = questions[i]
    const group = [current]
    used.add(i)

    for (let j = i + 1; j < questions.length; j++) {
      if (used.has(j)) continue

      const other = questions[j]
      if (isSameQuestion(current, other, threshold)) {
        group.push(other)
        used.add(j)
      }
    }

    // 合并为一题
    const merged = mergeWrongQuestions(group)
    grouped.push(merged)
  }

  return grouped
}

/**
 * 合并重复错题
 * 保留最新记录，累加统计信息
 */
const mergeWrongQuestions = (duplicates) => {
  if (duplicates.length === 1) return { ...duplicates[0], wrong_count: 1 }

  // 按最后错误时间排序
  const sorted = [...duplicates].sort((a, b) => {
    const timeA = new Date(a.last_wrong_at || a.added_at || 0)
    const timeB = new Date(b.last_wrong_at || b.added_at || 0)
    return timeB - timeA // 最新的在前
  })

  const latest = sorted[0]
  const earliest = sorted[sorted.length - 1]

  // 累加错误次数和练习次数
  const totalErrorCount = duplicates.reduce((sum, wq) => sum + (wq.error_count || 1), 0)
  const totalPracticeCount = duplicates.reduce((sum, wq) => sum + (wq.practice_count || 0), 0)

  // 合并生命周期状态（取最高阶段）
  const lifecycleOrder = ['new', 'review_1', 'review_2', 'mastered']
  let highestLifecycle = 'new'
  duplicates.forEach(wq => {
    const current = wq.lifecycle_status || 'new'
    const currentIndex = lifecycleOrder.indexOf(current)
    const highestIndex = lifecycleOrder.indexOf(highestLifecycle)
    if (currentIndex > highestIndex) {
      highestLifecycle = current
    }
  })

  return {
    ...latest,
    // 保留最新的记录
    id: latest.id,
    // 累加统计
    wrong_count: duplicates.length,  // 重复次数
    error_count: totalErrorCount,    // 累计错误次数
    practice_count: totalPracticeCount,
    // 时间范围
    first_wrong_time: earliest.added_at || earliest.created_at,
    last_wrong_time: latest.last_wrong_at || latest.added_at || latest.created_at,
    // 生命周期状态（取最高阶段）
    lifecycle_status: highestLifecycle,
    // 标记为合并记录
    is_merged: true,
    // 原始记录ID列表
    original_ids: duplicates.map(wq => wq.id)
  }
}

/**
 * 查找与给定题目相似的错题
 */
export const findSimilarQuestions = (question, questionList, threshold = 0.9) => {
  return questionList.filter(wq => isSameQuestion(question, wq, threshold))
}

/**
 * 获取题目的相似度信息（用于调试）
 */
export const getSimilarityInfo = (q1, q2) => {
  const content1 = q1.content || q1.question?.content || ''
  const content2 = q2.content || q2.question?.content || ''
  const similarity = calculateSimilarity(content1, content2)
  
  return {
    similarity: (similarity * 100).toFixed(2) + '%',
    isDuplicate: similarity >= 0.9,
    content1: content1.substring(0, 50) + '...',
    content2: content2.substring(0, 50) + '...'
  }
}
