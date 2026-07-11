// Use getters so env vars are resolved lazily at access time, not at module import time.
// This allows dotenv.config() in index.js / worker.js to set process.env before AI_CONFIG is used.
import axios from 'axios'

export const AI_CONFIG = {
  get ENDPOINT() { return process.env.AI_ENDPOINT || 'https://api-inference.modelscope.cn/v1/chat/completions' },
  get API_KEY() { return process.env.AI_API_KEY || 'ms-dae707ae-bcc4-4d7e-aa83-e2165d0cdbf5' },
  get MODEL() { return process.env.AI_MODEL || 'Qwen/Qwen3-VL-8B-Instruct' },
  TIMEOUT: 120000,
  MAX_RETRIES: 2
}

// ── AI 模型轮换机制 ──
// ModelScope 免费模型每日有配额限制，单个模型耗尽时自动切换到其他模型

/** 视觉模型列表（OCR 识别用）
 *  第一个优先取环境变量 AI_MODEL / VL_MODEL，方便线上快速切换而无需改代码；
 *  其余为 ModelScope 当前可用的候选，模型下线（400 no provider）或配额耗尽时自动向后轮换。
 *  注意：数组内去重，避免环境变量与候选重复导致轮换空转。
 *  ⚠️ 2026-07 实测：ModelScope 免费在线推理仅 Qwen3-VL 系列可用，
 *     Qwen2.5-VL 及非 Qwen 模型均 "has no provider supported"。
 *     平台日后恢复其他模型时，改 Render 环境变量 AI_MODEL 即可，无需改代码。 */
export const VL_MODELS = [...new Set([
  process.env.AI_MODEL,
  process.env.VL_MODEL,
  'Qwen/Qwen3-VL-30B-A3B-Instruct',
  'Qwen/Qwen3-VL-8B-Instruct',
].filter(Boolean))]

/** 文本模型列表（答案生成、标签生成用） */
export const TEXT_MODELS = [
  'Qwen/Qwen3-VL-8B-Instruct',
  'Qwen/Qwen3-8B-Instruct',
  'Qwen/Qwen2.5-72B-Instruct',
  'Qwen/QwQ-32B',
  'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
]

let _textIdx = 0
let _vlIdx = 0

/** 获取当前文本模型 */
export function getCurrentTextModel() {
  return TEXT_MODELS[_textIdx] || TEXT_MODELS[0]
}

/** 获取当前视觉模型 */
export function getCurrentVLModel() {
  return VL_MODELS[_vlIdx] || VL_MODELS[0]
}

/** 切换到下一个文本模型，返回新模型名；如果已遍历所有模型则返回 null */
export function rotateTextModel() {
  if (_textIdx >= TEXT_MODELS.length - 1) {
    console.warn(`⚠️ [ModelRotation] 所有文本模型已尝试完毕`)
    return null
  }
  _textIdx++
  console.log(`🔄 [ModelRotation] 切换到文本模型: ${TEXT_MODELS[_textIdx]}`)
  return TEXT_MODELS[_textIdx]
}

/** 切换到下一个视觉模型，返回新模型名；如果已遍历所有模型则返回 null */
export function rotateVLModel() {
  if (_vlIdx >= VL_MODELS.length - 1) {
    console.warn(`⚠️ [ModelRotation] 所有视觉模型已尝试完毕`)
    return null
  }
  _vlIdx++
  console.log(`🔄 [ModelRotation] 切换到视觉模型: ${VL_MODELS[_vlIdx]}`)
  return VL_MODELS[_vlIdx]
}

/** 重置所有模型索引到初始值 */
export function resetModelIndex() {
  _textIdx = 0
  _vlIdx = 0
}

