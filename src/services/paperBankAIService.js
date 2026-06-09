import axios from 'axios'
import { AI_CONFIG, getAIHeaders } from '../config/ai'

/**
 * 压缩图片base64数据
 */
function compressImageBase64(dataURL, maxDimension = 1600, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      let width = img.width
      let height = img.height
      if (width > maxDimension || height > maxDimension) {
        const ratio = Math.min(maxDimension / width, maxDimension / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = reject
    img.src = dataURL
  })
}

/**
 * 识别单页试卷（纯OCR文字，不拆题）
 * 用于快速识别，返回完整文字内容
 */
export const recognizePaperPageSimple = async (imageBase64) => {
  let imageDataURL = imageBase64.startsWith('data:')
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`

  try {
    imageDataURL = await compressImageBase64(imageDataURL, 1600, 0.75)
    console.log('[PaperBank] 图片已压缩')
  } catch (e) {
    console.warn('[PaperBank] 图片压缩失败:', e)
  }

  const systemPrompt = '你是一个专业的试卷OCR识别助手，请识别图片中的文字内容。'

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
            image_url: { url: imageDataURL }
          },
          {
            type: 'text',
            text: '请识别试卷图片中的所有文字内容，保持原始排版格式，包括题号、选项、公式等。'
          }
        ]
      }
    ],
    temperature: 0.1,
    max_tokens: 4000
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

    return {
      success: true,
      data: { content }
    }
  } catch (error) {
    console.error('[PaperBank] OCR识别失败:', error)
    if (error.response) {
      console.error('[PaperBank] API响应:', error.response.status, JSON.stringify(error.response.data).substring(0, 500))
    }
    return {
      success: false,
      error: error.message || '识别失败'
    }
  }
}

/**
 * 构建版面分析的AI Prompt
 * 要求AI返回结构化的版面区块
 */
function buildLayoutAnalysisPrompt() {
  return `请对试卷图片进行版面分析和OCR识别，返回结构化JSON。

每个区块包含：
- type: 区块类型（title/subtitle/section/question/image/table/text/footer）
- content: 文字内容
- confidence: 置信度（0.0-1.0，识别不确定的区域标低值）
- style: 样式提示（textAlign/fontWeight/fontSize/color）
- options: 选择题选项数组（仅question类型为选择题时）
- bbox: 区块在原图中的位置 [x1, y1, x2, y2]（像素坐标，以压缩后的图片为准）
- caption: 图片描述（仅image类型，如"二次函数图像"、"几何图形"）

type说明：
- title: 试卷大标题（居中、加粗、大字号）
- subtitle: 副标题（考试时间、满分等）
- section: 大题标题（如"一、选择题"）
- question: 具体题目（含题干，选择题含options）
- image: 试卷中嵌入的图形（函数图、几何图、实验装置图、统计图等）
- table: 表格（含rows二维数组）
- text: 普通文字段落
- footer: 页脚（页码等）

⚠️ 图形识别要求（核心）：
1. 仔细扫描试卷中的每一张图，一个都不能漏
2. 每张图对应一个单独的 image 区块
3. 每张图必须返回精确的 bbox [x1,y1,x2,y2]，精确框住图形区域
4. caption 简明描述图形内容（如"二次函数y=x²-2x的图像"、"三角形ABC"、"反比例函数图像"）
5. 图形类型包括：函数图像、几何图形、统计图表、实验装置图、坐标系图等
6. 如果题目中说"如图"、"见图"，则该题附近一定有对应的图形
7. 不要将整页作为一张图返回，只识别试卷中嵌入的具体图形
8. 图形区块的 content 字段留空字符串 ""

返回格式：
{
  "paperInfo": {
    "name": "试卷名称",
    "subject": "学科",
    "grade": "年级",
    "examType": "考试类型"
  },
  "layoutBlocks": [
    {"type":"title","content":"2024年初三数学期中考试卷","confidence":0.98,"style":{"textAlign":"center","fontWeight":"bold","fontSize":"18px"},"bbox":[100,20,500,60]},
    {"type":"subtitle","content":"考试时间：120分钟  满分：150分","confidence":0.95,"style":{"textAlign":"center","fontSize":"12px","color":"#666"},"bbox":[150,70,450,90]},
    {"type":"section","content":"一、选择题（每题3分，共30分）","confidence":0.99,"style":{"fontWeight":"bold","fontSize":"14px"},"bbox":[30,110,400,130]},
    {"type":"question","content":"1. 下列计算正确的是（ ）","confidence":0.97,"options":["A. 2+3=5","B. 2×3=6","C. 2-3=1","D. 2÷3=1"],"bbox":[30,140,500,180]},
    {"type":"image","content":"","confidence":0.95,"caption":"二次函数y=x²-2x的图像","bbox":[100,200,400,400]},
    {"type":"question","content":"2. 如图，三角形ABC中...","confidence":0.92,"bbox":[30,410,500,440]},
    {"type":"image","content":"","confidence":0.93,"caption":"三角形ABC几何图","bbox":[100,450,400,650]},
    {"type":"text","content":"注意事项：...","confidence":0.90,"bbox":[30,660,500,700]}
  ]
}

注意：
1. 仔细识别所有文字、符号、公式
2. 数学公式用文本表示（x², √2, ∠ABC等）
3. 保留填空下划线____和括号（ ）
4. 选择题必须提取options
5. 每张独立图片返回单独的image区块，给出精确bbox坐标
6. 所有区块都必须返回bbox坐标
7. 对不确定的文字标低confidence值（0.5以下表示高度不确定）
8. 只返回JSON，不要包含其他文字`;
}

/**
 * 识别单页试卷的版面结构
 * @param {string} imageBase64 - 图片base64数据
 * @returns {Promise<Object>} 包含paperInfo和layoutBlocks的结果
 */
export const recognizePaperPageLayout = async (imageBase64) => {
  let imageDataURL = imageBase64.startsWith('data:')
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`

  // 压缩图片以符合API限制
  try {
    imageDataURL = await compressImageBase64(imageDataURL, 1600, 0.75)
    console.log('[PaperBank] 图片已压缩')
  } catch (e) {
    console.warn('[PaperBank] 图片压缩失败:', e)
  }

  const prompt = buildLayoutAnalysisPrompt()

  const requestBody = {
    model: AI_CONFIG.MODEL,
    messages: [
      {
        role: 'system',
        content: '你是一个专业的试卷版面分析助手。'
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: imageDataURL }
          },
          {
            type: 'text',
            text: prompt
          }
        ]
      }
    ],
    temperature: 0.1,
    max_tokens: 8000
  }

  try {
    console.log('[PaperBank] 开始版面分析...')

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

    // 解析JSON
    let jsonStr = content
    // 尝试提取JSON（如果包含在markdown代码块中）
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (jsonMatch) {
      jsonStr = jsonMatch[1]
    }

    const result = JSON.parse(jsonStr)
    
    // 验证必需字段
    if (!result.layoutBlocks || !Array.isArray(result.layoutBlocks)) {
      throw new Error('AI返回的JSON缺少layoutBlocks字段')
    }

    return {
      success: true,
      data: result,
      compressedImage: imageDataURL  // 返回压缩后的图片，用于局部图截取
    }
  } catch (error) {
    console.error('[PaperBank] 版面分析失败:', error)
    if (error.response) {
      console.error('[PaperBank] API响应:', error.response.status, JSON.stringify(error.response.data).substring(0, 500))
    }
    return {
      success: false,
      error: error.message || '版面分析失败'
    }
  }
}

