import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../.env') })
import { Pool } from 'pg'
import axios from 'axios'
import sharp from 'sharp'
import { callVisionCompletion } from '../config/ai.js'

const p = new Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

// 与 worker.js workbookPrompt 一致的增强版提示词（含数学符号识别规范）
const repairPrompt = `你是一个专业的学生手写答案识别助手。请从作业图片中提取页面标题和每道题的题号、学生手写答案。

⚠️ 关键：请严格区分印刷体文字和手写文字
- 印刷体文字（题目、选项、题号数字等）→ 不要作为 student_answer
- 手写体文字（学生书写的内容）→ 这才是 student_answer

只输出 JSON 对象，格式：
{
  "page_title": "页面顶部印刷体标题，没有则填 null",
  "questions": [
    {
      "question_number": 1,
      "content": "题目原文（印刷体题干）",
      "student_answer": "学生手写的答案文本，没有则填 null",
      "question_type": "choice"
    }
  ]
}

注意：
- content 必须填：每道题的题干原文（印刷体），至少包含这道题在问什么。
  计算题请完整转录算式，如"计算：3×4=□"或"解方程：x+3=5"。

【数学符号识别规范（印刷体题干，必须严格遵守）】
- 题干中的数学式子必须完整、准确地转录，禁止漏写、替换或臆造符号。
- 严格区分三种"叉形"符号：
  · 算式中间表示相乘的是乘号"×"（如"3×4"、"√12 × √(1/3)"）；
  · 出现在未知数/方程/代数式里的是字母"x/X"（如"x²-3x+2=0"、"x÷3"）；
  · 判断题批改标记、或题干里明确是判断结果时才用"√/✗"。
  绝不要用"×"去替代方程里的字母 x，也不要把题干文字里的打叉当成乘号。
- 除号"÷"、分数线"/"、根号"√"、平方"²"、立方"³"、指数、小数点"."、百分号"%"必须原样保留。
- 题干里的填空横线"____"、括号"（ ）"、空格占位要原样保留，不要删掉也不要擅自填写。
- 若某处印刷体实在模糊无法辨认，用"□"占位，绝不要输出一堆无意义的符号（如"× ×"、"% = %"、"= = ="）。
- 简答题/解答题/计算题的题干一定包含汉字描述或数字（如"计算"、"化简"、"解方程"、"求值"）。
  如果识别出的 content 全部是符号、不含任何汉字和数字（如"÷ = × ×"），说明识别错误，
  必须重新仔细查看该题印刷体原图后重新填写真实题干。
- 只返回 JSON，不要其他文字`

const run = async () => {
  const taskId = 'cdeabcde-f5d4-4adb-871a-0bd5c591ccda'
  const { rows: imgs } = await p.query(
    `SELECT DISTINCT image_url FROM questions WHERE task_id=$1 AND page_number=3 AND image_url IS NOT NULL LIMIT 1`,
    [taskId]
  )
  if (imgs.length === 0) { console.log('未找到第3页图片'); process.exit(1) }
  const url = imgs[0].image_url
  console.log('重新OCR:', url)
  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 })
  const compressed = await sharp(resp.data).rotate().resize(1800, 1800, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer()
  const dataUrl = `data:image/jpeg;base64,${compressed.toString('base64')}`
  const { content } = await callVisionCompletion({
    imageDataURL: dataUrl,
    systemPrompt: repairPrompt,
    userText: '识别这张作业图片的页面标题和所有题目的学生答案，重点准确转录每道计算题的题干。',
    temperature: 0.1,
    maxTokens: 4096
  })
  console.log('AI 返回:', content)

  // 解析 JSON 并更新 Q18-Q23 题干
  let parsed
  try {
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/[\[{][\s\S]*[\]}]/)
    parsed = JSON.parse(jsonMatch ? jsonMatch[1] || jsonMatch[0] : content)
  } catch (e) {
    console.error('JSON 解析失败:', e.message)
    process.exit(1)
  }
  const questions = Array.isArray(parsed) ? parsed : parsed.questions || []
  for (const q of questions) {
    if (q.question_number >= 18 && q.question_number <= 23 && q.content) {
      console.log(`更新 Q${q.question_number} 题干: "${q.content}"`)
      await p.query(`UPDATE questions SET content=$1, answer_exception=FALSE, answer_exception_reason=NULL, updated_at=NOW() WHERE task_id=$2 AND page_number=3 AND question_number=$3`, [q.content, taskId, q.question_number])
    }
  }
  console.log('完成')
  await p.end()
}
run().catch(e => { console.error('失败:', e); process.exit(1) })
