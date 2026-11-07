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
import crypto from 'crypto'
import { query, transaction } from '../config/neon.js'
import { uploadImage } from './ossService.js'
import { renderPdfToJpegs } from './pdfService.js'
import {
  buildOCRPrompt, callVisionCompletion, GENERAL_OCR_VENDOR_CHAIN,
  PAPER_BANK_OCR_VERIFY_CHAIN, PAPER_BANK_OCR_ARBITER_CHAIN,
} from '../config/ai.js'
import { measurePageQuestionBoxes } from './questionBoxMeasure.js'
import { planSubrowFigureAssignments, analyzeCropFigure } from './paperFigureAssign.js'
import { stripPageRulingLines } from './pageRulingClean.js'
import { extractClipFigure } from './clipFigureClean.js'

// 分批 OCR 并发上限。与练习册答案页 OCR 同口径（OCR_PAGE_CONCURRENCY 默认 3）：
// 瞬时并发打满会触发供应商限流（2026-09-09 全本错位事故的成因之一）。
export const PAPER_OCR_CONCURRENCY = Number(process.env.PAPER_OCR_CONCURRENCY || 3)

// 单份卷子最多解析多少页 —— 防止误传整本书把额度打光。
export const PAPER_MAX_PAGES = Number(process.env.PAPER_MAX_PAGES || 60)

// 解析页图与裁片的缩放。scale 2 足够 OCR 与讲义缩略，且裁片体积可控。
const RENDER_SCALE = 2

// 裁片/整页图专用高清渲染（2026-11-03 负责人定调「要高清，不要矢量」）。
// OCR 仍用 2x（视觉模型内部会缩放，拉大只烧 token）；裁片与 page_image_url 用 4x：
// A4 基准 595×842pt ⇒ 4x = 2382×3368（≈288dpi），矢量线条/字母真实细节翻倍，
// 讲解版 PDF（280×210mm）300dpi 打印/放大时不糊、无锯齿（2x 只有 ~144dpi，4x 下裁片区域
// 1819px 打印像素有 2144px 源，够用）。maxEdge 必须同步抬高（默认 2048 会把 4x 压回 2.4x）。
const CROP_RENDER_SCALE = 4
const CROP_RENDER_MAX_EDGE = 4096
const CROP_RENDER_QUALITY = 0.92 // canvas.toBuffer 的 jpeg 质量是 0~1（不是 sharp 的 0~100）

// ── 配图上传去重（2026-11-06）──
// 同一道题的多个小问各自裁图时，裁出来常常是**字节完全相同**的一张图
// （小问行自己没有图，整组都落在题干那张图上）。逐行上传会给同一幅图造出 N 个 URL，
// 页面只能按 URL 判重 ⇒ 「同一幅图连贴 N 张」——负责人两次报障（徐汇一模 20 的三张表格图、
// 嘉定一模 22(2) 的正文图）在修掉「图本身错」之后，剩下的就是这一种重复形态。
// 以内容 md5 做 memo：同一份字节在**本页解析内**只上传一次，多行共用同一个 URL，
// 页面侧 showFigure 据此只显示一次（判据见 src/workbench/utils/paperRowDisplay.js）。
// ⛔ 只按内容判等，不按文件名/题号——文件名里含行下标，天然各不相同。
async function uploadFigureOnce(buf, name, memo) {
  const key = crypto.createHash('md5').update(buf).digest('hex')
  const hit = memo.get(key)
  if (hit) return hit
  const url = await uploadImage(buf, name, 'paper-bank')
  if (url) memo.set(key, url)
  return url
}

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

/**
 * 卷面题号归一（2026-11-06 漏题事故）：
 * 模型给题号的方式并不统一 —— 见过 `6`、`"6"`、`"6."`、`"第6题"`、`"（6）"`、`"6、10分"`。
 * 旧实现只做 `Number(q.question_number)`，上面除前两种外**全部得到 NaN**，于是整页题号被兜底
 * 从 1 重编，跟第 1 页撞车，落库去重时被当成重复题静默丢弃（嘉定一模 p2 的 6—10 题就这么没的）。
 * 这里统一抠出开头的阿拉伯数字；一页里出现「6 和 6(1) 和 6(2)」这类，数字部分相同是小问的事，
 * 由 sub_no 区分。认不出返回 null（表示「卷面题号不可知」，交给全卷补号），绝不猜。
 */
