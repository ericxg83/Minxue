/**
 * paperBank.js — 试卷题库路由（/api/paper-bank）
 *
 * 产品背景：见 _试卷题库与勾题出讲义-产品评审-20261010.md
 *   老师把纸质中考模拟卷（拍照/PDF）转成结构化题库，永久保存、跨年复用；
 *   再跨卷按题号/题型/难度/标签勾题，出讲义 PDF 去讲题
 *   （例：16 套一模卷的压轴题；所有第 19 题）。
 *
 * ⛔ 与「试卷答案库」(`/api/resources` + `/paper` 页) 的关系：
 *   两者管的是**同一批 resources(type='exam') 行**，但数据面不同 ——
 *   答案库写 resource_answers（给批改判题复用），本路由写 resource_questions（给讲题）。
 *   本路由**不碰** resource_answers，也不改 resources.status / answer_status，
 *   因此题库里的卷子不会出现在批改链路的「试卷选择器」里
 *   （那个接口要求 status='published' 且 answer_status ∈ teacher/official_verified）。
 */
import { Router } from 'express'
import multer from 'multer'
import { query } from '../config/neon.js'
import { uploadPDF } from '../services/ossService.js'
import {
  parsePaperResource,
  parsePaperAnswers,
  setPaperParseStatus,
  listPaperQuestions,
  searchPaperQuestions,
  updatePaperQuestion,
  PAPER_MAX_PAGES,
} from '../services/paperBankService.js'

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
})

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// ── 卷列表 ──