export const getAIHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${AI_CONFIG.API_KEY}`
})

// ── 备用 API（OpenRouter）──
// 当主 API（ModelScope）因配额/限流失败时，自动切换到备用厂商。
// Key / Endpoint / 模型 全部通过环境变量注入，部署端（Render）后台填写即可。
export const BACKUP_CONFIG = {
  get ENDPOINT() {
    return process.env.BACKUP_ENDPOINT || 'https://apihub.agnes-ai.com/v1/chat/completions'
  },
  get API_KEY() {
    // 未配置则返回一个明显无效的占位，调用时会自然失败并 fallback
    return process.env.BACKUP_API_KEY || ''
  },
  // 备用厂商默认使用的文本模型（OpenRouter 免费模型）
  get MODEL() {
    return process.env.BACKUP_MODEL || 'agnes-2.0-flash'
  },
  // 备用厂商默认使用的视觉模型
  get VL_MODEL() {
    return process.env.BACKUP_VL_MODEL || 'qwen/qwen2.5-vl-7b-instruct:free'
  },
  // 是否向备用 API 发送 reasoning:{enabled:false}（思考型免费模型需要）
  get DISABLE_REASONING() {
    return process.env.BACKUP_DISABLE_REASONING === 'true' || BACKUP_CONFIG.MODEL.includes('hy3')
  },
  get ENABLED() {
    return Boolean(process.env.BACKUP_API_KEY)
  }
}

const _backupAxios = axios.create({ timeout: 60000 })

/**
 * 统一发起一次文本聊天补全请求，内置"主 API → 备用 API"自动切换。
 *
 * @param {{systemContent:string, userContent:string, temperature?:number, maxTokens?:number, model?:string}} opts
 * @returns {Promise<{content:string, usedBackup:boolean}>}
 * @throws 当主、备均调用失败（非限流类错误）时抛出最后一个错误
 *
 * 设计要点：
 * - 限流（429）或主 Key 缺失时，自动尝试备用；
 * - 若连备用也限流，仍抛出错误，由调用方决定重试/写未分类；
 * - 调用方无需关心当前用的是哪家，只拿回 content 文本。
 */
export async function callTextCompletion(opts) {
  const { systemContent, userContent, temperature = 0.2, maxTokens = 500, model } = opts
  const messages = [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent }
  ]

  // 1. 先尝试主 API（ModelScope）
  const primaryBody = {
    model: model || getCurrentTextModel(),
    messages,
    temperature,
    max_tokens: maxTokens
  }
  try {
    const resp = await axios.post(AI_CONFIG.ENDPOINT, primaryBody, {
      headers: getAIHeaders(),
      timeout: 30000
    })
    const content = resp.data?.choices?.[0]?.message?.content
    if (!content) throw new Error('AI 返回内容为空')
    return { content, usedBackup: false }
  } catch (primaryErr) {
    const status = primaryErr.response?.status
    const isQuota = status === 429
    const primaryKeyMissing = !AI_CONFIG.API_KEY
    if (!isQuota && !primaryKeyMissing && !primaryErr.response) {
      // 非限流、非 Key 缺失的网络异常 → 直接抛出，不轻易切备用（可能是临时抖动由调用方重试）
    }
    console.warn(`⚠️ [AI] 主 API 调用失败${isQuota ? '（429 限流）' : primaryKeyMissing ? '（Key 缺失）' : ''}，尝试备用 API...`)

    // 2. 备用 API（OpenRouter）
    if (!BACKUP_CONFIG.ENABLED) {
      throw new Error(`主 API 失败且无备用 API：${primaryErr.message}`)
    }
    const backupBody = {
      model: model || BACKUP_CONFIG.MODEL,
      messages,
      temperature,
      max_tokens: maxTokens,
      // 部分免费模型（如 tencent/hy3）是"思考模型"，默认把预算花在 reasoning 上导致 content 为空；
      // 显式关闭思考，强制直接输出正文。
      ...(BACKUP_CONFIG.DISABLE_REASONING ? { reasoning: { enabled: false } } : {})
    }
    try {
      const resp = await _backupAxios.post(BACKUP_CONFIG.ENDPOINT, backupBody, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${BACKUP_CONFIG.API_KEY}`,
          'HTTP-Referer': 'https://minxue.edu',
          'X-Title': 'Minxue'
        }
      })
      const content = resp.data?.choices?.[0]?.message?.content
      if (!content) throw new Error('备用 AI 返回内容为空')
      console.log(`✅ [AI] 备用 API 调用成功（${model || BACKUP_CONFIG.MODEL}）`)
      return { content, usedBackup: true }
    } catch (backupErr) {
      console.error(`❌ [AI] 备用 API 也失败：${backupErr.message}`)
      throw backupErr
    }
  }
}