export function normalizeQuestionNo(raw) {
  if (raw == null) return null
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : null
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    // 个别模型给 { value: 6 } / { no: "6" }
    const inner = raw.value ?? raw.no ?? raw.number
    return inner == null ? null : normalizeQuestionNo(inner)
  }
  const s = String(raw).trim()
  if (!s) return null
  // 跳过前导的「第」「(」「（」空白，取开头第一段连续数字（"6." / "第6题" / "6、10分" 都取 6）
  const m = s.match(/^[\s第\(（\[【]*?(\d{1,3})/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
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
 * 全卷题号唯一化（2026-11-06 漏题事故）。
 *
 * 规则：**卷面印的题号一律不动**；只给「模型没给题号」的行补号，且必须全卷唯一。
 * 补号位置 = 该行之前出现过的最大印刷题号 + 1，并跳过任何在别处出现过的印刷题号。
 * 这样「第 2 页整页缺号」会被补成接在第 1 页后面，而不是从 1 重来跟第 1 页撞车。
 *
 * ⛔ 不能退回「每页从 1 数」：唯一键是 (resource_id, unit_id, question_no, sub_no)，
 *   跨页撞号会让 replacePaperQuestions 把**真题目**当重复丢掉（嘉定一模丢了 6—10 题）。
 * ⛔ 也不能简单「补成大于全卷最大号」：那样缺号题会全部排到卷末，页序与题号彻底错位，
 *   出卷时按题号排序就会把第 2 页的题排到最后。
 */
export function assignGlobalQuestionNumbers(rows) {
  const printed = new Set()
  for (const r of rows) {
    const n = Number(r?.question_no)
    if (r?.__printedNo && Number.isFinite(n)) printed.add(n)
  }

  let cursor = 0
  let filled = 0
  for (const r of rows) {
    const n = Number(r?.question_no)
    if (r?.__printedNo && Number.isFinite(n)) {
      r.question_no = n
      if (n > cursor) cursor = n
      continue
    }
    if (r?.__printedNo === false || !Number.isFinite(n)) {
      cursor += 1
      let guard = 0
      while (printed.has(cursor) && guard++ < 500) cursor += 1
      r.question_no = cursor
      filled += 1
    }
  }
  return { filled, printedMax: printed.size ? Math.max(...printed) : 0, printedCount: printed.size }
}

/** 文本相似度（字符二元组 Jaccard），用于判断「两行是不是同一道题被重复识别」。 */
export function textSimilarity(a, b) {
  const norm = (s) => String(s || '').replace(/[\s\$\\{}^_]/g, '').replace(/[（]/g, '(').replace(/[）]/g, ')')
  const A = norm(a)
  const B = norm(b)
  if (!A || !B) return A === B ? 1 : 0
  if (A === B) return 1
  const grams = (s) => {
    const set = new Set()
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
    return set
  }
  const ga = grams(A)
  const gb = grams(B)
  let inter = 0
  for (const g of ga) if (gb.has(g)) inter += 1
  const union = ga.size + gb.size - inter
  return union > 0 ? inter / union : 0
}

/**
 * 题号撞车处理（纯函数，可单测）。
 *   ① 同一页重复：模型把同一题认了两遍 → 丢后一条，计入 duplicated；
 *   ② 不同页 + 正文高度相似（≥ 0.6）：同一题被邻页重读/答题卡复述 → 丢后一条；
 *   ③ 不同页 + 正文明显不同：**两道真题目撞了号**（补号出错或卷面重号），
 *      改号到全卷最大号之后保留，计入 renumbered —— 宁可多一行让老师删，绝不静默少一行。
 * ⛔ 旧实现是无条件「保留首次」：嘉定一模第 2 页整页被编成 1—7，与第 1 页 1—5 撞号，
 *   5 道真题就这样消失了，而 warning 只说「重复题号（多为答题卡页）」，没人会去查。
 */
export function dedupePaperRows(rows, { similarity = 0.6 } = {}) {
  const seen = new Map() // key → 首次出现的行
  const kept = []
  let duplicated = 0
  let renumbered = 0
  const dropped = []
  const renumberedRows = []

  let maxNo = 0
  for (const r of rows) {
    const n = Number(r?.question_no)
    if (Number.isFinite(n) && n > maxNo) maxNo = n
  }
  let spill = maxNo

  for (const r of rows) {
    const key = `${String(r.question_no ?? '')}|${String(r.sub_no || '')}`
    const prev = seen.get(key)
    if (!prev) {
      seen.set(key, r)
      kept.push(r)
      continue
    }
    const samePage = Number(prev.page_no) === Number(r.page_no)
    const sim = textSimilarity(prev.content, r.content)
    if (samePage || sim >= similarity) {
      duplicated += 1
      dropped.push({ page: r.page_no, no: r.question_no, sub: r.sub_no || '', keepPage: prev.page_no, sim: Number(sim.toFixed(2)) })
      continue
    }
    // 撞号且内容不同 ⇒ 真题目，改号保留
    let fresh = ++spill
    let guard = 0
    while (seen.has(`${fresh}|${String(r.sub_no || '')}`) && guard++ < 500) fresh = ++spill
    const oldNo = r.question_no
    r.question_no = fresh
    seen.set(`${fresh}|${String(r.sub_no || '')}`, r)
    kept.push(r)
    renumbered += 1
    renumberedRows.push({ page: r.page_no, from: oldNo, to: fresh, sub: r.sub_no || '', otherPage: prev.page_no })
  }
  return { rows: kept, duplicated, renumbered, dropped, renumberedRows }
}

/**
 * 用一批新行**整体替换**某份卷子的题目清册。
 * 为什么是「先删后插」而不是 upsert：重新解析时题号可能变（切段算法/OCR 结果变了），
 * upsert 会留下一批孤儿行；整卷替换是唯一能让「库里 = 本次解析结果」的写法。
 * ⛔ 全程在事务里，失败不留半份数据。
 * 去重口径见 dedupePaperRows()。
 */
export async function replacePaperQuestions(resourceId, rows) {
  const { rows: deduped, duplicated, renumbered, dropped, renumberedRows } = dedupePaperRows(rows)

  if (duplicated > 0) {
    console.warn(`[paperBank] 卷 ${resourceId}：${duplicated} 行同题重复（同页重读或邻页复述），已保留首次识别`)
  }
  if (renumbered > 0) {
    console.warn(`[paperBank] 卷 ${resourceId}：${renumbered} 行题号撞车但内容不同，已改号保留（未丢数据）`)
  }

  await transaction(async (client) => {
    await client.query('DELETE FROM resource_questions WHERE resource_id = $1', [resourceId])
    for (const r of deduped) {
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
  return { duplicated, renumbered, dropped, renumberedRows }
}

// ── 单页 → 题目行 ──

// ── 一模卷零错字闸：双模型交叉校验（2026-11-06）────────────────────────────
// 事故：嘉定 23(2)「AC·DF」→「AC²-DE²」、24(2)②「△PDE」→「△PBE」，
//   且三套一模卷全量复核又查出 80+ 处字母/数字误读。单模型转录不可信。
// 流程：主模型转录 → 第二模型逐字挑错 → 最强模型**不看候选**独立抄回卷面字符，
//   两个抄本一致才自动改；不一致 / 看不清只标记「待人工核对」，绝不猜。
// ⛔ 任何一步失败都只降级（题目照存 + 标记未复核），绝不阻塞解析。
const OCR_PROOFREAD_SYSTEM = [
  '你是中考数学一模卷的 OCR 逐字校对员。给你一页试卷扫描图和这一页题目的 OCR 转录 JSON。',
  '逐字对照卷面，找出**会改变题意或答案**的字符错误：字母（B/D/P、O/0）、三角形顶点顺序、',
  '上下标与平方、数字、正负号、乘号与减号、三角函数名、向量符号、选项内容。',
  '⛔ 忽略纯排版差异：空格、标点全半角、LaTeX 包装、公式写法、题号前缀、换行。',
  '⛔ 不要用数学常识猜「应该是什么」，只读印刷字符；看不清就不要报。',
  '只输出 JSON：{"differences":[{"idx":0,"field":"content","ocr_text":"△PBE","printed_text":"△PDE","reason":"..."}]}',
  'idx 是转录数组下标，field 只能是 content / parent_stem / options。没有差异返回空数组。',
].join('\n')

const OCR_TRANSCRIBE_SYSTEM = [
  '你是中考数学一模卷的逐字抄录员。给你一页试卷扫描图和若干「待抄录位置」。',
  '每条给出题号、字段和库里 OCR 文本片段；请在卷面上找到该题，把**对应位置印的字符**原样抄回。',
  '⛔ 不要参考任何候选答案，不要用数学关系推测，只看印刷字符。',
  '看不清或卷面上找不到对应题目就写 uncertain:true，printed_text 留空。',
  '只输出 JSON：{"transcripts":[{"j":0,"printed_text":"△PDE","uncertain":false}]}，j 必须覆盖全部条目。',
].join('\n')

/**
 * 对一页主 OCR 结果做双模型交叉校验。
 * @returns {{rows:object[], review:object[], checked:number, corrected:number, skipped:boolean}}
 */
export async function crossCheckPageOcr({ imageDataURL, rows, pageNumber, logger = console }) {
  const empty = { rows, review: [], checked: 0, corrected: 0, skipped: false }
  if (!rows.length) return empty
  try {
    const snapshot = rows.map((r, i) => ({
      idx: i, question_no: r.question_no, sub_no: r.sub_no,
      content: r.content, parent_stem: r.parent_stem ?? null, options: r.options || [],
    }))
    // ① 不同供应商的第二模型逐字挑错
    const proof = await callVisionCompletion({
      imageDataURL,
      systemPrompt: OCR_PROOFREAD_SYSTEM,
      userText: '这一页题目的 OCR 转录如下，请逐字对照卷面：\n' + JSON.stringify({ questions: snapshot }),
      temperature: 0.05, maxTokens: 4096,
      vendorChain: PAPER_BANK_OCR_VERIFY_CHAIN,
      // ⛔ 闸是「字母级零错字」任务，配额打爆时绝不许静默降级到备份弱模型：
      //    弱模型做逐字挑错会自己编差异，比不校对更坏。宁可本页标记「未复核」。
      noBackup: true,
    })
    const diffs = (parseJsonLoose(proof.content)?.differences || [])
      .filter(d => Number.isInteger(Number(d.idx)) && rows[Number(d.idx)] && d.printed_text && d.ocr_text && d.ocr_text !== d.printed_text)
      .map(d => ({
        idx: Number(d.idx),
        field: ['content', 'parent_stem', 'options'].includes(d.field) ? d.field : 'content',
        ocr_text: String(d.ocr_text), printed_text: String(d.printed_text), reason: String(d.reason || ''),
      }))
    if (!diffs.length) return { ...empty, checked: rows.length }

    // ② 最强模型独立抄录（⛔ 不给候选 printed_text，避免被带偏）
    const ask = diffs.map((d, j) => ({
      j, question_no: rows[d.idx].question_no, sub_no: rows[d.idx].sub_no,
      field: d.field, ocr_text: d.ocr_text,
    }))
    const arb = await callVisionCompletion({
      imageDataURL,
      systemPrompt: OCR_TRANSCRIBE_SYSTEM,
      userText: '待抄录位置：\n' + JSON.stringify(ask),
      temperature: 0.05, maxTokens: 4096,
      vendorChain: PAPER_BANK_OCR_ARBITER_CHAIN,
      noBackup: true, // 同上：终裁必须是最强视觉本尊，降级等于让弱模型替卷面作证
    })
    const transcripts = new Map(
      (parseJsonLoose(arb.content)?.transcripts || []).map(t => [Number(t.j), t])
    )
    const norm = (s) => String(s ?? '').replace(/\s+/g, '')
    const review = []
    let corrected = 0
    for (let j = 0; j < diffs.length; j++) {
      const d = diffs[j]
      const t = transcripts.get(j)
      const agree = t && !t.uncertain && norm(t.printed_text) === norm(d.printed_text)
      const row = rows[d.idx]
      const cur = d.field === 'options' ? (row.options || []) : (row[d.field] ?? '')
      const hit = Array.isArray(cur)
        ? cur.some(x => String(x).includes(d.ocr_text))
        : String(cur).includes(d.ocr_text)
      if (!hit) continue // 锚点不在库里文本中 ⇒ 宁可不改，也不整段覆盖
      if (agree) {
        if (Array.isArray(cur)) {
          let done = false
          row.options = cur.map(x => {
            if (!done && x.includes(d.ocr_text)) { done = true; return x.replace(d.ocr_text, d.printed_text) }
            return x
          })
        } else {
          row[d.field] = String(cur).replace(d.ocr_text, d.printed_text)
        }
        corrected += 1
      } else {
        review.push({
          page_no: pageNumber, question_no: row.question_no, sub_no: row.sub_no,
          field: d.field, ocr_text: d.ocr_text, suggested_text: d.printed_text,
          arbiter_text: t?.printed_text ?? null, reason: d.reason,
        })
      }
    }
    return { rows, review, checked: rows.length, corrected, skipped: false }
  } catch (e) {
    logger.warn?.(`[paperBank] 第 ${pageNumber} 页双模型复核失败（题目照存、标记未复核）: ${e.message}`)
    return { rows, review: [], checked: 0, corrected: 0, skipped: true, error: String(e?.message || e).slice(0, 200) }
  }
}

/** 按归一化区间（0-1000）从整页图裁出该题区域。裁不动就返回 null（不编造图）。 */
export async function cropQuestionImage(pageBuffer, box) {
  if (!box) return null
  // 先剥掉页面印刷装订竖线（嘉定/徐汇一模实测每张裁片右缘带线，见 pageRulingClean.js）。
  const page = await stripPageRulingLines(pageBuffer)
  const meta = await sharp(page).metadata()
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
    // quality 92：82 在 4x 细节上会引入可见块状伪影（老师报障「锯齿」的一部分）。
    // ⛔ 必须 withMetadata({icc:'srgb'})：否则输出的裁片是无头 JPEG（ffd8ffdb）、
    //    色彩空间未知，下游抠图 sharp(...).raw() 直接抛「colourspace: parameter
    //    space not set」⇒ 图形带提取永远 null、静默回退整张裁片（配图带文字）。
    return await sharp(page).extract({ left, top, width, height })
      .withMetadata({ icc: 'srgb' })
      .jpeg({ quality: 92 })
      .toBuffer()
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
export async function parsePageToQuestions({ pageBuffer, cropPageBuffer = null, pageNumber, logger = console }) {
  const imageDataURL = 'data:image/jpeg;base64,' + pageBuffer.toString('base64')
  // 裁片/整页图一律走高清页（4x）；没给（拍照上传/高清渲染失败）就退回解析页。
  const hiPage = cropPageBuffer || pageBuffer

  const { content } = await callVisionCompletion({
    imageDataURL,
    systemPrompt: buildOCRPrompt(),
    // 2026-11-06 嘉定一模 23(2) 事故：卷面「BC·CF = AC·DF」被 OCR 成「BC·CF = AC² - DE²」，
    // 乘号后的字母被臆造成平方与减号。只给试卷题库这条链加逐字照抄约束，
    // ⛔ 不改全局 buildOCRPrompt（批改主链路与练习册共用，不能动）。
    userText: '请识别这张试卷页面上的全部题目，按 JSON 格式返回。求证/计算类等式必须逐字照抄卷面：'
      + '乘号「·」后面的字母不得改写成上标平方或减号，字母不得互换、不得增删项'
      + '（反例：卷面 AC·DF 不能写成 AC²-DE²）。看不清的字符宁可照原样保留，也不要用数学关系猜补。'
      // 卷面表格：OCR 原来只抄裸竖线（`| x | ... | -4 |`），不带 markdown 分隔行，
      // 页面就渲染成一串裸竖线（徐汇/杨浦一模 20 题的 x-y 对应值表实测）。
      // 要求补一行分隔行后，渲染器走标准表头路径，PDF/讲义同口径。
      + '卷面上的表格必须用 markdown 管道表返回，并在数据行前补一行分隔行（如 |---|），'
      + '不要在表格外复制一份表格文字。',
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
    pageImageUrl = await uploadImage(hiPage, `paper-p${pageNumber}.jpg`, 'paper-bank')
  } catch (e) {
    logger.warn?.(`[paperBank] 第 ${pageNumber} 页整页图上传失败: ${e.message}`)
  }

  // 题号：**这里只记录卷面印刷的题号**，缺号（null）留给 parsePaperResource 在全卷范围内补。
  // ⛔ 2026-11-06 漏题事故（嘉定一模丢 6—10 题、徐汇丢 19/24 题）根因就在这里：
  //   旧代码在本函数内「以本页最大题号为起点顺延」补号；只要某页模型没给出可解析的题号
  //   （"第6题"/"6."/"（6）" 都会被 Number() 判成 NaN），整页就被编成 1—7，
  //   与第 1 页的 1—5 撞车，落库时按「题号+小问」跨整卷去重 ⇒ 真题目被当成重复静默丢弃，
  //   只在 metadata 留一句「识别出 N 行重复题号（多为答题卡页重复识别）」，谁也不会去查。
  //   补号必须**全卷唯一**：见 assignGlobalQuestionNumbers()。
  const rows = rawList.map((q, i) => {
    const subNo = q?.sub_no == null ? '' : String(q.sub_no)
    const qno = normalizeQuestionNo(q?.question_number)
    const printedAnswer = q?.answer == null ? '' : String(q.answer).trim()
    return {
      __key: `${pageNumber}:${i}`,
      question_no: qno,
      __printedNo: qno != null,
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

  // ⭐ 一模卷零错字闸（2026-11-06）：主 OCR 之后，两个不同供应商的强模型再独立看同一页。
  // 两处抄本一致 ⇒ 自动修正；不一致 / 看不清 ⇒ 只标记待人工核对；调用失败 ⇒ 题目照存、标记未复核。
  const cross = await crossCheckPageOcr({ imageDataURL, rows, pageNumber, logger })

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
      // 裁片缓冲按行留底：下面的「小问组配图共享」要用同一份像素判图，
      // 不再重复 cropQuestionImage（4x 图重复裁一次就是一次多余的 sharp 解码）。
      const figBands = new Map()   // 行下标 → 该行自己的干净图形带
      const figureUploads = new Map()  // 内容 md5 → 已上传 URL（同页同一份字节只传一次）
      for (let i = 0; i < rows.length; i++) {
        const box = measured?.boxes?.[String(i)]
        if (!box) continue
        rows[i].bbox = box
        const cropped = await cropQuestionImage(hiPage, box)
        if (!cropped) continue
        // ── 配图只承载「图形」（2026-11-06）──
        // 负责人报障两例：徐汇一模 20 的三个小问各贴同一张表格图、嘉定一模 22(2) 贴的
        // 是它自己那段正文。两者都是「把裁片当配图」的必然结果：裁片是**整行区域**，
        // 纯文字行裁出来就是题干的重影，老师看到的是同一段字被贴了两遍。
        // 现在的判据：先判这片区域**有没有图**（analyzeCropFigure），
        //   ① 有图且能裁干净 → 用干净图形带；
        //   ② 有图但裁不干净（多图版式/图形与正文交错）→ 整张裁片兜底（宁可带文字，不可丢图）；
        //   ③ **没有图 → 不挂配图**（image_url 留空），页面只显示「看原卷」。
        const fig = await analyzeCropFigure(cropped)
        if (!fig.hasFigure) continue
        if (fig.band) figBands.set(i, fig.band)
        const imgBuf = fig.band || cropped
        const kind = fig.band ? 'fig' : 'crop'
        try {
          // ⛔ 文件名必须**逐行唯一**（2026-11-06）：
          //   ① 题号可能为 null（模型没给号，等全卷补号）⇒ 原来是 `-qnull.jpg`，
          //      同页多道缺号题的裁片会互相覆盖，最后所有行都指向同一张图；
          //   ② 同一道题的多个小问 question_no 相同 ⇒ 原来只用题号命名，
          //      后一个裁片覆盖前一个，第 (1) 问显示的是 (2) 问的图。
          //   行下标 i 天然唯一，拼进去一次性解决两种覆盖。
          rows[i].image_url = await uploadFigureOnce(
            imgBuf, `paper-p${pageNumber}-q${rows[i].question_no ?? 'n'}-r${i}-${kind}.jpg`, figureUploads)
        } catch (e) {
          logger.warn?.(`[paperBank] 第 ${pageNumber} 页第 ${rows[i].question_no} 题配图上传失败: ${e.message}`)
        }
      }

      // ── 小问组配图共享（2026-11-02 建；2026-11-06 按嘉定一模 22 事故重写判据）──
      // 切段以「题号行上沿」为界：「题干→小问→图块在最后」版式的图会整段落进
      // 最后一个下问的切段，其余小问只切到自己的一行文字条（显示为细线 = 没图，
      // 徐汇一模 25(1)(2) 实测）。组内把图补给文字条行；失败只降级为「维持现状」。
      //
      // ⛔ 2026-11-06 事故（嘉定一模 22）：旧实现用 bbox 高度猜「谁是带图行」，
      //   抠不出干净图形带就**整张源裁片兜底**。(2) 的切段高 200（三行正文 + 一条
      //   EF 线段）被猜成带图行 ⇒ 兜底成 (2) 的正文 ⇒ 补给 (1)：(1)(2) 都拿着 (2)
      //   的正文，(1) 真正要的图（题干材料框里的作图）彻底消失。
      // 新判据是**正证据**（详见 paperFigureAssign 文件头）：
      //   ① 先逐行实测「能不能抠出图形带」，抠得出来的才算图源；
      //   ② 图源优先整题行（题干图才是「如图」那张），其次组内最高的小问；
      //   ③ target 只收自己无图 + 一行文字条的行，高裁片绝不覆盖；
      //   ④ 抠不出图 ⇒ 不共享、不兜底。
      try {
        // figBands 已在上面的裁片循环里算好（一行只判一次图，不重复解码）
        // withFigure：所有「有图」的行（含抠不干净挂整张的），这些行绝不能被共享覆盖
        const withFigure = new Set()
        rows.forEach((r, i) => { if (r.image_url) withFigure.add(i) })
        const figPlans = planSubrowFigureAssignments(rows, figBands, { withFigure })
        const sourceDone = new Set()
        for (const pl of figPlans) {
          const src = rows[pl.sourceIdx]
          const tgt = rows[pl.targetIdx]
          const figBuf = figBands.get(pl.sourceIdx)
          if (!figBuf) continue
          // source 行也换成同一张干净图形带（避免该页图带小问文字 + 高裁片）
          if (!sourceDone.has(pl.sourceIdx)) {
            sourceDone.add(pl.sourceIdx)
            try {
              src.image_url = await uploadFigureOnce(
                figBuf,
                `paper-p${pageNumber}-q${src.question_no}-s${src.sub_no || 'x'}-figsrc.jpg`,
                figureUploads
              )
            } catch (e) {
              logger.warn?.(`[paperBank] 小问配图共享(source)上传失败 q${src.question_no}(${src.sub_no}): ${e.message}`)
            }
          }
          try {
            tgt.image_url = await uploadFigureOnce(
              figBuf,
              `paper-p${pageNumber}-q${tgt.question_no}-s${tgt.sub_no || 'x'}-fig.jpg`,
              figureUploads
            )
          } catch (e) {
            logger.warn?.(`[paperBank] 小问配图共享上传失败 q${tgt.question_no}(${tgt.sub_no}): ${e.message}`)
          }
        }
      } catch (e) {
        logger.warn?.(`[paperBank] 小问配图共享失败（不影响主流程）: ${e.message}`)
      }
    }
  } catch (e) {
    logger.warn?.(`[paperBank] 第 ${pageNumber} 页切段异常（题目照存、无裁片）: ${e.message}`)
  }

  return {
    rows,
    pageTitle: obj?.page_title || null,
    sectionTitle: obj?.section_title || null,
    ocrReview: cross.review,
    ocrChecked: cross.checked,
    ocrCorrected: cross.corrected,
    ocrSkipped: cross.skipped,
  }
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
// ── 卷面题号清点闸（2026-11-06 漏题事故）─────────────────────────────────────
// 事故：嘉定一模 p2 卷面 7 题只入库 2 题、徐汇 p4/p7 各漏 1 题，**页面毫无异常**，
//   直到老师自己发现。任何「逐字校对」都查不出漏题 —— 校对的对象是已入库的行，
//   没入库的题根本不在比对范围里。所以要有一道独立于 OCR 的清点：
//   直接问「这一页印了哪几个大题号」，与库里该页的题号做差集。
// 判读：卷面有、库里没有 = 漏题（必须报）；库里有、卷面没有 = 题号错/多录（必须报）；
//   整页无大题号 = 续页（杨浦 p6 是 25 题正文的延续），跳过不误报。
// ⛔ 调用失败不许当「没问题」：计入 unverified 并在界面显示「未核对」，绝不静默放过。
const COVERAGE_PAGE_PROMPT = [
  '你是试卷版面清点员。只看这张试卷扫描图，清点**本页印刷的大题号**。',
  '规则：',
  '1. 只输出卷面上真实印着的题号数字（形如 6. 7. 8.），按从上到下顺序。',
  '2. ⛔ 不要按顺序推断或补号，不要把小问号（(1)(2)(3)）当成大题号，不要读选项标号 A/B/C/D。',
  '3. 本页若是上一页某题的延续、整页没有任何大题号，question_numbers 返回空数组。',
  '4. 看不清的题号不要猜，宁可不报。',
  '只输出 JSON：{"question_numbers":[6,7,8]}',
].join('\n')

/**
 * 逐页清点卷面题号，与库里该页的题号做差集。返回可直接落 metadata 的结果对象。
 * @returns {{pages:Array, summary:Object}}
 */
export async function auditPaperCoverage({ pageBuffers, dbRows, logger = console }) {
  const byPage = new Map()
  for (const r of dbRows || []) {
    const p = Number(r.page_no)
    if (!Number.isFinite(p)) continue
    if (!byPage.has(p)) byPage.set(p, new Set())
    const n = Number(r.question_no)
    if (Number.isFinite(n)) byPage.get(p).add(n)
  }

  let unverified = 0
  const results = await mapWithConcurrency(pageBuffers, 2, async (buf, idx) => {
    const pageNo = idx + 1
    const dbNums = [...(byPage.get(pageNo) || new Set())].sort((a, b) => a - b)
    try {
      // 清点用高清页：题号是大字，但仍然走 4x（复用已渲染的，不额外渲染）
      const { content } = await callVisionCompletion({
        imageDataURL: 'data:image/jpeg;base64,' + buf.toString('base64'),
        systemPrompt: COVERAGE_PAGE_PROMPT,
        userText: '请清点本页印刷的全部大题号。',
        temperature: 0,
        maxTokens: 512,
        vendorChain: GENERAL_OCR_VENDOR_CHAIN,
      })
      const obj = parseJsonLoose(content)
      const raw = Array.isArray(obj) ? obj : (obj?.question_numbers ?? obj?.numbers ?? null)
      if (!Array.isArray(raw)) throw new Error('清点结果不可解析：' + String(content).slice(0, 120))
      const printed = [...new Set(raw.map(normalizeQuestionNo).filter(n => n != null))].sort((a, b) => a - b)
      if (!printed.length) {
        // 续页：整页没有大题号，不比对（库里该页有题是正常现象）
        return { page: pageNo, printed, db: dbNums, missing: [], extra: [], continuation: true }
      }
      const printedSet = new Set(printed)
      const dbSet = new Set(dbNums)
      return {
        page: pageNo,
        printed,
        db: dbNums,
        missing: printed.filter(n => !dbSet.has(n)),
        extra: dbNums.filter(n => !printedSet.has(n)),
        continuation: false,
      }
    } catch (e) {
      unverified += 1
      logger.warn?.(`[paperBank] 第 ${pageNo} 页题号清点失败（按未核对记）: ${String(e?.message || e).slice(0, 160)}`)
      return { page: pageNo, printed: null, db: dbNums, missing: null, extra: null, unverified: true }
    }
  })

  const pages = results.filter(Boolean)

  // 「漏题」与「错页」必须分开（2026-11-06 实测数据暴露）：
  //   徐汇卷面第 4 页印了 19、20 两个题号，20 的正文续到第 5 页，OCR 把这一行记成 page_no=5
  //   ⇒ 第 4 页「少了 20」、第 5 页「多了 20」。这不是漏题，是**题号记错页**。
  //   若混在一起报，老师会以为丢题（吓人），真正丢的题反而被噪音淹没。
  // 判定：某页缺的题号，若在相邻页（±1）多出来，判为错页，从两边都摘掉。
  const shifted = []
  const missingByPage = new Map()
  const extraByPage = new Map()
  const dbByPage = new Map()
  const continuationPages = new Set()
  for (const p of pages) {
    if (!p || p.unverified) continue
    dbByPage.set(p.page, new Set(p.db || []))
    if (p.continuation) { continuationPages.add(p.page); continue }
    missingByPage.set(p.page, new Set(p.missing || []))
    extraByPage.set(p.page, new Set(p.extra || []))
  }
  for (const [page, missSet] of missingByPage) {
    for (const no of [...missSet]) {
      for (const nb of [page + 1, page - 1]) {
        // 相邻页「多出该题号」= 串到下一页；相邻页是**续页**（本页无题号、正文承接）
        // 且库里该题号挂在那页 = 题干跨页、题号行在前一页，也算错页而非漏题（杨浦 q25 实证）。
        const isCont = continuationPages.has(nb)
        const ex = extraByPage.get(nb)
        const hasIt = (ex && ex.has(no)) || (isCont && dbByPage.get(nb)?.has(no))
        if (!hasIt) continue
        if (ex) ex.delete(no)
        missSet.delete(no)
        shifted.push({ no, printedPage: page, dbPage: nb })
        break
      }
    }
  }
  for (const p of pages) {
    if (!p || p.unverified || p.continuation) continue
    p.missing = [...(missingByPage.get(p.page) || [])].sort((a, b) => a - b)
    p.extra = [...(extraByPage.get(p.page) || [])].sort((a, b) => a - b)
  }

  const missing = pages.flatMap(p => (p.missing || []).map(no => ({ page: p.page, no })))
  const extra = pages.flatMap(p => (p.extra || []).map(no => ({ page: p.page, no })))
  return {
    pages,
    summary: {
      pagesChecked: pages.filter(p => !p.unverified && !p.continuation).length,
      pagesContinuation: pages.filter(p => p.continuation).length,
      pagesUnverified: unverified,
      missingCount: missing.length,
      extraCount: extra.length,
      shiftedCount: shifted.length,
      missing: missing.slice(0, 40),
      extra: extra.slice(0, 40),
      shifted: shifted.slice(0, 40),
    },
  }
}

/**
 * 重新解析前清掉上一轮的审计结论（2026-11-06）。
 * parseWarnings / coverageAudit / ocrReview 说的都是「本轮解析」的结果，不清会一直挂着
 * 早已修好的旧告警（同 15 号经验：计数类字段比它读的列表更容易失效）。
 * 用 jsonb 的 `-` 只摘这几个顶层键，不动 pageTitles / sourceFiles。
 */
async function resetParseAudit(resourceId) {
  try {
    await query(
      `UPDATE resources
          SET metadata = COALESCE(metadata, '{}'::jsonb)
                 - 'parseWarnings' - 'coverageAudit' - 'ocrReview' - 'ocrReviewSummary'
        WHERE id = $1`,
      [resourceId]
    )
  } catch (e) {
    console.warn('[paperBank] 清理上轮审计结果失败（不影响解析）:', e.message)
  }
}

export async function parsePaperResource({ resourceId, fileBuffer, mimeType, images, logger = console }) {
  let pages = []
  let hiPages = null // 4x 高清页：只喂裁片/整页图，不喂 OCR（2026-11-03「要高清」）
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
      // 高清页单独渲染一次。失败只降级（裁片退回 2x），绝不阻塞解析。
      try {
        const hi = await renderPdfToJpegs(fileBuffer, {
          scale: CROP_RENDER_SCALE,
          maxPages: pages.length,
          maxEdge: CROP_RENDER_MAX_EDGE,
          quality: CROP_RENDER_QUALITY,
        })
        if (hi?.images?.length) hiPages = hi.images
      } catch (e) {
        logger.warn?.(`[paperBank] 高清页渲染失败（裁片退回 ${RENDER_SCALE}x）: ${e.message}`)
      }
    } else {
      pages = [fileBuffer]
    }
  }
  if (!pages.length) throw new Error('没有可解析的页面')

  await resetParseAudit(resourceId)
  await setPaperParseStatus(resourceId, { status: 'parsing', totalPages: pages.length, donePages: 0 })

  let done = 0
  const pageResults = await mapWithConcurrency(pages, PAPER_OCR_CONCURRENCY, async (buf, idx) => {
    const pageNumber = idx + 1
    try {
      const r = await parsePageToQuestions({
        pageBuffer: buf,
        cropPageBuffer: hiPages?.[idx] || null,
        pageNumber,
        logger,
      })
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
  const ocrReview = []
  let ocrChecked = 0
  let ocrCorrected = 0
  let ocrSkippedPages = 0
  for (const r of pageResults) {
    if (!r || r.__error || r.failed) continue
    rows = rows.concat(r.rows || [])
    if (r.pageTitle) pageTitles.push(r.pageTitle)
    if (Array.isArray(r.ocrReview)) ocrReview.push(...r.ocrReview)
    ocrChecked += Number(r.ocrChecked || 0)
    ocrCorrected += Number(r.ocrCorrected || 0)
    if (r.ocrSkipped) ocrSkippedPages += 1
  }
  // ── 全卷题号唯一化（2026-11-06 漏题事故）──
  // 必须在 deriveAutoTags / 落库之前：缺号行要拿到全卷唯一的题号，
  // 否则跨页撞号会在 replacePaperQuestions 里被当成「重复题」处理。
  const numbering = assignGlobalQuestionNumbers(rows)
  if (numbering.filled > 0) {
    await appendParseWarning(
      resourceId,
      `${numbering.filled} 行模型未给出卷面题号，已按页序补号（补在相邻印刷题号之间，全卷唯一），请核对题号`
    )
  }
  rows = deriveAutoTags(rows)

  if (!rows.length) {
    throw new Error('整份卷子没有识别出任何题目（可能是扫描质量过低，或页面不是题目页）')
  }

  const { duplicated, renumbered, dropped, renumberedRows } = await replacePaperQuestions(resourceId, rows)
  if (duplicated > 0) {
    // 明细必须写出来：旧版只说「N 行重复题号（多为答题卡页重复识别）」，
    // 恰恰是这句含糊的话把「真题目被吞掉」掩盖了 6 天。
    const detail = dropped.slice(0, 8)
      .map(d => `第${d.page}页题${d.no}${d.sub ? `(${d.sub})` : ''}≈第${d.keepPage}页同名题`)
      .join('、')
    await appendParseWarning(resourceId, `识别出 ${duplicated} 行重复题（同页重读或邻页复述，正文相似），已保留首次识别：${detail}`)
  }
  if (renumbered > 0) {
    const detail = renumberedRows.slice(0, 8).map(d => `第${d.page}页题${d.from}→${d.to}`).join('、')
    await appendParseWarning(resourceId, `${renumbered} 行题号与别页撞车但正文不同，已改号保留（未丢题）：${detail}，请核对该题题号`)
  }
  await setPaperParseStatus(resourceId, { status: 'done', donePages: pages.length })

  // ── 落库后自动清点（2026-11-06）──
  // 独立于 OCR 再问一次「每页印了哪几个题号」，与库里差集比对：漏题/串号必须在页面可见。
  // 这是唯一能发现「整道题没入库」的环节 —— 逐字校对只覆盖已入库的行。
  // 失败不阻塞：写入 coverageAudit.summary.pagesUnverified，界面显示「未核对」。
  try {
    const dbRows = (await query(
      `SELECT page_no, question_no FROM resource_questions WHERE resource_id = $1`,
      [resourceId]
    )).rows
    const audit = await auditPaperCoverage({
      pageBuffers: pages.map((p, i) => hiPages?.[i] || p),
      dbRows,
      logger,
    })
    await query(
      `UPDATE resources
          SET metadata = COALESCE(metadata, '{}'::jsonb)
               || jsonb_build_object('coverageAudit', $2::jsonb)
        WHERE id = $1`,
      [resourceId, JSON.stringify({ at: new Date().toISOString(), ...audit })]
    ).catch(e => logger.warn?.(`[paperBank] 清点结果回填失败: ${e.message}`))

    if (audit.summary.missingCount > 0) {
      const detail = audit.summary.missing.slice(0, 10).map(m => `第${m.page}页题${m.no}`).join('、')
      await appendParseWarning(resourceId, `卷面有 ${audit.summary.missingCount} 个题号没入库：${detail}，请重传该页或手工补录`)
    }
    if (audit.summary.extraCount > 0) {
      const detail = audit.summary.extra.slice(0, 10).map(m => `第${m.page}页题${m.no}`).join('、')
      await appendParseWarning(resourceId, `${audit.summary.extraCount} 个题号在卷面找不到对应：${detail}，请核对题号是否错位`)
    }
    // ⛔ shifted（题干跨页承接）**不写 parseWarnings**：它不是错误 —— 卷面第 4 页印「20.」、
    //   正文续到第 5 页，库里按正文所在页记 page_no 是合理的。写进去只会训练老师忽略告警。
    //   它只用于把「这一页少了个题号」从漏题里摘出来，避免误报（徐汇 20、杨浦 25 实测）。
  } catch (e) {
    logger.warn?.(`[paperBank] 落库后清点整体失败（不影响解析）: ${String(e?.message || e).slice(0, 200)}`)
  }

  // 卷面标题回填到 metadata，方便列表识别是哪一套卷
  if (pageTitles.length) {
    await query(
      `UPDATE resources
         SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('pageTitles', to_jsonb($2::text[]))
       WHERE id = $1`,
      [resourceId, pageTitles.slice(0, 5)]
    ).catch(() => {})
  }

  // 双模型复核结果落 metadata：一致处已自动改，剩下的是「待老师对照原卷核对」的清单。
  // 空数组也要写（表示已复核且无遗留）；复核失败的页单独记进 summary，界面会给提示。
  await query(
    `UPDATE resources
        SET metadata = COALESCE(metadata, '{}'::jsonb)
             || jsonb_build_object('ocrReview', $2::jsonb, 'ocrReviewSummary', $3::jsonb)
      WHERE id = $1`,
    [
      resourceId,
      JSON.stringify(ocrReview.slice(0, 200)),
      JSON.stringify({
        checked: ocrChecked, corrected: ocrCorrected,
        skippedPages: ocrSkippedPages, reviewCount: ocrReview.length,
        at: new Date().toISOString(),
      }),
    ]
  ).catch(e => logger.warn?.(`[paperBank] 复核结果回填失败: ${e.message}`))

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
  oa.unit_title AS official_unit_title, oa.conflict_count AS answer_conflict_count,
  -- 截图来源（2026-11-07）：按「第几张截图」= page_no 存在卷的 metadata.clipSources 里，
  -- 一张截图拆出的多道题共享同一个来源。用相关子查询取，两个读取入口自动都带，
  -- 且不改 FROM / JOIN 结构（listPaperQuestions 没有 JOIN resources）。
  (SELECT r.metadata->'clipSources'->>(rq.page_no::text)
     FROM resources r WHERE r.id = rq.resource_id) AS clip_source`

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
  // 公共题干也会 OCR 错，老师行内校对时要能一起改（2026-11-06 嘉定一模 23(2) 事故）
  if ('parent_stem' in patch) put('parent_stem', patch.parent_stem)
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

// ── 截图入题库（2026-11-06）────────────────────────────────────────────────
//
// 场景：老师看视频/网课时看到一道好题，截图就想收进题库。
// 现有入口要求「先新建卷 → 选卷 → 上传 → 整卷替换」，这个前缀成本远大于收益，
// 于是单独开一条「不建卷、直接截图入库」的路。
//
// 形态：所有截图统一进**同一个**「截图题库」卷（resources.metadata.origin='screenshot'），
// 题号在本卷内接着往后排。老师后期量大了再从这个卷里筛出来整理分类。
//
// ⛔ 三个不能复用（踩一个就会丢题或污染数据）：
//   ① 不能走 parsePaperResource：它落库走 replacePaperQuestions（先删后插），
//      对同一卷第二次截图会把第一批题全部删掉。
//   ② 不能把 assignGlobalQuestionNumbers 的补号结果直接落库：那套补号按「本批页序」从 1 数，
//      每批都从 1 开始，跨批次必然撞唯一键 (resource_id, unit_id, question_no, sub_no)。
//   ③ 不能跑 auditPaperCoverage（逐页题号清点）：截图里通常没有印刷题号，
//      清点会得出「卷面一个题号都没有 / 库里多出 N 个」的假告警，只会训练老师忽略告警。

export const CLIP_LIBRARY_NAME = '截图题库'

// 一次最多收几张截图（老师一次贴十几张已经是极限；再多请分两批）
export const CLIP_MAX_IMAGES = Number(process.env.PAPER_CLIP_MAX_IMAGES || 12)

// 截图是单题小图，并发 2 足够（与主链路同一口径：绝不瞬时打满供应商额度）
const CLIP_CONCURRENCY = 2

/**
 * 取（或首次创建）截图容器卷。
 * ⚠️ 用 module 级 promise 做并发合并：老师连点两次「开始识别」时不能创建出两个容器卷。
 *    正常路径每次都重新查库（幂等），promise 只用于折叠同一瞬时的并发调用。
 */
let clipLibraryPromise = null
export async function getOrCreateClipLibrary() {
  if (clipLibraryPromise) return clipLibraryPromise
  clipLibraryPromise = (async () => {
    const found = await query(
      `SELECT id, name, question_parse_status
         FROM resources
        WHERE resource_type = 'exam' AND metadata->>'origin' = 'screenshot'
        ORDER BY created_at ASC
        LIMIT 1`
    )
    if (found.rows.length) return found.rows[0]
    const created = await query(
      `INSERT INTO resources (resource_type, name, subject, grade, status, answer_status, metadata)
       VALUES ('exam', $1, NULL, NULL, 'draft', 'none', jsonb_build_object('origin', 'screenshot'))
       RETURNING id, name, question_parse_status`,
      [CLIP_LIBRARY_NAME]
    )
    return created.rows[0]
  })().finally(() => { clipLibraryPromise = null })
  return clipLibraryPromise
}

/**
 * 往某个卷**追加**题目（不删已有行）。
 * 题号接续：本批每一行整体平移到「现有最大题号」之后；同一页同一个原题号算同一道题（小问组共享新题号）。
 * @returns {{inserted:number, baseNo:number, lastNo:number}}
 */
export async function appendPaperQuestions(resourceId, rows) {
  if (!Array.isArray(rows) || !rows.length) return { inserted: 0, baseNo: 0, lastNo: 0 }

  const { rows: mx } = await query(
    `SELECT COALESCE(MAX(question_no), 0)::int AS max_no
       FROM resource_questions WHERE resource_id = $1`,
    [resourceId]
  )
  const baseNo = mx[0]?.max_no || 0

  let cursor = baseNo
  const groupNo = new Map()
  const prepared = rows.map((r) => {
    // 同页同原题号 ⇒ 同一道题的小问，必须共用一个新题号（否则 (1)(2)(3) 会被拆成三道题）
    const key = `${r.page_no}|${r.question_no == null ? '__solo' : r.question_no}`
    if (!groupNo.has(key)) { cursor += 1; groupNo.set(key, cursor) }
    return { ...r, question_no: groupNo.get(key), sub_no: r.sub_no || '' }
  })

  let inserted = 0
  await transaction(async (client) => {
    for (const r of prepared) {
      const res = await client.query(
        `INSERT INTO resource_questions
           (resource_id, unit_id, question_no, sub_no, parent_stem, content, options,
            question_type, answer, answer_source, analysis, difficulty, tags,
            page_no, bbox, image_url, page_image_url)
         VALUES ($1, NULL, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12::text[], $13, $14::jsonb, $15, $16)
         ON CONFLICT (resource_id, unit_id, question_no, sub_no) DO NOTHING`,
        [
          resourceId,
          r.question_no ?? null,
          r.sub_no,
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
      inserted += res.rowCount || 0
    }
  })
  // ⛔ 返回真实插入行数：题号接续出错时这里会小于 prepared.length，
  //    前端「已入库 N 道题」按真实数报，不会把静默丢弃说成成功。
  return { inserted, baseNo, lastNo: cursor }
}

/** 删单题（截图截错了 / OCR 多拆出一行时用）。题目行删除不影响卷和其它题。 */
export async function deletePaperQuestion(id) {
  const { rowCount } = await query('DELETE FROM resource_questions WHERE id = $1', [id])
  return rowCount > 0
}

/**
 * 把一批截图解析成题目，追加进「截图题库」卷。
 *
 * 与主链路唯一的分歧在「落库」和「清点」两步，识别/切段/裁片/双模型复核完全同一套零件：
 * parsePageToQuestions 是逐页识别的唯一实现，这里绝不另写一份 OCR。
 *
 * 兜底：OCR 一个字都没读出来的截图**也要存**——老师要的是「把这道题留下来」，
 * 文字识别是加分项。此时补一行只有图、题干待补的题，老师在界面上手填即可。
 */
export async function parseClipImages({ images, sources = [], logger = console }) {
  if (!Array.isArray(images) || !images.length) throw new Error('没有收到截图')
  const batch = images.slice(0, CLIP_MAX_IMAGES)
  const sourceList = (Array.isArray(sources) ? sources : [sources]).slice(0, batch.length)

  const library = await getOrCreateClipLibrary()
  const resourceId = library.id

  // 页号接续：截图按「第几张」记 page_no，老师点「看原卷」时能在多批截图之间定位到那一张
  const { rows: mx } = await query(
    `SELECT COALESCE(MAX(page_no), 0)::int AS max_page
       FROM resource_questions WHERE resource_id = $1`,
    [resourceId]
  )
  const basePage = mx[0]?.max_page || 0

  await setPaperParseStatus(resourceId, { status: 'parsing', totalPages: batch.length, donePages: 0 })

  let done = 0
  const pageResults = await mapWithConcurrency(batch, CLIP_CONCURRENCY, async (buf, idx) => {
    const pageNumber = basePage + idx + 1
    try {
      const parsed = await parsePageToQuestions({ pageBuffer: buf, pageNumber, logger })
      // ── 截图专属配图提取（2026-11-07）──
      // 主链路的「白底黑墨」判据在深底板书截图上必然失效（整页都是墨），
      // 结果是 image_url 为空、旧代码拿整张截图顶上 ⇒ 老师看到人像 + 黑底 + 板书重影。
      // 这里把同一张截图另跑一遍板书净化，拿到白底干净几何图后**覆盖**主链路的裁片。
      let figureUrl = null
      const clean = await extractClipFigure(buf, { logger })
      if (clean.buffer) {
        try {
          figureUrl = await uploadImage(clean.buffer, `clip-p${pageNumber}-fig.jpg`, 'paper-bank')
        } catch (e) {
          logger.warn?.(`[paperBank] 截图第 ${idx + 1} 张配图上传失败: ${e?.message || e}`)
        }
      } else {
        logger.info?.(`[paperBank] 截图第 ${idx + 1} 张未提取到干净配图（${clean.reason}），不挂配图`)
      }
      return { ...parsed, figureUrl }
    } catch (e) {
      logger.warn?.(`[paperBank] 截图第 ${idx + 1} 张识别失败: ${e?.message || e}`)
      return { rows: [], figureUrl: null }
    } finally {
      done += 1
      await setPaperParseStatus(resourceId, { donePages: done }).catch(() => {})
    }
  })

  let rows = []
  for (const r of pageResults) {
    if (!Array.isArray(r?.rows) || !r.rows.length) continue
    // 一张截图拆出的多行（小问组）共用同一张干净配图；页面侧 showFigure 按 URL 只显示一次。
    if (r.figureUrl) for (const row of r.rows) row.image_url = r.figureUrl
    rows = rows.concat(r.rows)
  }

  // OCR 没读出题的截图：整张图存进 OSS 当题，题干留空等老师补
  const emptyIdx = []
  pageResults.forEach((r, idx) => { if (!Array.isArray(r?.rows) || !r.rows.length) emptyIdx.push(idx) })
  for (const idx of emptyIdx) {
    const pageNumber = basePage + idx + 1
    try {
      const url = await uploadImage(batch[idx], `clip-p${pageNumber}.jpg`, 'paper-bank')
      rows.push({
        question_no: null,
        sub_no: '',
        parent_stem: null,
        content: '',
        options: [],
        question_type: 'answer',
        answer: null,
        answer_source: null,
        analysis: null,
        difficulty: null,
        tags: [],
        page_no: pageNumber,
        bbox: null,
        // 一个字都没认出来时，整张原截图仍是老师唯一能补题干的线索 ⇒ page_image_url 必须是原图；
        // 但行内配图优先用净化后的几何图（若有），不把人像/黑底铺在题目下面。
        image_url: pageResults[idx]?.figureUrl || url,
        page_image_url: url,
      })
    } catch (e) {
      logger.warn?.(`[paperBank] 截图第 ${idx + 1} 张存图失败: ${e?.message || e}`)
    }
  }
  if (!rows.length) throw new Error('这批截图没能存下来（图片可能已损坏），请重新截图再传')

  // ⛔ 2026-11-07 撤掉「裁片为空就用整张截图顶上」的兜底（负责人报障的直接根因）。
  // 那句话把带人像、黑背景、板书重影的原始截图当成配图铺在题目下面，与讲解版的
  // 白底干净裁片差了整整一档。现在的口径：提不出干净几何图 ⇒ **不挂配图**，
  // page_image_url 仍是原截图，老师点「看原截图」随时能回看；宁可不给图，不给脏图。
  // （主链路对纯文字题不挂裁片的既有口径不变，此处只改截图这条新路径。）

  // 本批内先补号保证每行有唯一题号，再由 appendPaperQuestions 整体平移到已有题号之后
  assignGlobalQuestionNumbers(rows)
  const { inserted, lastNo } = await appendPaperQuestions(resourceId, rows)

  await setPaperParseStatus(resourceId, { status: 'done', donePages: batch.length })
  await query(
    `UPDATE resources
        SET metadata = COALESCE(metadata, '{}'::jsonb)
             || jsonb_build_object('lastClipAt', to_jsonb($2::text))
      WHERE id = $1`,
    [resourceId, new Date().toISOString()]
  ).catch(e => logger.warn?.(`[paperBank] 截图时间戳回填失败: ${e.message}`))

  // 来源（2026-11-07 负责人需求）：按「第几张截图」= page_no 存，一张图拆出的多题共享来源。
  // 放 resources.metadata.clipSources 是纯加法、零迁移；用 || 合并旧 map，不覆盖同卷其它
  // metadata 键，也不碰多批次已存的来源。
  const clipSources = {}
  sourceList.forEach((s, i) => {
    const v = String(s ?? '').trim().slice(0, 500)
    if (v) clipSources[String(basePage + i + 1)] = v
  })
  if (Object.keys(clipSources).length) {
    await query(
      `UPDATE resources
          SET metadata = COALESCE(metadata, '{}'::jsonb)
               || jsonb_build_object('clipSources',
                    COALESCE(metadata->'clipSources', '{}'::jsonb) || $2::jsonb)
        WHERE id = $1`,
      [resourceId, JSON.stringify(clipSources)]
    ).catch(e => logger.warn?.(`[paperBank] 截图来源回填失败: ${e.message}`))
  }

  return { resourceId, inserted, lastNo, basePage, pages: batch.length, emptyPages: emptyIdx.length }
}
