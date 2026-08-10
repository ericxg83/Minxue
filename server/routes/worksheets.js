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
  clearResourceUnits,
  upsertWorksheetAnswers,
  upsertResourceUnitPageRanges,
  getWorksheetAnswers,
  updateWorksheetAnswer,
  getStudentWorksheetSetting,
  upsertStudentWorksheetSetting,
} from '../services/neonService.js'
import { uploadPDF, uploadImage } from '../services/ossService.js'
import { ossClient } from '../config/oss.js'
import { extractPdfText, renderPdfToJpegs, getPdfPageCount } from '../services/pdfService.js'
import { callVisionCompletion } from '../config/ai.js'
import { parseAnswerText, normalizeSectionName, parseUnitHeader, normLesson } from '../services/answerParseService.js'
import {
  diagnoseWorksheet,
  listSuspectWorksheets,
  fixWorksheet,
  scanDirtyQuestionTypes,
  fixDirtyQuestionTypes,
} from '../services/worksheetFixService.js'
import { regradeTaskPageWithUnit } from '../services/worksheetPageService.js'
import { query as pgQuery } from '../config/neon.js'
const query = pgQuery

const router = Router()
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB：scanned PDF 可能很大，后台会用 doParseOcrBatched 分批处理
})

// 课时编号归一化：从 answerParseService 复用（压空白 + 全角→半角括号），
// 预埋答案 lesson_code 入口用
const normLessonForPrecomputed = normLesson

// 预埋答案 answer_type 缺省时按答案形态推断：单字母 A-D 视为选择，√× 视为判断。
// 与 answerParseService.JUDGE_SYMBOL_RE 保持一致
const JUDGE_SYMBOL_RE = /^[✓√✔✗✘×]$/

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

// ────────── 修复『试卷①/②/③ 错挂到父章节』一键接口 ──────────
// ⚠️ 必须放在 /:id/* 路由之前：避免 POST /:id/fix-exam-units 把 /fix-exam-units 抢走
// 根因：parseUnitHeader 之前漏识别试卷类标题（已 commit 3dc63df 修复）。
//       本组端点用于重跑 OCR 修正已入库的错挂数据。
// 调用方：PC 后台 → 练习册管理 → "修复试卷单元" 按钮

// 列出所有真嫌疑 worksheet（GET 同步返回，便于后台直接展示）
router.get('/fix-exam-units/suspects', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 500)
    const suspects = await listSuspectWorksheets(limit)
    res.json({ success: true, count: suspects.length, suspects })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 单个 worksheet 诊断（不带 OCR 重跑，看 suspect 列表）
