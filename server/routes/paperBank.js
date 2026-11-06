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
import { uploadPDF, uploadImage, headObjectExists } from '../services/ossService.js'
import { getCDNUrl } from '../config/oss.js'
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

// ── 上传原件留档（2026-11-06）──
//
// 老师要能直接点开「我上传的那份原题文件」对照 OCR 结果，所以上传的文件本身必须留档。
// 题目原件与答案原件分开存到 resources.metadata.sourceFiles（jsonb 纯加法，不改 Schema）。
// ⛔ 答案册绝不能再写 pdf_url：pdf_url 的历史语义是题目原卷（worksheets 视图也在读），
//    旧实现上传答案 PDF 会覆盖它，老师点「原卷」就会打开答案册。
// ⛔ 存档必须在后台解析启动前 await 完成：解析结束会回填 metadata.pageTitles，
//    两边同时读改写 metadata 会互相覆盖（不同键，但是两次独立 UPDATE）。

/** 把上传文件（PDF / 照片）上传到 OSS，生成可点击的原件记录。单份失败只跳过该份。 */
async function archiveUploads(files, label) {
  const out = []
  for (const [i, f] of files.entries()) {
    try {
      const isPdf = f.mimetype === 'application/pdf'
      const url = isPdf
        ? await uploadPDF(f.buffer, f.originalname, 'paper-bank')
        : await uploadImage(f.buffer, f.originalname, 'paper-bank')
      out.push({
        url,
        name: f.originalname || `${label} ${i + 1}`,
        kind: isPdf ? 'pdf' : 'image',
        size: f.size || null,
      })
    } catch (e) {
      console.warn(`[paperBank] ${label}原件存档失败（不影响解析）:`, e.message)
    }
  }
  return out
}

/** 只覆盖 sourceFiles 下的一个键，保留 metadata 里其它键（pageTitles / parseWarnings 等）。 */
async function saveSourceFiles(resourceId, kind, files) {
  if (!files.length) return
  await query(
    `UPDATE resources
        SET metadata = COALESCE(metadata, '{}'::jsonb)
             || jsonb_build_object(
                  'sourceFiles',
                  COALESCE(metadata->'sourceFiles', '{}'::jsonb)
                    || jsonb_build_object($2::text, $3::jsonb)
                )
      WHERE id = $1`,
    [resourceId, kind, JSON.stringify(files)]
  )
}

