// 魔搭社区 AI 接口配置
// 从环境变量读取配置，支持测试/生产环境自动切换
export const AI_CONFIG = {
  // API 端点 - 魔搭社区
  ENDPOINT: import.meta.env.VITE_AI_ENDPOINT || 'https://api-inference.modelscope.cn/v1/chat/completions',

  // API Key
  API_KEY: import.meta.env.VITE_AI_API_KEY,

  // 模型名称 - Qwen3-VL-8B 支持多模态图片识别（魔搭社区支持，有免费额度）
  MODEL: import.meta.env.VITE_AI_MODEL || 'Qwen/Qwen3-VL-8B-Instruct',

  // 请求超时时间（毫秒）- 60秒
  TIMEOUT: 60000,

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
export const buildOCRPrompt = () => `你是一个专业的教育题目识别助手。请仔细分析上传的作业图片，识别其中的题目内容。

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
      "question_type": "choice/fill/answer"
    }
  ]
}

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
7. 确保 is_correct 的布尔值准确反映学生答案是否正确`