//   GET /api/worksheets/:id/fix-exam-units/diagnose  → 已存在，不动
// 下面是面向 self-test 的：直接把 diagnoseWorksheet 的结果 JSON 化
router.get('/fix-exam-units/diagnose/:worksheetId', async (req, res) => {
  try {
    const d = await diagnoseWorksheet(req.params.worksheetId)
    res.json({
      success: true,
      name: d.w.name,
      units_count: d.units.length,
      exam_unit_count: d.examUnitCount,
      suspects: d.suspects.map(s => ({
        unit_id: s.id, unit_key: s.unit_key, unit_title: s.unit_title,
        lesson_code: s.lesson_code, ans_count: parseInt(s.ans_count, 10),
      })),
      big_chapters: (d.bigChapters || []).map(s => ({
        unit_id: s.id, unit_key: s.unit_key, unit_title: s.unit_title, ans_count: parseInt(s.ans_count, 10),
      })),
      units: d.units.map(u => ({
        unit_id: u.id, unit_key: u.unit_key, unit_title: u.unit_title,
        lesson_code: u.lesson_code, ans_count: parseInt(u.ans_count, 10),
      })),
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 自测：列所有 worksheet 的 unit 分布 + 嫌疑原因（不筛任何东西，调试用）
//   GET /api/worksheets/fix-exam-units/selftest
router.get('/fix-exam-units/selftest', async (req, res) => {
  try {
    // 1) 跑 listSuspectWorksheets 看返回什么
    const suspects = await listSuspectWorksheets(200)
    // 2) raw SQL：列出每个 worksheet 的所有 unit_key（不筛）和每条答案数
    const { rows: raw } = await query(
      `SELECT w.id, w.name,
              u.unit_key,
              u.unit_title,
              (SELECT COUNT(*) FROM worksheet_answers wa WHERE wa.unit_id = u.id)::int AS ans_count
       FROM worksheets w
       LEFT JOIN resource_units u ON u.resource_id = w.id
       WHERE w.pdf_url IS NOT NULL
       ORDER BY w.created_at DESC, u.unit_seq NULLS LAST, u.id ASC`
    )
    // 3) 聚合成 worksheet -> units
    const byWs = new Map()
    for (const r of raw) {
      if (!byWs.has(r.id)) byWs.set(r.id, { id: r.id, name: r.name, units: [] })
      const k = r.unit_key || ''
      const a = r.ans_count || 0
      byWs.get(r.id).units.push({ unit_key: k, unit_title: r.unit_title, ans_count: a })
    }
    const all = [...byWs.values()].map((w) => {
      // 分类统计
      let exam = 0, chapterMax = 0, chapterAns = 0, practiceAns = 0, orphanAns = 0, total = 0
      const orphanUnitKeys = []
      const bigChapterUnitKeys = []
      for (const u of w.units) {
        const k = u.unit_key || ''
        total += u.ans_count
        if (k.startsWith('试卷')) exam++
        else if (/^第[一二三四五六七八九十\d]+[章节]/.test(k)) {
          chapterAns += u.ans_count
          if (u.ans_count > chapterMax) chapterMax = u.ans_count
          if (u.ans_count >= 10) bigChapterUnitKeys.push(`${k}=${u.ans_count}`)
        } else if (/^(堂堂练|课课练|课时练|随堂练|同步练|课时作业|课后练)/.test(k)) {
          practiceAns += u.ans_count
        } else {
          orphanAns += u.ans_count
          if (u.ans_count > 0) orphanUnitKeys.push(`${k}=${u.ans_count}`)
        }
      }
      return {
        id: w.id, name: w.name,
        exam, chapterMax, chapterAns, practiceAns, orphanAns, total,
        big_chapter_units: bigChapterUnitKeys,
        orphan_unit_keys: orphanUnitKeys,
        is_suspect: orphanAns >= 1 || chapterMax >= 10 || exam >= 1,
      }
    })
    res.json({
      success: true,
      now: new Date().toISOString(),
      suspects_count: suspects.length,
      suspects,
      worksheets_count: all.length,
      worksheets: all,
    })
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack })
  }
})

// 诊断：列出**所有** worksheet 的 unit 分布，便于排查"扫描没结果"的情况
//   GET /api/worksheets/fix-exam-units/debug
// 返回每个 worksheet 的所有 unit 及其答案数（不筛嫌疑）
router.get('/fix-exam-units/debug', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200)
    const { rows } = await query(
      `SELECT w.id, w.name, w.parse_status, w.pdf_url IS NOT NULL AS has_pdf,
              u.id AS unit_id, u.unit_key, u.unit_title, u.lesson_code,
              (SELECT COUNT(*) FROM worksheet_answers wa WHERE wa.unit_id = u.id) AS ans_count
       FROM worksheets w
       LEFT JOIN resource_units u ON u.resource_id = w.id
       WHERE w.pdf_url IS NOT NULL
       ORDER BY w.created_at DESC, u.unit_seq NULLS LAST, u.created_at ASC
       LIMIT $1`,
      [limit * 20]  // 粗略上限：每个 worksheet 平均 20 个 unit
    )
    // 按 worksheet 分组
    const map = new Map()
    for (const r of rows) {
      if (!map.has(r.id)) {
        map.set(r.id, { id: r.id, name: r.name, parse_status: r.parse_status, units: [] })
      }
      if (r.unit_id) {
        map.get(r.id).units.push({
          unit_id: r.unit_id, unit_key: r.unit_key, unit_title: r.unit_title,
          lesson_code: r.lesson_code, ans_count: parseInt(r.ans_count, 10)
        })
      }
    }
    const list = [...map.values()]
    // 每个 worksheet 标注分类
    for (const w of list) {
      let examCount = 0, orphanAns = 0, chapterAns = 0, practiceAns = 0, totalAns = 0
      const orphanUnits = []
      for (const u of w.units) {
        const k = u.unit_key || ''
        const isExam = k.startsWith('试卷')
        const isChapter = /^第[一二三四五六七八九十\d]+[章节]/.test(k)
        const isPractice = /^(堂堂练|课课练|课时练|随堂练|同步练|课时作业|课后练)/.test(k)
        totalAns += u.ans_count
        if (isExam) examCount++
        else if (isChapter) chapterAns += u.ans_count
        else if (isPractice) practiceAns += u.ans_count
        else { orphanAns += u.ans_count; if (u.ans_count > 0) orphanUnits.push(u) }
      }
      w.exam_units = examCount
      w.orphan_ans_count = orphanAns
      w.chapter_ans_count = chapterAns
      w.practice_ans_count = practiceAns
      w.total_ans_count = totalAns
      w.orphan_units = orphanUnits
      w.is_suspect = orphanAns >= 1
    }
    list.sort((a, b) => (b.is_suspect - a.is_suspect) || (b.orphan_ans_count - a.orphan_ans_count))
    res.json({ success: true, count: list.length, worksheets: list })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 修复 question_type 脏数据（OCR 老 prompt 残留"choice/fill/judge/answer"枚举串）
//   POST /api/worksheets/fix-question-types/scan     body: { worksheetId?, limit? }
//   POST /api/worksheets/fix-question-types          body: { worksheetId?, limit?, dryRun? }
//
// 启发式归一（与前端 normalizeType 保持完全一致）：
//   有 options → choice；含 ____ → fill；含对错 → judge；其它 → answer
router.post('/fix-question-types/scan', async (req, res) => {
  try {
    const worksheetId = req.body?.worksheetId || null
    const limit = Math.min(Math.max(parseInt(req.body?.limit || '500', 10) || 500, 1), 5000)
    const data = await scanDirtyQuestionTypes({ worksheetId, limit })
    res.json(data)
  } catch (e) {
    console.error('[fix-question-types/scan] error:', e)
    res.status(500).json({ success: false, error: e.message })
  }
})

router.post('/fix-question-types', async (req, res) => {
  try {
    const worksheetId = req.body?.worksheetId || null
    const limit = Math.min(Math.max(parseInt(req.body?.limit || '1000', 10) || 1000, 1), 10000)
    const dryRun = req.body?.dryRun === true
    const data = await fixDirtyQuestionTypes({ worksheetId, limit, dryRun })
    res.json(data)
  } catch (e) {
    console.error('[fix-question-types] error:', e)
    res.status(500).json({ success: false, error: e.message })
  }
})

// 批量修复所有真嫌疑 worksheet（异步任务 + 轮询日志）
//   POST /api/worksheets/fix-exam-units          body: { dryRun?: boolean, limit?: number }
//   GET  /api/worksheets/fix-exam-units/job/:id  查询任务状态与日志
//   POST /api/worksheets/fix-exam-units/cancel   取消正在执行的任务
//
// 异步原因：单个 worksheet 修复 1-3 分钟，批量 10+ 个会超 HTTP 超时。改为返回 jobId + 轮询。
const _fixJobs = new Map()  // jobId -> { status, logs, results, startedAt, finishedAt }

router.post('/fix-exam-units', async (req, res) => {
  const dryRun = req.body?.dryRun === true
  const limit = Math.min(Math.max(parseInt(req.body?.limit || '20', 10) || 20, 1), 50)
  const jobId = `fx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const job = {
    id: jobId,
    status: 'pending',
    dryRun,
    limit,
    logs: [],
    results: [],
    suspects: [],
    startedAt: Date.now(),
    finishedAt: null,
  }
  _fixJobs.set(jobId, job)
  const onLog = (line) => { job.logs.push(line); console.log(`[${jobId}] ${line}`) }
  onLog(`📋 创建修复任务 ${jobId} (limit=${limit}, dryRun=${dryRun})`)

  // 立即扫描嫌疑，扫描完才决定要不要进队列
  let suspects
  try {
    suspects = await listSuspectWorksheets(limit)
  } catch (e) {
    job.status = 'failed'
    job.finishedAt = Date.now()
    onLog(`❌ 扫描失败: ${e.message}`)
    return res.status(500).json({ success: false, error: e.message, jobId })
  }
  job.suspects = suspects

  if (suspects.length === 0) {
    job.status = 'completed'
    job.finishedAt = Date.now()
    onLog('✅ 未发现需要修复的 worksheet')
    return res.json({ success: true, jobId, status: job.status, count: 0, results: [] })
  }
  onLog(`📋 发现 ${suspects.length} 个真嫌疑 worksheet`)
  for (const s of suspects) onLog(`   - ${s.id}  ${s.name}  (orphan_ans=${s.orphan_ans_count})`)

  if (dryRun) {
    job.status = 'completed'
    job.finishedAt = Date.now()
    onLog('⏸ dry-run 模式：只扫描不修复')
    return res.json({ success: true, jobId, status: job.status, count: suspects.length, suspects, results: [] })
  }

  // 启动后台任务，立即返回 jobId
  job.status = 'running'
  ;(async () => {
    try {
      for (let i = 0; i < suspects.length; i++) {
        if (job._cancelled) {
          onLog('⏸ 任务已被取消')
          break
        }
        const s = suspects[i]
        onLog(`\n${'='.repeat(60)}`)
        onLog(`[${i + 1}/${suspects.length}] ${s.id}  ${s.name}`)
        onLog('='.repeat(60))
        try {
          const r = await fixWorksheet(s.id, { onLog })
          job.results.push({ id: s.id, name: s.name, ok: r.ok, error: r.error || null, skipped: r.skipped || false })
        } catch (e) {
          onLog(`❌ 异常: ${e.message}`)
          job.results.push({ id: s.id, name: s.name, ok: false, error: e.message })
        }
      }
      const ok = job.results.filter(r => r.ok).length
      const failed = job.results.filter(r => !r.ok).length
      onLog(`\n📊 批量修复总结: 成功 ${ok} / 失败 ${failed} / 总计 ${job.results.length}`)
      job.status = job._cancelled ? 'cancelled' : 'completed'
    } catch (e) {
      onLog(`❌ 任务异常: ${e.message}`)
      job.status = 'failed'
    } finally {
      job.finishedAt = Date.now()
    }
  })()

  res.json({ success: true, jobId, status: job.status, count: suspects.length, suspects })
})

// 查询任务状态
router.get('/fix-exam-units/job/:jobId', async (req, res) => {
  const job = _fixJobs.get(req.params.jobId)
  if (!job) return res.status(404).json({ success: false, error: '任务不存在' })
  res.json({
    success: true,
    jobId: job.id,
    status: job.status,
    dryRun: job.dryRun,
    count: job.suspects.length,
    results: job.results,
    logs: job.logs,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  })
})

// 取消任务（标记位，不强杀正在跑的 fixWorksheet）
router.post('/fix-exam-units/cancel', async (req, res) => {
  const { jobId } = req.body || {}
  if (!jobId) return res.status(400).json({ success: false, error: '缺少 jobId' })
  const job = _fixJobs.get(jobId)
  if (!job) return res.status(404).json({ success: false, error: '任务不存在' })
  job._cancelled = true
  res.json({ success: true, jobId, status: job.status })
})

// 单个 worksheet 修复（同样改为异步）
router.post('/fix-one-async', async (req, res) => {
  const worksheetId = req.body?.worksheetId
  if (!worksheetId) return res.status(400).json({ success: false, error: '缺少 worksheetId' })
  const jobId = `fx1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const job = { id: jobId, status: 'running', worksheetId, logs: [], startedAt: Date.now(), finishedAt: null }
  _fixJobs.set(jobId, job)
  const onLog = (line) => { job.logs.push(line); console.log(`[${jobId}] ${line}`) }
  onLog(`📋 启动单 worksheet 修复 ${worksheetId}`)
  ;(async () => {
    try {
      const r = await fixWorksheet(worksheetId, { onLog })
      job.result = { ok: r.ok, error: r.error || null, skipped: r.skipped || false, before: r.before ? { examUnitCount: r.before.examUnitCount, suspectCount: r.before.suspects.length } : null, after: r.after ? { examUnitCount: r.after.examUnitCount, suspectCount: r.after.suspects.length } : null }
      job.status = 'completed'
    } catch (e) {
      onLog(`❌ 异常: ${e.message}`)
      job.status = 'failed'
      job.result = { ok: false, error: e.message }
    } finally {
      job.finishedAt = Date.now()
    }
  })()
  res.json({ success: true, jobId, status: job.status })
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
        // 支持的可选字段：
        //   unit / unit_title  - 单元标题/全名（如"堂堂练① 19.1(1) 算术平方根"）
        //   unit_key           - 单元键（如"堂堂练1|19.1(1)"），未提供时按 unit_title 推导
        //   lesson_code        - 课时编号（如"19.1(1)"），未提供时按 unit_title 推导
        //   sub_no             - 子题号（多空题），字符串如"1"/"2"
        // 之前只透传 section + content，预埋答案的 unit_key 恒为 null，
        // 导致学生页在 pickAnswerUnit 中找不到对应单元，60% 兜底失败则整页判待人工。
        precomputedAnswers = parsed.filter(a =>
          a && typeof a.question_no !== 'undefined' && typeof a.answer !== 'undefined'
        ).map(a => {
          // 1) 优先使用调用方直接给出的 unit_key
          let unitKey = a.unit_key ? String(a.unit_key).trim() : null
          let unitTitle = a.unit_title ? normalizeSectionName(a.unit_title) : null
          let lessonCode = a.lesson_code ? normLessonForPrecomputed(a.lesson_code) : null
          let ordinal = null

          // 2) 否则按 unit / unit_title 走 parseUnitHeader 推导
          //    支持"堂堂练① 19.1(1) 算术平方根" / "第3课时 二次根式的加减"等格式
          if (!unitKey || !unitTitle) {
            const headerSrc = a.unit || a.unit_title
            if (headerSrc) {
              const parsed2 = parseUnitHeader(String(headerSrc))
              if (parsed2) {
                if (!unitKey) unitKey = parsed2.unit_key
                if (!unitTitle) unitTitle = parsed2.unit_title
                if (!lessonCode && parsed2.lesson_code) lessonCode = parsed2.lesson_code
                ordinal = parsed2.ordinal ?? null
              }
            }
          }

          return {
            question_no: parseInt(a.question_no, 10),
            answer: String(a.answer),
            // answer_type 缺省时按答案形态推断：单字母 A-D 视为选择（避免下游 judgeService
            // 走到"数学等价"分支把 'B' vs 'A' 误判为等价：prep 后两表达式都是 0/1，被当成
            // "同变量不同数值"巧合命中。判断题 √× 也单独处理。其它默认 answer（一般题）。
            answer_type: a.answer_type || (JUDGE_SYMBOL_RE.test(String(a.answer).trim())
              ? 'judge'
              : (/^[A-Da-d]$/.test(String(a.answer).trim()) ? 'choice' : 'answer')),
            section: normalizeSectionName(a.section),
            content: (a.content != null && String(a.content).trim()) ? String(a.content).trim() : null,
            unit_key: unitKey || null,
            unit_title: unitTitle || null,
            lesson_code: lessonCode || null,
            ordinal: ordinal,
            sub_no: a.sub_no != null ? String(a.sub_no) : '',
            confidence: 1.0, // 预埋答案置信度最高
          }
        })
      } catch (e) {
        return res.status(400).json({ error: '预埋答案格式错误，应为 JSON 数组' })
      }
    }

    // 文件已收到：先告知前端上传成功，解析在后台进行，前端轮询 parse_status
    // 进度列同时清零：避免重新解析时上一轮的"45/45 页"残留被前端短暂读到
    await updateWorksheetParseStatus(worksheetId, { status: 'parsing' })
    // 进度列清零：避免重新解析时上一轮"45/45 页"残留被前端短暂读到
    // 若列不存在（迁移未跑）也不阻塞上传，静默跳过
    try {
      await updateWorksheetParseProgress(worksheetId, {})
    } catch (progressErr) {
      console.warn('⚠️ 清零解析进度列失败（可能是列不存在，不影响上传）:', progressErr.message)
    }
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
    try {
      await updateWorksheetParseProgress(worksheetId, {}) // 清除上一轮 PDF 分批解析的进度残留
    } catch (progressErr) {
      console.warn('⚠️ 清零解析进度列失败（可能是列不存在，不影响上传）:', progressErr.message)
    }
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
  let carryState = null
  for (const content of ocrContents) {
    const { answers, lastState } = parseAnswerText(content, lowConfidence, carryState)
    parsedAnswers.push(...answers)
    carryState = lastState
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
      // OCR 并行，解析按页顺序（单元跨页延续，见 processOcrBatch 说明）
      ocrPagesTried = images.length
      const ocrContents = await Promise.all(
        images.map((img, i) => ocrExtractFromBuffer(img, i, ocrFailedPages))
      )
      let carryState = null
      for (let i = 0; i < ocrContents.length; i++) {
        // 真实页号 1-based（与分批路径同语义），用于记录每个单元的起止页范围
        const realPage = i + 1
        const { answers, lastState } = parseAnswerText(ocrContents[i], lowConfidence, carryState, realPage)
        parsedAnswers.push(...answers)
        carryState = lastState
      }
      // 收尾：把 lastState.pageRanges 落库到 resource_units.answer_page_start/end
      // 单趟路径末单元 end 兜底为 images.length（OCR 实际页数）
      const singlePassRanges = carryState?.pageRanges
      if (singlePassRanges && singlePassRanges.size > 0) {
        const ranges = []
        for (const [k, r] of singlePassRanges.entries()) {
          if (!k) continue
          const start = r?.start
          const end = r?.end != null ? r.end : (r?.start != null ? images.length : null)
          if (start != null && end != null && end >= start) {
            ranges.push({ unit_key: k, answer_page_start: start, answer_page_end: end })
          }
        }
        if (ranges.length > 0) {
          try {
            await upsertResourceUnitPageRanges(worksheetId, ranges)
          } catch (e) {
            console.warn(`[单趟解析] 单元页范围落库失败 worksheet=${worksheetId}: ${e.message}`)
          }
        }
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
    // key 与 dedupeAnswers 保持一致：含单元、大题组与子题号，否则跨单元/跨大题同题号会互相覆盖
    const keyOf = a => `${a.unit_key || ''}|${a.section || ''}|${a.question_no}|${a.sub_no || ''}`
    const precomputedMap = new Map()
    for (const a of precomputedAnswers) {
      precomputedMap.set(keyOf(a), a)
    }
    // 用预埋答案替换同 key 的 OCR 结果
    const merged = [...parsedAnswers]
    for (const [key, pa] of precomputedMap) {
      const idx = merged.findIndex(a => keyOf(a) === key)
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
const BATCH_TIMEOUT_MS = 20 * 60 * 1000 // 单批超时：约束单批（工作量恒定 ≤15 页）而非全程，总时长天然有界

const withBatchTimeout = (promise, ms, label) => {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

// 渲染并 OCR 一个批次（startPage..endPage，1-based 闭区间），返回解析出的答案与批末单元
async function processOcrBatch(fileBuffer, startPage, endPage, carryState, lowConfidence, ocrFailedPages) {
  let { images } = await renderPdfToJpegs(fileBuffer, {
    scale: 3,
    startPage,
    endPage,
    maxPages: OCR_BATCH_SIZE,
  })
  const ocrContents = await Promise.all(
    // startPage - 1 + i：ocrExtractFromBuffer 内部 push pageIndex+1，此处换算为真实页号
    images.map((img, i) => ocrExtractFromBuffer(img, startPage - 1 + i, ocrFailedPages))
  )
  images = null // 断引用：JPEG buffer 不与 OCR 文本同时存活到解析阶段，下一批分配大对象时可被回收

  const answers = []
  let state = carryState
  // 按真实页号逐页解析：state.pageRanges 跨批累计，调用方在收尾时再补末单元 end
  for (let i = 0; i < ocrContents.length; i++) {
    const realPage = startPage + i
    const content = ocrContents[i]
    // 传递 lastState 对象而非标题字符串：单元标题只印在单元首页、大题标题只印在大题首行，
    // 续页要继承完整的 {unit, group, pageRanges}，否则同一单元会被拆成两个、大题组会丢失
    const parsed = parseAnswerText(content, lowConfidence, state, realPage)
    answers.push(...parsed.answers)
    state = parsed.lastState
  }
  return { answers, lastState: state }
}

// 导出供离线重解析脚本复用（scripts/ 下按 worksheetId 直接重跑已存 PDF，无需重新上传）
export async function doParseOcrBatched(worksheetId, fileBuffer, totalPages, precomputedAnswers) {
  const effectivePages = Math.min(totalPages, MAX_TOTAL_PAGES)
  // 进度初始化在清库之前：这条 UPDATE 同时是"取页数+清库"阶段的 stale 心跳
  await updateWorksheetParseProgress(worksheetId, { totalPages: effectivePages, donePages: 0 })
  // 增量写入前清一次场（替代 replaceWorksheetAnswers 的 DELETE 半段，此后每批只追加）
  await clearWorksheetAnswers(worksheetId)
  // 单元同样清空：上一轮解析残留的单元若本轮不再出现，会在审核页留下空单元
  await clearResourceUnits(worksheetId)

  const lowConfidence = []
  const ocrFailedPages = [] // 跨批累积，存真实页号
  let carryState = null // 单元标题跨批延续（与跨页延续同一机制）
  let ocrPagesTried = 0
  let anySaved = false

  for (let start = 1; start <= effectivePages; start += OCR_BATCH_SIZE) {
    const end = Math.min(start + OCR_BATCH_SIZE - 1, effectivePages)
    console.log(`[分批解析] worksheet=${worksheetId} 第 ${start}-${end} 页 / 共 ${effectivePages} 页`)
    const batch = await withBatchTimeout(
      processOcrBatch(fileBuffer, start, end, carryState, lowConfidence, ocrFailedPages),
      BATCH_TIMEOUT_MS,
      `第 ${start}-${end} 页解析超时（单批超过 ${BATCH_TIMEOUT_MS / 60000} 分钟）`
    )
    carryState = batch.lastState
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

  // 收尾：把 lastState.pageRanges 落库到 resource_units.answer_page_start/end
  // 末单元（仍 open 的）end 兜底为 effectivePages
  const pageRanges = carryState?.pageRanges
  if (pageRanges && pageRanges.size > 0) {
    const ranges = []
    for (const [k, r] of pageRanges.entries()) {
      if (!k) continue
      const start = r?.start
      const end = r?.end != null ? r.end : (r?.start != null ? effectivePages : null)
      if (start != null && end != null && end >= start) {
        ranges.push({ unit_key: k, answer_page_start: start, answer_page_end: end })
      }
    }
    if (ranges.length > 0) {
      try {
        await upsertResourceUnitPageRanges(worksheetId, ranges)
      } catch (e) {
        console.warn(`[分批解析] 单元页范围落库失败 worksheet=${worksheetId}: ${e.message}`)
      }
    }
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
// 按 (单元, 大题组, 题号, 子题号) 去重：同 key 保留置信度高的，相同则保留靠后的；再按单元、题号排序。
// key 的三层缺一不可：
//  - unit_key：几十个「堂堂练」的第 1 题会全部撞成同一个 key（实测 73 页只剩 650 条 / 5 个 section）
//  - section（大题组）：同一单元内填空题第1题与选择题第1题也会撞（实测 p2「1. 13」被「1. C」覆盖）
// 单趟路径全量使用；分批路径批内使用（跨批同 key 由 upsertWorksheetAnswers 的定向删除兜住，后批覆盖）
function dedupeAnswers(parsedAnswers) {
  const keyOf = a => `${a.unit_key || ''}|${a.section || ''}|${a.question_no}|${a.sub_no || ''}`
  const byKey = new Map()
  for (const a of parsedAnswers) {
    const key = keyOf(a)
    const prev = byKey.get(key)
    if (!prev || a.confidence >= prev.confidence) byKey.set(key, a)
  }
  // 排序必须用「首次出现顺序」而非字典序：页面按书内顺序解析，首次出现即书内顺序。
  // 字典序会把「堂堂练10」排到「堂堂练2」前面，且 resolveUnitIds 按此顺序分配
  // unit_seq，一错全错（实测 seq2 变成了堂堂练⑩）。
  const unitOrder = new Map()
  const groupOrder = new Map()
  for (const a of parsedAnswers) {
    const u = a.unit_key || ''
    if (!unitOrder.has(u)) unitOrder.set(u, unitOrder.size)
    const g = `${u}|${a.section || ''}`
    if (!groupOrder.has(g)) groupOrder.set(g, groupOrder.size)
  }
  const subVal = s => {
    const n = parseInt(s, 10)
    return Number.isNaN(n) ? 0 : n
  }
  return [...byKey.values()].sort((a, b) => {
    const ua = unitOrder.get(a.unit_key || '')
    const ub = unitOrder.get(b.unit_key || '')
    if (ua !== ub) return ua - ub
    const ga = groupOrder.get(`${a.unit_key || ''}|${a.section || ''}`)
    const gb = groupOrder.get(`${b.unit_key || ''}|${b.section || ''}`)
    if (ga !== gb) return ga - gb
    if (a.question_no !== b.question_no) return a.question_no - b.question_no
    return subVal(a.sub_no) - subVal(b.sub_no)
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

  // 分离『题号连续性异常』与普通低置信度条目：
  //   - 普通 lowConfidence：OCR 噪声（题没看清），按 50% 阈值提示
  //   - seqAnomaly：题号反向/跳号过大/重置，强信号 = 答案页单元标题漏识别，独立提示
  const seqAnomalies = lowConfidence.filter(x => x && x.kind === 'question_seq_anomaly')
  const realLowConfidence = lowConfidence.filter(x => !(x && x.kind === 'question_seq_anomaly'))

  // 生成警告提示
  let warning = null
  if (parsedAnswers.length === 0) {
    warning = `未能解析出任何答案，请确认上传的是纯答案页${sourceLabel}。`
  } else if (ocrFailedPages.length > 0) {
    warning = `第 ${ocrFailedPages.join('、')} 页 OCR 识别失败，对应页答案缺失，建议重新上传补齐。`
  } else if (ocrTruncatedInfo) {
    warning = `${sourceLabel}共 ${ocrTruncatedInfo.totalPages} 页，仅识别了前 ${ocrTruncatedInfo.ocrPages} 页。若答案位于文件末尾，请裁剪为纯答案页后重新上传。`
  } else if (!markerFound && realLowConfidence.length > parsedAnswers.length * 0.5) {
    warning = `未检测到"参考答案"标记，且低置信度条目偏多，可能混入了题干内容。建议裁剪为纯答案页后重新上传。`
  }

  // 题号连续性异常：每条都列出来（前 5 条 + 总数），便于老师/运维定位具体单元
  if (seqAnomalies.length > 0) {
    const sample = seqAnomalies.slice(0, 5).map(a => a.message).filter(Boolean)
    const more = seqAnomalies.length > 5 ? `等 ${seqAnomalies.length} 处` : ''
    const seqWarning = `检测到 ${seqAnomalies.length} 处答案页题号连续性异常（可能漏识别单元/大题组标题）：${sample.join('；')}${more ? '；' + more : ''}。建议在『修复试卷单元』面板点击『重新解析』或检查答案PDF是否完整。`
    warning = warning ? `${warning}\n${seqWarning}` : seqWarning
  }

  await updateWorksheetParseStatus(worksheetId, {
    status: 'done',
    count: parsedAnswers.length,
    warning,
  })
}

// 答案页 OCR 的系统提示词（ocrExtractFromBuffer / ocrExtractRawText 共用，务必只保留这一份）
//
// 「单元标题」是本方案的地基：练习册的题号作用域是单元（堂堂练① 19.1(1) 算术平方根），
// 每个单元从 1 重新编号。识别不出单元 → 几十个「第1题」撞同一个 key 被丢弃。
// 旧提示词只说"章节标题"，模型会把「一、填空题」当章节，也会在无标题的续页上
// 凭空编一个（实测编出了整本书里根本不存在的「第一章阶段练1」，吞掉 85% 的答案），
// 故此处必须显式给出正反例，并明令续页不得编造。
// 导出供离线校验脚本与阶段 2 题目 PDF 解析复用，避免提示词出现第二份副本导致漂移
//
// 设计思路：练习册答案页的题号是"按单元局部编号"，每张试卷/每个堂堂练都从 1 重新开始。
// AI 必须先识别"单元标题"（试卷/堂堂练/章节），才能把题号-答案正确归位。
// 过去出现"所有答案错挂"几乎都是因为 AI 漏识别了单元标题行（特别是试卷类小标题），
// 导致下面所有题目错挂到上一个父单元。本提示词把"试卷类小标题"放在第一优先级强制输出。
export const ANSWER_OCR_SYSTEM_PROMPT = [
  '你是一个练习册答案识别助手。请从图片中按物理位置（从上到下、从左到右）提取所有题号和对应答案。',
  '',
  '【输出原则】',
  '- 严格按图片中题号-答案的物理位置顺序输出，**不要按猜测的题号重排**。',
  '- 一行只输出一个题号和它的答案（题号、答案之间用一个空格分隔）。',
  '- 严禁把多个题号压在一行（错误样例："1. A 2. B 3. C"）。',
  '',
  '【单元标题 - 最高优先级，必须原样输出，绝不省略】',
  '练习册答案页中，每个『独立练习单元』都从题 1 重新开始编号。',
  '这些单元的标题必须原样单独成行输出。AI 漏掉或合并任何一个，都会让下面所有题目的题号错位到上一个单元，整张试卷答案错乱。',
  '',
  '★ 试卷类小标题（最容易被漏掉，必须重点关注）★',
  '特征：行首出现"试卷"二字，后接序号（圈数字 ①..⑳ / 中文一..十 / 阿拉伯 1..99）或课时编号。',
  '必须原样输出的例子：',
  '  · 「试卷① 19.1 平方根与立方根 基础性测试」',
  '  · 「试卷② 21.2(3) 一般的一元二次方程的解法」',
  '  · 「试卷③ 19.2(1) 二次根式的性质」',
  '  · 「试卷 19.1(1) 算术平方根」',
  '  · 「试卷 19.1」',
  '  · 「试卷一 19.1」',
  '  · 「试卷1 算术平方根」',
  '  · 「试卷四 综合测试」',
  '  · 「试卷B 19.2 提高性测试」',
  '关键约束：',
  '  1. 这些标题与"堂堂练①/②/③"是**同层级的独立练习单元**，题号都从 1 重新开始。',
  '  2. 漏掉"试卷②..."这一行 → 下面所有题目（1.~30.）会被错挂到上一个单元（如『试卷① 19.1』或『第十九章实数』），整套试卷答案全部错位。',
  '  3. 这类标题在答案页通常**印得较小、紧贴在上一题的答案后面**，或**独立成段被一行横线/方框包住**。',
  '     请仔细扫过每一行（包括小字号），不要只看大标题。',
  '  4. 当"试卷"后只跟课时编号（无标题）时也要输出，例如"试卷 19.1"——它就是独立单元。',
  '',
  '★ 其他必输出单元标题 ★',
  '  · 「堂堂练① 19.1(1) 算术平方根」「堂堂练⑩ 21.2(3) 一般的一元二次方程的解法」',
  '  · 「19.2(1) 二次根式的性质」「第3课时 平方根」',
  '  · 「第十九章 单元测试卷」「期中评价测试卷」「第一单元综合练习」',
  '  · 「双基过关堂堂练 1」',
  '',
  '★ 不属于单元标题，绝对不要当作标题输出 ★',
  '  · 「一、填空题」「二、选择题」「三、解答题」「四、计算题」——这是**大题组**，要单独成行（见【大题组标题】）',
  '  · 「参考答案」「答案」「解：」「证明：」',
  '  · 任何题干文字（如"已知 x+y=5，求..."）',
  '  · 题号-答案行（如"5. 3x=6"）',
  '  · 单独出现的"试卷"二字（无序号、无课时、无标题时不要输出——避免空单元）',
  '',
  '【如果本页没有单元标题】',
  '- 若本页属于上一单元的续页（无新单元标题），**不要凭空编造一个标题**。',
  '- 直接输出题号-答案即可，前一单元的标题已经在前面输出过了。',
  '- 严禁猜测或杜撰一个单元标题——宁可不输出，也不要猜。',
  '',
  '【大题组标题】',
  '- 一个单元内部会分「一、填空题」「二、选择题」「三、解答题」等大题，每个大题题号都各自从 1 重新开始。',
  '- 必须在大题答案之前单独成行原样输出（如"一、填空题"），即使原书把它排在同一行或字号较小。',
  '- 漏掉它会导致填空题第 1 题和选择题第 1 题被混为一题，互相覆盖。',
  '- 大题组标题不是单元标题，两者都要输出，顺序：单元标题 → 大题组标题 → 答案。',
  '',
  '【题号与答案格式】',
  '- 选择题：「5. A」/「13. D」',
  '- 判断题：「7. √」/「8. ×」',
  '- 多空题保留子题编号：「2.(1)7/2 (2)4/3 (3)0.9」',
  '- 解答题：「21. -3」/「25. 详见解析」',
  '- 答案 PDF 排版紧凑时允许一行内多题（用分号或空白隔开），但**不要猜题号**——看不清就只输出能看清的。',
  '',
  '【题号错位自检提示】',
  '- 同一单元+大题组内，题号应单调递增且跳跃不超过 5（除非遇到新大题组重新从 1 开始）。',
  '- 如果你发现"5. -3"后面紧跟"7. 2x"（漏了 6），说明漏读了一个题号——**仍要按原题号输出 5 和 7**，不要替它补 6（后处理会按题号匹配学生答案）。',
  '- 遇到看不清的题号，输出"?. <你看到的内容>"，由后处理判断。',
].join('\n')

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

// 基于 OSS URL 的 OCR：上传图片到 OSS 后以 HTTP URL 调用 AI，
// 解决 ModelScope 等 API 不支持 data:image/jpeg;base64 格式的问题
async function ocrExtractFromBuffer(imgBuffer, pageIndex, failedPages) {
  try {
    const url = await uploadImage(imgBuffer, `page_${pageIndex + 1}.jpg`, 'system')
    const { content } = await callVisionCompletion({
      imageDataURL: url,
      systemPrompt: ANSWER_OCR_SYSTEM_PROMPT,
      userText: '请提取这份练习册答案中的所有单元标题、题号和对应答案。',
      temperature: 0.0,
      maxTokens: 4096,
    })
    return content || ''
  } catch (e) {
    console.error(`第 ${pageIndex + 1} 页 OCR 失败（OSS URL 模式）:`, e.message)
    failedPages.push(pageIndex + 1)
    return ''
  }
}

async function ocrExtractRawText(base64Image) {
  const { content } = await callVisionCompletion({
    imageDataURL: `data:image/jpeg;base64,${base64Image}`,
    systemPrompt: ANSWER_OCR_SYSTEM_PROMPT,
    userText: '请提取这份练习册答案中的所有单元标题、题号和对应答案。',
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

// ── 诊断端点：重跑 PDF 解析，**只读不写** ──
// 用于排查"答案与 PDF 对不上"类问题：返回每页 OCR 原文、解析后的 (unit, group, qNo, subNo, answer) 树、
// 当前 DB 中的答案快照。调用方式：
//   GET /api/worksheets/<id>/parse-debug?pages=1-3      // 只跑前 3 页
//   GET /api/worksheets/<id>/parse-debug?pages=all     // 跑全本（默认）
// 注意：调用会消耗 OCR 配额（每页一次 AI 调用），仅排查用，正式解析仍走 POST /:id/parse-pdf
router.get('/:id/parse-debug', async (req, res) => {
  try {
    const worksheet = await getWorksheetById(req.params.id)
    if (!worksheet) return res.status(404).json({ error: '练习册不存在' })
    if (!worksheet.pdf_url) return res.status(400).json({ error: '练习册未上传 PDF' })

    // 1. 从 OSS 拉回原 PDF buffer
    const url = new URL(worksheet.pdf_url)
    const ossPath = url.pathname.slice(1)
    const obj = await ossClient.get(ossPath)
    const fileBuffer = obj.content

    // 2. 选页范围
    const totalPages = await getPdfPageCount(fileBuffer).catch(() => 0)
    const pageParam = String(req.query.pages || 'all')
    let pageRange
    if (pageParam === 'all' || !pageParam) {
      pageRange = { from: 1, to: totalPages }
    } else if (/^\d+-\d+$/.test(pageParam)) {
      const [a, b] = pageParam.split('-').map(Number)
      pageRange = { from: Math.max(1, a), to: Math.min(totalPages, b) }
    } else if (/^\d+$/.test(pageParam)) {
      const p = Number(pageParam)
      pageRange = { from: p, to: p }
    } else {
      return res.status(400).json({ error: 'pages 参数格式: 数字 / N-M / all' })
    }
    if (pageRange.to < pageRange.from || totalPages === 0) {
      return res.status(400).json({ error: `无效的页范围 (PDF 共 ${totalPages} 页)` })
    }

    // 3. 渲染 + OCR + 解析（不写库）
    const { images } = await renderPdfToJpegs(fileBuffer, {
      scale: 3,
      startPage: pageRange.from,
      endPage: pageRange.to,
      maxPages: OCR_BATCH_SIZE,
    })
    const ocrFailedPages = []
    const pageResults = []
    let carryState = null
    for (let i = 0; i < images.length; i++) {
      const realPage = pageRange.from + i
      let content = ''
      let ocrError = null
      try {
        content = await ocrExtractFromBuffer(images[i], i, ocrFailedPages)
      } catch (e) {
        ocrError = e.message
      }
      const parsed = content
        ? parseAnswerText(content, [], carryState)
        : { answers: [], lastState: carryState, lastUnit: null, lastSection: null }
      carryState = parsed.lastState
      pageResults.push({
        page: realPage,
        ocr_ok: !ocrError,
        ocr_error: ocrError,
        ocr_text: content,
        parsed_answers: parsed.answers.map(a => ({
          unit_key: a.unit_key, unit_title: a.unit_title,
          section: a.section, question_no: a.question_no,
          sub_no: a.sub_no, answer: a.answer, answer_type: a.answer_type,
        })),
        carry_after: {
          unit: parsed.lastUnit?.unit_key || null,
          group: parsed.lastState?.group || null,
        },
      })
    }

    // 4. 当前 DB 中的答案（对账用）
    const dbAnswers = await getWorksheetAnswers(req.params.id)

    // 5. 对账：按 (unit_key, section, qNo, sub) 分组，比对 parsed 列表与 DB 列表
    const keyOf = a => `${a.unit_key || ''}|${a.section || ''}|${a.question_no}|${a.sub_no || ''}`
    const parsedByKey = new Map()
    for (const a of pageResults.flatMap(p => p.parsed_answers)) {
      parsedByKey.set(keyOf(a), a)
    }
    const dbByKey = new Map()
    for (const a of dbAnswers) {
      dbByKey.set(keyOf(a), { ...a, unit_key: a.unit_key, section: a.section })
    }
    const allKeys = new Set([...parsedByKey.keys(), ...dbByKey.keys()])
    const reconcile = []
    for (const k of allKeys) {
      const p = parsedByKey.get(k); const d = dbByKey.get(k)
      let status = 'match'
      if (p && !d) status = 'parsed_only'
      else if (!p && d) status = 'db_only'
      else if (p && d && (p.answer !== d.answer || p.answer_type !== d.answer_type)) status = 'mismatch'
      reconcile.push({ key: k, parsed: p || null, db: d || null, status })
    }
    reconcile.sort((a, b) => {
      if (a.status === b.status) return a.key.localeCompare(b.key)
      return ({ parsed_only: 0, mismatch: 1, db_only: 2, match: 3 })[a.status] - ({ parsed_only: 0, mismatch: 1, db_only: 2, match: 3 })[b.status]
    })

    res.json({
      success: true,
      worksheet: {
        id: worksheet.id, name: worksheet.name, subject: worksheet.subject,
        parse_status: worksheet.parse_status, parse_count: worksheet.parse_count,
        pdf_url: worksheet.pdf_url, total_pages: totalPages,
      },
      page_range: pageRange,
      pages: pageResults,
      ocr_failed_pages: ocrFailedPages,
      reconcile_count: {
        match: reconcile.filter(r => r.status === 'match').length,
        parsed_only: reconcile.filter(r => r.status === 'parsed_only').length,
        db_only: reconcile.filter(r => r.status === 'db_only').length,
        mismatch: reconcile.filter(r => r.status === 'mismatch').length,
      },
      reconcile: reconcile.slice(0, 200), // 头 200 条，全量看 DB 侧
      db_snapshot: dbAnswers.map(a => ({
        unit_key: a.unit_key, section: a.section,
        question_no: a.question_no, sub_no: a.sub_no,
        answer: a.answer, answer_type: a.answer_type,
        unit_title: a.unit_title,
      })),
    })
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack?.split('\n').slice(0, 5) })
  }
})

// 单 worksheet 修复端点（放在 /:id/* 通用路由区域，与 parse-pdf 等保持一致风格）
//   GET  /api/worksheets/:id/fix-exam-units/diagnose
//   POST /api/worksheets/:id/fix-exam-units   body: { dryRun?: boolean }
router.get('/:id/fix-exam-units/diagnose', async (req, res) => {
  try {
    const diag = await diagnoseWorksheet(req.params.id)
    res.json({ success: true, ...diag })
  } catch (e) {
    res.status(404).json({ error: e.message })
  }
})

router.post('/:id/fix-exam-units', async (req, res) => {
  const worksheetId = req.params.id
  const dryRun = req.body?.dryRun === true
  const logs = []
  const onLog = (line) => { logs.push(line); console.log(line) }
  try {
    const result = await fixWorksheet(worksheetId, { onLog, skipOcr: dryRun })
    res.json({
      success: result.ok,
      dryRun,
      skipped: result.skipped || false,
      error: result.error || null,
      logs,
      before: { examUnitCount: result.before.examUnitCount, suspectCount: result.before.suspects.length },
      after: result.after ? { examUnitCount: result.after.examUnitCount, suspectCount: result.after.suspects.length } : null,
    })
  } catch (e) {
    res.status(500).json({ success: false, error: e.message, logs })
  }
})

// ── 修复『堂堂练 ordinal 错位』─
// 背景：OCR 识别圈序号 ≥⑨ 时频繁漏识别，回退为前一个成功 ordinal，导致
//       unit_key="堂堂练2|19.2(6)" 这类与"堂堂练2|19.1(2)"严重撞 key，
//       进而批改时把别单元的答案（如 2×10^16）挂到"绝对值"题下。
//       lesson_code（19.1(1)、19.2(6) 等）OCR 一直认对，所以按
//       lesson_code 在本 worksheet 内的 chapter/section/lesson 顺序重新派 ordinal。
// 安全性：答案通过 unit_id (UUID) 关联，改 unit_key / ordinal 不破坏 answer 关联；
//        唯一约束 UNIQUE(resource_id, unit_key) 失败时单条回滚、整体继续，方便定位。
// 调用：POST /api/worksheets/:id/fix-tanglian-ordinals   body: { dryRun?: boolean }
router.post('/:id/fix-tanglian-ordinals', async (req, res) => {
  const worksheetId = req.params.id
  const dryRun = req.body?.dryRun !== false // 默认 dryRun=true 防误改，body 显式传 false 才落库
  const CIRCLED_DIGITS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟㊱㊲㊳㊴㊵'

  // 1) 拉所有 堂堂练 unit（按 unit_seq）
  const { rows: units } = await query(
    `SELECT id, unit_key, unit_title, lesson_code, ordinal, unit_seq
     FROM resource_units
     WHERE resource_id = $1
       AND unit_key LIKE '堂堂练%'
     ORDER BY unit_seq ASC NULLS LAST, created_at ASC`,
    [worksheetId]
  )
  if (units.length === 0) {
    return res.json({ success: true, dryRun, changed: 0, message: '该 worksheet 无堂堂练单元' })
  }

  // 2) 把 lesson_code 解析成可比较的 (chapter, section, lesson, sub) 数字
  //    19.1(1) → [19, 1, 1, 0]
  //    21.1    → [21, 1, 0, 0]
  //    22.3(2) → [22, 3, 2, 0]
  //    没 lesson_code 的按 (999, 999, 999, seq) 排到末尾
  const parseLesson = (s) => {
    if (!s) return [999, 999, 999, 0]
    const m = s.match(/^(\d+)\.(\d+)(?:\((\d+)\))?$/)
    if (!m) return [998, 998, 998, 0]
    return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3] || '0', 10), 0]
  }
  const sorted = [...units].sort((a, b) => {
    const ka = parseLesson(a.lesson_code)
    const kb = parseLesson(b.lesson_code)
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]
    return (a.unit_seq || 0) - (b.unit_seq || 0)
  })

  // 3) 派 ordinal = 1..N，重新计算 unit_key / unit_title
  const proposed = sorted.map((u, idx) => {
    const newOrdinal = idx + 1
    const lessonPart = u.lesson_code ? `|${u.lesson_code}` : ''
    const newUnitKey = `堂堂练${newOrdinal}${lessonPart}`
    const circled = CIRCLED_DIGITS[newOrdinal - 1] || `${newOrdinal}`
    // 修正 unit_title：把"堂堂练"后面所有"圈序号+阿拉伯数字"杂糅串整段替换成正确圈序号
    // 关键坑：OCR 可能把 ㊱ 错误识别成 "③③③"（3 个圈数字符），
    // 或 "36" 前缀混在圈序号里，所以字符类要同时包含 \d 和全部圈序号，用 + 匹配整段
    let newUnitTitle = u.unit_title
    if (newUnitTitle) {
      newUnitTitle = String(newUnitTitle)
        .replace(/^堂堂练[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟㊱㊲㊳㊴㊵\d]+/, `堂堂练${circled}`)
    }
    return {
      id: u.id,
      old_unit_key: u.unit_key,
      new_unit_key: newUnitKey,
      old_ordinal: u.ordinal,
      new_ordinal: newOrdinal,
      old_unit_title: u.unit_title,
      new_unit_title: newUnitTitle,
      changed: u.unit_key !== newUnitKey || u.ordinal !== newOrdinal || u.unit_title !== newUnitTitle,
    }
  })

  // 4) dryRun 时直接返回预览，不落库
  if (dryRun) {
    const changedCount = proposed.filter(p => p.changed).length
    return res.json({
      success: true,
      dryRun: true,
      total: proposed.length,
      changed: changedCount,
      preview: proposed,
    })
  }

  // 5) 落库：单条 UPDATE，唯一约束冲突会报错并跳过该条
  const applied = []
  const errors = []
  for (const p of proposed) {
    if (!p.changed) { applied.push({ ...p, applied: true, skipped: 'no_change' }); continue }
    try {
      await query(
        `UPDATE resource_units
         SET unit_key = $1, ordinal = $2, unit_title = $3
         WHERE id = $4`,
        [p.new_unit_key, p.new_ordinal, p.new_unit_title, p.id]
      )
      applied.push({ ...p, applied: true })
    } catch (e) {
      errors.push({ id: p.id, old_unit_key: p.old_unit_key, new_unit_key: p.new_unit_key, error: e.message })
    }
  }

  return res.json({
    success: errors.length === 0,
    dryRun: false,
    total: proposed.length,
    changed: applied.filter(a => a.applied && !a.skipped).length,
    unchanged: applied.filter(a => a.skipped === 'no_change').length,
    errors,
    applied: applied.map(a => ({
      id: a.id, old_unit_key: a.old_unit_key, new_unit_key: a.new_unit_key,
      old_ordinal: a.old_ordinal, new_ordinal: a.new_ordinal,
      old_unit_title: a.old_unit_title, new_unit_title: a.new_unit_title,
      applied: a.applied, skipped: a.skipped || null,
    })),
  })
})

//   POST /api/worksheets/tasks/:taskId/pages/:pageNumber/unit
//   body: { unitKey: string }
//   功能：老师手动指定该 task 的某一页应归属到哪个 unit，系统用该 unit 答案库重新批改该页
router.post('/tasks/:taskId/pages/:pageNumber/unit', async (req, res) => {
  const { taskId, pageNumber } = req.params
  const { unitKey } = req.body || {}

  if (!unitKey) {
    return res.status(400).json({ success: false, error: '缺少 unitKey' })
  }

  const pageNum = Number(pageNumber)
  if (!Number.isFinite(pageNum) || pageNum < 1) {
    return res.status(400).json({ success: false, error: 'pageNumber 必须是正整数' })
  }

  try {
    const result = await regradeTaskPageWithUnit(taskId, pageNum, unitKey)
    const statusCode = result.success ? 200 : (result.error ? 400 : 500)
    return res.status(statusCode).json(result)
  } catch (error) {
    console.error(`[regradeTaskPageWithUnit] taskId=${taskId} page=${pageNumber} unit=${unitKey} error:`, error)
    return res.status(500).json({ success: false, error: error.message })
  }
})

export default router
