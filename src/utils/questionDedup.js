/**
 * 题目相似度工具函数
 *
 * 用途：给人工判断提供「这两题可能是同一题」的候选提示。
 *
 * 注意：错题本的自动去重已迁出本文件，统一由
 * src/domain/questionIdentity.js 按「归一化后精确匹配」执行。
 * 原先基于 90% 相似度的 deduplicateWrongQuestions 会把只改数字/改角度的
 * 变式题、以及「最小 vs 最大」这类语义相反的题误合并（实测相似度
 * 90.5%~97.5%，题干越长越严重），且合并时取组内最高 lifecycle，
 * 会让未掌握的错题从错题本消失，因此已移除，不要重新引入到自动路径。
 *
 * 本文件剩余函数只做只读的相似度计算，不产生业务状态。
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
 * 判断两道题在文本上是否高度相似。
 *
 * 这不是「同一题」的业务判定 —— 业务判定见
 * src/domain/questionIdentity.js 的 isSameWrongQuestion。
 * 本函数仅用于给人工复核提供候选提示。
 */
export const isSameQuestion = (q1, q2, threshold = 0.9) => {
  const content1 = q1.content || q1.question?.content || ''
  const content2 = q2.content || q2.question?.content || ''
  
  return calculateSimilarity(content1, content2) >= threshold
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
