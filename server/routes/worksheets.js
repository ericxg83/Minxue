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
import { ossClient } from '../config/oss.js'
import { extractPdfText, renderPdfToJpegs } from '../services/pdfService.js'
import { callVisionCompletion } from '../config/ai.js'
import { parseAnswerText, normalizeSectionName } from '../services/answerParseService.js'

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
    const precomputedAnswersRaw = req.body.precomputed_answers

    if (!file && !precomputedAnswersRaw) {
      return res.status(400).json({ error: '请上传 PDF 文件或预埋答案' })
    }

    if (worksheet.parse_status === 'parsing') {
      return res.status(409).json({ error: '该练习册正在解析中，请稍候' })
    }

    let precomputedAnswers = null
    if (precomputedAnswersRaw) {
      try {
        const parsed = JSON.parse(precomputedAnswersRaw)
        if (!Array.isArray(parsed)) throw new Error('格式错误')
        // 验证每项结构：{ question_no, answer, answer_type?, section?, content? }
        precomputedAnswers = parsed.filter(a =>
          a && typeof a.question_no !== 'undefined' && typeof a.answer !== 'undefined'
        ).map(a => ({
          question_no: parseInt(a.question_no, 10),
          answer: String(a.answer),
          answer_type: a.answer_type || 'answer',
          section: normalizeSectionName(a.section),
          content: (a.content != null && String(a.content).trim()) ? String(a.content).trim() : null, // 题干（若提供）
          confidence: 1.0, // 预埋答案置信度最高
        }))
      } catch (e) {
        return res.status(400).json({ error: '预埋答案格式错误，应为 JSON 数组' })
      }
    }

    // 文件已收到：先告知前端上传成功，解析在后台进行，前端轮询 parse_status
    await updateWorksheetParseStatus(worksheetId, { status: 'parsing' })
    res.json({ success: true, parsing: true, message: '上传成功，解析已开始' })

    if (precomputedAnswers && !file) {
      // 纯预埋答案模式：无需 PDF，直接保存
      parsePrecomputedInBackground(worksheetId, precomputedAnswers).catch(async (e) => {
        console.error('预埋答案保存失败:', e)
        await updateWorksheetParseStatus(worksheetId, {
          status: 'failed',
          error: e.message || '未知错误',
        }).catch(() => {})
      })
    } else {
      // 需要 PDF 解析（可能同时有预埋答案作为辅助）
      parsePdfInBackground(worksheetId, file, precomputedAnswers).catch(async (e) => {
        console.error('PDF 后台解析失败:', e)
        await updateWorksheetParseStatus(worksheetId, {
          status: 'failed',
          error: e.message || '未知错误',
        }).catch(() => {})
      })
    }
  } catch (e) {
    res.status(500).json({ error: 'PDF 解析失败: ' + e.message })
  }
})

// 图片答案上传：直接用视觉模型 OCR，不走 PDF 渲染步骤，更清晰更准
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 单张 20MB
})

router.post('/:id/parse-images', imageUpload.array('files', 30), async (req, res) => {
  try {
    const worksheetId = req.params.id
    const worksheet = await getWorksheetById(worksheetId)
    if (!worksheet) return res.status(404).json({ error: '练习册不存在' })

    const files = req.files
    if (!files || files.length === 0) return res.status(400).json({ error: '请上传至少一张图片' })
    if (worksheet.parse_status === 'parsing') {
      return res.status(409).json({ error: '该练习册正在解析中，请稍候' })
    }

    // 校验图片格式
    for (const f of files) {
      if (!IMAGE_MIME_TYPES.includes(f.mimetype)) {
        return res.status(400).json({ error: `不支持的文件格式: ${f.originalname}（仅支持 JPEG/PNG/WebP）` })
      }
    }

    await updateWorksheetParseStatus(worksheetId, { status: 'parsing' })
    res.json({ success: true, parsing: true, message: '上传成功，解析已开始' })

    parseImagesInBackground(worksheetId, files).catch(async (e) => {
      console.error('图片后台解析失败:', e)
      await updateWorksheetParseStatus(worksheetId, {
        status: 'failed',
        error: e.message || '未知错误',
      }).catch(() => {})
    })
  } catch (e) {
    res.status(500).json({ error: '图片解析失败: ' + e.message })
  }
})

