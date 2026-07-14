import { Router } from 'express'
import multer from 'multer'
import {
  createWorksheet,
  getAllWorksheets,
  getWorksheetById,
  updateWorksheetStatus,
  updateWorksheetPdfUrl,
  updateWorksheetAnswerCount,
  deleteWorksheet,
  batchInsertAnswers,
  getWorksheetAnswers,
  updateWorksheetAnswer,
  getStudentWorksheetSetting,
  upsertStudentWorksheetSetting,
} from '../services/neonService.js'
import { uploadImage } from '../services/ossService.js'
import { callVisionCompletion } from '../config/ai.js'

const router = Router()
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
})

router.get('/', async (req, res) => {
  try {
    const worksheets = await getAllWorksheets()
    res.json({ success: true, worksheets })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

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

router.get('/:id', async (req, res) => {
  try {
    const worksheet = await getWorksheetById(req.params.id)
    if (!worksheet) return res.status(404).json({ error: '练习册不存在' })
    res.json({ success: true, worksheet })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

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

router.delete('/:id', async (req, res) => {
  try {
    await deleteWorksheet(req.params.id)
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/:id/parse-pdf', pdfUpload.single('file'), async (req, res) => {
  try {
    const worksheetId = req.params.id
    const worksheet = await getWorksheetById(worksheetId)
    if (!worksheet) return res.status(404).json({ error: '练习册不存在' })

    const file = req.file
    if (!file) return res.status(400).json({ error: '请上传 PDF 文件' })

    const pdfUrl = await uploadImage(file.buffer, `worksheets/${worksheetId}/${file.originalname}`, 'system')
    await updateWorksheetPdfUrl(worksheetId, pdfUrl)

    let fullText = ''
    try {
      const pdf = await import('pdf-parse')
      const data = await pdf.default(file.buffer)
      fullText = data.text || ''
    } catch (e) {
      console.log('pdf-parse failed, will try OCR fallback:', e.message)
    }

    let parsedAnswers = []
    const lowConfidence = []

    if (fullText && fullText.trim().length > 50) {
      const answerSection = fullText.replace(/.*?(参考答案|答案|标准答案|参考解答)/s, '')
      if (answerSection.length < fullText.length * 0.3) {
        parsedAnswers = parseAnswerText(fullText, lowConfidence)
      } else {
        parsedAnswers = parseAnswerText(answerSection, lowConfidence)
      }
    }

    if (parsedAnswers.length === 0) {
      try {
        const sharp = await import('sharp')
        const imageBuffer = await sharp.default(file.buffer).jpeg({ quality: 85 }).toBuffer()
        const base64 = imageBuffer.toString('base64')
        const ocrResult = await ocrExtractAnswers(base64)
        if (ocrResult.length > 0) {
          parsedAnswers = ocrResult
        }
      } catch (e) {
        console.log('OCR fallback failed:', e.message)
      }
    }

    if (parsedAnswers.length > 0) {
      await batchInsertAnswers(worksheetId, parsedAnswers)
      await updateWorksheetAnswerCount(worksheetId)
      await updateWorksheetStatus(worksheetId, 'reviewing')
    }

    const updated = await getWorksheetById(worksheetId)

    res.json({
      success: true,
      count: parsedAnswers.length,
      lowConfidence,
      worksheet: updated,
    })
  } catch (e) {
    res.status(500).json({ error: 'PDF 解析失败: ' + e.message })
  }
})

function parseAnswerText(text, lowConfidence) {
  const results = []
  const lines = text.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let m = trimmed.match(/^\(?(\d+)\)?[.．、\s]\s*([A-Da-d])\s*$/)
    if (m) {
      results.push({
        question_no: parseInt(m[1], 10),
        answer: m[2].toUpperCase(),
        answer_type: 'choice',
        confidence: 0.95,
      })
      continue
    }

    m = trimmed.match(/^(\d+)\s*[-~]\s*(\d+)\s+([A-Da-d]+)\s*$/)
    if (m) {
      const start = parseInt(m[1], 10)
      const letters = m[3].toUpperCase().split('')
      for (let i = 0; i < letters.length; i++) {
        results.push({
          question_no: start + i,
          answer: letters[i],
          answer_type: 'choice',
          confidence: 0.9,
        })
      }
      continue
    }

    m = trimmed.match(/^(\d+)[.．、\s]\s*(.+)$/)
    if (m) {
      const ans = m[2].trim()
      if (ans.length < 50) {
        const questionNo = parseInt(m[1], 10)
        results.push({
          question_no: questionNo,
          answer: ans,
          answer_type: 'answer',
          confidence: 0.8,
        })
        lowConfidence.push({ question_no: questionNo, answer: ans })
      }
    }
  }

  return results
}

async function ocrExtractAnswers(base64Image) {
  const { content } = await callVisionCompletion({
    imageDataURL: `data:image/jpeg;base64,${base64Image}`,
    systemPrompt: '你是一个作业答案识别助手。请从图片中提取所有题号和对应答案。只输出题号和答案，每行一个，格式如“1. A”或“13. 2017”。',
    userText: '请提取这份练习册答案中的所有题号和对应答案。',
    temperature: 0.1,
    maxTokens: 4096,
  })

  const lowConfidence = []
  return parseAnswerText(content || '', lowConfidence)
}

router.get('/:id/answers', async (req, res) => {
  try {
    const answers = await getWorksheetAnswers(req.params.id)
    res.json({ success: true, answers })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.put('/:id/answers/:answerId', async (req, res) => {
  try {
    const { answer, answer_type } = req.body
    const updated = await updateWorksheetAnswer(req.params.answerId, { answer, answer_type })
    res.json({ success: true, answer: updated })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
