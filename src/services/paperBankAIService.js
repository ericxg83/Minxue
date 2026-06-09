import axios from 'axios'
import { AI_CONFIG, getAIHeaders } from '../config/ai'

/**
 * 压缩图片base64数据
 * @param {string} dataURL - 原始data URL格式base64
 * @param {number} maxDimension - 最大宽高（ModelScope API限制2048像素）
 * @param {number} quality - JPEG质量 (0-1)
 * @returns {Promise<string>} 压缩后的data URL
 */
function compressImageBase64(dataURL, maxDimension = 1600, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      let width = img.width
      let height = img.height

      // 限制宽高都不超过maxDimension
      if (width > maxDimension || height > maxDimension) {
        const ratio = Math.min(maxDimension / width, maxDimension / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }

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

/**
 * 识别单页试卷内容
 * @param {string} imageBase64 - 试卷图片的base64数据
 * @param {boolean} isFirstPage - 是否第一页（需要提取试卷信息）
 * @returns {Promise<Object>} 识别结果
 */
export const recognizePaperPage = async (imageBase64, isFirstPage = true) => {
  // 确保图片包含data URI前缀
  let imageDataURL = imageBase64.startsWith('data:')
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`

  // 压缩图片，确保宽高都不超过1600像素（API限制2048）
  try {
    const origImg = new Image()
    await new Promise((resolve, reject) => {
      origImg.onload = resolve
      origImg.onerror = reject
      origImg.src = imageDataURL
    })
    console.log(`[PaperBank] 原始图片尺寸: ${origImg.width}x${origImg.height}`)
  } catch (e) { /* ignore */ }

  try {
    imageDataURL = await compressImageBase64(imageDataURL, 1600, 0.75)
    console.log('[PaperBank] 图片已压缩')
  } catch (e) {
    console.warn('[PaperBank] 图片压缩失败:', e)
  }

  // 精简prompt：图片已占用大部分token，文字必须极短
  const systemPrompt = '你是一个专业的试卷OCR识别助手，请识别图片中的文字并以JSON格式返回。'

  const userText = isFirstPage
    ? `请识别试卷图片，返回JSON：{"name":"试卷名称","subject":"学科","grade":"年级","examType":"考试类型","content":"完整文字内容"}\n注意：仔细识别文字和符号，保持题号和层级结构。`
    : `请识别试卷图片中的文字内容，保持原始排版格式。`

  const requestBody = {
    model: AI_CONFIG.MODEL,
    messages: [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: imageDataURL
            }
          },
          {
            type: 'text',
            text: userText
          }
        ]
      }
    ],
    temperature: 0.1,
    max_tokens: 4000
  }

  try {
    console.log(`[PaperBank] 开始识别${isFirstPage ? '第一页（含信息提取）' : '试卷内容'}...`)
    console.log('[PaperBank] 图片数据长度:', imageDataURL.length, 'bytes')

    const response = await axios.post(
      AI_CONFIG.ENDPOINT,
      requestBody,
      {
        headers: getAIHeaders(),
        timeout: AI_CONFIG.TIMEOUT
      }
    )

    console.log('[PaperBank] API响应成功:', response.status)

    const content = response.data.choices[0]?.message?.content
    if (!content) {
      throw new Error('AI 返回内容为空')
    }

    // 尝试解析JSON
    let jsonStr = content
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) ||
                      content.match(/```\n?([\s\S]*?)\n?```/)
    if (jsonMatch) {
      jsonStr = jsonMatch[1]
    }

    const result = JSON.parse(jsonStr)
    console.log('[PaperBank] 识别成功')

    return {
      success: true,
      data: result
    }
  } catch (error) {
    console.error('[PaperBank] 识别失败:', error)
    if (error.response) {
      console.error('[PaperBank] API响应状态:', error.response.status)
      console.error('[PaperBank] API响应数据:', JSON.stringify(error.response.data).substring(0, 500))
    }
    return {
      success: false,
      error: error.message || '识别失败'
    }
  }
}

/**
 * 处理多页试卷
 * 1. 第一页提取试卷信息和OCR
 * 2. 后续页面只OCR
 * 3. 合并所有页面内容
 * @param {Array} pages - 试卷页面数组 [{id, imageUrl, imageBase64}]
 * @returns {Promise<Object>} 处理结果
 */
export const processMultiPagePaper = async (pages) => {
  if (!pages || pages.length === 0) {
    return { success: false, error: '没有上传试卷页面' }
  }

  const results = {
    paperInfo: null,
    pageContents: [],
    fullContent: ''
  }

  try {
    console.log(`[PaperBank] 开始处理多页试卷，共${pages.length}页`)

    // 步骤1: 第一页 - 提取试卷信息 + OCR
    const firstPage = pages[0]
    console.log(`[PaperBank] 正在处理第1页（信息提取）...`)

    const firstResult = await recognizePaperPage(firstPage.imageBase64, true)
    if (firstResult.success) {
      results.paperInfo = {
        name: firstResult.data.name || '',
        subject: firstResult.data.subject || '',
        grade: firstResult.data.grade || '',
        examType: firstResult.data.examType || ''
      }
      results.pageContents.push({
        pageNo: 1,
        content: firstResult.data.content || ''
      })
    } else {
      console.warn('[PaperBank] 第一页识别失败:', firstResult.error)
      results.pageContents.push({
        pageNo: 1,
        content: '',
        error: firstResult.error
      })
    }

    // 步骤2: 后续页面 - 仅OCR
    for (let i = 1; i < pages.length; i++) {
      const page = pages[i]
      console.log(`[PaperBank] 正在处理第${i + 1}页...`)

      const ocrResult = await recognizePaperPage(page.imageBase64, false)
      if (ocrResult.success) {
        results.pageContents.push({
          pageNo: i + 1,
          content: ocrResult.data.content || ''
        })
      } else {
        results.pageContents.push({
          pageNo: i + 1,
          content: '',
          error: ocrResult.error
        })
      }
    }

    // 步骤3: 合并所有页面的完整文字内容
    const validContents = results.pageContents
      .filter(p => p.content && p.content.trim())

    results.fullContent = validContents
      .map((p, idx) => {
        const pageText = p.content
        const pageBreak = idx < validContents.length - 1 ? `\n\n--- 第${p.pageNo}页结束 ---\n\n` : ''
        return pageText + pageBreak
      })
      .join('')

    console.log('[PaperBank] 多页试卷处理完成')
    return { success: true, data: results }
  } catch (error) {
    console.error('[PaperBank] 多页试卷处理失败:', error)
    return { success: false, error: error.message || '处理失败' }
  }
}