async function parseImagesInBackground(worksheetId, files) {
  const OVERALL_TIMEOUT = 10 * 60 * 1000
  let overallTimer
  const timeoutPromise = new Promise((_, reject) => {
    overallTimer = setTimeout(() => reject(new Error(`图片解析整体超时（>${OVERALL_TIMEOUT / 1000}s）`)), OVERALL_TIMEOUT)
  })

  try {
    await Promise.race([
      doParseImages(worksheetId, files),
      timeoutPromise,
    ])
  } catch (e) {
    console.error('图片后台解析失败:', e)
    await updateWorksheetParseStatus(worksheetId, {
      status: 'failed',
      error: e.message || '未知错误',
    }).catch(() => {})
  } finally {
    clearTimeout(overallTimer)
  }
}

async function doParseImages(worksheetId, files) {
  const lowConfidence = []
  // OCR 并行执行（AI 并发由 withAiLimit 全局控制），但解析必须按页顺序进行：
  // 章节标题只出现在首页，后续页答案要延续上一页的章节，否则会落到 section=null
  // 与其它章节的同题号互相覆盖。
  const ocrContents = await Promise.all(
    files.map(f => ocrExtractRawText(f.buffer.toString('base64')))
  )
  const parsedAnswers = []
  let carrySection = null
  for (const content of ocrContents) {
    const { answers, lastSection } = parseAnswerText(content, lowConfidence, carrySection)
    parsedAnswers.push(...answers)
    carrySection = lastSection
  }

  await processOcrResults(worksheetId, parsedAnswers, {
    lowConfidence,
    sourceLabel: '图片',
  })
}

async function parsePdfInBackground(worksheetId, file, precomputedAnswers = null) {
  // 整体超时兜底：OCR 兜底走 AI 单页 2 分钟 * 20 页上限，给 5 分钟防止无限等待
  const OVERALL_TIMEOUT = 10 * 60 * 1000
  let overallTimer
  const timeoutPromise = new Promise((_, reject) => {
    overallTimer = setTimeout(() => reject(new Error(`PDF 解析整体超时（>${OVERALL_TIMEOUT / 1000}s）`)), OVERALL_TIMEOUT)
  })

  try {
    await Promise.race([
      doParse(worksheetId, file, precomputedAnswers),
      timeoutPromise,
    ])
  } catch (e) {
    console.error('PDF 后台解析失败:', e)
    await updateWorksheetParseStatus(worksheetId, {
      status: 'failed',
      error: e.message || '未知错误',
    }).catch(() => {})
  } finally {
    clearTimeout(overallTimer)
  }
}

async function parsePrecomputedInBackground(worksheetId, precomputedAnswers) {
  try {
    await processOcrResults(worksheetId, precomputedAnswers, {
      markerFound: false,
      lowConfidence: [],
      sourceLabel: '预埋答案',
    })
  } catch (e) {
    console.error('预埋答案保存失败:', e)
    await updateWorksheetParseStatus(worksheetId, {
      status: 'failed',
      error: e.message || '未知错误',
    }).catch(() => {})
  }
}

async function doParse(worksheetId, file, precomputedAnswers = null) {
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
    parsedAnswers = parseAnswerText(markerFound ? answerSection : fullText, lowConfidence).answers
    if (markerFound && parsedAnswers.length === 0) {
      // 标记词切分后无结果（可能切错位置），退回全文解析
      parsedAnswers = parseAnswerText(fullText, lowConfidence).answers
    }
  }

  if (parsedAnswers.length === 0) {
    try {
      // 扫描版 PDF：逐页渲染成图片后走视觉模型 OCR
      const { images, totalPages } = await renderPdfToJpegs(file.buffer, { maxPages: 20, scale: 3 })
      if (totalPages > images.length) {
        ocrTruncatedInfo = { totalPages, ocrPages: images.length }
        console.log(`PDF 共 ${totalPages} 页，仅 OCR 前 ${images.length} 页`)
      }
      // OCR 并行，解析按页顺序（章节跨页延续，见 doParseImages 说明）
      const ocrContents = await Promise.all(
        images.map(img => ocrExtractRawText(img.toString('base64')))
      )
      let carrySection = null
      for (const content of ocrContents) {
        const { answers, lastSection } = parseAnswerText(content, lowConfidence, carrySection)
        parsedAnswers.push(...answers)
        carrySection = lastSection
      }
    } catch (e) {
      console.log('OCR fallback failed:', e.message)
    }
  }

  // 若有预埋答案，以预埋答案为准（置信度最高，覆盖 OCR 结果）
  if (precomputedAnswers && precomputedAnswers.length > 0) {
    const precomputedMap = new Map()
    for (const a of precomputedAnswers) {
      const key = (a.section || '') + '|' + a.question_no
      precomputedMap.set(key, a)
    }
    // 用预埋答案替换同题号的 OCR 结果
    const merged = [...parsedAnswers]
    for (const [key, pa] of precomputedMap) {
      const idx = merged.findIndex(a => (a.section || '') + '|' + a.question_no === key)
      if (idx >= 0) {
        merged[idx] = { ...merged[idx], ...pa, confidence: 1.0 }
      } else {
        merged.push(pa)
      }
    }
    parsedAnswers = merged
  }

  // 共享去重、保存、状态更新逻辑
  await processOcrResults(worksheetId, parsedAnswers, {
    ocrTruncatedInfo,
    markerFound,
    lowConfidence,
    sourceLabel: 'PDF',
  })
}

