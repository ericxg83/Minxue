/**
 * paperBankService.js — 试卷题库采集管线（2026-10-10）
 *
 * 职责：把一份**纸质卷子**（PDF 或拍照）变成「每题一行」的结构化题目，
 * 永久存进 resource_questions，供跨卷勾题、出讲义 PDF 讲题。
 *
 * ── 为什么单独成服务、不复用批改链路 ──
 * 批改链路的题必须绑 task_id + student_id（有学生、有作答）；试卷题库的题
 * **没有学生、没有作答**，是纯教学素材。两套数据语义不同，绝不能混写
 * （questions.task_id / student_id 均 NOT NULL，硬塞会污染批改→错题→掌握度全链路）。
 *
 * ── 这条管线是「用现成零件拼」而不是「重写识别」──
 *   ① 整页 OCR        ：buildOCRPrompt + callVisionCompletion（GENERAL_OCR_VENDOR_CHAIN）
 *   ② 按题切段        ：questionBoxMeasure#measurePageQuestionBoxes（复核页定位框在用）
 *   ③ 裁片            ：sharp.extract（切段服务内部同款）
 *   ④ 落库            ：resource_questions（032 建好、063 补列，此前全仓零写入）
 * 识别口径（题干/选项/题型）与批改链路完全一致，换的只是「往哪张表写」。
 *
 * ── 三条硬纪律 ──
 *   1. ⛔ 绝不写 questions 表。
 *   2. ⛔ 不做相似度合并；题目身份 = (resource_id, question_no, sub_no) 既有唯一键。
 *   3. ⛔ 答案只存「卷面印刷的」或「老师手填的」，标 answer_source 区分；
 *      模型自己算的答案本版不写（宁可空着，也不给没验算过的值）。
 */
import sharp from 'sharp'
import { query, transaction } from '../config/neon.js'
import { uploadImage } from './ossService.js'
import { renderPdfToJpegs } from './pdfService.js'
import { buildOCRPrompt, callVisionCompletion, GENERAL_OCR_VENDOR_CHAIN } from '../config/ai.js'
import { measurePageQuestionBoxes } from './questionBoxMeasure.js'

// 分批 OCR 并发上限。与练习册答案页 OCR 同口径（OCR_PAGE_CONCURRENCY 默认 3）：
// 瞬时并发打满会触发供应商限流（2026-09-09 全本错位事故的成因之一）。
export const PAPER_OCR_CONCURRENCY = Number(process.env.PAPER_OCR_CONCURRENCY || 3)

// 单份卷子最多解析多少页 —— 防止误传整本书把额度打光。
export const PAPER_MAX_PAGES = Number(process.env.PAPER_MAX_PAGES || 60)

// 解析页图与裁片的缩放。scale 2 足够 OCR 与讲义缩略，且裁片体积可控。
const RENDER_SCALE = 2

/** 并发映射：保序返回，单点失败不拖垮整批。 */
export async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length)
  let cursor = 0
  const n = Math.max(1, Math.min(limit, items.length))
  const workers = Array.from({ length: n }, async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      try {
        out[i] = await fn(items[i], i)
      } catch (e) {
        out[i] = { __error: String(e?.message || e).slice(0, 300) }
      }
    }
  })
  await Promise.all(workers)
  return out
}