/**
 * 发起一次「视觉（多模态）」聊天补全请求，内置"主 API → 备用 API"回退。
 *
 * 与 callTextCompletion 的差异：user 消息走多模态 content 数组（image_url + text）。
 *
 * @param {{imageDataURL:string, systemPrompt:string, userText:string, temperature?:number, maxTokens?:number, model?:string}} opts
 * @returns {Promise<{content:string, usedBackup:boolean}>}
 * @throws 主、备均失败时抛出最后一个错误（含 axios error，供调用方读取 error.response.status）
 *
 * 设计要点：
 * - 仅在「配额/限流(429)」或「主 Key 缺失」时才回退备用；
 * - 其它错误（如 400 "no provider supported" 模型下线）直接抛出，
 *   由 worker 侧的 VL 模型轮换逻辑处理，保持本函数职责单一。
 */
export async function callVisionCompletion(opts) {
  const {
    imageDataURL,
    systemPrompt,
    userText = '请识别这张作业图片中的所有题目，并返回JSON格式结果。',
    temperature = 0.3,
    maxTokens = 8192,
    model
  } = opts

  const buildMessages = () => ([
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageDataURL } },
        { type: 'text', text: userText }
      ]
    }
  ])

  // 1. 主 API（ModelScope）
  const primaryBody = {
    model: model || getCurrentVLModel(),
    messages: buildMessages(),
    temperature,
    max_tokens: maxTokens
  }
  try {
    const resp = await axios.post(AI_CONFIG.ENDPOINT, primaryBody, {
      headers: getAIHeaders(),
      timeout: AI_CONFIG.TIMEOUT
    })
    const content = resp.data?.choices?.[0]?.message?.content
    if (!content) throw new Error('AI 返回内容为空')
    return { content, usedBackup: false }
  } catch (primaryErr) {
    const status = primaryErr.response?.status
    const isQuota = status === 429
    const primaryKeyMissing = !AI_CONFIG.API_KEY

    // 仅配额/限流或 Key 缺失才回退备用；其它错误（如 400 模型下线）交给上层轮换。
    if (!isQuota && !primaryKeyMissing) {
      throw primaryErr
    }
    if (!BACKUP_CONFIG.ENABLED) {
      console.warn(`⚠️ [AI-Vision] 主 API 配额耗尽但未配置备用 API，放弃回退`)
      throw primaryErr
    }

    console.warn(`⚠️ [AI-Vision] 主 API${isQuota ? '（429 配额耗尽）' : '（Key 缺失）'}，回退备用视觉 API...`)

    // 2. 备用 API
    const backupBody = {
      model: model || BACKUP_CONFIG.VL_MODEL,
      messages: buildMessages(),
      temperature,
      max_tokens: maxTokens,
      ...(BACKUP_CONFIG.DISABLE_REASONING ? { reasoning: { enabled: false } } : {})
    }
    try {
      const resp = await _backupAxios.post(BACKUP_CONFIG.ENDPOINT, backupBody, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${BACKUP_CONFIG.API_KEY}`,
          'HTTP-Referer': 'https://minxue.edu',
          'X-Title': 'Minxue'
        },
        timeout: AI_CONFIG.TIMEOUT
      })
      const content = resp.data?.choices?.[0]?.message?.content
      if (!content) throw new Error('备用 AI 返回内容为空')
      console.log(`✅ [AI-Vision] 备用 API 调用成功（${model || BACKUP_CONFIG.VL_MODEL}）`)
      return { content, usedBackup: true }
    } catch (backupErr) {
      console.error(`❌ [AI-Vision] 备用视觉 API 也失败：${backupErr.message}`)
      throw backupErr
    }
  }
}

export const buildOCRPrompt = () => `你是一个专业的教育题目识别助手。请仔细分析上传的作业图片，识别其中的题目内容、几何配图和位置。

请按以下 JSON 格式返回识别结果：
{
  "questions": [
    {
      "question_id": "唯一标识",
      "question_number": 1,
      "content": "题目内容（纯文本）",
      "options": ["选项A", "选项B", "选项C", "选项D"],
      "answer": "正确答案",
      "student_answer": "学生作答",
      "is_correct": true/false,
      "confidence": 0.95,
      "analysis": "题目解析",
      "question_type": "choice/fill/answer",
      "has_manual_checkmark": true/false,
      "block_coordinates": {
        "x": 100,
        "y": 200,
        "width": 800,
        "height": 150
      },
      "text_bbox": {
        "x": 100,
        "y": 200,
        "width": 800,
        "height": 100
      },
      "image_type": "geometry/chart/none",
      "image_bbox": {
        "x": 200,
        "y": 350,
        "width": 250,
        "height": 200
      },
      "geometry_image": null
    }
  ]
}

页面结构分析（重要新功能）：
- question_number: 该题在试卷上的题号（如第1题填1，第2题填2）。如果无明确编号，按从上到下顺序从1开始编号。
- block_coordinates: 题目整体区域（包括题干、选项、配图、作答区）在整张图片中的边界框坐标（像素估算值）。
- text_bbox: 仅题目文字区域（题干+选项，不含配图）的边界框坐标。
- image_type: 配图类型，取值：
  * "geometry" — 几何图形（三角形、圆、函数图像等）
  * "chart" — 图表（统计图、表格等）
  * "none" — 无配图
- image_bbox: 配图区域在整张图片中的边界框坐标。如果 image_type 为 "none"，该字段可省略或填 null。

geometry_image 说明（多模态切题核心字段，保持向后兼容）：
- 如果该题目包含几何图形/配图，请填写 geometry_image 对象，否则填 null
- geometry_image 对象格式：
  {
    "has_image": true,
    "bbox": { "x": 200, "y": 350, "width": 250, "height": 200 },
    "description": "直角三角形ABC的几何示意图"
  }
- bbox 是配图在整张试卷图片中的边界框坐标（像素估算值），必须与 image_bbox 保持一致
- 如果题干中提到"如图"、"如图所示"、"图1"、"附图"等关键词，请务必找到对应的配图并标注 bbox
- 配图通常在题干下方或右方

block_coordinates 说明（必填）：
- x: 题目区域左上角在图片中的横坐标（像素估算值，范围 0-图片宽度）
- y: 题目区域左上角在图片中的纵坐标（像素估算值，范围 0-图片高度）
- width: 题目区域的估算宽度
- height: 题目区域的估算高度
- 请根据题目在图片中的实际位置进行估算，后续批改页面将用这些坐标来高亮标记题目区域

题目类型说明：
- choice: 选择题（有A/B/C/D等选项）
- fill: 填空题（有下划线或空格需要填写）
- answer: 解答题（需要文字说明或计算过程）

字段说明：
- answer: 题目的标准答案/参考答案
- student_answer: 学生实际填写的答案
- is_correct: 仅作为 AI 的参考判断，实际正确性由服务端根据 student_answer 与 answer 的比对结果决定
- analysis: 题目解析，讲解题目本身的知识点和解法，绝不能提及学生答案或作答情况
- has_manual_checkmark: 是否在该题目旁边看到了人工批改的勾号（✓/✔/√ 打勾标记）。如果有，说明老师已批改此题，请设为 true

识别重点：
1. 务必确保 student_answer 和 answer 字段的识别尽可能准确，它们是评判正确性的唯一依据
2. 如果无法识别学生答案，student_answer 留空字符串，不要编造
3. 如果题目没有标准答案，answer 留空字符串
4. 对于填空题，用 ____ 表示填空位置，仔细识别学生填写的内容
5. 重点检测题目旁边是否有老师批改的打勾（✓）或打叉（✗）标记
6. **重点**：仔细扫描题干中的"如图"、"如图所示"、"图1"、"附图"等关键词，找到对应的几何配图并准确标注 bbox

针对 student_answer 的识别：
- 如果图片中同时出现了学生笔迹和老师批改痕迹，student_answer 以学生笔迹为准
- 如果图片中只有打印的题目和空白，student_answer 留空

注意事项：
1. 只返回 JSON 格式数据，不要包含其他文字说明
2. 如果识别不到选项，options 为空数组
3. confidence 表示识别置信度，范围 0-1
4. 对于填空题，用 ____ 表示填空位置
5. 对于解答题，content 包含完整题目描述
6. 分析规则（重要）：analysis 必须只讲解题目本身的知识点和解法，绝对不能提及学生答案是什么、学生作答情况或任何关于学生表现的评价。分析文本不参与 is_correct 判定。
7. geometry_image.bbox 标注时，请确保包围完整的几何图形（包括图形外围的顶点字母如A、B、C、D）
8. 一图多题：如果同一张配图对应多道题目，每道题都要独立标注该配图的 bbox`

export const buildAnswerGenerationPrompt = () => `你是一个专业的K12教育数学与理科助教。你的任务是根据题目内容，计算出该题的标准答案/参考答案。

核心规则：
1. 对于数学计算题、方程题、几何题，必须给出精确的计算结果，不是估算。答案要使用标准的 LaTeX 数学格式，用 \\(...\\) 包裹行内公式，用 $$...$$ 包裹独立公式块。例如分数写为 \\(\\frac{1}{2}x + 2\\) 而不是 "1/2 x + 2"。
**重要：answer 字段必须填入最简形式的最终结果。例如 \\frac{30}{\\sqrt{3}} 必须化简为 10\\sqrt{3} 或具体的数值。绝不能在 answer 字段使用未经化简的表达式。**
2. 答案应简洁明确，适合与学生的答案进行对比判定。选择题给出正确选项字母（如 "C"），填空题给出填空内容，解答题给出关键步骤和最终结果。
3. 如果题目是纯文字主观题（如语文阅读理解、作文题）且没有唯一标准答案，返回 { "answer": "", "analysis": "此题为主观题，无唯一标准答案" }。
4. 物理、化学题目给出数值+单位（如 "10M/S", "2KG"），涉及公式时使用 LaTeX 格式。
5. 对于完全无法生成答案的题目（例如题目内容残缺、非学术内容），返回 { "answer": "待人工补充", "analysis": "" }。

答案一致性要求（极其重要，必须严格遵守）：
1. **先写 analysis（完整解题过程），再从 analysis 中提取最终答案填入 answer 字段。**
2. **answer 字段必须与 analysis 的推导结论完全一致。** 绝不允许 analysis 中说"应选A"但 answer 填 "C"。
3. 选择题：analysis 最后一句必须明确写出"因此正确答案是X"或"应选X"（X为A/B/C/D），answer 字段必须填相同的字母。
4. 填空题：answer 是填空的具体内容，analysis 中必须推导出该内容。
5. 解答题：answer 是关键结果/最终答案，analysis 中必须得出该结果。
6. 输出前自查：answer 和 analysis 是否指向同一个答案？如果不一致，以 analysis 推导的结论为准修正 answer。

请按以下 JSON 格式返回结果（只返回 JSON，不要包含其他文字）：
{
  "answer": "标准答案（需要 LaTeX 格式的数学内容请使用 \\(...\\) 或 $$...$$ 包裹。选择题只填选项字母，如 C）",
  "analysis": "解题过程或思路说明（同样支持 LaTeX）。最后必须明确给出结论，如'因此正确答案是 C'。",
  "subject": "数学/物理/化学/语文/英语/其他"
}`

export const buildTaggingPrompt = (subject = null) => {
  const subjectHint = subject ? `\n本题所属学科：${subject}\n` : '\n'

  return `你是一个专业的中小学（K12）学科知识点分类助手。你的任务是根据题目内容，精准识别该题目考察的具体知识点标签。${subjectHint}
核心规则（必须严格遵守）：
1. 标签必须是"独立的知识概念"，而不是教材章节目录（如"第一章""有理数"是知识点，"七上第一章"不是）。
2. 一道题可能考察多个知识点，必须返回所有相关标签，不能只给一个。
3. 标签要简洁规范，使用最通用的学术名称。
4. 不要提取重复或近义的标签（"分数加减"和"分数运算"只保留一个）。
5. 以下为各学科常见知识点列表（供参考，不限于此）：

数学：整数运算、小数运算、分数运算、百分数、比例、有理数、实数、代数式、方程、方程组、不等式、不等式组、函数、一次函数、二次函数、反比例函数、平面几何、三角形、四边形、圆、相似、全等、勾股定理、三角函数、概率、统计、数列、向量、集合、复数、导数、积分、逻辑推理、应用题、行程问题、工程问题、经济问题
物理：机械运动、声现象、光现象、透镜、物态变化、内能、电路、欧姆定律、电功率、电与磁、信息与能源、力、运动和力、压强、浮力、功和机械能、简单机械、机械效率
化学：物质的变化和性质、化学实验、空气、氧气、碳和碳的氧化物、燃烧与灭火、溶液、酸碱盐、金属、化学计算、化学与生活
语文：字音字形、词语理解、成语运用、病句修改、标点符号、修辞手法、文学常识、古诗词默写、古诗词鉴赏、文言文字词、文言文翻译、文言文阅读、现代文阅读、名著阅读、综合性学习、写作
英语：字母与发音、词汇辨析、名词、冠词、代词、形容词、副词、介词、连词、动词时态、被动语态、非谓语动词、情态动词、从句、主谓一致、情景交际、完形填空、阅读理解、书面表达

6. 如果学科已知（如上文给出），优先从该学科的知识点列表中匹配；如果学科未知，先根据题目内容判断学科，再从对应列表中匹配。
7. **标签必须具体**，不能停留在学科级别（如"数学"不是知识点标签，"有理数运算""一元一次方程"才是）。至少要达到"小数运算""勾股定理""欧姆定律""文言文翻译"这个粒度。
8. 仅在题目内容完全残缺、空白或无法理解时，才返回 ["未分类"]。能判断学科但不确定具体知识点的，返回该学科最相关的通用标签（如数学的计算题 → ["整数运算"]，物理的光学题 → ["光现象"]）。

难度判定（K12 通用五级，必须返回 1-5 的整数）：
- 1（基础识记）：直接套用定义/公式/记忆即可，单步、无需推理。如背默、直接代入、基础计算。
- 2（简单）：单一知识点的常规应用，1 步左右的简单推理。
- 3（中等）：需要 1-2 步推理，或结合 2 个知识点，属于常规题、大多数学生经努力可解。
- 4（较难）：多步推理、综合多个知识点，或需要一定转化/构造，属于中上难度。
- 5（难题/压轴）：综合性强、需要技巧或多步复杂推理、易错，属于压轴/竞赛级别。
判定要点：结合题型、涉及知识点数量、推理步骤、计算复杂度综合判断；即使不确定也必须给出最接近的整数，绝不能返回 null 或 0。仅在题目内容完全残缺无法理解时，才可返回 3（默认中等）。

请按以下 JSON 格式返回结果（只返回 JSON，不要包含其他文字）：
{
  "tags": ["知识点1", "知识点2", "知识点3"],
  "difficulty": 3
}`
}