/**
 * 共享的去重 + 保存 + 状态更新 + 生成警告
 * @param {string} worksheetId
 * @param {Array} parsedAnswers - 原始解析结果数组
 * @param {Object} [options]
 * @param {Object} [options.ocrTruncatedInfo] - { totalPages, ocrPages }，有值表示文件被截断
 * @param {boolean} [options.markerFound] - PDF 文本模式是否找到"参考答案"标记
 * @param {Array} [options.lowConfidence] - 低置信度条目列表
 * @param {string} [options.sourceLabel] - 来源标签（"PDF"或"图片"），用于错误提示
 */
async function processOcrResults(worksheetId, parsedAnswers, options = {}) {
  const { ocrTruncatedInfo, markerFound, lowConfidence = [], sourceLabel = '文件' } = options

  // 按 (章节, 题号) 去重：同一章节内保留置信度高的，相同则保留靠后的
  const byKey = new Map()
  for (const a of parsedAnswers) {
    const key = (a.section || '') + '|' + a.question_no
    const prev = byKey.get(key)
    if (!prev || a.confidence >= prev.confidence) byKey.set(key, a)
  }
  parsedAnswers = [...byKey.values()].sort((a, b) => {
    const sa = a.section || ''
    const sb = b.section || ''
    if (sa !== sb) return sa.localeCompare(sb, 'zh')
    return a.question_no - b.question_no
  })

  if (parsedAnswers.length > 0) {
    // 事务性替换：先清空旧答案再插入，避免并发解析产生重复行
    await replaceWorksheetAnswers(worksheetId, parsedAnswers)
    await updateWorksheetAnswerCount(worksheetId)
    await updateWorksheetStatus(worksheetId, 'reviewing')
  }

  // 生成警告提示
  let warning = null
  if (parsedAnswers.length === 0) {
    warning = `未能解析出任何答案，请确认上传的是纯答案页${sourceLabel}。`
  } else if (ocrTruncatedInfo) {
    warning = `${sourceLabel}共 ${ocrTruncatedInfo.totalPages} 页，仅识别了前 ${ocrTruncatedInfo.ocrPages} 页。若答案位于文件末尾，请裁剪为纯答案页后重新上传。`
  } else if (!markerFound && lowConfidence.length > parsedAnswers.length * 0.5) {
    warning = `未检测到"参考答案"标记，且低置信度条目偏多，可能混入了题干内容。建议裁剪为纯答案页后重新上传。`
  }

  await updateWorksheetParseStatus(worksheetId, {
    status: 'done',
    count: parsedAnswers.length,
    warning,
  })
}

async function ocrExtractRawText(base64Image) {
  const { content } = await callVisionCompletion({
    imageDataURL: `data:image/jpeg;base64,${base64Image}`,
    systemPrompt: '你是一个作业答案识别助手。请从图片中提取所有题号和对应答案。重要：每行只能输出一个题号和它的答案，绝对不要在一行输出多个答案（如"1. A 2. B 3. C"是错误的）。格式如"1. A"或"13. 2017"。判断题答案请输出 √ 或 ×。如果图片包含章节标题（如"第一章阶段练1"或"第二章评价测试卷"），请在对应答案前单独一行输出完整章节标题，不要省略、不要与答案同行。',
    userText: '请提取这份练习册答案中的所有题号和对应答案。',
    temperature: 0.0,
    maxTokens: 4096,
  })
  return content || ''
}

router.get('/:id/pdf', async (req, res) => {
  try {
    const worksheet = await getWorksheetById(req.params.id)
    if (!worksheet || !worksheet.pdf_url) {
      return res.status(404).json({ error: 'PDF 不存在' })
    }
    const url = new URL(worksheet.pdf_url)
    const ossPath = url.pathname.slice(1) // 去掉开头的 /
    const result = await ossClient.get(ossPath)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'inline')
    res.setHeader('X-Frame-Options', 'SAMEORIGIN')
    res.send(result.content)
  } catch (e) {
    res.status(500).json({ error: 'PDF 获取失败: ' + e.message })
  }
})

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
