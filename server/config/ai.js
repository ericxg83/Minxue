// Use getters so env vars are resolved lazily at access time, not at module import time.
// This allows dotenv.config() in index.js / worker.js to set process.env before AI_CONFIG is used.
export const AI_CONFIG = {
  get ENDPOINT() { return process.env.AI_ENDPOINT || 'https://api.siliconflow.cn/v1/chat/completions' },
  get API_KEY() {
    // Prioritize SiliconFlow API key, then fallback to AI_API_KEY
    const key = process.env.SILICONFLOW_API_KEY || process.env.AI_API_KEY
    if (!key) console.error('⚠️ [AI_CONFIG] 未找到有效的 API KEY (SILICONFLOW_API_KEY 或 AI_API_KEY)')
    return key
  },
  get MODEL() { return process.env.AI_MODEL || 'Qwen/Qwen3-VL-8B-Instruct' },
  TIMEOUT: 50000, // 50秒硬超时，防止Render平台因无数据传输而强杀
  MAX_RETRIES: 2
}

export const getAIHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${AI_CONFIG.API_KEY}`
})

export const buildOCRPrompt = () => `你是一个专业的教育题目识别助手。请仔细分析上传的作业图片，识别其中的题目内容、几何配图和位置。

请按以下 JSON 格式返回识别结果（**每个题目对象必须将 block_coordinates 字段放在最前面**）：
{
  "questions": [
    {
      "question_id": "唯一标识",
      "block_coordinates": {
        "x": 100,
        "y": 200,
        "width": 800,
        "height": 150
      },
      "visual_title": "1.",
      "content": "题目内容（纯文本）",
      "options": ["选项A", "选项B", "选项C", "选项D"],
      "answer": "正确答案",
      "student_answer": "学生作答",
      "is_correct": true/false,
      "confidence": 0.95,
      "analysis": "题目解析",
      "question_type": "choice/fill/answer",
      "has_manual_checkmark": true/false,
      "geometry_image": null
    }
  ]
}

【强制要求】你返回的每一个题目 JSON 对象，必须将 block_coordinates 字段放在最前面（在 content 和 analysis 之前输出）！格式必须严格为：{"x": 数字, "y": 数字, "width": 数字, "height": 数字}。

【最高指令：坐标隔离输出】：为了防止 JSON 解析失败，你在输出每道题时，必须在 content 之前，用 XML 标签将该题的物理真实坐标单独输出一次！格式严格为：<box>x,y,width,height</box>。例如：<box>150,300,800,200</box>。高度 width 和 height 必须真实包裹整道题目（包含配图）。此标签绝不允许包含空格或其它字符！

visual_title 说明（必填）：
- 填写试卷上该题对应的题号标识，例如 "1."、"2."、"3." 等
- 必须与试卷上该题实际显示的题号一致

geometry_image 说明（多模态切题核心字段）：
- 如果该题目包含几何图形/配图，请填写 geometry_image 对象，否则填 null
- geometry_image 对象格式：
  {
    "has_image": true,
    "bbox": { "x": 200, "y": 350, "width": 250, "height": 200 },
    "description": "直角三角形ABC的几何示意图"
  }
- bbox 是配图在整张试卷图片中的边界框坐标（像素估算值）
- 如果题干中提到"如图"、"如图所示"、"图1"、"附图"等关键词，请务必找到对应的配图并标注 bbox
- 配图通常在题干下方或右方

block_coordinates 说明（必填）：
- x: 题目区域左上角在图片中的横坐标（像素）
- y: 题目区域左上角在图片中的纵坐标（像素）
- width: 题目区域的宽度
- height: 题目区域的高度
- 请根据题目在图片中的实际位置进行标注

