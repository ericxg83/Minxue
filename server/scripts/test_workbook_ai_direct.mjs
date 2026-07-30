// 直接测试 AI vision call 是否对真实图片 400
// 复现：worker.js 调用 callVisionCompletion 时的参数
import dotenv from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import { callVisionCompletion, AI_CONFIG } from '../config/ai.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '..', '.env') })

// 用任务 5107a87c 的真实图片 URL
const imageUrl = 'https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/e60bb513-ec67-4a01-9942-14b65a5ec69f/20260730/f7cae68f-e8cd-4ffb-bd46-390072dcdc7f.jpg'

console.log('下载测试图片...')
const r = await fetch(imageUrl)
if (!r.ok) { console.error('下载失败:', r.status); process.exit(1) }
const buf = Buffer.from(await r.arrayBuffer())
console.log('原图大小:', buf.length, 'bytes')

const compressed = await sharp(buf)
  .rotate()
  .resize(1800, 1800, { fit: 'inside', withoutEnlargement: true })
  .jpeg({ quality: 85 })
  .toBuffer()
console.log('压缩后大小:', compressed.length, 'bytes')
console.log('base64 后大小:', compressed.toString('base64').length, 'chars')

const workbookPrompt = `你是一个专业的学生手写答案识别助手。请从作业图片中提取页面标题和每道题的题号、学生手写答案。
只输出 JSON 对象。
{
  "page_title": "...",
  "questions": [
    { "question_number": 1, "student_answer": "...", "question_type": "choice", "block_coordinates": { "x": 0, "y": 0, "width": 100, "height": 100 } }
  ]
}
`

try {
  const { content, usedBackup } = await callVisionCompletion({
    imageDataURL: `data:image/jpeg;base64,${compressed.toString('base64')}`,
    systemPrompt: workbookPrompt,
    userText: '识别这张作业图片的页面标题和所有题目的学生答案。',
    temperature: 0.1,
    maxTokens: 4096
  })
  console.log('OK usedBackup=', usedBackup)
  console.log('content len=', content.length)
  console.log('content first 500:', content.substring(0, 500))
} catch (e) {
  console.error('❌ 失败:', e.message)
  console.error('status:', e.response?.status)
  console.error('data:', JSON.stringify(e.response?.data)?.substring(0, 800))
}
process.exit(0)
