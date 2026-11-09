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
import { query, transaction } from '../config/neon.js'
import { uploadPDF, uploadImage, headObjectExists } from '../services/ossService.js'
import { getCDNUrl } from '../config/oss.js'
import {
  parsePaperResource,
  parsePaperAnswers,
  setPaperParseStatus,
  listPaperQuestions,
  searchPaperQuestions,
  updatePaperQuestion,
  // 截图加题（2026-11-06 加，11-07 改为「写进指定题集」）：同一批零件的第二条落库路径，见下方 /clips
  parseClipImages,
  deletePaperQuestion,
  movePaperQuestions,
  restoreQuestionPlacements,
  bulkUpdatePaperQuestions,
  bulkDeletePaperQuestions,
  paperBankStatistics,
  CLIP_MAX_IMAGES,
  PAPER_MAX_PAGES,
} from '../services/paperBankService.js'
import { queueZeroTypoAudit } from '../services/zeroTypoAuditService.js'

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
    // 双模型复核后「两处抄本不一致」的待人工核对清单（2026-11-06）
    ocr_review: Array.isArray(meta.ocrReview) ? meta.ocrReview : [],
    ocr_review_summary: meta.ocrReviewSummary && typeof meta.ocrReviewSummary === 'object' ? meta.ocrReviewSummary : null,
    // 零错字审计状态（2026-11-09）：解析完自动跑三厂商盲抄，字段名与前端 zero_typo 逐字对齐。
    // status: queued / running / passed / needs_review / checked / failed
    zero_typo: meta.zeroTypoAudit && typeof meta.zeroTypoAudit === 'object' ? meta.zeroTypoAudit : null,
    // 落库后逐页题号清点（2026-11-06）：卷面有、库里没有 = 漏题；库里多出 = 串号。
    // 字段名与前端逐字对齐：coverage_audit（原始明细）/ coverage_summary（列表徽标只读这个）。
    coverage_audit: meta.coverageAudit && typeof meta.coverageAudit === 'object' ? meta.coverageAudit : null,
    coverage_summary: meta.coverageAudit?.summary && typeof meta.coverageAudit.summary === 'object'
      ? meta.coverageAudit.summary
      : null,
    // 题集归属（2026-11-07 文件夹树）：挂在哪一层文件夹下，null = 未归类。
    // 不新加列，只读 metadata；字段名与前端逐字对齐：folder_id。
    folder_id: meta.folderId == null ? null : String(meta.folderId),
    // 历史字段（2026-11-06 旧模型）：曾用来标记「截图题库」卷，让前端置顶并打「截图」标签。
    // ⛔ 2026-11-07 起截图不再自成一类题集，前端已不消费此字段；保留只为兼容存量行。
    origin: meta.origin === 'screenshot' ? 'screenshot' : null,
  }
}

// ── 树形文件夹（2026-11-07）─────────────────────────────────────────────────
//
// 文件夹本体在 paper_bank_folders 表（迁移 066 纯加法，不碰任何既有表/列）。
// 题集归属挂在 resources.metadata.folderId（jsonb 单键，零加列）。
// ⛔ 删除文件夹绝不连带删题目：子文件夹上移一层、题集回到「未归类」。
// ⛔ parentId 校验 + 防环：树成环会让前端展平死循环。

const folderInputError = (e) => /不存在|不能把|层级异常|缺少名称/.test(String(e?.message || ''))

/** 空 / null = 根目录；给了就必须指向一个真实存在的文件夹。 */
async function resolveParentId(parentId) {
  if (parentId == null || parentId === '') return null
  const { rows } = await query(
    `SELECT id FROM paper_bank_folders WHERE id = $1::uuid`, [parentId]
  )
  if (!rows.length) throw new Error('目标文件夹不存在，请刷新后重试')
  return parentId
}

/** 沿 parent_id 往上走，确认新父节点不是自己或自己的后代。 */
async function assertNoCycle(id, parentId) {
  if (!parentId) return
  if (parentId === id) throw new Error('不能把文件夹放进它自己')
  let cursor = parentId
  const seen = new Set()
  while (cursor) {
    if (cursor === id) throw new Error('不能把文件夹放进它的子文件夹里')
    if (seen.has(cursor)) throw new Error('文件夹层级异常，请刷新后重试')
    seen.add(cursor)
    const { rows } = await query(
      `SELECT parent_id FROM paper_bank_folders WHERE id = $1`, [cursor]
    )
    cursor = rows[0]?.parent_id || null
  }
}