/**
 * 根据bbox截取局部图并返回base64
 * @param {string} imageBase64 - 原图base64（data URL格式）
 * @param {number[]} bbox - [x1, y1, x2, y2] 像素坐标（相对于传入的图片）
 * @returns {Promise<string|null>} 截取后的base64图片
 */
async function cropImageByBbox(imageBase64, bbox) {
  if (!bbox || bbox.length !== 4) return null
  
  try {
    const [x1, y1, x2, y2] = bbox
    const width = x2 - x1
    const height = y2 - y1
    
    if (width <= 0 || height <= 0) return null
    
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = Math.min(width, img.width - x1)
          canvas.height = Math.min(height, img.height - y1)
          const ctx = canvas.getContext('2d')
          
          // 安全边界检查
          const sx = Math.max(0, x1)
          const sy = Math.max(0, y1)
          const sw = Math.min(canvas.width, img.width - sx)
          const sh = Math.min(canvas.height, img.height - sy)
          
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
          
          const croppedBase64 = canvas.toDataURL('image/png', 0.9)
          resolve(croppedBase64)
        } catch (e) {
          reject(e)
        }
      }
      img.onerror = () => reject(new Error('图片加载失败'))
      img.src = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`
    })
  } catch (e) {
    console.warn('[cropImage] 截取局部图失败:', e)
    return null
  }
}

/**
 * 处理多页试卷（版面分析模式）
 * @param {Array} pages - 试卷页面数组 [{id, imageUrl, imageBase64}]
 * @returns {Promise<Object>} 包含paperInfo和pageResults的结果
 */
export const processMultiPagePaperLayout = async (pages) => {
  if (!pages || pages.length === 0) {
    return { success: false, error: '没有上传试卷页面' }
  }

  const results = {
    paperInfo: null,
    pageResults: []
  }

  try {
    console.log(`[PaperBank] 开始处理多页试卷（版面分析），共${pages.length}页`)

    // 处理每一页
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]
      console.log(`[PaperBank] 正在处理第${i + 1}页...`)

      const layoutResult = await recognizePaperPageLayout(page.imageBase64)
      
      if (layoutResult.success) {
        const pageData = layoutResult.data
        
        // 第一页提取试卷信息
        if (i === 0 && pageData.paperInfo) {
          results.paperInfo = {
            name: pageData.paperInfo.name || '未命名试卷',
            subject: pageData.paperInfo.subject || '',
            grade: pageData.paperInfo.grade || '',
            examType: pageData.paperInfo.examType || ''
          }
        }

        // 处理区块：截取image类型局部图，保留bbox信息
        // 关键：bbox坐标是相对于压缩后图片的，所以必须用压缩后的图片来截取
        const originalImageFull = page.imageBase64.startsWith('data:') 
          ? page.imageBase64 
          : `data:image/jpeg;base64,${page.imageBase64}`
        const croppedImageSource = layoutResult.compressedImage || originalImageFull
        
        const processedBlocks = []
        for (const block of pageData.layoutBlocks) {
          const processedBlock = {
            ...block,
            confidence: block.confidence || 0.8
          }
          
          // 对image类型区块，使用bbox从压缩后的图片截取局部图
          if (block.type === 'image' && block.bbox) {
            try {
              const croppedImage = await cropImageByBbox(croppedImageSource, block.bbox)
              processedBlock.src = croppedImage || undefined
            } catch (e) {
              console.warn(`[PaperBank] image区块截取失败:`, e)
              processedBlock.src = undefined
            }
          }
          
          // 非image类型删除src字段
          if (block.type !== 'image') {
            delete processedBlock.src
          }
          
          processedBlocks.push(processedBlock)
        }

        results.pageResults.push({
          pageNo: i + 1,
          originalImage: originalImageFull,
          layoutBlocks: processedBlocks
        })
      } else {
        console.warn(`[PaperBank] 第${i + 1}页版面分析失败:`, layoutResult.error)
        results.pageResults.push({
          pageNo: i + 1,
          originalImage: page.imageBase64.startsWith('data:') ? page.imageBase64 : `data:image/jpeg;base64,${page.imageBase64}`,
          layoutBlocks: [],
          error: layoutResult.error
        })
      }
    }

    // 如果没有提取到试卷信息，使用默认值
    if (!results.paperInfo) {
      results.paperInfo = {
        name: pages[0]?.name?.replace(/\.[^.]+$/, '') || '未命名试卷',
        subject: '',
        grade: '',
        examType: ''
      }
    }

    console.log('[PaperBank] 多页试卷版面分析完成')
    return { success: true, data: results }
  } catch (error) {
    console.error('[PaperBank] 多页试卷版面分析失败:', error)
    return { success: false, error: error.message || '处理失败' }
  }
}
