// 魔搭社区 AI 接口配置
// 从环境变量读取配置，支持测试/生产环境自动切换
export const AI_CONFIG = {
  // API 端点 - 魔搭社区
  ENDPOINT: import.meta.env.VITE_AI_ENDPOINT || 'https://api-inference.modelscope.cn/v1/chat/completions',

  // API Key
  API_KEY: import.meta.env.VITE_AI_API_KEY,

  // 模型名称 - Qwen3-VL-8B 支持多模态图片识别（魔搭社区支持，有免费额度）
  MODEL: import.meta.env.VITE_AI_MODEL || 'Qwen/Qwen3-VL-8B-Instruct',

  // 请求超时时间（毫秒）- 120秒，给AI服务器更多处理时间
  TIMEOUT: 120000,

  // 最大重试次数
  MAX_RETRIES: 2
}

// 环境变量检查
if (!AI_CONFIG.API_KEY) {
  console.error('❌ 错误：缺少 AI API Key 环境变量配置')
  console.error('请检查 .env.development 或 .env.production 文件中的 VITE_AI_API_KEY')
}

// 构建 AI 请求头
export const getAIHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${AI_CONFIG.API_KEY}`
})

// 构建题目识别提示词 (多模态智能切题引擎版)
export const buildOCRPrompt = () => `你是一个专业的教育题目识别助手。请仔细分析上传的试卷/作业图片，识别其中的题目内容、几何配图和作答情况。

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
- 如果题干中提到"如图"、"如图所示"、"图1"等关键词，请务必找到对应的配图并标注 bbox
- 配图可能在题干下方、右方，也可能在页面其他位置

block_coordinates 说明（必填）：
- x: 题目区域左上角在图片中的横坐标（像素估算值，0-图片宽度）
- y: 题目区域左上角在图片中的纵坐标（像素估算值，0-图片高度）
- width: 题目区域的估算宽度
- height: 题目区域的估算高度
- 请根据题目在图片中的实际位置进行估算

题目类型说明：
- choice: 选择题（有A/B/C/D等选项）
- fill: 填空题（有下划线或空格需要填写）
- answer: 解答题（需要文字说明或计算过程）

字段说明：
- answer: 题目的标准答案/参考答案
- student_answer: 学生实际填写的答案
- is_correct: 仅作为 AI 的参考判断，实际正确性由服务端根据 student_answer 与 answer 的比对结果决定
- analysis: 题目解析，讲解题目本身的知识点和解法，绝不能提及学生答案或作答情况
- confidence: 识别置信度，范围 0-1

识别重点：
1. 务必确保 student_answer 和 answer 字段的识别尽可能准确，它们是评判正确性的唯一依据
2. 如果无法识别学生答案，student_answer 留空字符串，不要编造
3. 如果题目没有标准答案，answer 留空字符串
4. 对于填空题，用 ____ 表示填空位置，仔细识别学生填写的内容
5. **重点**：仔细扫描题干中的"如图"、"如图所示"、"图1"、"附图"等关键词，找到对应的几何配图并准确标注 bbox

针对 student_answer 的识别：
- 如果图片中同时出现了学生笔迹和老师批改痕迹，student_answer 以学生笔迹为准
- 如果图片中只有打印的题目和空白，student_answer 留空

注意事项：
1. 只返回 JSON 格式数据，不要包含其他文字说明
2. 如果识别不到选项，options 为空数组
3. 对于填空题，用 ____ 表示填空位置
4. 对于解答题，content 包含完整题目描述
5. 分析规则（重要）：analysis 必须只讲解题目本身的知识点和解法，绝对不能提及学生答案是什么、学生作答情况或任何关于学生表现的评价。分析文本不参与 is_correct 判定。
6. geometry_image.bbox 标注时，请确保包围完整的几何图形（包括图形外围的顶点字母如A、B、C、D）
7. 一图多题：如果同一张配图对应多道题目，每道题都要独立标注该配图的 bbox`

export const buildTaggingPrompt = () => `你是一个专业的教育知识点标注助手。你的任务是根据题目内容，提取该题目考察的具体知识点标签。

核心规则（必须严格遵守）：
1. 标签必须是"独立的知识概念"，而不是教材章节目录。
   - 正确示例："勾股定理"、"一元二次方程"、"牛顿第一定律"、"函数图像"、"数形结合"
   - 错误示例："第三章"、"第二节"、"第一单元"、"教材P45"
2. 一道题可能考察多个知识点，必须返回所有相关标签，不能只给一个。
   - 例如：一道题既考了"函数图像"又考了"数形结合"，应返回 ["函数图像", "数形结合"]
3. 标签要简洁规范，使用最通用的学术名称：
   - 使用"三角形"而不是"几何-三角形"
   - 使用"一元二次方程"而不是"方程与不等式-一元二次方程"
   - 使用"勾股定理"而不是"直角三角形-勾股定理"
4. 不要提取重复或近义的标签：
   - 如果同时识别出"三角形"和"几何-三角形"，只保留"三角形"
   - 如果同时识别出"二次函数"和"抛物线"，只保留"二次函数"（更规范的名称）
5. 如果实在无法分析出知识点，返回 ["未分类"]，不要编造标签。

请按以下 JSON 格式返回结果（只返回 JSON，不要包含其他文字）：
{
  "tags": ["知识点1", "知识点2", "知识点3"]
}

常见学科知识点参考（不限于以下，根据题目实际内容提取）：
- 数学：勾股定理、一元二次方程、二次函数、三角形、圆、概率、统计、数列、向量、导数、不等式、绝对值、因式分解、分式方程、平行线、相似三角形、反比例函数、一次函数、数形结合、分类讨论、方程思想
- 物理：牛顿第一定律、牛顿第二定律、牛顿第三定律、万有引力、动能定理、动量守恒、欧姆定律、串并联电路、光的折射、光的反射、浮力、压强、功和功率、机械能守恒、电磁感应
- 化学：氧化还原反应、酸碱中和、化学平衡、离子反应、有机化学、元素周期表、化学键、物质的量、电解质、原电池
- 语文：修辞手法、文言文翻译、诗歌鉴赏、阅读理解、作文结构、成语运用
- 英语：时态、语态、虚拟语气、定语从句、名词性从句、非谓语动词、完形填空、阅读理解`
