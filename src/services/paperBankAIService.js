import axios from 'axios'
import { AI_CONFIG, getAIHeaders } from '../config/ai'

/**
 * 构建试卷信息提取的AI Prompt
 * 用于从试卷图片中提取试卷名称、学科、年级等信息
 */
function buildPaperInfoPrompt() {
  return `你是一个专业的试卷分析助手。请仔细分析上传的试卷图片，提取以下信息：

1. **试卷名称**：根据试卷内容推断出完整的试卷名称（如："2024年北京市海淀区初三数学期中考试卷"）
2. **学科**：判断试卷所属学科（数学/语文/英语/物理/化学/生物/历史/地理/政治等）
3. **年级**：判断适用年级（如：初一/初二/初三/高一/高二/高三/一年级/二年级/三年级等）
4. **考试类型**：判断试卷类型（月考/期中/期末/模拟/单元测验/课后练习/作业等）
5. **学年**：如果试卷上标注了学年则提取（如：2023-2024学年）
6. **学期**：如果标注了学期则提取（如：第一学期/上学期/第二学期/下学期）

请严格按照以下JSON格式返回，不要包含任何其他内容：
{
  "name": "试卷完整名称",
  "subject": "学科",
  "grade": "年级",
  "examType": "考试类型",
  "schoolYear": "学年",
  "semester": "学期"
}

如果某些信息无法确定，请使用空字符串""。`
}

/**
 * 构建试卷OCR识别的AI Prompt
 * 用于识别试卷中的文字内容，保持原始格式
 */
function buildPaperOCRPrompt() {
  return `你是一个专业的试卷OCR识别助手。请仔细识别试卷图片中的所有文字内容，并保持原始的格式结构。

识别要求：
1. **试卷标题信息**：试卷名称、考试时间、适用年级、学科、满分、考试时间等
2. **题目内容**：每道题的完整题干、选项（如有）、作答区域提示
3. **格式结构**：保持原始的题号顺序、大题小题层级、段落结构
4. **特殊符号**：数学公式用文本形式表示（如：x², √2, ∠ABC, △ABC）
5. **填空/作答提示**：保留下划线、括号等作答提示符

返回格式：纯文本，保持原始排版结构，大题之间有适当空行。

示例格式：
【试卷名称】2024年初三数学期中考试卷
【学科】数学  【年级】初三  【考试时间】120分钟  【满分】150分

一、选择题（每题3分，共30分）

1. 下列计算正确的是（ ）
   A. 2 + 3 = 5
   B. 2 × 3 = 6
   C. 2 - 3 = 1
   D. 2 ÷ 3 = 1

2. 若x = 2，则x² + 1的值为（ ）
   A. 3
   B. 4
   C. 5
   D. 6

二、填空题（每题4分，共20分）

3. 计算：(-2)³ = ______

4. 若a + b = 5，ab = 6，则a² + b² = ______

三、解答题（共50分）

5. （10分）解方程：2x + 5 = 13

注意事项：
1. 仔细识别每个字，确保准确性
2. 数学公式和符号要尽量准确
3. 保持题号和层级结构
4. 选项要对齐排列
5. 如果识别不确定的地方，用最可能的结果，不要留空`
}

/**
 * 从试卷图片中提取试卷信息（名称、学科、年级等）
 * @param {string} imageBase64 - 试卷图片的base64数据
 * @returns {Promise<Object>} 提取的试卷信息
 */
export const extractPaperInfo = async (imageBase64) => {
  const prompt = buildPaperInfoPrompt()
  
  const imageDataURL = imageBase64.startsWith('data:') 
    ? imageBase64 
    : `data:image/jpeg;base64,${imageBase64}`

  const requestBody = {
    model: AI_CONFIG.MODEL,
    messages: [
      {
        role: 'system',
        content: prompt
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: imageDataURL, detail: 'high' }
          },
          {
            type: 'text',
            text: '请分析这张试卷图片，提取试卷名称、学科、年级等信息。'
          }
        ]
      }
    ],
    temperature: 0.1,
    max_tokens: 500
  }

  try {
    console.log('[PaperBank] 开始提取试卷信息...')
    const response = await axios.post(
      AI_CONFIG.ENDPOINT,
      requestBody,
      {
        headers: getAIHeaders(),
        timeout: AI_CONFIG.TIMEOUT
      }
    )

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
    console.log('[PaperBank] 试卷信息提取成功:', result)
    
    return {
      success: true,
      data: result
    }
  } catch (error) {
    console.error('[PaperBank] 试卷信息提取失败:', error)
    return {
      success: false,
      error: error.message || '提取失败'
    }
  }
}

/**
 * 对试卷图片进行OCR识别，返回完整文字内容
 * @param {string} imageBase64 - 试卷图片的base64数据
 * @returns {Promise<Object>} 识别结果
 */
export const recognizePaperContent = async (imageBase64) => {
  const prompt = buildPaperOCRPrompt()
  
  const imageDataURL = imageBase64.startsWith('data:') 
    ? imageBase64 
    : `data:image/jpeg;base64,${imageBase64}`

  const requestBody = {
    model: AI_CONFIG.MODEL,
    messages: [
      {
        role: 'system',
        content: prompt
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: imageDataURL, detail: 'high' }
          },
          {
            type: 'text',
            text: '请识别这张试卷图片中的所有文字内容，保持原始格式。'
          }
        ]
      }
    ],
    temperature: 0.1,
    max_tokens: 8000
  }

  try {
    console.log('[PaperBank] 开始OCR识别...')
    const response = await axios.post(
      AI_CONFIG.ENDPOINT,
      requestBody,
      {
        headers: getAIHeaders(),
        timeout: AI_CONFIG.TIMEOUT
      }
    )

    const content = response.data.choices[0]?.message?.content
    if (!content) {
      throw new Error('AI 返回内容为空')
    }

    // 清理markdown代码块
    let textContent = content
    const textMatch = content.match(/```\n?([\s\S]*?)\n?```/)
    if (textMatch) {
      textContent = textMatch[1]
    }

    console.log('[PaperBank] OCR识别完成')
    
    return {
      success: true,
      data: {
        content: textContent,
        rawResponse: content
      }
    }
  } catch (error) {
    console.error('[PaperBank] OCR识别失败:', error)
    return {
      success: false,
      error: error.message || '识别失败'
    }
  }
}

/**
 * 处理多页试卷
 * 1. 第一页提取试卷基本信息
 * 2. 每页进行OCR识别
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

    // 步骤1: 从第一页提取试卷基本信息
    const firstPage = pages[0]
    const paperInfoResult = await extractPaperInfo(firstPage.imageBase64)
    if (paperInfoResult.success) {
      results.paperInfo = paperInfoResult.data
    } else {
      console.warn('[PaperBank] 试卷信息提取失败，使用默认值')
    }

    // 步骤2: 逐页进行OCR识别
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]
      console.log(`[PaperBank] 正在处理第${i + 1}页...`)
      
      const ocrResult = await recognizePaperContent(page.imageBase64)
      if (ocrResult.success) {
        results.pageContents.push({
          pageNo: i + 1,
          content: ocrResult.data.content
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
    results.fullContent = results.pageContents
      .filter(p => p.content)
      .map((p, idx, arr) => {
        const pageText = p.content
        const pageBreak = idx < arr.length - 1 ? `\n\n--- 第${p.pageNo}页结束 ---\n\n` : ''
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
