/**
 * 回填「选择题缺失的选项」（整页 OCR 漏识别选项的存量治理）
 *
 * 背景：
 *   整页 OCR 拆题时，选择题的选项常被整体漏掉（题干末尾停在「（」，options 为空）。
 *   而 checkQuestionCompleteness 的「选择题缺少选项」规则**只读 options 数组**，
 *   配图（geometry_image_url）不参与该规则 —— 所以这些题会被完整性门禁挡住，
 *   永远进不了错题本，学生也就永远练不到。
 *
 * 做法：
 *   对每道 `question_type='choice'` 且 options 为空的题，用它**原卷页图上的定位框**
 *   （block_coordinates，缺失时回退 text_bbox ∪ image_bbox）裁出该题区域，
 *   交给 services/questionOCRService.recognizeQuestionImage 重识别，取回选项。
 *
 *   ⚠️ 脚本**只写 options 一个字段**。content / answer 一律不动 ——
 *      改答案会直接影响判题与错题生命周期，属核心流程，绝不能由批处理脚本擅自改。
 *      题干本身也残缺的题会在报告里标出来，交老师人工处理。
 *
 *   ⚠️ 内置「题干一致性闸」：2026-09-11 实测发现部分题目的 block_coordinates 与题目内容**错位**
 *      （定位框实际指向邻题，例如 q6 的框裁出来是 q5 的整段）。不加校验就写库会把**别的题的选项**
 *      灌进来，比缺选项更糟。因此识别题干与库里题干对不上的行一律只进报告、不写库，
 *      状态标记为 mismatch_stem。
 *
 * 用法：
 *   node scripts/backfill-choice-options.mjs                       # dry-run，只出对比表
 *   node scripts/backfill-choice-options.mjs --out=report.csv      # 指定 CSV 输出路径
 *   node scripts/backfill-choice-options.mjs --task=<taskId>       # 只扫某份作业
 *   node scripts/backfill-choice-options.mjs --student=<studentId> # 只扫某学生
 *   node scripts/backfill-choice-options.mjs --limit=50            # 只处理前 N 道（试跑）
 *   node scripts/backfill-choice-options.mjs --apply               # 真正写库
 *
 * ⚠️ --apply 前必须先 dry-run 核对 CSV。写库前会整行快照到
 *    scripts/logs/choice-options-backfill-<时间戳>.json，便于回滚。
 * ⚠️ 并发硬限 3：2026-09-09 练习册答案事故的根因之一就是 15 页 Promise.all 打爆模型配额，
 *    导致请求被静默轮换到弱模型。这里同样限流，宁可慢也不出脏数据。
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import { Pool } from 'pg'
import sharp from 'sharp'
import { recognizeQuestionImage } from '../services/questionOCRService.js'
import { syncQuestionCompleteness } from '../services/questionCompletenessSync.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: join(__dirname, '..', '.env') })

const argv = process.argv.slice(2)
const has = (flag) => argv.some(a => a === flag || a.startsWith(`${flag}=`))
const valueOf = (flag) => {
  const hit = argv.find(a => a.startsWith(`${flag}=`))
  return hit ? hit.slice(flag.length + 1) : null
}

const APPLY = has('--apply')
const TASK_ID = valueOf('--task')
const STUDENT_ID = valueOf('--student')
const LIMIT = Number(valueOf('--limit')) || 0
const CONCURRENCY = 3
const OUT = valueOf('--out') || join(__dirname, 'logs', `choice-options-backfill-${Date.now()}.csv`)
const SNAPSHOT = join(__dirname, 'logs', `choice-options-backfill-${Date.now()}.json`)

const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL })

// ── 表格实际列名可能与静态 schema 有差异，运行时探一次，缺列按 NULL 处理 ──
const loadQuestionColumns = async () => {
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'questions'`
  )
  return new Set(rows.map(r => r.column_name))
}

const buildSelect = (cols) => {
  const pick = (...names) => names.find(n => cols.has(n)) || null
  const exprs = [
    'q.id',
    'q.task_id',
    pick('student_id') ? 'q.student_id' : 'NULL::uuid AS student_id',
    pick('page_number') ? 'q.page_number' : 'NULL::int AS page_number',
    pick('question_number') ? 'q.question_number' : 'NULL::int AS question_number',
    pick('block_coordinates') ? 'q.block_coordinates' : 'NULL::jsonb AS block_coordinates',
    pick('text_bbox') ? 'q.text_bbox' : 'NULL::jsonb AS text_bbox',
    pick('image_bbox') ? 'q.image_bbox' : 'NULL::jsonb AS image_bbox',
    pick('geometry_image_url') ? 'q.geometry_image_url' : 'NULL::text AS geometry_image_url',
    'q.content',
    'q.options',
    'q.answer',
    'q.question_type',
    't.images AS task_images',
    't.image_url AS task_image_url',
  ]
  return exprs.join(',\n         ')
}

const buildWhere = (params) => {
  const conds = [
    'q.deleted_at IS NULL',
    "q.question_type = 'choice'",
    "(q.options IS NULL OR (jsonb_typeof(q.options) = 'array' AND jsonb_array_length(q.options) = 0))",
  ]
  if (TASK_ID) {
    params.push(TASK_ID)
    conds.push(`q.task_id = $${params.length}`)
  }
  if (STUDENT_ID) {
    params.push(STUDENT_ID)
    conds.push(`q.student_id = $${params.length}`)
  }
  return conds.join('\n           AND ')
}

const toJson = (v) => {
  if (v == null) return null
  if (typeof v === 'string') {
    try { return JSON.parse(v) } catch { return null }
  }
  return typeof v === 'object' ? v : null
}

const parseBbox = (b) => {
  const o = toJson(b)
  if (!o) return null
  const x = o.x ?? o.x_min ?? o.left
  const y = o.y ?? o.y_min ?? o.top
  const width = o.width ?? o.w ?? (o.x_max != null && x != null ? o.x_max - x : 0)
  const height = o.height ?? o.h ?? (o.y_max != null && y != null ? o.y_max - y : 0)
  if ([x, y, width, height].some(v => typeof v !== 'number' || Number.isNaN(v))) return null
  if (width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

const unionBbox = (a, b) => {
  if (!a) return b
  if (!b) return a
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x),
    height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y),
  }
}

/** 定位框：优先 block_coordinates（worker.js 的区域重 OCR 用的就是它），
 *  缺失时回退 text_bbox ∪ image_bbox（与前端原卷裁剪弹窗的自动预选一致）。 */
