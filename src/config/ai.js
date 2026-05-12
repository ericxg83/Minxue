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

// 构建题目识别提示词
export const buildOCRPrompt = () => `你是一个专业的教育题目识别助手。请仔细分析上传的作业图片，识别其中的题目内容和位置。

请按以下 JSON 格式返回识别结果：
{
  "questions": [
    {
      "question_id": "唯一标识",
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
      }
    }
  ]
}

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

答案比对规则（非常重要）：
1. 选择题：
   - 正确答案和学生答案都应该是单个字母（A/B/C/D）
   - 如果学生答案和正确答案相同（不区分大小写），is_correct = true
   - 如果不同，is_correct = false
   - 例如：正确答案"B"，学生答案"b" → is_correct = true
   - 例如：正确答案"B"，学生答案"C" → is_correct = false

2. 填空题：
   - 比较学生答案和正确答案的内容
   - 忽略空格、标点符号的差异
   - 如果数值相同，is_correct = true
   - 例如：正确答案"3.14"，学生答案"3.14" → is_correct = true
   - 例如：正确答案"3.14"，学生答案"3.1" → is_correct = false

3. 解答题：
   - 如果学生有作答内容，is_correct = true（由老师人工复核）
   - 如果学生未作答，is_correct = false

4. 特殊情况：
   - 如果无法识别学生答案，is_correct = false
   - 如果题目没有标准答案，is_correct = true（由老师人工复核）

注意事项：
1. 只返回 JSON 格式数据，不要包含其他文字说明
2. 如果识别不到选项，options 为空数组
3. confidence 表示识别置信度，范围 0-1
4. 对于填空题，用 ____ 表示填空位置
5. 对于解答题，content 包含完整题目描述
6. 请仔细比对学生答案和正确答案，严格按照上述规则判断 is_correct
7. 确保 is_correct 的布尔值准确反映学生答案是否正确
8. 关于 analysis（题目解析）：解析应只讲解题目本身的解法和知识点，不要提及学生的作答情况。例如：正确写法"将x=-6代入y=-1/2x得y1=3；将x=-3代入y=-1/2x得y2=1.5。因此y1>y2，选项C正确。" 错误写法"学生选择了B"或"因此y1>y2，选项C正确，学生选择了B"。`

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
