/**
 * 错题本配图服务
 * 处理裁剪、优化、上传和绑定题目的完整流程
 */

import { dataURLtoFile } from '../utils/imageOptimizer'
import { uploadImage } from '../services/apiService'
import { updateQuestion } from '../services/apiService'

/**
 * 上传裁剪后的配图到服务器
 * @param {string} dataUrl - 裁剪后的图片 dataURL
 * @param {string} questionId - 关联的题目ID
 * @returns {string} 上传后的图片URL
 */
export async function uploadCroppedImage(dataUrl, questionId) {
  const file = dataURLtoFile(dataUrl, `question_${questionId}_cropped.png`)
  const url = await uploadImage(file)
  return url
}

/**
 * 将配图URL绑定到题目
 * @param {string} questionId - 题目ID
 * @param {string} imageUrl - 配图URL
 * @returns {Object} 更新结果
 */
export async function bindImageToQuestion(questionId, imageUrl) {
  return await updateQuestion(questionId, {
    image_url: imageUrl
  })
}

/**
 * 完整的配图处理流程：裁剪 -> 优化 -> 上传 -> 绑定
 * @param {Object} cropResult - 裁剪结果 { dataUrl, questionId }
 * @param {Function} onProgress - 进度回调 (progress, message)
 * @returns {Object} 最终结果 { success, imageUrl, questionId }
 */
export async function processAndBindCroppedImage(cropResult, onProgress = null) {
  const { dataUrl, questionId, isStraightened } = cropResult

  if (!questionId) {
    throw new Error('未指定题目ID')
  }

  try {
    // 步骤1: 上传图片
    if (onProgress) onProgress(20, '正在上传配图...')
    const imageUrl = await uploadCroppedImage(dataUrl, questionId)

    // 步骤2: 绑定到题目
    if (onProgress) onProgress(80, '正在绑定题目...')
    await bindImageToQuestion(questionId, imageUrl)

    if (onProgress) onProgress(100, '配图保存成功')

    return {
      success: true,
      imageUrl,
      questionId,
      isStraightened
    }
  } catch (error) {
    console.error('配图处理失败:', error)
    throw error
  }
}

/**
 * 批量处理配图
 * @param {Array} cropResults - 多个裁剪结果
 * @param {Function} onProgress - 进度回调
 * @returns {Array} 处理结果
 */
export async function batchProcessCroppedImages(cropResults, onProgress = null) {
  const results = []
  const total = cropResults.length

  for (let i = 0; i < total; i++) {
    const cropResult = cropResults[i]
    const progress = Math.round((i / total) * 100)

    if (onProgress) {
      onProgress(progress, `处理 ${i + 1}/${total}...`)
    }

    try {
      const result = await processAndBindCroppedImage(cropResult)
      results.push({ ...result, index: i })
    } catch (error) {
      results.push({
        success: false,
        error: error.message,
        questionId: cropResult.questionId,
        index: i
      })
    }
  }

  if (onProgress) onProgress(100, '全部处理完成')

  return results
}
