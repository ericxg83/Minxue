import { callVisionCompletion } from '../config/ai.js'

/**
 * 单题「区域重识别」服务（PC 批改工作台「重新识别本题」用）
 *
 * 背景：整页 OCR 拆题时，选择题的选项常被漏识别（题干末尾停在「（」，options 为空）。
 * 而 checkQuestionCompleteness 的「选择题缺少选项」规则**只读 options 数组**，
 * 配图（geometry_image_url）不参与该规则 —— 所以老师把整题裁成配图也解不开拦截，
 * 必须把选项文本真正补出来。
 *
 * 本服务只做一件事：吃一张**已经裁剪好的一题区域**图片，吐回结构化的题目元素，
 * **不写库**（与 answerOCRService 同款契约）。是否采纳、如何合并由前端预览弹窗决定，
 * 最终仍走既有的 PUT /api/questions/:id 落库，从而自动联动
 * is_complete / wrong_book_risks / rejudge。
 */

// ── 输出口径 ──
// content / options 走「纯文本 + Unicode 数学符号」，与题库现有 data 一致
//   （原卷 OCR 出来的题干就是 "y=x²-1" 这种形态，不是 LaTeX）。
// answer 允许 KaTeX：答案本来就是 KaTeX 存的（见 answerOCRService）。
const buildQuestionPrompt = () => `你是一位资深数学老师，正在做试卷录入。图片是从一张试卷上裁剪出来的【一道题】的区域。

【任务】把这道题的题目元素结构化提取出来。

【content（题干）】
- 只转录题干正文，**绝对不要包含 A/B/C/D 的选项文字**。
- 原图开头有印刷体题号（如"5."）就保留。
- 数学式用纯文本 + Unicode 符号表达：上标下标用 x²、y₁，根号用 √，乘号用 ×，除号用 ÷，百分号 %，π、≤、≥、±、≠ 原样保留。**不要输出 LaTeX 命令**（不要 \\frac、\\sqrt、$）。
- 区分乘号 × 与字母 x：算式中间表示相乘用 ×，未知数用 x。
- 图片里如果印着"（ ）"这种待填括号，保留它。

【options（选项）】
- 顺序对应 A、B、C、D。**只放选项正文，不要带"A."/"（A）"/"A、"这类标号**（标号由系统按顺序自动生成）。
- 数学式同样是纯文本 + Unicode 符号，规则同 content。
- 原图有几个选项就输出几个，不要凑数。
- **原图根本没有选项时返回空数组 []，不要自己编造选项。**

【answer（参考答案）】
- 原图**印有或手写**参考答案时才转录（选择题通常只写字母，如 "B"；填选题写最终结果，允许 KaTeX 如 \\frac{\\sqrt{2}}{2}）。
- 原图没有答案时，请你独立解出这道题并把最终答案填进 answer；**不要编造题目里没有的数值或条件**。
- 不要输出方程、不要输出问句，只要最终结果。

【question_type】
- choice（选择题）/ fill（填空题）/ answer（解答题）三者之一，按题目实际形态判断。

【analysis】
- 简要解题过程（可选，可留空字符串）。

【识别不到时】
- 某处印刷体确实模糊无法辨认，用 □ 占位，**不要臆造内容**。

严格返回合法 JSON，不要任何额外说明、不要 markdown 代码块：
{
  "content": "题干纯文本",
  "options": ["选项A正文", "选项B正文"],
  "answer": "参考答案",
  "question_type": "choice",
  "analysis": "解题过程（可空字符串）"
}`

const bufferToDataURL = (buffer, mimeType) => {
  const m = mimeType && mimeType.startsWith('image/') ? mimeType : 'image/jpeg'
  return `data:${m};base64,${buffer.toString('base64')}`
}

const stripCodeFence = (text) =>
  String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()