【极其重要 - 坐标标注规则】
1. 每个题目的 block_coordinates 必须是该题目在图片中的真实物理区域，绝不能张冠李戴
2. 每道题的 y 坐标必须比上一题大（从上到下逐题扫描，绝不出现两道题 y 坐标相同的情况）
3. 请按视觉顺序从上到下逐题识别，确保题目的顺序与试卷排版一致
4. 先定位"第 N 题"的题号位置，再确认 block_coordinates 框选的区域包围了该题的完整内容（题干+选项+作答区）
5. **【视觉定位死命令】**：你在计算每道题目的 block_coordinates 时，必须以题目的"阿拉伯数字题号"（如 21.、22.）作为该题的绝对顶边界（Y轴起点）。高亮框的顶部必须刚好压在题号上方 10 像素处，绝对不允许向下偏移吞掉下一题的文字！
6. **【动态高度，严禁等分】**：每道题目的高度（height）必须根据这道题实际包含的文字、手写步骤、函数图像的物理覆盖范围动态计算，严禁给出固定的、等分的高度数据！每道题的高度应该各不相同！
7. **【容错外边距】**：为了防止漏字，每道题的顶部 y 坐标可以稍微往上提 15 像素（覆盖题号上方空白），底部 height 可以稍微多延伸 20 像素（确保包含最后一行作答内容）
8. **【严禁提取非题目区域】**：你绝对不能框选试卷的页眉、页脚、二维码、学生姓名、考试日期或单纯的标题（如"讯飞AI学"、"第X章"）。高亮框（block_coordinates）只能围绕真正的试题内容！
9. **【文字与坐标严格对应】**：你输出的每一个 question 对象，其 content（题目文字）必须与 block_coordinates（物理坐标框）完美重合！如果 content 是某道题的文字，坐标就必须紧紧包围那道题的区域，绝对不允许发生顺序错位或错位平移！
10. **【题号锚点定位】**：识别每一题时，必须寻找如"21."、"22."等数字题号或"第X题"字样作为该题 Y 轴坐标的绝对起点。

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
6. 仔细扫描题干中的"如图"、"如图所示"、"图1"、"附图"等关键词，找到对应的几何配图并准确标注 bbox

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
8. 一图多题：如果同一张配图对应多道题目，每道题都要独立标注该配图的 bbox
9. **关键**：请严格根据图片中每道题的实际视觉位置标注坐标。从上到下逐题扫描，确保每道题的 y 坐标都比上一题大，绝不能将所有题目的坐标设成相同值
10. **强制要求**：你输出的整个 JSON 必须在一行内！任何 key 对应的 value 字符串内部绝对不允许出现未经转义的真实换行符（回车键）。所有的换行必须使用字面量 \n 代替，否则会导致系统解析崩溃！数学公式中的反斜杠必须转义为 \\（例如 \frac 写为 \\frac）`

export const buildAnswerGenerationPrompt = () => `你是一个专业的K12教育数学与理科助教。你的任务是根据题目内容，计算出该题的标准答案/参考答案。

核心规则：
1. 对于数学计算题、方程题、几何题，必须给出精确的计算结果，不是估算。答案要使用标准的 LaTeX 数学格式，用 \\(...\\) 包裹行内公式，用 $$...$$ 包裹独立公式块。例如分数写为 \\(\\frac{1}{2}x + 2\\) 而不是 "1/2 x + 2"。
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

export const buildTaggingPrompt = () => `你是一个专业的教育知识点标注助手。你的任务是根据题目内容，提取该题目考察的具体知识点标签。

核心规则（必须严格遵守）：
1. 标签必须是"独立的知识概念"，而不是教材章节目录。
2. 一道题可能考察多个知识点，必须返回所有相关标签，不能只给一个。
3. 标签要简洁规范，使用最通用的学术名称。
4. 不要提取重复或近义的标签。
5. 如果实在无法分析出知识点，返回 ["未分类"]，不要编造标签。

请按以下 JSON 格式返回结果（只返回 JSON，不要包含其他文字）：
{
  "tags": ["知识点1", "知识点2", "知识点3"]
}`