/** 老卷（2026-11-06 前上传）只有 pdf_url，且它存的就是题目原卷 ⇒ 直接当单份原件用。 */
const normalizeSourceFiles = (list, legacyUrl) => {
  const files = (Array.isArray(list) ? list : [])
    .filter(f => f && typeof f.url === 'string' && /^https?:\/\//.test(f.url))
    .map(f => ({
      url: f.url,
      name: f.name || '原题文件',
      kind: f.kind === 'pdf' ? 'pdf' : 'image',
      size: f.size ?? null,
    }))
  if (files.length) return files
  return legacyUrl ? [{ url: legacyUrl, name: '原卷 PDF', kind: 'pdf', size: null }] : []
}

/** 列表接口把原件清单提成顶层字段 —— 前后端字段名逐字对齐：question_files / answer_files。 */
const withSourceFiles = (r) => {
  const meta = r.metadata && typeof r.metadata === 'object' ? r.metadata : {}
  const src = meta.sourceFiles && typeof meta.sourceFiles === 'object' ? meta.sourceFiles : {}
  return {
    ...r,
    question_files: normalizeSourceFiles(src.questions, r.pdf_url),
    answer_files: normalizeSourceFiles(src.answers, null),
  }
}

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
    res.json({ success: true, papers: rows.map(withSourceFiles) })
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

/**
 * 清空全部卷（负责人 2026-11-01：重新上传解析前要能一键清空题库，一套套删太费劲）。
 * 级联范围与单卷删除相同：resource_questions / resource_answers / resource_units
 * 全部 ON DELETE CASCADE（pg_constraint 实测），只删 exam 类型、不碰练习册。
 * ⛔ 有卷子还在解析中必须 409 拒绝：后台解析任务还在往库里写，
 *   这时删 resources 会出现「写一半」的孤儿数据/报错刷屏。
 */
router.delete('/papers', async (req, res) => {
  try {
    const parsing = await query(
      `SELECT name FROM resources
        WHERE resource_type = 'exam' AND question_parse_status = 'parsing'
        LIMIT 5`
    )
    if (parsing.rows.length) {
      return res.status(409).json({
        error: '有试卷正在解析中',
        message: `「${parsing.rows.map(r => r.name).join('、')}」还在解析，等解析完成（或失败）后再清空`,
      })
    }
    const { rowCount } = await query(
      `DELETE FROM resources WHERE resource_type = 'exam'`
    )
    res.json({ success: true, deleted: rowCount || 0 })
  } catch (e) {
    res.status(500).json({ error: '清空失败', message: e.message })
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
    // ⛔ 2026-11-06：答案原件只进 metadata.sourceFiles.answers，**不再写 pdf_url**，
    //    pdf_url 是题目原卷（worksheets 视图也在读），覆盖后「看原卷」会打开答案册。
    //    照片答案以前完全没有留档，这里一并补上。
    try {
      const answerFiles = await archiveUploads(pdf ? [pdf] : images, '答案')
      await saveSourceFiles(resourceId, 'answers', answerFiles)
    } catch (e) {
      console.warn('[paperBank] 答案原件存档失败（不影响解析）:', e.message)
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

    // 题目原件留档：老师点「原卷」就能打开自己上传的那份文件核对 OCR。
    // PDF 同时保持 pdf_url 的历史语义；多张照片按上传顺序逐张留档（以前完全没有留档）。
    // ⛔ 必须在解析启动前完成，避免与 metadata.pageTitles 回填互相覆盖。
    try {
      const questionFiles = await archiveUploads(pdf ? [pdf] : images, '原卷')
      if (pdf && questionFiles.length) {
        await query(`UPDATE resources SET pdf_url = $2 WHERE id = $1`, [resourceId, questionFiles[0].url])
      }
      await saveSourceFiles(resourceId, 'questions', questionFiles)
    } catch (e) {
      console.warn('[paperBank] 原卷存档失败（不影响解析）:', e.message)
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

// ── 几何矢量图附着：已停用（2026-11-03 负责人定调）──
// 负责人原话：「我不追求矢量，我要的是高清」。重绘两天内连续画错（嘉定 23 F→H、
// 徐汇 25 面板错位），且扫描件小图标签保真是硬上限 ⇒ 停用 vec_url 附着，
// 列表/讲解版/组篮全部回退高清裁片（裁片分辨率由 paperBankService 的 4x 渲染保证）。
// 历史 SVG 仍留在 OSS（paper-bank/vec/...），仅作归档，不再消费；
// 生成脚本 server/scripts/vectorize-paper-bank-figures.mjs 同步停用，不要在新卷流程里跑。

// ── 几何矢量图附着（2026-11-02 上线，2026-11-03 恢复）──
// 负责人定调：「能矢量就矢量，矢量做不到就高清」——矢量正确时观感最好，
// 但必须有硬质量闸兜底：生成侧 4x 高清输入 + content gate（含硬规则 3.5 字母误读判据）
// + 逐张人工目验（server/scripts/vectorize-paper-bank-figures.mjs），三关缺一不可。
// 列表接口 HEAD 探测后逐行附 vec_url；无产物 = 前端自动回退高清裁片（4x ≈288dpi）。
// ⚠️ 只附着、不生成：生成是显式批处理（烧视觉额度），接口保持只读廉价。
const VEC_TTL_MS = 10 * 60 * 1000
const vecCache = new Map()
async function attachVecUrls(questions) {
  if (!Array.isArray(questions) || !questions.length) return questions
  const now = Date.now()
  const uniq = new Map()
  for (const q of questions) {
    if (!q?.image_url || q.resource_id == null || q.question_no == null) continue
    const key = `${q.resource_id}|${String(q.question_no)}`
    if (!uniq.has(key)) uniq.set(key, key)
  }
  await Promise.all([...uniq.keys()].map(async (key) => {
    const hit = vecCache.get(key)
    if (hit && now - hit.at < (hit.url ? VEC_TTL_MS : 2 * 60 * 1000)) return
    const [rid, qno] = key.split('|')
    const ossKey = `paper-bank/vec/${rid}/${qno}.svg`
    const exists = await headObjectExists(ossKey)
    vecCache.set(key, { url: exists ? getCDNUrl(ossKey) : null, at: Date.now() })
  }))
  for (const q of questions) {
    if (!q?.image_url || q.resource_id == null || q.question_no == null) continue
    const hit = vecCache.get(`${q.resource_id}|${String(q.question_no)}`)
    if (hit?.url) q.vec_url = hit.url
  }
  return questions
}

router.get('/papers/:id/questions', async (req, res) => {
  try {
    const questions = await listPaperQuestions(req.params.id)
    await attachVecUrls(questions)
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
    await attachVecUrls(questions)
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
