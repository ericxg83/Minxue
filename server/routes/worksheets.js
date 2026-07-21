import { Router } from 'express'
import multer from 'multer'
import {
  createWorksheet,
  getAllWorksheets,
  getWorksheetById,
  updateWorksheetStatus,
  updateWorksheetPdfUrl,
  updateWorksheetQuestionPdfUrl,
  updateWorksheetParseStatus,
  updateWorksheetParseProgress,
  updateWorksheetAnswerCount,
  deleteWorksheet,
  replaceWorksheetAnswers,
  clearWorksheetAnswers,
  upsertWorksheetAnswers,
  getWorksheetAnswers,
  updateWorksheetAnswer,
  getStudentWorksheetSetting,
  upsertStudentWorksheetSetting,
} from '../services/neonService.js'
import { uploadPDF } from '../services/ossService.js'
import { ossClient } from '../config/oss.js'
import { extractPdfText, renderPdfToJpegs, getPdfPageCount } from '../services/pdfService.js'
import { callVisionCompletion } from '../config/ai.js'
import { parseAnswerText, normalizeSectionName } from '../services/answerParseService.js'

const router = Router()
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
})

// 解析卡死判定：后台解析是路由进程内的内存任务，10 分钟超时兜底也是内存态的，
// 服务器重启/OOM 后 parse_status 会永远停在 'parsing'，导致重新上传被 409 永久拒绝。
// 进程内超时为 10 分钟，updated_at 超过 12 分钟仍是 'parsing' 说明解析进程已死，
// 放行新的解析请求。
const STALE_PARSING_MS = 12 * 60 * 1000
const isParsingStale = (worksheet) => {
  const t = new Date(worksheet.updated_at || 0).getTime()
  return !t || Date.now() - t > STALE_PARSING_MS
}

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
    const isCombined = req.body.is_combined === 'true'

    if (!file && !precomputedAnswersRaw) {
      return res.status(400).json({ error: '请上传 PDF 文件或预埋答案' })
    }

    if (worksheet.parse_status === 'parsing' && !isParsingStale(worksheet)) {
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
    // 进度列同时清零：避免重新解析时上一轮的"45/45 页"残留被前端短暂读到
    await updateWorksheetParseStatus(worksheetId, { status: 'parsing' })
    await updateWorksheetParseProgress(worksheetId, {})
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
      parsePdfInBackground(worksheetId, file, precomputedAnswers, isCombined).catch(async (e) => {
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

// 上传题目PDF（单独上传，不触发解析）
router.post('/:id/question-pdf', pdfUpload.single('file'), async (req, res) => {
  try {
    const worksheetId = req.params.id
    const worksheet = await getWorksheetById(worksheetId)
    if (!worksheet) return res.status(404).json({ error: '练习册不存在' })

    const file = req.file
    if (!file) return res.status(400).json({ error: '请上传 PDF 文件' })

    const pdfUrl = await uploadPDF(file.buffer, file.originalname, 'system')
    await updateWorksheetQuestionPdfUrl(worksheetId, pdfUrl)

    res.json({ success: true, message: '题目PDF上传成功' })
  } catch (e) {
    res.status(500).json({ error: '题目PDF上传失败: ' + e.message })
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
    if (worksheet.parse_status === 'parsing' && !isParsingStale(worksheet)) {
      return res.status(409).json({ error: '该练习册正在解析中，请稍候' })
    }

    // 校验图片格式
    for (const f of files) {
      if (!IMAGE_MIME_TYPES.includes(f.mimetype)) {
        return res.status(400).json({ error: `不支持的文件格式: ${f.originalname}（仅支持 JPEG/PNG/WebP）` })
      }
    }

    await updateWorksheetParseStatus(worksheetId, { status: 'parsing' })
    await updateWorksheetParseProgress(worksheetId, {}) // 清除上一轮 PDF 分批解析的进度残留
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
  const ocrFailedPages = []
  const ocrContents = await Promise.all(
    files.map((f, i) => ocrExtractSafe(f.buffer.toString('base64'), i, ocrFailedPages))
  )
  if (ocrFailedPages.length === files.length) {
    throw new Error(`全部 ${files.length} 页 OCR 识别失败（AI 服务可能暂时不可用），请稍后重试`)
  }
  const parsedAnswers = []
  let carrySection = null
  for (const content of ocrContents) {
    const { answers, lastSection } = parseAnswerText(content, lowConfidence, carrySection)
    parsedAnswers.push(...answers)
    carrySection = lastSection
  }

  await processOcrResults(worksheetId, parsedAnswers, {
    lowConfidence,
    ocrFailedPages,
    sourceLabel: '图片',
  })
}

async function parsePdfInBackground(worksheetId, file, precomputedAnswers = null, isCombined = false) {
  // 不再设整体超时：大文件分批解析总时长可达数十分钟且无固定上界，固定整体超时会误杀。
  // 卡死防护改为三层：单页渲染/加载 30s 超时（pdfService.withTimeout）
  // + 单批 5 分钟超时（doParseOcrBatched 内 withBatchTimeout）
  // + 进程级 stale 恢复（每批结束写进度刷新 updated_at，超 12/15 分钟由路由守卫和 pendingTaskRecovery 兜底）
  try {
    await doParse(worksheetId, file, precomputedAnswers, isCombined)
  } catch (e) {
    console.error('PDF 后台解析失败:', e)
    await updateWorksheetParseStatus(worksheetId, {
      status: 'failed',
      error: e.message || '未知错误',
    }).catch(() => {})
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

async function doParse(worksheetId, file, precomputedAnswers = null, isCombined = false) {
  const pdfUrl = await uploadPDF(file.buffer, file.originalname, 'system')
  await updateWorksheetPdfUrl(worksheetId, pdfUrl)

  // 合并模式：同一份 PDF 同时作为题目和答案源
  if (isCombined) {
    await updateWorksheetQuestionPdfUrl(worksheetId, pdfUrl)
  }

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
  const ocrFailedPages = []
  let ocrPagesTried = 0

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
    // 扫描版 PDF：先探明总页数，决定单趟还是分批
    let totalPages = 0
    try {
      totalPages = await getPdfPageCount(file.buffer)
    } catch (e) {
      console.log('PDF 页数读取失败，回退单趟 OCR:', e.message)
    }

    if (totalPages > OCR_BATCH_SIZE) {
      // 大文件：每 15 页一批串行解析、增量写库、页级进度（内部完成全部保存与状态收尾）
      await doParseOcrBatched(worksheetId, file.buffer, totalPages, precomputedAnswers)
      return
    }

    try {
      // 小文件（≤15 页）或页数读取失败：沿用单趟逻辑（渲染全部→并行 OCR→一次性写库）
      const { images, totalPages: renderedTotal } = await renderPdfToJpegs(file.buffer, { maxPages: OCR_BATCH_SIZE, scale: 3 })
      if (renderedTotal > images.length) {
        ocrTruncatedInfo = { totalPages: renderedTotal, ocrPages: images.length }
        console.log(`PDF 共 ${renderedTotal} 页，仅 OCR 前 ${images.length} 页`)
      }
      // OCR 并行，解析按页顺序（章节跨页延续，见 doParseImages 说明）
      ocrPagesTried = images.length
      const ocrContents = await Promise.all(
        images.map((img, i) => ocrExtractSafe(img.toString('base64'), i, ocrFailedPages))
      )
      let carrySection = null
      for (const content of ocrContents) {
        const { answers, lastSection } = parseAnswerText(content, lowConfidence, carrySection)
        parsedAnswers.push(...answers)
        carrySection = lastSection
      }
    } catch (e) {
      console.log('OCR fallback failed:', e.message)
      // 渲染失败时抛出让上层 catch 设置 parse_status='failed'，避免 silent 走到 done+0 误导用户
      throw e
    }
  }

  // 全部 OCR 页都失败时按解析失败处理（可重试），而不是 done + 0 条误导用户
  if (parsedAnswers.length === 0 && ocrPagesTried > 0 && ocrFailedPages.length === ocrPagesTried) {
    throw new Error(`全部 ${ocrPagesTried} 页 OCR 识别失败（AI 服务可能暂时不可用），请稍后重试`)
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
    ocrFailedPages,
    sourceLabel: 'PDF',
  })
}

// ── 大 PDF 分批 OCR 解析 ──
// 超过 15 页的扫描版 PDF 按 15 页/批串行处理：每批渲染→并行 OCR→解析→立即增量写库，
// 批间由 renderPdfToJpegs 内部 doc.destroy() 彻底释放 pdfjs 缓存与 canvas，内存峰值 = 单批。
// 中断（进程崩溃/单批超时）时已写库的批次保留；重新解析会先 clearWorksheetAnswers 重来。
const OCR_BATCH_SIZE = 15
const MAX_TOTAL_PAGES = 300 // 安全上限：防误传超大文档导致费用/时长失控，超出部分不解析并警告
const BATCH_TIMEOUT_MS = 5 * 60 * 1000 // 单批超时：约束单批（工作量恒定 ≤15 页）而非全程，总时长天然有界

const withBatchTimeout = (promise, ms, label) => {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

// 渲染并 OCR 一个批次（startPage..endPage，1-based 闭区间），返回解析出的答案与批末章节
async function processOcrBatch(fileBuffer, startPage, endPage, carrySection, lowConfidence, ocrFailedPages) {
  let { images } = await renderPdfToJpegs(fileBuffer, {
    scale: 3,
    startPage,
    endPage,
    maxPages: OCR_BATCH_SIZE,
  })
  const ocrContents = await Promise.all(
    // startPage - 1 + i：ocrExtractSafe 内部 push pageIndex+1，此处换算为真实页号
    images.map((img, i) => ocrExtractSafe(img.toString('base64'), startPage - 1 + i, ocrFailedPages))
  )
  images = null // 断引用：JPEG buffer 不与 OCR 文本同时存活到解析阶段，下一批分配大对象时可被回收

  const answers = []
  let section = carrySection
  for (const content of ocrContents) {
    const parsed = parseAnswerText(content, lowConfidence, section)
    answers.push(...parsed.answers)
    section = parsed.lastSection
  }
  return { answers, lastSection: section }
}

async function doParseOcrBatched(worksheetId, fileBuffer, totalPages, precomputedAnswers) {
  const effectivePages = Math.min(totalPages, MAX_TOTAL_PAGES)
  // 进度初始化在清库之前：这条 UPDATE 同时是"取页数+清库"阶段的 stale 心跳
  await updateWorksheetParseProgress(worksheetId, { totalPages: effectivePages, donePages: 0 })
  // 增量写入前清一次场（替代 replaceWorksheetAnswers 的 DELETE 半段，此后每批只追加）
  await clearWorksheetAnswers(worksheetId)

  const lowConfidence = []
  const ocrFailedPages = [] // 跨批累积，存真实页号
  let carrySection = null // 章节标题跨批延续（与跨页延续同一机制）
  let ocrPagesTried = 0
  let anySaved = false

  for (let start = 1; start <= effectivePages; start += OCR_BATCH_SIZE) {
    const end = Math.min(start + OCR_BATCH_SIZE - 1, effectivePages)
    console.log(`[分批解析] worksheet=${worksheetId} 第 ${start}-${end} 页 / 共 ${effectivePages} 页`)
    const batch = await withBatchTimeout(
      processOcrBatch(fileBuffer, start, end, carrySection, lowConfidence, ocrFailedPages),
      BATCH_TIMEOUT_MS,
      `第 ${start}-${end} 页解析超时（单批超过 ${BATCH_TIMEOUT_MS / 60000} 分钟）`
    )
    carrySection = batch.lastSection
    ocrPagesTried += end - start + 1

    // 增量写库：本批答案立即落库，之后即使中断，已完成批次也不丢失
    if (batch.answers.length > 0) {
      await upsertWorksheetAnswers(worksheetId, dedupeAnswers(batch.answers))
      anySaved = true
    }
    // 每批结束写进度：前端进度条数据源，同时经 updated_at 触发器刷新 stale 卡死判定的心跳
    await updateWorksheetParseProgress(worksheetId, { totalPages: effectivePages, donePages: end })
  }

  // 全部 OCR 页都失败时按解析失败处理（可重试），与单趟路径语义一致
  if (!anySaved && ocrPagesTried > 0 && ocrFailedPages.length === ocrPagesTried) {
    throw new Error(`全部 ${ocrPagesTried} 页 OCR 识别失败（AI 服务可能暂时不可用），请稍后重试`)
  }

  // 预埋答案最后统一 upsert：同 (章节|题号) 覆盖 OCR 结果（置信度最高），新题号追加。
  // 先去重：用户提供的 JSON 可能含重复题号，INSERT 前必须保证批内 key 唯一
  if (precomputedAnswers && precomputedAnswers.length > 0) {
    await upsertWorksheetAnswers(worksheetId, dedupeAnswers(precomputedAnswers))
    anySaved = true
  }

  let count = 0
  if (anySaved) {
    // 必须从 DB 实际 count：跨批 ON CONFLICT 覆盖会让各批行数之和虚高
    const updated = await updateWorksheetAnswerCount(worksheetId)
    count = updated?.answer_count || 0
    await updateWorksheetStatus(worksheetId, 'reviewing')
  }

  const warnings = []
  if (count === 0) {
    warnings.push('未能解析出任何答案，请确认上传的是纯答案页PDF。')
  } else {
    if (ocrFailedPages.length > 0) {
      warnings.push(`第 ${ocrFailedPages.join('、')} 页 OCR 识别失败，对应页答案缺失，建议重新上传补齐。`)
    }
    if (totalPages > MAX_TOTAL_PAGES) {
      warnings.push(`PDF 共 ${totalPages} 页，超过 ${MAX_TOTAL_PAGES} 页解析上限，仅解析了前 ${MAX_TOTAL_PAGES} 页。`)
    }
    if (warnings.length === 0 && lowConfidence.length > count * 0.5) {
      warnings.push('低置信度条目偏多，可能混入了题干内容。建议裁剪为纯答案页后重新上传。')
    }
  }

  await updateWorksheetParseStatus(worksheetId, {
    status: 'done',
    count,
    warning: warnings.length > 0 ? warnings.join('；') : null,
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
 * @param {Array<number>} [options.ocrFailedPages] - OCR 失败的页码列表（部分失败时生成警告）
 * @param {string} [options.sourceLabel] - 来源标签（"PDF"或"图片"），用于错误提示
 */
// 按 (章节, 题号) 去重：同一章节内保留置信度高的，相同则保留靠后的；再按章节、题号排序。
// 单趟路径全量使用；分批路径批内使用（跨批同 key 由 upsert 的 ON CONFLICT 兜住，后批覆盖）
function dedupeAnswers(parsedAnswers) {
  const byKey = new Map()
  for (const a of parsedAnswers) {
    const key = (a.section || '') + '|' + a.question_no
    const prev = byKey.get(key)
    if (!prev || a.confidence >= prev.confidence) byKey.set(key, a)
  }
  return [...byKey.values()].sort((a, b) => {
    const sa = a.section || ''
    const sb = b.section || ''
    if (sa !== sb) return sa.localeCompare(sb, 'zh')
    return a.question_no - b.question_no
  })
}

async function processOcrResults(worksheetId, parsedAnswers, options = {}) {
  const { ocrTruncatedInfo, markerFound, lowConfidence = [], ocrFailedPages = [], sourceLabel = '文件' } = options

  parsedAnswers = dedupeAnswers(parsedAnswers)

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
  } else if (ocrFailedPages.length > 0) {
    warning = `第 ${ocrFailedPages.join('、')} 页 OCR 识别失败，对应页答案缺失，建议重新上传补齐。`
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

// 单页 OCR 容错：一页失败不再连坐整批（此前 Promise.all 一页 reject 即丢弃全部页结果）
async function ocrExtractSafe(base64Image, pageIndex, failedPages) {
  try {
    return await ocrExtractRawText(base64Image)
  } catch (e) {
    console.error(`第 ${pageIndex + 1} 页 OCR 失败:`, e.message)
    failedPages.push(pageIndex + 1)
    return ''
  }
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

// 获取题目PDF（代理 OSS，绕过 CDN 头限制）
router.get('/:id/question-pdf', async (req, res) => {
  try {
    const worksheet = await getWorksheetById(req.params.id)
    if (!worksheet || !worksheet.question_pdf_url) {
      return res.status(404).json({ error: '题目PDF 不存在' })
    }
    const url = new URL(worksheet.question_pdf_url)
    const ossPath = url.pathname.slice(1)
    const result = await ossClient.get(ossPath)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'inline')
    res.setHeader('X-Frame-Options', 'SAMEORIGIN')
    res.send(result.content)
  } catch (e) {
    res.status(500).json({ error: '题目PDF 获取失败: ' + e.message })
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