/**
 * 归一化选项数组：
 *  - 只保留字符串、去首尾空白、丢掉空串
 *  - 去掉模型偶发带上的标号（(A) / A. / A、 等）。这里不做「整组表决」，
 *    因为题库落库时还有 normalizeOptions 兜底；此处先削一刀是为了让前端预览好看。
 *  - 上限 8 项（A-H），超出视为模型跑偏，直接截断
 */
const sanitizeOptions = (raw) => {
  if (!Array.isArray(raw)) return []
  const RE = /^\s*(?:[（([【「]\s*[A-Ha-h]\s*[)）\]】」]|[A-Ha-h]\s*[.．、)）])[.．、]?\s*/
  return raw
    .filter(o => typeof o === 'string')
    .map(o => o.replace(RE, '').trim())
    .filter(o => o.length > 0)
    .slice(0, 8)
}

const VALID_TYPES = ['choice', 'fill', 'answer']

/**
 * 题目元素是否「像垃圾」：用来拦住模型跑偏时的输出，避免污染前端预览。
 * 与 worker.js 的同名判据思路一致（稀疏/占位符不算有效题干）。
 */
const isUnusableContent = (content) => {
  const c = String(content || '').trim()
  if (!c) return true
  // 纯占位符 / 纯指令词，没有实际题面
  if (/^[□\s。.，,、（）()【】\[\]]+$/.test(c)) return true
  if (c.length < 4) return true
  // 只输出"计算：""解方程："这类指令词而没有正文
  if (c.length < 12 && /^(计算|化简|求解|解方程|求值|解答|判断)[:：]?$/.test(c)) return true
  return false
}

const safeParseQuestion = (rawText) => {
  if (!rawText) throw new Error('模型返回为空')
  let text = stripCodeFence(rawText)
  let obj = null
  try {
    obj = JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    if (m) {
      try { obj = JSON.parse(m[0]) } catch { /* fall through */ }
    }
  }
  if (!obj || typeof obj !== 'object') throw new Error('模型未返回可解析的 JSON')

  const content = typeof obj.content === 'string' ? obj.content.trim() : ''
  const options = sanitizeOptions(obj.options)
  const answer = typeof obj.answer === 'string' ? obj.answer.trim() : ''
  const analysis = typeof obj.analysis === 'string' ? obj.analysis.trim() : ''
  let questionType = String(obj.question_type || '').trim().toLowerCase()
  if (!VALID_TYPES.includes(questionType)) {
    // 模型没给或给了非法值 → 按内容推断，不引入新枚举
    questionType = options.length > 0 ? 'choice' : 'answer'
  }

  // 什么都没有 → 视为识别失败（宁可让老师重来，也不给空预览）
  if (isUnusableContent(content) && options.length === 0 && !answer) {
    throw new Error('未能从图片中识别出有效的题目内容')
  }

  return { content, options, answer, analysis, question_type: questionType }
}

/**
 * 识别一张「单题区域」图片，返回结构化题目元素。不写库。
 * @param {Buffer} imageBuffer
 * @param {string} mimeType
 * @returns {Promise<{content:string, options:string[], answer:string, analysis:string, question_type:string}>}
 */
export async function recognizeQuestionImage(imageBuffer, mimeType) {
  if (!imageBuffer || imageBuffer.length === 0) {
    throw new Error('图片为空')
  }

  const { content } = await callVisionCompletion({
    imageDataURL: bufferToDataURL(imageBuffer, mimeType),
    systemPrompt: buildQuestionPrompt(),
    userText: '请提取这张图片中这一道题的题干、选项与参考答案，按 JSON 格式返回。',
    temperature: 0.05,
    maxTokens: 2048,
    // 质量敏感：禁止静默降级到弱备份视觉模型。
    // 理由同 2026-09-09 练习册答案事故（弱模型阅读顺序错乱、漏读），
    // 补出来的题干/选项要直接落库并进入错题本，错不起。
    noBackup: true,
  })

  return safeParseQuestion(content)
}
