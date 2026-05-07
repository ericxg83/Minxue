export const AI_CONFIG = {
  ENDPOINT: process.env.AI_ENDPOINT || 'https://api-inference.modelscope.cn/v1/chat/completions',
  API_KEY: process.env.AI_API_KEY,
  MODEL: process.env.AI_MODEL || 'Qwen/Qwen3-VL-8B-Instruct',
  TIMEOUT: 120000,
  MAX_RETRIES: 2
}

export const getAIHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${AI_CONFIG.API_KEY}`
})

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

2. 填空题：
   - 比较学生答案和正确答案的内容
   - 忽略空格、标点符号的差异
   - 如果数值相同，is_correct = true

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
8. 关于 analysis（题目解析）：解析应只讲解题目本身的解法和知识点，不要提及学生的作答情况。`

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