/** 从模型输出里宽松地抠出 JSON（模型常包 ```json 或加解释文字）。 */
export function parseJsonLoose(content) {
  if (content && typeof content === 'object') return content
  if (typeof content !== 'string') return null
  const m = content.match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

/** 选项归一化：去掉 "A."/"（A）"/"A、" 这类标号（标号由界面按顺序生成）。 */
export function normalizeOptions(options) {
  if (!Array.isArray(options)) return []
  return options
    .map(o => String(o == null ? '' : o).replace(/^\s*[（(]?[A-Da-d][）)]?\s*[.、．:：]?\s*/, '').trim())
    .filter(Boolean)
}

/** 题型归一化到 questions 同口径四值；未知一律归解答题（宁错块不漏题）。 */
export function normalizeQuestionType(t) {
  const v = String(t || '').trim().toLowerCase()
  if (v === 'choice' || v === 'fill' || v === 'judge') return v
  return 'answer'
}

/**
 * 「压轴题」自动打标 —— 位置规则，不是猜难度。
 * 规则：本卷**解答题**（question_type='answer'）按题号排序后的最后 2 题。
 * 依据：一模卷的压轴题就是最后两道解答题（第 24/25 题），这是卷面事实。
 * 解答题不足 3 道时不打标（避免把整卷都标成压轴题）。
 * ⛔ 不引入难度预测模型：判不准就不标，老师可在界面上手动改。
 */
export function deriveAutoTags(rows) {
  const answers = rows
    .filter(r => r.question_type === 'answer' && Number.isFinite(r.question_no))
    .sort((a, b) => a.question_no - b.question_no)
  if (answers.length < 3) return rows
  const tail = new Set(answers.slice(-2).map(r => r.__key))
  return rows.map(r => (tail.has(r.__key) ? { ...r, tags: ['压轴题'] } : r))
}

// ── 进度 / 状态 ──

export async function setPaperParseStatus(resourceId, patch = {}) {
  const sets = []
  const params = [resourceId]
  const put = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`) }
  if ('status' in patch) put('question_parse_status', patch.status)
  if ('totalPages' in patch) put('question_parse_total_pages', patch.totalPages)
  if ('donePages' in patch) put('question_parse_done_pages', patch.donePages)
  if ('metadata' in patch) put('metadata', JSON.stringify(patch.metadata))
  if (!sets.length) return
  await query(`UPDATE resources SET ${sets.join(', ')} WHERE id = $1`, params)
}

/** 只加一个 warning 到 metadata.parseWarnings（不动其它 metadata 键）。 */
async function appendParseWarning(resourceId, message) {
  try {
    await query(
      `UPDATE resources
         SET metadata = jsonb_set(
               COALESCE(metadata, '{}'::jsonb), '{parseWarnings}',
               COALESCE(metadata->'parseWarnings', '[]'::jsonb) || to_jsonb($2::text)
             )
       WHERE id = $1`,
      [resourceId, String(message).slice(0, 300)]
    )
  } catch (e) {
    console.warn('[paperBank] 写 parseWarnings 失败（不影响主流程）:', e.message)
  }
}

// ── 落库 ──

/**
 * 用一批新行**整体替换**某份卷子的题目清册。
 * 为什么是「先删后插」而不是 upsert：重新解析时题号可能变（切段算法/OCR 结果变了），
 * upsert 会留下一批孤儿行；整卷替换是唯一能让「库里 = 本次解析结果」的写法。
 * ⛔ 全程在事务里，失败不留半份数据。
 */
export async function replacePaperQuestions(resourceId, rows) {
  await transaction(async (client) => {
    await client.query('DELETE FROM resource_questions WHERE resource_id = $1', [resourceId])
    for (const r of rows) {
      await client.query(
        `INSERT INTO resource_questions
           (resource_id, unit_id, question_no, sub_no, parent_stem, content, options,
            question_type, answer, answer_source, analysis, difficulty, tags,
            page_no, bbox, image_url, page_image_url)
         VALUES ($1, NULL, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12::text[], $13, $14::jsonb, $15, $16)`,
        [
          resourceId,
          r.question_no ?? null,
          r.sub_no || '',
          r.parent_stem || null,
          r.content || '',
          JSON.stringify(r.options || []),
          r.question_type || 'answer',
          r.answer || null,
          r.answer_source || null,
          r.analysis || null,
          r.difficulty ?? null,
          r.tags || [],
          r.page_no ?? null,
          r.bbox ? JSON.stringify(r.bbox) : null,
          r.image_url || null,
          r.page_image_url || null,
        ]
      )
    }
  })
}

// ── 单页 → 题目行 ──

/** 按归一化区间（0-1000）从整页图裁出该题区域。裁不动就返回 null（不编造图）。 */
export async function cropQuestionImage(pageBuffer, box) {
  if (!box) return null
  const meta = await sharp(pageBuffer).metadata()
  const W = Number(meta.width) || 0
  const H = Number(meta.height) || 0
  if (!W || !H) return null
  const clampN = (v) => Math.max(0, Math.min(1000, Number(v) || 0))
  const left = Math.round(clampN(box.x) / 1000 * W)
  const top = Math.round(clampN(box.y) / 1000 * H)
  const width = Math.min(W - left, Math.round(clampN(box.width) / 1000 * W))
  const height = Math.min(H - top, Math.round(clampN(box.height) / 1000 * H))
  if (width < 8 || height < 8) return null
  try {
    return await sharp(pageBuffer).extract({ left, top, width, height }).jpeg({ quality: 82 }).toBuffer()
  } catch (e) {
    console.warn('[paperBank] 裁片失败:', e.message)
    return null
  }
}

/**
 * 解析一页：整页 OCR → 按题切段 → 裁片 → 返回该页的题目行（尚未落库）。
 * 任一子步骤失败都**只降级、不中断**：OCR 失败 → 该页 0 题（记 warning）；
 * 切段失败 → 题目照存，只是没有裁片图（image_url 为空）。
 */
export async function parsePageToQuestions({ pageBuffer, pageNumber, logger = console }) {
  const imageDataURL = 'data:image/jpeg;base64,' + pageBuffer.toString('base64')

  const { content } = await callVisionCompletion({
    imageDataURL,
    systemPrompt: buildOCRPrompt(),
    userText: '请识别这张试卷页面上的全部题目，按 JSON 格式返回。',
    temperature: 0.05,
    maxTokens: 8192,
    // 显式链：整页卷子 OCR 与学生作业拍照 OCR 是同族任务，
    // 绝不静默落到链外弱模型（弱模型阅读顺序错乱/漏读是 2026-09-09 事故成因）。
    vendorChain: GENERAL_OCR_VENDOR_CHAIN,
  })

  const obj = parseJsonLoose(content)
  const rawList = Array.isArray(obj?.questions) ? obj.questions : []
  if (!rawList.length) {
    logger.warn?.(`[paperBank] 第 ${pageNumber} 页未识别出题目（模型返回不可解析或为空）`)
    return { rows: [], pageTitle: obj?.page_title || null, sectionTitle: obj?.section_title || null }
  }

  // 整页图存 OSS：裁片可重做（换算法/补配图）而不必让老师重传卷子。
  // 路径段用 'paper-bank' 而不是 null：题库素材没有学生归属，
  // 传 null 会生成 `images/null/...` 这种脏路径。
  let pageImageUrl = null
  try {
    pageImageUrl = await uploadImage(pageBuffer, `paper-p${pageNumber}.jpg`, 'paper-bank')
  } catch (e) {
    logger.warn?.(`[paperBank] 第 ${pageNumber} 页整页图上传失败: ${e.message}`)
  }

  // 题号补齐：先收模型给的印刷题号，未给题号的从「本卷最大题号之后顺延」编号。
  // 为什么要顺延而不是用页内序号：唯一键是 (resource_id, unit_id, question_no, sub_no)，
  // 顺延能保证兜底号**永远大于所有印刷题号**，绝不会和某道真题的题号撞上
  //（撞了会让整批 INSERT 失败，整页题目一起丢）。
  let maxPrinted = 0
  for (const q of rawList) {
    const n = Number(q?.question_number)
    if (Number.isFinite(n) && n > maxPrinted) maxPrinted = n
  }
  let spill = maxPrinted
  const used = new Set()
  const rows = rawList.map((q, i) => {
    const subNo = q?.sub_no == null ? '' : String(q.sub_no)
    let qno = Number(q?.question_number)
    if (!Number.isFinite(qno)) qno = ++spill
    let guard = 0
    while (used.has(`${qno}|${subNo}`) && guard++ < 200) qno = ++spill
    used.add(`${qno}|${subNo}`)
    const printedAnswer = q?.answer == null ? '' : String(q.answer).trim()
    return {
      __key: `${pageNumber}:${i}`,
      question_no: qno,
      sub_no: subNo,
      parent_stem: q?.parent_stem ? String(q.parent_stem) : null,
      content: String(q?.content || '').trim(),
      options: normalizeOptions(q?.options),
      question_type: normalizeQuestionType(q?.question_type),
      // 只认「卷面印刷的答案」；本版不写模型自己算的（answer_source='ai' 留给后续接答案引擎）
      answer: printedAnswer || null,
      answer_source: printedAnswer ? 'printed' : null,
      analysis: q?.analysis ? String(q.analysis) : null,
      difficulty: null,
      tags: [],
      page_no: pageNumber,
      bbox: null,
      image_url: null,
      page_image_url: pageImageUrl,
    }
  }).filter(r => r.content || r.options.length > 0)

  // 按题切段 → 裁片。切段失败不阻塞落库。
  try {
    const measured = await measurePageQuestionBoxes({
      imageBuffer: pageBuffer,
      questions: rows.map((r, i) => ({
        id: String(i),
        question_number: r.question_no,
        sub_no: r.sub_no || null,
        content: r.content,
      })),
      vendorChain: GENERAL_OCR_VENDOR_CHAIN,
    })
    if (measured?.error) {
      logger.warn?.(`[paperBank] 第 ${pageNumber} 页切段失败（题目照存、无裁片）: ${measured.error}`)
    } else {
      for (let i = 0; i < rows.length; i++) {
        const box = measured?.boxes?.[String(i)]
        if (!box) continue
        rows[i].bbox = box
        const cropped = await cropQuestionImage(pageBuffer, box)
        if (cropped) {
          try {
            rows[i].image_url = await uploadImage(cropped, `paper-p${pageNumber}-q${rows[i].question_no}.jpg`, 'paper-bank')
          } catch (e) {
            logger.warn?.(`[paperBank] 第 ${pageNumber} 页第 ${rows[i].question_no} 题裁片上传失败: ${e.message}`)
          }
        }
      }
    }
  } catch (e) {
    logger.warn?.(`[paperBank] 第 ${pageNumber} 页切段异常（题目照存、无裁片）: ${e.message}`)
  }

  return { rows, pageTitle: obj?.page_title || null, sectionTitle: obj?.section_title || null }
}

// ── 主流程 ──

/**
 * 解析一份卷子（PDF 或图片数组）→ 写 resource_questions。
 * 调用方负责：把 resources.question_parse_status 置 'parsing'、失败置 'failed'。
 * 本函数内部只做「页面 → 题目行 → 落库」与进度更新。
 *
 * @param {object}   o
 * @param {string}   o.resourceId
 * @param {Buffer}   o.fileBuffer   PDF 或单张图片
 * @param {string}   [o.mimeType]   'application/pdf' 时按 PDF 渲染分页
 * @param {Buffer[]} [o.images]     直接给多张图片（拍照场景）
 * @param {object}   [o.logger]
 */
export async function parsePaperResource({ resourceId, fileBuffer, mimeType, images, logger = console }) {
  let pages = []
  if (Array.isArray(images) && images.length) {
    pages = images.slice(0, PAPER_MAX_PAGES)
  } else if (fileBuffer) {
    const isPdf = mimeType === 'application/pdf' || /\.pdf$/i.test(String(mimeType || ''))
    if (isPdf) {
      const rendered = await renderPdfToJpegs(fileBuffer, { scale: RENDER_SCALE, maxPages: PAPER_MAX_PAGES })
      pages = (rendered?.images || []).slice(0, PAPER_MAX_PAGES)
      if (rendered?.totalPages > pages.length) {
        await appendParseWarning(resourceId, `PDF 共 ${rendered.totalPages} 页，仅解析前 ${pages.length} 页`)
      }
    } else {
      pages = [fileBuffer]
    }
  }
  if (!pages.length) throw new Error('没有可解析的页面')

  await setPaperParseStatus(resourceId, { status: 'parsing', totalPages: pages.length, donePages: 0 })

  let done = 0
  const pageResults = await mapWithConcurrency(pages, PAPER_OCR_CONCURRENCY, async (buf, idx) => {
    const pageNumber = idx + 1
    try {
      const r = await parsePageToQuestions({ pageBuffer: buf, pageNumber, logger })
      return r
    } catch (e) {
      await appendParseWarning(resourceId, `第 ${pageNumber} 页解析失败：${String(e?.message || e).slice(0, 200)}`)
      return { rows: [], failed: true }
    } finally {
      done += 1
      await setPaperParseStatus(resourceId, { donePages: done }).catch(() => {})
    }
  })

  // 汇总 + 自动打标
  let rows = []
  const pageTitles = []
  for (const r of pageResults) {
    if (!r || r.__error || r.failed) continue
    rows = rows.concat(r.rows || [])
    if (r.pageTitle) pageTitles.push(r.pageTitle)
  }
  rows = deriveAutoTags(rows)

  if (!rows.length) {
    throw new Error('整份卷子没有识别出任何题目（可能是扫描质量过低，或页面不是题目页）')
  }

  await replacePaperQuestions(resourceId, rows)
  await setPaperParseStatus(resourceId, { status: 'done', donePages: pages.length })

  // 卷面标题回填到 metadata，方便列表识别是哪一套卷
  if (pageTitles.length) {
    await query(
      `UPDATE resources
         SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('pageTitles', to_jsonb($2::text[]))
       WHERE id = $1`,
      [resourceId, pageTitles.slice(0, 5)]
    ).catch(() => {})
  }

  return { pages: pages.length, questions: rows.length }
}

// ── 官方答案（复用练习册「预埋答案」那条链）──
//
// 2026-10-10 负责人指出：一模卷的**官方答案**必须能单独上传，不能只靠 OCR 从卷面读
//（很多卷子的答案在卷末另页，且「答案一定要对，不要去猜」）。
// 系统里这条链**早就存在** —— 就是练习册的「答案 PDF/图片 → OCR → 答案库」：
//   server/routes/worksheets.js 的 parsePdfInBackground / parseImagesInBackground
//   → processOcrResults → replaceWorksheetAnswers → resource_answers（标 official_verified）
// 所以这里**只做两件事**：① 把 exam 资源接进那条链；② 读题目时按题号把官方答案 join 回来。
// ⛔ 绝不另写一套答案解析。

/**
 * 写「答案解析」状态（走真实 resources 表）。
 * 为什么不复用 updateWorksheetParseStatus：那个函数 `UPDATE worksheets ...`，
 * 而 worksheets 是 `WHERE resource_type='worksheet'` 的**视图** —— exam 行不在里面，
 * 更新会静默影响 0 行（答案照写、状态永远不动）。
 */
export async function setPaperAnswerStatus(resourceId, { status, count = null, warning = null, error = null } = {}) {
  await query(
    `UPDATE resources
        SET parse_status = COALESCE($2, parse_status),
            parse_count = COALESCE($3, parse_count),
            parse_warning = COALESCE($4, parse_warning),
            parse_error = $5
      WHERE id = $1 AND resource_type = 'exam'`,
    [resourceId, status ?? null, count, warning, error]
  )
}

/**
 * 解析一份**官方答案**（PDF 或照片）→ 写 resource_answers（official_verified）。
 * @param {object} o
 * @param {string} o.resourceId
 * @param {{buffer:Buffer, originalname:string}} [o.file]   PDF
 * @param {Array<{buffer:Buffer, mimetype:string, originalname:string}>} [o.files]  照片
 * @param {(msg:string, level?:string)=>void} [o.logger]
 */
export async function parsePaperAnswers({ resourceId, file, files, logger = console }) {
  const { parsePdfInBackground, parseImagesInBackground } = await import('../routes/worksheets.js')
  await setPaperAnswerStatus(resourceId, { status: 'parsing', error: null })
  try {
    if (file) {
      await parsePdfInBackground(resourceId, file)
    } else if (Array.isArray(files) && files.length) {
      await parseImagesInBackground(resourceId, files)
    } else {
      throw new Error('没有可解析的答案文件')
    }
    // parsePdfInBackground 内部会把状态写 'done'/'reviewing'，但那是走视图、对 exam 无效；
    // 这里在真实表上补一次（成功后答案已落 resource_answers）。
    const n = await countPaperAnswers(resourceId)
    await setPaperAnswerStatus(resourceId, { status: n > 0 ? 'done' : 'failed', count: n })
    return { answers: n }
  } catch (e) {
    logger.error?.('[paperBank] 答案解析失败:', e)
    await setPaperAnswerStatus(resourceId, { status: 'failed', error: String(e?.message || e).slice(0, 300) }).catch(() => {})
    throw e
  }
}

/** 该卷已解析出的官方答案条数。 */
export async function countPaperAnswers(resourceId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM resource_answers
      WHERE resource_id = $1 AND answer_status IN ('teacher_verified','official_verified')`,
    [resourceId]
  )
  return rows[0]?.n || 0
}