router.get('/folders', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, name, parent_id, sort_order, created_at
         FROM paper_bank_folders
        ORDER BY sort_order ASC, created_at ASC`
    )
    res.json({ success: true, folders: rows })
  } catch (e) {
    res.status(500).json({ error: '文件夹加载失败', message: e.message })
  }
})

router.post('/folders', async (req, res) => {
  try {
    const name = String(req.body?.name ?? '').trim().slice(0, 80)
    if (!name) throw new Error('缺少名称：给文件夹起个名字')
    const parentId = await resolveParentId(req.body?.parentId)
    const { rows: mx } = await query(
      `SELECT COALESCE(MAX(sort_order), 0)::int AS n
         FROM paper_bank_folders
        WHERE parent_id IS NOT DISTINCT FROM $1::uuid`,
      [parentId]
    )
    const { rows } = await query(
      `INSERT INTO paper_bank_folders (name, parent_id, sort_order)
       VALUES ($1, $2, $3)
       RETURNING id, name, parent_id, sort_order, created_at`,
      [name, parentId, (mx[0]?.n || 0) + 1]
    )
    res.json({ success: true, folder: rows[0] })
  } catch (e) {
    res.status(folderInputError(e) ? 400 : 500).json({ error: '新建文件夹失败', message: e.message })
  }
})

router.put('/folders/:id', async (req, res) => {
  try {
    const id = req.params.id
    const { rows: cur } = await query(
      `SELECT id, name, parent_id FROM paper_bank_folders WHERE id = $1`, [id]
    )
    if (!cur.length) return res.status(404).json({ error: '文件夹不存在' })
    const name = req.body?.name == null
      ? cur[0].name
      : String(req.body.name).trim().slice(0, 80)
    if (!name) throw new Error('缺少名称：给文件夹起个名字')
    let parentId = cur[0].parent_id
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'parentId')) {
      parentId = await resolveParentId(req.body.parentId)
      await assertNoCycle(id, parentId)
    }
    const { rows } = await query(
      `UPDATE paper_bank_folders SET name = $2, parent_id = $3
        WHERE id = $1
        RETURNING id, name, parent_id, sort_order, created_at`,
      [id, name, parentId]
    )
    res.json({ success: true, folder: rows[0] })
  } catch (e) {
    res.status(folderInputError(e) ? 400 : 500).json({ error: '保存文件夹失败', message: e.message })
  }
})

router.delete('/folders/:id', async (req, res) => {
  try {
    const id = req.params.id
    const { rows: cur } = await query(
      `SELECT parent_id FROM paper_bank_folders WHERE id = $1`, [id]
    )
    if (!cur.length) return res.status(404).json({ error: '文件夹不存在' })
    const upper = cur[0].parent_id
    await transaction(async (client) => {
      // 子文件夹上移一层，不递归删；题目一行都不动。
      await client.query(
        `UPDATE paper_bank_folders SET parent_id = $2 WHERE parent_id = $1`,
        [id, upper]
      )
      // ⛔ text 比较，不写裸 jsonb 与 '' 比较（PG 会抛 invalid input syntax for type json）。
      await client.query(
        `UPDATE resources
            SET metadata = COALESCE(metadata, '{}'::jsonb) - 'folderId'
          WHERE resource_type = 'exam' AND metadata->>'folderId' = $1::text`,
        [id]
      )
      await client.query(`DELETE FROM paper_bank_folders WHERE id = $1`, [id])
    })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: '删除文件夹失败', message: e.message })
  }
})

/** 把题集移进 / 移出文件夹。folderId 传空 = 未归类。 */
router.put('/papers/:id/folder', async (req, res) => {
  try {
    const folderId = await resolveParentId(req.body?.folderId)
    const { rowCount } = await query(
      `UPDATE resources
          SET metadata = COALESCE(metadata, '{}'::jsonb)
               || jsonb_build_object('folderId', $2::text)
        WHERE id = $1 AND resource_type = 'exam'`,
      [req.params.id, folderId]
    )
    if (!rowCount) return res.status(404).json({ error: '题集不存在' })
    res.json({ success: true, folderId })
  } catch (e) {
    res.status(folderInputError(e) ? 400 : 500).json({ error: '移动题集失败', message: e.message })
  }
})

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

    // 2026-11-07 负责人定调：上传 PDF 默认**追加**到所选题集，绝不删掉老师已收的题。
    // 只有上传弹窗里显式勾「重新解析」才走整卷重建。参数名与前端 FormData 逐字对齐：replace='1'。
    const replaceExisting = String(req.body?.replace ?? '') === '1'
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

    parsePaperResource({ resourceId, append: !replaceExisting, ...payload })
      .then(r => {
        console.log(`[paperBank] 解析完成 ${resourceId}: ${r.pages} 页 / ${r.questions} 题`)
        // 零错字审计自动入队（2026-11-09 负责人死规定：一模卷零错字，且不许依赖人手动跑）。
        // 只审本批新增页：追加批次不重烧前面几页的钱；整卷重建才审全卷。
        // ⛔ 后台排队跑，不 await —— 不能让 200+ 次视觉调用卡住上传响应。
        const pages = replaceExisting
          ? null
          : Array.from({ length: Math.max(0, (r.pageTo || 0) - (r.pageFrom || 0) + 1) }, (_, i) => (r.pageFrom || 0) + i)
        try { queueZeroTypoAudit({ resourceId, pages, reason: 'auto' }) } catch (e) {
          console.warn('[paperBank] 零错字审计入队失败（不影响解析）:', e.message)
        }
      })
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

// ── 零错字审计：手动重跑入口（自动跑不了的补救：老卷、或上次通道抖动失败）──
//
// 正常路径是解析完成自动入队（见 /papers/:id/parse）。这个端点只做「重新排一次队」，
// ⛔ 不在这里同步跑：一次审计 200+ 次视觉调用、几分钟，HTTP 会先超时。
router.post('/papers/:id/zero-typo-audit', async (req, res) => {
  try {
    const { id } = req.params
    const { rows } = await query(
      `SELECT id, name, metadata->'zeroTypoAudit'->>'status' AS audit_status
         FROM resources WHERE id = $1 AND resource_type = 'exam'`, [id]
    )
    if (!rows.length) return res.status(404).json({ error: '试卷不存在' })
    const pagesArg = Array.isArray(req.body?.pages)
      ? req.body.pages.map(Number).filter(n => Number.isFinite(n) && n > 0)
      : null
    const out = queueZeroTypoAudit({ resourceId: id, pages: pagesArg && pagesArg.length ? pagesArg : null, reason: 'manual' })
    if (!out.queued && out.reason === 'disabled') {
      return res.status(409).json({ error: '零错字审计已关闭', message: '服务端 ZERO_TYPO_AUDIT=0，需开启后才能跑' })
    }
    res.json({
      success: true,
      queued: out.queued,
      deduped: !!out.deduped,
      status: rows[0].audit_status || null,
      message: out.queued ? '已排入审计队列，完成后卷子头上会显示结果' : '这份卷子正在审计中',
    })
  } catch (e) {
    console.error('[paperBank] 零错字审计入队失败:', e)
    res.status(500).json({ error: '排入审计队列失败', message: e.message })
  }
})

// ── 截图加题（2026-11-06 加，2026-11-07 改模型）──
//
// 场景：老师看视频/网课看到一道好题，截图加进**自己选中的题集**。
// ⛔ 已废弃：所有截图统一进固定「截图题库」卷（metadata.origin='screenshot'）——
//    那等于把「录入渠道」当成「题目类别」，与 PDF 卷并列。负责人 2026-11-07 否决。
// 现行：paperId 必填且必须是现存 exam 题集；PDF 与截图都是往题集里加题的动作。
// 识别链路与「上传并解析」完全同一套零件（parsePageToQuestions），只有落库方式不同。
//
// ⛔ 进程内串行 + 409：识别在后台跑，这期间再提交会被挡住。
//    不做排队 —— 老师连点两次时排队会把同一批图收两遍，重复题比报错难收拾得多。
let clipJob = null

// multer 的「文件数超限」抛在中间件层，不会进路由的 try/catch ⇒ 单独包一层给人话。
const clipUpload = (req, res, next) => {
  upload.array('files', CLIP_MAX_IMAGES)(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        error: '截图数量超出上限',
        message: `一次最多 ${CLIP_MAX_IMAGES} 张截图，先传这一批，剩下的下一批再贴`,
      })
    }
    next()
  })
}

router.post('/clips', clipUpload, async (req, res) => {
  try {
    const files = req.files || []
    if (!files.length) {
      return res.status(400).json({ error: '没有收到截图', message: '按 Ctrl+V 粘贴，或拖一张图进来' })
    }
    const bad = files.find(f => !IMAGE_MIME_TYPES.includes(f.mimetype))
    if (bad) {
      return res.status(400).json({
        error: '不支持的图片格式',
        message: '截图请用 PNG / JPEG / WebP（Windows 截图工具默认存的就是 PNG）',
      })
    }
    const tooBig = files.find(f => (f.size || 0) > 20 * 1024 * 1024)
    if (tooBig) {
      return res.status(400).json({ error: '图片太大', message: '单张截图请控制在 20MB 以内' })
    }

    // ⛔ 目标题集必须显式指定且真实存在：截图没有专属容器，静默建卷就是旧模型复活。
    const targetId = String(req.body?.paperId || '').trim()
    if (!targetId) {
      return res.status(400).json({ error: '没有指定题集', message: '先选一个题集，再把截图加进去' })
    }
    const { rows: target } = await query(
      `SELECT id FROM resources WHERE id = $1 AND resource_type = 'exam'`,
      [targetId]
    )
    if (!target.length) {
      return res.status(404).json({ error: '题集不存在', message: '这个题集可能已被删除，刷新页面重新选一个' })
    }

    // ⛔ 只认进程内的 clipJob，不认库里的 parsing 状态：
    //    服务重启后 DB 里可能残留 parsing（后台任务随进程一起没了），
    //    拿它当锁会让截图入口永久 409，而且老师完全看不出该怎么解。
    if (clipJob) {
      return res.status(409).json({
        error: '上一批截图还在识别',
        message: '等这一批识别完再贴下一批（识别完卷名旁边会显示题数）',
      })
    }

    // 解析前的题数快照：前端用它算「这一批入了多少题」
    const { rows: cnt } = await query(
      `SELECT COUNT(*)::int AS n FROM resource_questions WHERE resource_id = $1`,
      [targetId]
    )

    res.json({
      success: true,
      parsing: true,
      paperId: targetId,
      beforeCount: cnt[0]?.n || 0,
      accepted: files.length,
      message: `${files.length} 张截图已收下，正在识别`,
    })

    // 来源（2026-11-07）：前端把「每张截图一个值」的数组 JSON 塞进一个表单字段，
    // 与 files 按下标对齐。sources = 链接/文字，notes = 视频时间点或备注。
    // 填错/解析失败不影响收题，只是不带来源。
    const asArray = (raw) => {
      const v = Array.isArray(raw) ? raw[0] : raw
      if (!v) return []
      try { const a = JSON.parse(v); return Array.isArray(a) ? a : [] } catch { return [] }
    }
    const clipSources = asArray(req.body?.sources)
    const clipNotes = asArray(req.body?.notes)

    clipJob = parseClipImages({
      images: files.map(f => f.buffer),
      sources: clipSources,
      notes: clipNotes,
      resourceId: targetId,
    })
      .then(r => console.log(`[paperBank] 截图入库完成 ${r.resourceId}: +${r.inserted} 题（含 ${r.emptyPages} 张仅存图）`))
      .catch(async (e) => {
        console.error('[paperBank] 截图入库失败:', e)
        await setPaperParseStatus(targetId, { status: 'failed' }).catch(() => {})
        await query(
          `UPDATE resources SET metadata = COALESCE(metadata, '{}'::jsonb)
             || jsonb_build_object('parseError', to_jsonb($2::text))
           WHERE id = $1`,
          [targetId, String(e?.message || e).slice(0, 300)]
        ).catch(() => {})
      })
      .finally(() => { clipJob = null })
  } catch (e) {
    console.error('[paperBank] 截图上传失败:', e)
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

/**
 * 题库统计（2026-11-09 P0-3）：按难度 / 题型 / 标签聚合。
 * query: resourceIds（逗号分隔，可选，限定某几个题集；兼容旧的单数 resourceId）
 */
router.get('/statistics', async (req, res) => {
  try {
    const idsParam = req.query.resourceIds ?? req.query.resourceId
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const resourceIds = idsParam
      ? String(idsParam).split(',').map(s => s.trim()).filter(x => UUID_RE.test(x))
      : undefined
    if (idsParam && !resourceIds.length) {
      return res.json({ success: true, total: 0, byDifficulty: [], byType: [], byTag: [] })
    }
    const stats = await paperBankStatistics(resourceIds)
    res.json({ success: true, ...stats })
  } catch (e) {
    res.status(500).json({ error: '统计加载失败', message: e.message })
  }
})

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
    // ⛔ resource_id 是 uuid 列：脏参数（前端缓存里的旧 id、手工拼的 query）直接进
    //    会让 PG 抛 invalid input syntax for type uuid ⇒ 整条 SQL 500、题目区全空。
    //    先过滤，一个合法 id 都不剩就返回空结果，别让坏参数打成 500。
    const rawIds = splitList(req.query.resourceIds)
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const resourceIds = rawIds ? rawIds.filter(x => UUID_RE.test(x)) : undefined
    if (rawIds && !resourceIds.length) {
      return res.json({ success: true, questions: [] })
    }
    const questions = await searchPaperQuestions({
      resourceIds,
      questionNos: nums(req.query.questionNos),
      questionTypes: splitList(req.query.questionTypes),
      difficulties: nums(req.query.difficulties),
      tags: splitList(req.query.tags),
      keyword: req.query.keyword ? String(req.query.keyword) : undefined,
      sort: req.query.sort ? String(req.query.sort) : undefined,
      limit: req.query.limit,
    })
    await attachVecUrls(questions)
    res.json({ success: true, questions })
  } catch (e) {
    res.status(500).json({ error: '筛选失败', message: e.message })
  }
})

/**
 * 单题改归属（2026-11-08 负责人需求）：截图收题时点错题集，本该在另一个文件夹里。
 * 此前只能删了重收 —— 等于拿已校对好的题干/难度/标签去换一次 OCR 风险。
 *
 * body: { ids: string[], targetPaperId: string }
 * 语义：`ids` 里如果含「同一题号的多个小问行」，服务端按整题搬（见 planQuestionMove）。
 * 返回 undo 快照，前端据此给「撤销」。
 */
router.post('/questions/move', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [req.body?.id].filter(Boolean)
    const targetPaperId = req.body?.targetPaperId || req.body?.paperId
    if (!ids.length) return res.status(400).json({ error: '没有选要移动的题目', message: '先选择要移动的题目' })
    if (!targetPaperId) return res.status(400).json({ error: '没有选目标题集', message: '先选择要移到哪个题集' })
    const r = await movePaperQuestions({ ids, targetResourceId: targetPaperId })
    res.json({ success: true, ...r })
  } catch (e) {
    // 目标题集不存在 / 题目已被删 这类是「可解释失败」，用 400 把原文透给老师
    const msg = String(e?.message || '移动失败')
    const status = /不存在|没有选|没有目标/.test(msg) ? 400 : 500
    res.status(status).json({ error: '移动失败', message: msg })
  }
})

/** 撤销上面的移动：前端把 undo 快照原样带回来。原位置被占用时跳过并如实报数。 */
router.post('/questions/restore', async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : []
    if (!items.length) return res.status(400).json({ error: '没有要还原的题目' })
    const r = await restoreQuestionPlacements(items)
    res.json({ success: true, ...r })
  } catch (e) {
    res.status(500).json({ error: '还原失败', message: e.message })
  }
})

/**
 * 批量更新题目（2026-11-08 批量操作 P0）：多选 → 一次改难度/标签。
 * body: { ids: string[], patch: { difficulty?: number|null, tags?: string[] } }
 */
router.put('/questions/bulk', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : []
    if (!ids.length) return res.status(400).json({ error: '没有选要修改的题目' })
    if (ids.length > 500) return res.status(400).json({ error: '一次最多修改 500 道题' })
    const patch = req.body?.patch || {}
    const r = await bulkUpdatePaperQuestions(ids, patch)
    res.json({ success: true, ...r })
  } catch (e) {
    res.status(500).json({ error: '批量修改失败', message: e.message })
  }
})

/**
 * 批量删除题目（2026-11-08 批量操作 P0）。
 * body: { ids: string[] }
 */
router.delete('/questions/bulk', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : []
    if (!ids.length) return res.status(400).json({ error: '没有选要删除的题目' })
    if (ids.length > 500) return res.status(400).json({ error: '一次最多删除 500 道题' })
    const r = await bulkDeletePaperQuestions(ids)
    res.json({ success: true, ...r })
  } catch (e) {
    res.status(500).json({ error: '批量删除失败', message: e.message })
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

/**
 * 改题目来源（2026-11-07 加；同日随「题集」模型放宽到所有题集）。
 *
 * 来源属于「这一页素材」，不是某个题目行 —— 一张图拆成多道题时它们共享同一出处。
 * 因此按 page_no 存在题集的 metadata.clipSources，改一处整页生效。
 * ⛔ 旧实现只允许 metadata.origin='screenshot' 的卷改来源。2026-11-07 起截图可进任意题集，
 *    该卷级分类已废弃；且 PDF 追加与截图追加都做 page_no 全局接续（两条链的 basePage），
 *    同一题集内页号不重复 ⇒ 来源索引不会串页。
 */
router.put('/questions/:id/source', async (req, res) => {
  try {
    const source = String(req.body?.source ?? '').trim().slice(0, 500)
    // 时间点/备注（2026-11-07 二轮）：「视频的第几分钟」单独一项。
    // 旧调用只带 source 时保持原备注不清空，避免把已经记好的时间点抹掉。
    const hasNote = Object.prototype.hasOwnProperty.call(req.body || {}, 'note')
    const { rows } = await query(
      `SELECT rq.resource_id, rq.page_no,
              r.metadata->'clipNotes'->>(rq.page_no::text) AS old_note,
              r.metadata->'movedSources'->(rq.id::text) AS moved
         FROM resource_questions rq
         JOIN resources r ON r.id = rq.resource_id
        WHERE rq.id = $1`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: '题目不存在' })
    // 2026-11-08：从别的题集搬过来的题没有 page_no（原页码已清，避免跳到目标卷错页），
    // 它的来源按**题目 id** 存在 metadata.movedSources ⇒ 这条链路也要能改，否则老师
    // 一改来源就吃 400「这道题没有素材页码」。
    if (rows[0].page_no == null) {
      const oldNote = rows[0].moved?.note || ''
      const note = hasNote ? String(req.body.note ?? '').trim().slice(0, 500) : String(oldNote)
      await query(
        `UPDATE resources
            SET metadata = jsonb_set(
                  COALESCE(metadata, '{}'::jsonb),
                  '{movedSources}',
                  jsonb_set(
                    COALESCE(metadata->'movedSources', '{}'::jsonb),
                    ARRAY[$2::text],
                    COALESCE(metadata->'movedSources'->($2::text), '{}'::jsonb)
                      || jsonb_build_object('source', $3::text, 'note', $4::text),
                    true),
                  true)
          WHERE id = $1`,
        [rows[0].resource_id, String(req.params.id), source, note]
      )
      return res.json({ success: true, source, note })
    }
    const note = hasNote
      ? String(req.body.note ?? '').trim().slice(0, 500)
      : String(rows[0].old_note || '')
    await query(
      `UPDATE resources
          SET metadata = jsonb_set(
                jsonb_set(
                  COALESCE(metadata, '{}'::jsonb)
                    || jsonb_build_object('clipSources', COALESCE(metadata->'clipSources', '{}'::jsonb),
                                         'clipNotes',   COALESCE(metadata->'clipNotes', '{}'::jsonb)),
                  ARRAY['clipSources', $2::text], to_jsonb($3::text), true),
                ARRAY['clipNotes', $2::text], to_jsonb($4::text), true)
        WHERE id = $1`,
      [rows[0].resource_id, String(rows[0].page_no), source, note]
    )
    res.json({ success: true, source, note })
  } catch (e) {
    res.status(500).json({ error: '来源保存失败', message: e.message })
  }
})

/**
 * 删单题（2026-11-06）。截图入库后最需要它：截错了 / 一张图里多拆出一行，
 * 以前只能删整卷。只删 resource_questions 单行，不动卷、不动答案册、不动其它题。
 */
router.delete('/questions/:id', async (req, res) => {
  try {
    const ok = await deletePaperQuestion(req.params.id)
    if (!ok) return res.status(404).json({ error: '题目不存在' })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: '删除失败', message: e.message })
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