const resolveBbox = (row) =>
  parseBbox(row.block_coordinates) || unionBbox(parseBbox(row.text_bbox), parseBbox(row.image_bbox))

/** 原卷页图：tasks.images 是 JSONB 数组，**顺序即 1-based 页号**（不是元素里的 page_number）。
 *  questions.image_url 不可信（重练卷引用的原题 60/60 全为 NULL），必须走 tasks。 */
const resolvePageImage = (row) => {
  const imgs = toJson(row.task_images)
  const list = Array.isArray(imgs) ? imgs.filter(i => i && i.image_url) : []
  if (list.length === 0) {
    // 单页上传时 images 可能为空，退回 task.image_url
    return row.task_image_url ? { url: row.task_image_url, assumed: false } : null
  }
  const pn = Number(row.page_number)
  if (!Number.isFinite(pn) || pn < 1) {
    return { url: list[0].image_url, assumed: true }
  }
  const hit = list[pn - 1]
  if (!hit) return null   // 页码越界：宁可跳过，也不猜页（猜错页 = 补错选项）
  return { url: hit.image_url, assumed: false }
}

const downloadImage = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`图片下载失败 HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/** 按归一化 0-1000 定位框裁出题目区域并放大（与 worker.js reocrQuestionRegion 同口径：
 *  外扩 20% 内边距，短边放大到不超过 1800，JPEG q90）。 */
const cropQuestionRegion = async (imageBuffer, bbox) => {
  const meta = await sharp(imageBuffer).metadata()
  const imgW = meta.width
  const imgH = meta.height
  if (!imgW || !imgH) throw new Error('无法读取图片尺寸')

  const clamp = (v) => Math.max(0, Math.min(1000, Number(v) || 0))
  const toPx = (v, dim) => Math.round(clamp(v) / 1000 * dim)
  let left = toPx(bbox.x, imgW)
  let top = toPx(bbox.y, imgH)
  let width = toPx(bbox.width, imgW)
  let height = toPx(bbox.height, imgH)
  const padX = Math.round(width * 0.20)
  const padY = Math.round(height * 0.20)
  left = Math.max(0, left - padX)
  top = Math.max(0, top - padY)
  width = Math.min(width + padX * 2, imgW - left)
  height = Math.min(height + padY * 2, imgH - top)
  if (width <= 0 || height <= 0) throw new Error('裁剪区域为空')

  return sharp(imageBuffer)
    .rotate()
    .extract({ left, top, width, height })
    .resize(1800, 1800, { fit: 'inside' })
    .jpeg({ quality: 90 })
    .toBuffer()
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// ── 题干一致性闸（本脚本的安全核心）──
// 2026-09-11 实测：部分题目的 block_coordinates 与题目内容**错位**（定位框实际指向邻题）。
// 例如「6. 函数 y=a/x 与 y=-ax²-a…」的框裁出来是「5. 已知点(x₁,y₁)…」的整段。
// 若不加校验就写库，会把**别的题的选项**灌进这道题，比缺选项更糟 —— 老师会按错的选项批改。
// 因此：识别出的题干必须与库里题干指向同一道题，才算通过；不通过的一律只进报告、不写库。
const normalizeStem = (s) => String(s || '')
  .normalize('NFKC')
  .replace(/^\s*\d+\s*[.、．)）]\s*/, '')          // 去题号前缀（OCR 时有时无）
  .replace(/[\s，,。.、；;：:（）()【】\[\]「」“”"'’‘]/g, '')
  .toLowerCase()

const stemMatches = (stored, recognized) => {
  const a = normalizeStem(stored)
  const b = normalizeStem(recognized)
  if (!a || !b) return false
  if (a === b) return true
  // OCR 差异多出现在尾部（括号留白、标点、单位），互相包含即视为同题
  if (a.includes(b) || b.includes(a)) return true
  // 否则比较前缀：同题的前 14 个字符必然一致
  const n = Math.min(a.length, b.length, 14)
  return n > 0 && a.slice(0, n) === b.slice(0, n)
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/** 逐题处理一条：只读识别，不写库。返回报告行。 */
const processRow = async (row) => {
  const base = {
    id: row.id,
    task_id: row.task_id,
    student_id: row.student_id,
    page_number: row.page_number,
    question_number: row.question_number,
    content: row.content || '',
    existing_answer: row.answer || '',
    state: '',
    stem_match: null,
    note: '',
    rec_content: '',
    rec_options: [],
    rec_answer: '',
    rec_type: '',
  }

  const bbox = resolveBbox(row)
  if (!bbox) {
    return { ...base, state: 'skipped_no_bbox', note: '无定位框，无法自动框选' }
  }
  const page = resolvePageImage(row)
  if (!page) {
    return { ...base, state: 'skipped_no_image', note: `取不到第 ${row.page_number} 页原卷图` }
  }

  let imageBuffer
  try {
    imageBuffer = await downloadImage(page.url)
  } catch (e) {
    return { ...base, state: 'failed', note: `原图下载失败: ${e.message}` }
  }

  let cropBuffer
  try {
    cropBuffer = await cropQuestionRegion(imageBuffer, bbox)
  } catch (e) {
    return { ...base, state: 'failed', note: `裁剪失败: ${e.message}` }
  }

  let result
  try {
    result = await recognizeQuestionImage(cropBuffer, 'image/jpeg')
  } catch (e) {
    return { ...base, state: 'failed', note: `识别失败: ${e.message}` }
  }

  const note = []
  if (page.assumed) note.push('无 page_number，按首页取图')
  if (result.question_type !== 'choice') note.push(`模型判为「${result.question_type}」`)

  // 一致性闸：识别出的题干必须与库里题干指向同一道题，否则拒绝（防定位框错位补错选项）
  const matched = stemMatches(row.content, result.content)

  if (!Array.isArray(result.options) || result.options.length === 0) {
    return {
      ...base,
      state: 'skipped_model_empty',
      stem_match: matched,
      note: ['模型未识别出选项', ...note].join('；'),
      rec_content: result.content || '',
      rec_type: result.question_type || '',
    }
  }

  if (!matched) {
    return {
      ...base,
      state: 'mismatch_stem',
      stem_match: false,
      note: ['识别题干与本题不一致，疑似定位框错位，已拒绝写入', ...note].join('；'),
      rec_content: result.content || '',
      rec_options: result.options,
      rec_answer: result.answer || '',
      rec_type: result.question_type || '',
    }
  }

  return {
    ...base,
    state: 'filled',
    stem_match: true,
    note: note.join('；'),
    rec_content: result.content || '',
    rec_options: result.options,
    rec_answer: result.answer || '',
    rec_type: result.question_type || '',
  }
}

const main = async () => {
  const cols = await loadQuestionColumns()
  const select = buildSelect(cols)

  const params = []
  const where = buildWhere(params)
  const limitSql = LIMIT > 0 ? `LIMIT ${LIMIT}` : ''
  const { rows } = await pool.query(
    `SELECT ${select}
       FROM questions q
       LEFT JOIN tasks t ON t.id = q.task_id
      WHERE ${where}
      ORDER BY q.created_at
      ${limitSql}`,
    params
  )

  console.log('─'.repeat(72))
  console.log(`模式：${APPLY ? 'APPLY（会写库）' : 'DRY-RUN（只读）'}`)
  console.log(`候选题目：${rows.length} 道`)
  console.log(`过滤：choice 且 options 为空 / deleted_at IS NULL`
    + (TASK_ID ? ` / task=${TASK_ID}` : '')
    + (STUDENT_ID ? ` / student=${STUDENT_ID}` : '')
    + (LIMIT ? ` / limit=${LIMIT}` : ''))
  console.log(`并发：${CONCURRENCY}（硬限，防打爆模型配额）`)
  console.log('─'.repeat(72))
  if (rows.length === 0) {
    console.log('没有需要处理的题目。')
    await pool.end()
    return
  }

  const results = []
  let cursor = 0
  let done = 0
  const worker = async () => {
    while (cursor < rows.length) {
      const idx = cursor++
      const row = rows[idx]
      try {
        const r = await processRow(row)
        results[idx] = r
      } catch (e) {
        results[idx] = {
          id: row.id, task_id: row.task_id, student_id: row.student_id,
          page_number: row.page_number, question_number: row.question_number,
          content: row.content || '', existing_answer: row.answer || '',
          state: 'failed', stem_match: null, note: `未预期异常: ${e.message}`,
          rec_content: '', rec_options: [], rec_answer: '', rec_type: '',
        }
      }
      done++
      process.stdout.write(`\r  处理中 ${done}/${rows.length} ...`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker))
  process.stdout.write('\r' + ' '.repeat(40) + '\r')

  const final = results.filter(Boolean)
  const filled = final.filter(r => r.state === 'filled')
  const stats = final.reduce((acc, r) => {
    acc[r.state] = (acc[r.state] || 0) + 1
    return acc
  }, {})

  // ── 先落盘报告（无论 dry-run 还是 apply，报告都要留档）──
  mkdirSync(dirname(OUT), { recursive: true })
  const header = [
    'question_id', 'task_id', 'student_id', 'page_number', 'question_number',
    'state', '题干一致', 'note', '模型题型', '现有题干', '识别题干', '选项数', '识别选项', '现有答案', '识别答案',
  ]
  const lines = [header.join(',')]
  for (const r of final) {
    lines.push([
      r.id, r.task_id, r.student_id, r.page_number, r.question_number,
      r.state, r.stem_match == null ? '' : (r.stem_match ? '是' : '否'),
      r.note, r.rec_type, r.content, r.rec_content,
      r.rec_options.length, r.rec_options.join(' | '), r.existing_answer, r.rec_answer,
    ].map(csvCell).join(','))
  }
  writeFileSync(OUT, '\uFEFF' + lines.join('\n'), 'utf8')

  console.log('结果统计：')
  for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(22)} ${v}`)
  console.log(`\n对比表已写入：${OUT}`)

  if (!APPLY) {
    console.log('\n[DRY-RUN] 未写任何数据。核对 CSV 后加 --apply 执行。')
    await pool.end()
    return
  }

  // ── 写库 ──
  const snapshot = []
  let updated = 0
  let skippedOnWrite = 0
  for (const r of filled) {
    const { rows: before } = await pool.query(
      `SELECT id, content, options, answer, question_type FROM questions WHERE id = $1`,
      [r.id]
    )
    if (before.length === 0) continue
    // 守卫：只有 options 仍为空才写，避免覆盖老师在脚本运行期间手工补的内容
    const { rowCount } = await pool.query(
      `UPDATE questions
          SET options = $2::jsonb, updated_at = NOW()
        WHERE id = $1
          AND (options IS NULL OR (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) = 0))`,
      [r.id, JSON.stringify(r.rec_options)]
    )
    if (rowCount === 0) {
      skippedOnWrite++
      console.log(`  · 跳过 ${r.id.slice(0, 8)}：options 已被他处填写`)
      continue
    }
    snapshot.push({ id: r.id, before: before[0], after_options: r.rec_options })
    updated++
    // is_complete 是反范式缓存列，写完必须重算回写，否则错题本/周报/讲义按
    // `is_complete = TRUE` 过滤时仍看不到这题
    try {
      await syncQuestionCompleteness([r.id])
    } catch (e) {
      console.error(`  ! ${r.id.slice(0, 8)} is_complete 回写失败: ${e.message}`)
    }
    await sleep(50)
  }

  mkdirSync(dirname(SNAPSHOT), { recursive: true })
  writeFileSync(SNAPSHOT, JSON.stringify({
    at: new Date().toISOString(),
    filter: { task: TASK_ID, student: STUDENT_ID, limit: LIMIT || null },
    updated, skippedOnWrite,
    rows: snapshot,
  }, null, 2), 'utf8')

  console.log(`\n[APPLY] 已更新 ${updated} 道题的 options，跳过 ${skippedOnWrite} 道（已被他处填写）。`)
  console.log(`回滚快照：${SNAPSHOT}`)
  console.log('注意：本脚本只补了选项。若报告里还有缺题干/缺答案的题，需人工处理。')
  await pool.end()
}

main().catch(async (e) => {
  console.error('脚本异常：', e)
  try { await pool.end() } catch {}
  process.exit(1)
})