/**
 * 读题目时把官方答案 join 回来的 SQL 片段。
 * 键：`(resource_id, question_no, sub_no)` —— 刻意**不含 unit_id**：
 *   · 试卷题库的题目 unit_id 恒为 NULL；
 *   · 试卷答案库路径解析出的答案 unit_id 也是 NULL；
 *   · 但若答案 PDF 被识别出「单元」（练习册式版式），答案会带 unit_id 而题目没有
 *     ⇒ 带上 unit_id 就永远 join 不上。按题号匹配才是试卷的正确口径。
 * 同一题号命中多条（跨大题组撞号）时**取官方优先、其次最早**，并把命中条数
 * 透出为 answer_conflict_count —— 让老师看见冲突，而不是我们悄悄挑一条。
 */
const OFFICIAL_ANSWER_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT ra.answer, ra.answer_status, ra.section, ru.unit_title,
           (SELECT COUNT(*)::int FROM resource_answers ra2
             WHERE ra2.resource_id = ra.resource_id
               AND ra2.question_no = ra.question_no
               AND COALESCE(ra2.sub_no, '') = COALESCE(ra.sub_no, '')
               AND ra2.answer_status IN ('teacher_verified', 'official_verified')) AS conflict_count
      FROM resource_answers ra
      LEFT JOIN resource_units ru ON ru.id = ra.unit_id
     WHERE ra.resource_id = rq.resource_id
       AND ra.question_no = rq.question_no
       AND COALESCE(ra.sub_no, '') = COALESCE(rq.sub_no, '')
       AND ra.answer_status IN ('teacher_verified', 'official_verified')
     ORDER BY (ra.answer_status = 'official_verified') DESC, ra.created_at ASC
     LIMIT 1
  ) oa ON TRUE`

/** 把「官方答案优先」的取值口径收敛到一处（列表与讲义共用）。 */
export function attachEffectiveAnswer(row) {
  const { own_answer, own_answer_source, official_answer, official_answer_status,
    official_unit_title, answer_conflict_count, ...rest } = row
  const official = official_answer == null ? '' : String(official_answer).trim()
  const useOfficial = official !== ''
  return {
    ...rest,
    answer: useOfficial ? official : (own_answer ?? null),
    // 来源三态：official 官方答案库 / printed 卷面印刷 / manual 老师手填 / ai 模型解出
    answer_source: useOfficial ? 'official' : (own_answer_source || null),
    answer_status: useOfficial ? official_answer_status : null,
    answer_unit_title: useOfficial ? (official_unit_title || null) : null,
    answer_conflict_count: Number(answer_conflict_count) || 0,
  }
}

// ── 读取 ──

const RQ_COLS = `id, resource_id, question_no, sub_no, parent_stem, content, options,
  question_type, answer, answer_source, analysis, difficulty, tags, page_no, bbox,
  image_url, page_image_url, created_at`

// 读路径的列：原题自带的答案 + join 回来的官方答案（两个都要，取值口径在 attachEffectiveAnswer）
const RQ_READ_COLS = `rq.id, rq.resource_id, rq.question_no, rq.sub_no, rq.parent_stem, rq.content,
  rq.options, rq.question_type, rq.analysis, rq.difficulty, rq.tags, rq.page_no, rq.bbox,
  rq.image_url, rq.page_image_url, rq.created_at,
  rq.answer AS own_answer, rq.answer_source AS own_answer_source,
  oa.answer AS official_answer, oa.answer_status AS official_answer_status,
  oa.unit_title AS official_unit_title, oa.conflict_count AS answer_conflict_count`

/** 单份卷子的题目（按页码、题号、小问号排序）。 */
export async function listPaperQuestions(resourceId) {
  const { rows } = await query(
    `SELECT ${RQ_READ_COLS}
       FROM resource_questions rq
       ${OFFICIAL_ANSWER_LATERAL}
      WHERE rq.resource_id = $1
      ORDER BY rq.page_no NULLS LAST, rq.question_no NULLS LAST, rq.sub_no`,
    [resourceId]
  )
  return rows.map(attachEffectiveAnswer)
}

/**
 * 跨卷筛选 —— 「所有第 19 题」「所有压轴题」就是走这里。
 * 每项筛选都是可选的；全部为空 = 返回全部卷的全部题。
 * @param {object} f
 * @param {string[]} [f.resourceIds]
 * @param {number[]} [f.questionNos]
 * @param {string[]} [f.questionTypes]
 * @param {number[]} [f.difficulties]
 * @param {string[]} [f.tags]          命中任一标签即可（数组包含语义）
 * @param {string}   [f.keyword]       题干关键字（ILIKE）
 * @param {number}   [f.limit]
 */
export async function searchPaperQuestions(f = {}) {
  const where = []
  const params = []
  const add = (sql, val) => { params.push(val); where.push(sql.replace('?', `$${params.length}`)) }

  if (Array.isArray(f.resourceIds) && f.resourceIds.length) add('rq.resource_id = ANY(?::uuid[])', f.resourceIds)
  if (Array.isArray(f.questionNos) && f.questionNos.length) add('rq.question_no = ANY(?::int[])', f.questionNos)
  if (Array.isArray(f.questionTypes) && f.questionTypes.length) add('rq.question_type = ANY(?::text[])', f.questionTypes)
  if (Array.isArray(f.difficulties) && f.difficulties.length) add('rq.difficulty = ANY(?::int[])', f.difficulties)
  if (Array.isArray(f.tags) && f.tags.length) add('rq.tags && ?::text[]', f.tags)
  if (f.keyword) add('rq.content ILIKE ?', `%${f.keyword}%`)

  const limit = Math.max(1, Math.min(Number(f.limit) || 500, 2000))
  params.push(limit)
  const { rows } = await query(
    `SELECT ${RQ_READ_COLS},
            r.name AS resource_name, r.grade, r.subject, r.exam_date
       FROM resource_questions rq
       JOIN resources r ON r.id = rq.resource_id
       ${OFFICIAL_ANSWER_LATERAL}
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY r.exam_date NULLS LAST, r.name, rq.page_no NULLS LAST, rq.question_no NULLS LAST, rq.sub_no
      LIMIT $${params.length}`,
    params
  )
  return rows.map(attachEffectiveAnswer)
}

/** 单题可改字段（老师校对用）。 */
export async function updatePaperQuestion(id, patch = {}) {
  const sets = []
  const params = [id]
  const put = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`) }
  if ('content' in patch) put('content', patch.content)
  if ('options' in patch) { params.push(JSON.stringify(patch.options || [])); sets.push(`options = $${params.length}::jsonb`) }
  if ('question_type' in patch) put('question_type', normalizeQuestionType(patch.question_type))
  if ('answer' in patch) {
    put('answer', patch.answer == null || patch.answer === '' ? null : String(patch.answer))
    // 老师手填的答案必须与「卷面印刷」区分开 —— 这是「答案一定要对」的留痕
    params.push(patch.answer == null || patch.answer === '' ? null : 'manual')
    sets.push(`answer_source = $${params.length}`)
  }
  if ('difficulty' in patch) put('difficulty', patch.difficulty == null ? null : Number(patch.difficulty))
  if ('tags' in patch) { params.push(Array.isArray(patch.tags) ? patch.tags : []); sets.push(`tags = $${params.length}::text[]`) }
  if (!sets.length) return null
  const { rows } = await query(
    `UPDATE resource_questions SET ${sets.join(', ')} WHERE id = $1 RETURNING ${RQ_COLS}`,
    params
  )
  return rows[0] || null
}

/** 一份卷子的题目数（列表页用）。 */
export async function countPaperQuestions(resourceId) {
  const { rows } = await query(
    'SELECT COUNT(*)::int AS n FROM resource_questions WHERE resource_id = $1',
    [resourceId]
  )
  return rows[0]?.n || 0
}