router.get('/papers', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT r.id, r.name, r.grade, r.subject, r.exam_date, r.status, r.pdf_url,
              r.question_parse_status, r.question_parse_total_pages, r.question_parse_done_pages,
              r.parse_status, r.parse_count, r.parse_error, r.metadata, r.created_at,
              (SELECT COUNT(*)::int FROM resource_questions rq WHERE rq.resource_id = r.id) AS question_count,
              (SELECT COUNT(*)::int FROM resource_answers ra
                WHERE ra.resource_id = r.id
                  AND ra.answer_status IN ('teacher_verified','official_verified')) AS answer_count
         FROM resources r
        WHERE r.resource_type = 'exam'
        ORDER BY r.created_at DESC`
    )
    res.json({ success: true, papers: rows })
  } catch (e) {
    res.status(500).json({ error: '试卷题库加载失败', message: e.message })
  }
})

// ── 新建卷 ──

router.post('/papers', async (req, res) => {
  try {
    const { name, grade = null, subject = '数学', examDate = null } = req.body || {}
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: '缺少试卷名称', message: '请填写试卷名称，如「2026 黄浦一模·数学」' })
    }
    const { rows } = await query(
      `INSERT INTO resources (resource_type, name, subject, grade, exam_date, status, answer_status)
       VALUES ('exam', $1, $2, $3, $4, 'draft', 'none')
       RETURNING id, name, grade, subject, exam_date, status, question_parse_status, created_at`,
      [String(name).trim(), subject, grade, examDate]
    )
    res.json({ success: true, paper: rows[0] })
  } catch (e) {
    res.status(500).json({ error: '新建试卷失败', message: e.message })
  }
})

router.put('/papers/:id', async (req, res) => {
  try {
    const { name, grade, subject, examDate } = req.body || {}
    const { rows } = await query(
      `UPDATE resources
          SET name = COALESCE($2, name),
              grade = COALESCE($3, grade),
              subject = COALESCE($4, subject),
              exam_date = COALESCE($5, exam_date)
        WHERE id = $1 AND resource_type = 'exam'
        RETURNING id, name, grade, subject, exam_date, status`,
      [req.params.id, name ?? null, grade ?? null, subject ?? null, examDate ?? null]
    )
    if (!rows.length) return res.status(404).json({ error: '试卷不存在' })
    res.json({ success: true, paper: rows[0] })
  } catch (e) {
    res.status(500).json({ error: '保存失败', message: e.message })
  }
})

router.delete('/papers/:id', async (req, res) => {
  try {
    // 题目行随 resources 级联删除（resource_questions.resource_id ON DELETE CASCADE）。
    // 只删本模块建的 exam 资源，不碰练习册。
    const { rowCount } = await query(
      `DELETE FROM resources WHERE id = $1 AND resource_type = 'exam'`,
      [req.params.id]
    )
    if (!rowCount) return res.status(404).json({ error: '试卷不存在' })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: '删除失败', message: e.message })
  }
})

// ── 上传 + 解析（后台跑，接口立即返回）──

/**
 * 上传**官方答案**（PDF 或照片）→ 走练习册那条「预埋答案」链 → resource_answers。
 * 负责人 2026-10-10 明确：一模卷的官方答案必须能单独上传，不能只靠 OCR 从卷面读
 *（很多卷子的答案在卷末另页；且「答案一定要对，不要去猜」）。
 * ⛔ 本路由**不另写解析**：直接复用 worksheets.js 的 parsePdfInBackground /
 *    parseImagesInBackground（见 paperBankService.parsePaperAnswers）。
 */
router.post('/papers/:id/parse-answers', upload.array('files', 40), async (req, res) => {
  try {
    const resourceId = req.params.id
    const { rows } = await query(
      `SELECT id, parse_status FROM resources WHERE id = $1 AND resource_type = 'exam'`,
      [resourceId]
    )
    if (!rows.length) return res.status(404).json({ error: '试卷不存在' })
    if (rows[0].parse_status === 'parsing') {
      return res.status(409).json({ error: '正在解析中', message: '这份答案还在解析，请稍候' })
    }

    const files = req.files || []
    if (!files.length) return res.status(400).json({ error: '请上传答案 PDF 或答案照片' })

    const pdf = files.find(f => f.mimetype === 'application/pdf')
    const images = files.filter(f => IMAGE_MIME_TYPES.includes(f.mimetype))
    if (!pdf && !images.length) {
      return res.status(400).json({ error: '不支持的文件格式', message: '仅支持 PDF 或 JPEG/PNG/WebP 图片' })
    }
    if (pdf && files.length > 1) {
      return res.status(400).json({ error: '不能混传', message: '答案 PDF 请单独上传；拍照请只传图片' })
    }

    // 留一份原件指针：老师复核时要能打开原始答案册对照。
    // （parsePdfInBackground 内部也会上传一次，但那个 URL 写在 worksheets 视图上、
    //   对 exam 资源是空操作，所以这里自己存一份到真实表的 pdf_url。）
    if (pdf) {
      try {
        const pdfUrl = await uploadPDF(pdf.buffer, pdf.originalname, 'paper-bank')
        await query(`UPDATE resources SET pdf_url = $2 WHERE id = $1`, [resourceId, pdfUrl])
      } catch (e) {
        console.warn('[paperBank] 答案 PDF 存档失败（不影响解析）:', e.message)
      }
    }

    res.json({ success: true, parsing: true, message: '答案已上传，解析已开始' })

    parsePaperAnswers({
      resourceId,
      file: pdf || undefined,
      files: images.length ? images : undefined,
    })
      .then(r => console.log(`[paperBank] 答案解析完成 ${resourceId}: ${r.answers} 条`))
      .catch(e => console.error('[paperBank] 答案解析失败:', e?.message || e))
  } catch (e) {
    console.error('[paperBank] 答案上传失败:', e)
    res.status(500).json({ error: '上传失败', message: e.message })
  }
})

router.post('/papers/:id/parse', upload.array('files', 40), async (req, res) => {
  try {
    const resourceId = req.params.id
    const { rows } = await query(
      `SELECT id, question_parse_status FROM resources WHERE id = $1 AND resource_type = 'exam'`,
      [resourceId]
    )
    if (!rows.length) return res.status(404).json({ error: '试卷不存在' })
    if (rows[0].question_parse_status === 'parsing') {
      return res.status(409).json({ error: '正在解析中', message: '这份卷子还在解析，请稍候' })
    }

    const files = req.files || []
    if (!files.length) return res.status(400).json({ error: '请上传 PDF 或试卷照片' })

    const pdf = files.find(f => f.mimetype === 'application/pdf')
    const images = files.filter(f => IMAGE_MIME_TYPES.includes(f.mimetype))

    if (!pdf && !images.length) {
      return res.status(400).json({ error: '不支持的文件格式', message: '仅支持 PDF 或 JPEG/PNG/WebP 图片' })
    }
    if (pdf && files.length > 1) {
      return res.status(400).json({ error: '不能混传', message: 'PDF 请单独上传；拍照请只传图片' })
    }

    // 题目 PDF 存一份原始文件：老师可以随时打开原卷核对
    if (pdf) {
      try {
        const pdfUrl = await uploadPDF(pdf.buffer, pdf.originalname, 'paper-bank')
        await query(`UPDATE resources SET pdf_url = $2 WHERE id = $1`, [resourceId, pdfUrl])
      } catch (e) {
        console.warn('[paperBank] 原卷 PDF 上传失败（不影响解析）:', e.message)
      }
    }

    await setPaperParseStatus(resourceId, { status: 'parsing', totalPages: 0, donePages: 0 })
    res.json({ success: true, parsing: true, message: '上传成功，解析已开始' })

    // 后台解析（与练习册 parsePdfInBackground 同款：先回响应，再跑重活）
    const payload = pdf
      ? { fileBuffer: pdf.buffer, mimeType: 'application/pdf' }
      : { images: images.map(f => f.buffer) }

    parsePaperResource({ resourceId, ...payload })
      .then(r => console.log(`[paperBank] 解析完成 ${resourceId}: ${r.pages} 页 / ${r.questions} 题`))
      .catch(async (e) => {
        console.error('[paperBank] 解析失败:', e)
        await setPaperParseStatus(resourceId, { status: 'failed' }).catch(() => {})
        await query(
          `UPDATE resources SET metadata = COALESCE(metadata, '{}'::jsonb)
             || jsonb_build_object('parseError', to_jsonb($2::text))
           WHERE id = $1`,
          [resourceId, String(e?.message || e).slice(0, 300)]
        ).catch(() => {})
      })
  } catch (e) {
    console.error('[paperBank] 上传失败:', e)
    res.status(500).json({ error: '上传失败', message: e.message })
  }
})

// ── 题目读取 ──

router.get('/papers/:id/questions', async (req, res) => {
  try {
    const questions = await listPaperQuestions(req.params.id)
    res.json({ success: true, questions })
  } catch (e) {
    res.status(500).json({ error: '题目加载失败', message: e.message })
  }
})

/**
 * 跨卷筛选 —— 「所有第 19 题」「所有压轴题」走这里。
 * query: resourceIds(逗号分隔 uuid) / questionNos(逗号分隔) / questionTypes / difficulties / tags / keyword / limit
 */
router.get('/questions', async (req, res) => {
  try {
    const splitList = (v) => (v == null || v === '' ? undefined : String(v).split(',').map(s => s.trim()).filter(Boolean))
    const nums = (v) => {
      const l = splitList(v)
      return l ? l.map(Number).filter(Number.isFinite) : undefined
    }
    const questions = await searchPaperQuestions({
      resourceIds: splitList(req.query.resourceIds),
      questionNos: nums(req.query.questionNos),
      questionTypes: splitList(req.query.questionTypes),
      difficulties: nums(req.query.difficulties),
      tags: splitList(req.query.tags),
      keyword: req.query.keyword ? String(req.query.keyword) : undefined,
      limit: req.query.limit,
    })
    res.json({ success: true, questions })
  } catch (e) {
    res.status(500).json({ error: '筛选失败', message: e.message })
  }
})

router.put('/questions/:id', async (req, res) => {
  try {
    const updated = await updatePaperQuestion(req.params.id, req.body || {})
    if (!updated) return res.status(400).json({ error: '没有可更新的字段' })
    res.json({ success: true, question: updated })
  } catch (e) {
    res.status(500).json({ error: '保存失败', message: e.message })
  }
})

// 题目总数（首页/列表徽标用）
router.get('/stats', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         (SELECT COUNT(*)::int FROM resources WHERE resource_type = 'exam') AS papers,
         (SELECT COUNT(*)::int FROM resource_questions) AS questions,
         (SELECT COUNT(*)::int FROM resource_answers ra
            JOIN resources r ON r.id = ra.resource_id
           WHERE r.resource_type = 'exam'
             AND ra.answer_status IN ('teacher_verified','official_verified')) AS answers`
    )
    res.json({ success: true, ...rows[0], maxPagesPerPaper: PAPER_MAX_PAGES })
  } catch (e) {
    res.status(500).json({ error: '统计失败', message: e.message })
  }
})

export default router
