import { Router } from 'express'
import multer from 'multer'
import { query, TABLES } from '../config/neon.js'
import {
  createWorksheet, getAllWorksheets, getWorksheetById,
  updateWorksheetStatus, updateWorksheetPdfUrl, updateWorksheetAnswerCount,
  deleteWorksheet,
  batchInsertAnswers, getWorksheetAnswers, updateWorksheetAnswer,
  getStudentWorksheetSetting, upsertStudentWorksheetSetting
} from '../services/neonService.js'
import { uploadImage } from '../services/ossService.js'

const router = Router()
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
})

// ── 练习册 CRUD ──

// 列表
router.get('/', async (req, res) => {
  try {
    const worksheets = await getAllWorksheets()
    res.json({ success: true, worksheets })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 新建
router.post('/', async (req, res) => {
  try {
    const { name, subject, grade } = req.body
    if (!name) return res.status(400).json({ error: '缺少练习册名称' })
    const worksheet = await createWorksheet({ name, subject, grade })
    res.json({ success: true, worksheet })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 详情
router.get('/:id', async (req, res) => {
  try {
    const worksheet = await getWorksheetById(req.params.id)
    if (!worksheet) return res.status(404).json({ error: '练习册不存在' })
    res.json({ success: true, worksheet })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 更新状态
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body
    if (!['draft', 'reviewing', 'published'].includes(status)) {
      return res.status(400).json({ error: '无效状态' })
    }
    const worksheet = await updateWorksheetStatus(req.params.id, status)
    res.json({ success: true, worksheet })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 删除
router.delete('/:id', async (req, res) => {
  try {
    await deleteWorksheet(req.params.id)
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── PDF 解析 ──

router.post('/:id/parse-pdf', pdfUpload.single('file'), async (req, res) => {
  try {
    const worksheetId = req.params.id
    const worksheet = await getWorksheetById(worksheetId)
    if (!worksheet) return res.status(404).json({ error: '练习册不存在' })

    const file = req.file
    if (!file) return res.status(400).json({ error: '请上传PDF文件' })

    // 上传 PDF 到 OSS
    const pdfUrl = await uploadImage(file.buffer, `worksheets/${worksheetId}/${file.originalname}`, 'system')
    await updateWorksheetPdfUrl(worksheetId, pdfUrl)

    // 尝试 pdf-parse 提取文本
    let fullText = ''
    try {
      const pdf = await import('pdf-parse')
      const data = await pdf.default(file.buffer)
      fullText = data.text || ''
    } catch (e) {
      console.log('pdf-parse failed, will try OCR fallback:', e.message)
    }

    let parsedAnswers = []
    let lowConfidence = []

    if (fullText && fullText.trim().length > 50) {
      // 文本解析：查找参考答案区域
      const answerSection = fullText.replace(/.*?(参考答案|答案|标准答案|参考解答)/s, '')
      if (answerSection.length < fullText.length * 0.3) {
        // 如果没找到明确的答案区域，用全文
        parsedAnswers = parseAnswerText(fullText, lowConfidence)
      } else {
        parsedAnswers = parseAnswerText(answerSection, lowConfidence)
      }
    }

    // 如果文本解析不足，降级到 OCR
    if (parsedAnswers.length === 0) {
      // 转图片 → Gemini Vision
      try {
        const sharp = await import('sharp')
        const imageBuffer = await sharp.default(file.buffer)
          .jpeg({ quality: 85 })
          .toBuffer()
        const base64 = imageBuffer.toString('base64')

        const ocrResult = await ocrExtractAnswers(base64)
        if (ocrResult && ocrResult.length > 0) {
          parsedAnswers = ocrResult
        }
      } catch (e) {
        console.log('OCR fallback failed:', e.message)
      }
    }

    // 保存到数据库
    if (parsedAnswers.length > 0) {
      await batchInsertAnswers(worksheetId, parsedAnswers)
      await updateWorksheetAnswerCount(worksheetId)
      await updateWorksheetStatus(worksheetId, 'reviewing')
    }

    // 更新 answer_count
    const updated = await getWorksheetById(worksheetId)

    res.json({
      success: true,
      count: parsedAnswers.length,
      lowConfidence,
      worksheet: updated
    })
  } catch (e) {
    res.status(500).json({ error: 'PDF解析失败: ' + e.message })
  }
})

// 简单的题号答案解析
function parseAnswerText(text, lowConfidence) {
  const results = []
  const lines = text.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // 匹配 "13. A" / "13．A" / "13、A" / "(13) A"
    let m = trimmed.match(/^\(?(\d+)\)?[.．、\s]\s*([A-Da-d])\s*$/)
    if (m) {
      results.push({
        question_no: parseInt(m[1]),
        answer: m[2].toUpperCase(),
        answer_type: 'choice',
        confidence: 0.95
      })
      continue
    }

    // 匹配 "1-5 ACDBE" 展开为 5 题
    m = trimmed.match(/^(\d+)\s*[-~]\s*(\d+)\s+([A-Da-d]+)\s*$/)
    if (m) {
      const start = parseInt(m[1])
      const letters = m[3].toUpperCase().split('')
      for (let i = 0; i < letters.length; i++) {
        results.push({
          question_no: start + i,
          answer: letters[i],
          answer_type: 'choice',
          confidence: 0.9
        })
      }
      continue
    }

    // 匹配非选择题 "13. 2017" 等
    m = trimmed.match(/^(\d+)[.．、\s]\s*(.+)$/)
    if (m) {
      const ans = m[2].trim()
      if (ans.length < 50) {
        results.push({
          question_no: parseInt(m[1]),
          answer: ans,
          answer_type: 'answer',
          confidence: 0.8
        })
        lowConfidence.push({ question_no: parseInt(m[1]), answer: ans })
      }
    }
  }

  return results
}

// OCR 降级提取
async function ocrExtractAnswers(base64Image) {
  const { AI_CONFIG, getAIHeaders } = await import('../config/ai.js')
  const model = AI_CONFIG.vision?.models?.[0]
  if (!model) return []

  const body = {
    model: model.name,
    messages: [
      { role: 'user', content: [{ type: 'text', text: '请提取这份练习册答案中的所有题号和对应答案。只输出题号和答案，每行一个，格式如"1. A"。' }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }] }
    ],
    max_tokens: 4096
  }

  const resp = await fetch(model.endpoint, {
    method: 'POST',
    headers: getAIHeaders(model),
    body: JSON.stringify(body)
  })

  if (!resp.ok) return []

  const data = await resp.json()
  const text = data.choices?.[0]?.message?.content || data.content || ''
  const lowConfidence = []
  return parseAnswerText(text, lowConfidence)
}

// ── 答案管理 ──

// 获取答案列表
router.get('/:id/answers', async (req, res) => {
  try {
    const answers = await getWorksheetAnswers(req.params.id)
    res.json({ success: true, answers })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 编辑答案
router.put('/:id/answers/:answerId', async (req, res) => {
  try {
    const { answer, answer_type } = req.body
    const updated = await updateWorksheetAnswer(req.params.answerId, { answer, answer_type })
    res.json({ success: true, answer: updated })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── 学生默认练习册 ──

router.get('/student-settings/:studentId', async (req, res) => {
  try {
    const { subject } = req.query
    if (!subject) return res.status(400).json({ error: '缺少科目' })
    const setting = await getStudentWorksheetSetting(req.params.studentId, subject)
    res.json({ success: true, setting })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.put('/student-settings', async (req, res) => {
  try {
    const { studentId, subject, worksheetId } = req.body
    if (!studentId || !subject) return res.status(400).json({ error: '缺少参数' })
    const setting = await upsertStudentWorksheetSetting(studentId, subject, worksheetId || null)
    res.json({ success: true, setting })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router