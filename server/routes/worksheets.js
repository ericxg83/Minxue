import { Router } from 'express'
import multer from 'multer'
import {
  createWorksheet,
  getAllWorksheets,
  getWorksheetById,
  updateWorksheetStatus,
  updateWorksheetPdfUrl,
  updateWorksheetParseStatus,
  updateWorksheetAnswerCount,
  deleteWorksheet,
  replaceWorksheetAnswers,
  getWorksheetAnswers,
  updateWorksheetAnswer,
  getStudentWorksheetSetting,
  upsertStudentWorksheetSetting,
} from '../services/neonService.js'
import { uploadPDF } from '../services/ossService.js'
import { extractPdfText, renderPdfToJpegs } from '../services/pdfService.js'
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
    if (worksheet.parse_status === 'parsing') {
      return res.status(409).json({ error: '该练习册正在解析中，请稍候' })
    }

    // 文件已收到：先告知前端上传成功，解析在后台进行，前端轮询 parse_status
    await updateWorksheetParseStatus(worksheetId, { status: 'parsing' })
    res.json({ success: true, parsing: true, message: '上传成功，解析已开始' })

    parsePdfInBackground(worksheetId, file).catch(async (e) => {
      console.error('PDF 后台解析失败:', e)
      await updateWorksheetParseStatus(worksheetId, {
        status: 'failed',
        error: e.message || '未知错误',
      }).catch(() => {})
    })
  } catch (e) {
    res.status(500).json({ error: 'PDF 解析失败: ' + e.message })
  }
})

async function parsePdfInBackground(worksheetId, file) {
  const pdfUrl = await uploadPDF(file.buffer, file.originalname, 'system')
  await updateWorksheetPdfUrl(worksheetId, pdfUrl)

  let fullText = ''
  try {
    fullText = await extractPdfText(file.buffer)
  } catch (e) {
    console.log('PDF text extraction failed, will try OCR fallback:', e.message)
  }

  let parsedAnswers = []
  const lowConfidence = []
  let markerFound = false
  let ocrTruncatedInfo = null

  if (fullText && fullText.trim().length > 50) {
    const answerSection = fullText.replace(/[\s\S]*?(参考答案|标准答案|参考解答|答案)/, '')
    markerFound = answerSection.length < fullText.length
    parsedAnswers = parseAnswerText(markerFound ? answerSection : fullText, lowConfidence)
    if (markerFound && parsedAnswers.length === 0) {
      // 标记词切分后无结果（可能切错位置），退回全文解析
      parsedAnswers = parseAnswerText(fullText, lowConfidence)
    }
  }

  if (parsedAnswers.length === 0) {
    try {
      // 扫描版 PDF：逐页渲染成图片后走视觉模型 OCR
      const { images, totalPages } = await renderPdfToJpegs(file.buffer, { maxPages: 20 })
      if (totalPages > images.length) {
        ocrTruncatedInfo = { totalPages, ocrPages: images.length }
        console.log(`PDF 共 ${totalPages} 页，仅 OCR 前 ${images.length} 页`)
      }
      for (const imageBuffer of images) {
        const ocrResult = await ocrExtractAnswers(imageBuffer.toString('base64'), lowConfidence)
        parsedAnswers.push(...ocrResult)
      }
    } catch (e) {
      console.log('OCR fallback failed:', e.message)
    }
  }

  // 同一题号去重：保留置信度更高的；置信度相同保留靠后的（答案区通常在文末）
  const byQuestionNo = new Map()
  for (const a of parsedAnswers) {
    const prev = byQuestionNo.get(a.question_no)
    if (!prev || a.confidence >= prev.confidence) byQuestionNo.set(a.question_no, a)
  }
  parsedAnswers = [...byQuestionNo.values()].sort((a, b) => a.question_no - b.question_no)

  if (parsedAnswers.length > 0) {
    // 事务性替换：先清空旧答案再插入，避免并发解析产生重复行
    await replaceWorksheetAnswers(worksheetId, parsedAnswers)
    await updateWorksheetAnswerCount(worksheetId)
    await updateWorksheetStatus(worksheetId, 'reviewing')
  }

  // 明确边界：本功能面向纯答案页 PDF，疑似完整 PDF（题干+答案）时提示重新裁剪上传
  let warning = null
  if (parsedAnswers.length === 0) {
    warning = '未能解析出任何答案，请确认上传的是纯答案页 PDF。'
  } else if (ocrTruncatedInfo) {
    warning = `PDF 共 ${ocrTruncatedInfo.totalPages} 页，仅识别了前 ${ocrTruncatedInfo.ocrPages} 页。若答案位于文件末尾，请裁剪为纯答案页后重新上传。`
  } else if (!markerFound && lowConfidence.length > parsedAnswers.length * 0.5) {
    warning = '未检测到"参考答案"标记，且低置信度条目偏多，可能混入了题干内容。建议裁剪为纯答案页后重新上传。'
  }

  await updateWorksheetParseStatus(worksheetId, {
    status: 'done',
    count: parsedAnswers.length,
    warning,
  })
}

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

async function ocrExtractAnswers(base64Image, lowConfidence = []) {
  const { content } = await callVisionCompletion({
    imageDataURL: `data:image/jpeg;base64,${base64Image}`,
    systemPrompt: '你是一个作业答案识别助手。请从图片中提取所有题号和对应答案。只输出题号和答案，每行一个，格式如“1. A”或“13. 2017”。',
    userText: '请提取这份练习册答案中的所有题号和对应答案。',
    temperature: 0.1,
    maxTokens: 4096,
  })

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
