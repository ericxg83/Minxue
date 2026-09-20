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
 *   node scripts/backfill-choice-options.mjs --mode=page           # 整页提取（推荐，抗 block 错位）
 *   node scripts/backfill-choice-options.mjs --limit=50            # 只处理前 N 道（试跑）
 *   node scripts/backfill-choice-options.mjs --vendor=Huihuiyun    # 指定视觉供应商
 *   node scripts/backfill-choice-options.mjs --apply               # 真正写库
 *
 * ⚠️ --mode：默认 crop（按题定位框裁剪，带题干一致性闸）。
 *    2026-09-18 全量 89 道实测：crop 只补上 33 道，**28 道被题干一致性闸拦下，且这 28 道
 *    全是真实错位**（库 Q6 裁出 Q5、库 Q2 裁出 Q4…，即 block_coordinates 指向邻题）。
 *    整页模式（--mode=page）不依赖 block_coordinates，键是卷面印刷题号 —— 同一页实测 4/4 全对。
 *    page 模式没有题干一致性闸（题号是纸面事实），因此**--apply 前必须核对报告表**。
 *
 * ⚠️ --vendor：默认走 recognizeQuestionImage 的默认路径（锁魔搭，noBackup）。
 *    魔搭当日配额耗尽时（2026-09-18 实测：三模型全部冷却 1024 分钟），补全完全跑不动。
 *    此时用 --vendor 人工点名一个**已实测可用**的供应商兜底。
 *    2026-09-18 实测结论（真实练习册页，选项提取任务）：
 *      Huihuiyun(sensenova-6.8-flash-lite) 7.2s ✅ 质量最好（图形选项能给出可区分描述）
 *      BigModel(glm-5v-turbo)             54s  ✅ 可用（图形选项只给「选项A图」这类占位）
 *      GMI 未启用（缺 Key）/ SenseNova 429 / ZenMux 空错误 / Agnes 503
 *    注意：这是**人工点名**而非静默降级 —— 选定供应商的产出质量由调用方负责，
 *    写库前务必核对下面的 CSV/控制台对比表。
 *
 * ⚠️ --apply 前必须先 dry-run 核对 CSV。写库前会整行快照到
 *    scripts/logs/choice-options-backfill-<时间戳>.json，便于回滚。
 * ⚠️ 并发硬限 3：2026-09-09 练习册答案事故的根因之一就是 15 页 Promise.all 打爆模型配额，
 *    导致请求被静默轮换到弱模型。这里同样限流，宁可慢也不出脏数据。
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { Pool } from 'pg'
import sharp from 'sharp'
import { recognizeQuestionImage } from '../services/questionOCRService.js'
import { callVisionCompletion, callVendorVisionCompletion } from '../config/ai.js'
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
// --vendor=<name>：显式点名视觉供应商（魔搭配额耗尽时的兜底通道，见文件头说明）
const VENDOR = valueOf('--vendor')
// --mode=page：整页提取（默认 crop = 按题定位框裁剪）。
//   2026-09-18 实测对比（task deb4a13d 第 1 页，4 道选择题）：
//     crop 模式 3 filled / 1 mismatch —— 第 5 题的 block_coordinates 裁出来是第 6 题；
//     page 模式 4/4 全对，且图形选项能给出可区分描述。
//   全量 89 道实测 crop 模式：filled 33 / mismatch_stem 28（**全部是真实错位**，
//     库 Q6 裁出 Q5、库 Q2 裁出 Q4…，即裁剪框指向邻题）/ skipped_model_empty 23 / bad 3 / failed 2。
//   结论：密集练习册页面上按题裁剪不可靠，整页提取更稳。
const MODE = (valueOf('--mode') || 'crop').toLowerCase()
// --replay=<csv>：回放一次 dry-run 产出的报告表，直接写库，**不再调视觉模型**。
//   为什么需要它：① 视觉额度有限，核对完再跑一遍等于重复烧额度；
//   ② 更重要的是「审的是什么就写什么」—— 人核对了 A 报告，就不该在写库时重新识别出 B 结果。
//   只会写 state='filled' 的行，且仍带「当前 options 为空」守卫。
const REPLAY = valueOf('--replay')
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

// bbox 判据统一走共享实现（2026-09-18）。本文件原先自带一份 parseBbox/unionBbox，
// 是全仓第 4 份副本。改用共享版并显式声明策略：这里要的是「尽量给个框去裁」，
// 越界由下游裁剪自然截断，所以传 allowOutOfRange（原副本也不拒绝越界，行为不变）。
import { parseBbox, unionBbox } from '../../src/utils/questionBbox.js'

/** 定位框：优先 block_coordinates（worker.js 的区域重 OCR 用的就是它），
 *  缺失时回退 text_bbox ∪ image_bbox（与前端原卷裁剪弹窗的自动预选一致）。
 *
 *  ⚠️ [2026-09-18] 这个**优先序与前端相反**，且优先的那一路已被证不可信：
 *    · 前端（src/utils/questionBbox.js）是 text∪image 优先、block 兜底；
 *    · 本脚本是 block 优先。而 block_coordinates 在练习册路径实测是「按题数均分整页」
 *      的占位框（y 步长恒定、零误差），叠加页图目检逐题下移 → 正是本文件第 19/36/83/244 行
 *      记的那批「裁出邻题」。这也是 crop 模式补全率远低于 page 模式的原因之一
 *      （crop 33/89 vs page 87/89）。
 *    故 --mode=crop 请视为**已废弃路径**，补选项一律用默认的 --mode=page。
 *    真要复活 crop 模式，先把这里的优先序翻成 text∪image 优先再跑。 */
const resolveBbox = (row) =>
  parseBbox(row.block_coordinates, { allowOutOfRange: true }) ||
  unionBbox(
    parseBbox(row.text_bbox, { allowOutOfRange: true }),
    parseBbox(row.image_bbox, { allowOutOfRange: true })
  )

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
//
// ⚠️ 2026-09-18 补：**符号变体必须先归一，否则会把同一道题误判成"错位"而拒写。**
// 实测（task deb4a13d，同一页同一题）：库里存 "AB//CD//EF"，模型读成 "AB∥CD∥EF"；
// 库里 "AD//BC"，模型读成 "AD∥BC" —— 两个字符不同就直接 prefix 比对失败，
// 3/6 道题被误拒。平行/垂直/减号/乘除号在中小学数学里有多套等价写法，全部归一到同一形式。
const normalizeStem = (s) => String(s || '')
  .normalize('NFKC')
  .replace(/^\s*\d+\s*[.、．)）]\s*/, '')          // 去题号前缀（OCR 时有时无）
  .replace(/[∥‖]/g, '//')                          // 平行：∥ / ‖ → //
  .replace(/[⊥⟂]/g, '⊥')                          // 垂直：⟂ → ⊥
  .replace(/[−–—－]/g, '-')                        // 减号/连字符：− – — － → -
  .replace(/[×✕✖]/g, '×')                          // 乘号：✕ ✖ → ×
  .replace(/[÷∕]/g, '÷')                          // 除号：∕ → ÷
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

// ══════════════════════════════════════════════════════════════════
// --replay：回放 dry-run 报告表写库
// ══════════════════════════════════════════════════════════════════
/** 极简 CSV 解析（支持双引号包裹、引号内逗号/换行、"" 转义） */
const parseCsv = (text) => {
  const rows = []
  let cur = [], cell = '', inQ = false
  const s = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++ } else inQ = false }
      else cell += c
    } else if (c === '"') inQ = true
    else if (c === ',') { cur.push(cell); cell = '' }
    else if (c === '\n') { cur.push(cell); rows.push(cur); cur = []; cell = '' }
    else if (c !== '\r') cell += c
  }
  if (cell || cur.length) { cur.push(cell); rows.push(cur) }
  return rows
}

const loadPlanFromCsv = (file) => {
  if (!existsSync(file)) throw new Error(`报告表不存在: ${file}`)
  const rows = parseCsv(readFileSync(file, 'utf8'))
  const hdr = rows[0] || []
  const idx = (name) => hdr.indexOf(name)
  const iId = idx('question_id'), iState = idx('state'), iOpts = idx('识别选项'), iQn = idx('question_number')
  if (iId < 0 || iState < 0 || iOpts < 0) throw new Error('报告表缺少必需列（question_id/state/识别选项）')
  const plan = []
  for (const r of rows.slice(1)) {
    if (!r[iId] || r[iState] !== 'filled') continue
    const opts = String(r[iOpts] || '').split(' | ').map(x => x.trim()).filter(Boolean)
    if (!looksLikeRealOptions(opts)) continue
    plan.push({ id: r[iId], question_number: iQn >= 0 ? r[iQn] : '', rec_options: opts })
  }
  return plan
}

/** 写库 + 快照 + is_complete 回写。plan 元素：{ id, rec_options } */
const applyPlan = async (plan, filterDesc) => {
  const snapshot = []
  let updated = 0
  let skippedOnWrite = 0
  for (const r of plan) {
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
    filter: filterDesc,
    updated, skippedOnWrite,
    rows: snapshot,
  }, null, 2), 'utf8')

  console.log(`\n[APPLY] 已更新 ${updated} 道题的 options，跳过 ${skippedOnWrite} 道（已被他处填写）。`)
  console.log(`回滚快照：${SNAPSHOT}`)
  console.log('注意：本脚本只补了选项。若报告里还有缺题干/缺答案的题，需人工处理。')
  return { updated, skippedOnWrite }
}

// ══════════════════════════════════════════════════════════════════
// --mode=page：整页提取
// ══════════════════════════════════════════════════════════════════
// 与 crop 模式的关键差别：**不依赖 block_coordinates**。
// 键是卷面上印刷的题号（题号印在纸上，不会错位），而 block_coordinates 会错位 ——
// 实测 89 道里 28 道的框指向邻题，crop 模式对这 28 道完全无能为力。
// 代价：一次调用覆盖整页，比单题裁剪"粗"，所以更需要 looksLikeRealOptions 质量闸 +
// 人工核对报告表（见文件头 --apply 前的提醒）。
const PAGE_PROMPT = `你是作业图片选项提取助手。请从这张作业图里，把每道**选择题**的选项正文提取出来。

只返回 JSON，格式（键 = 卷面上印刷的题号，值 = 该题 A→B→C→D 顺序的选项正文数组）：
{
  "2": ["AD/DF = BC/CE", "AD/BC = AF/BE", "GC/GE = GD/GF", "AF/DF = BE/BC"],
  "5": ["3/8", "3/4", "√5/2", "√15/15"]
}

规则：
1. 只提取卷面上【印刷体】的选项正文。绝不抄学生手写答案，绝不抄老师的批改痕迹（√ / × / 分数 / 批语）。
2. 选项正文里【不要带 A/B/C/D 标号】：卷面印的「A. 3/8」「（B）4/3」「C、SAS」要去掉标号，
   只留 "3/8"、"4/3"、"SAS"，按 A→B→C→D 顺序排列。
3. 选项是【图形】时（如「下列作图中正确的是」配四张图），该项填该图的简短描述，
   形如 "选项A图"，或带上能区分四张图的特征（如 "图A：开口向上的抛物线与斜率为正的直线"）。
   **绝不能因为选项是图就把这一项留空或整题跳过。**
4. 分数、根号、指数按卷面原样转录（如 "3/8"、"√15/15"、"√(a-b)²"、"m≥-2"）。
5. 不是选择题的题（填空题、解答题）**不要出现在结果里**。判断题（对/错）的选项填 ["正确","错误"]。
6. 看不清的题宁可整题不输出，也不要编造选项。
7. 只返回 JSON，不要任何解释文字。`

/** 页级结果缓存：同一页只调一次模型（按 (task_id, page_number) 去重） */
const pageCache = new Map()

const extractPageOptions = async (row) => {
  const page = resolvePageImage(row)
  if (!page) throw new Error(`取不到第 ${row.page_number} 页原卷图`)
  const raw = await downloadImage(page.url)
  const compressed = await sharp(raw)
    .rotate()
    .resize(1800, 1800, { fit: 'inside' })
    .jpeg({ quality: 85 })
    .toBuffer()

  const req = {
    imageDataURL: `data:image/jpeg;base64,${compressed.toString('base64')}`,
    systemPrompt: PAGE_PROMPT,
    userText: '提取这张作业图里所有选择题的选项正文，只返回 JSON。',
    temperature: 0.1,
    maxTokens: 4096,
  }
  const { content } = VENDOR
    ? await callVendorVisionCompletion({ ...req, vendorName: VENDOR, timeout: 180000 })
    : await callVisionCompletion({ ...req, noBackup: true })

  const text = String(content || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  let parsed
  try { parsed = JSON.parse(text) } catch (e) {
    throw new Error(`整页 JSON 解析失败: ${e.message}；原文(前150字) ${text.slice(0, 150)}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('整页返回结构不是对象')
  }
  const byNo = new Map()
  for (const [k, v] of Object.entries(parsed)) {
    const no = Number(String(k).replace(/[^\d]/g, ''))
    if (!Number.isInteger(no) || byNo.has(no)) continue
    byNo.set(no, Array.isArray(v) ? v.map(x => String(x ?? '').trim()).filter(Boolean) : null)
  }
  return { byNo, assumed: page.assumed }
}

/** 整页模式下的单题处理：从页级缓存里按题号取选项 */
const processRowByPage = async (row) => {
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
    rec_type: 'choice',
  }

  const key = `${row.task_id}||${row.page_number}`
  if (!pageCache.has(key)) {
    pageCache.set(key, extractPageOptions(row).catch(e => ({ error: e.message })))
  }
  const page = await pageCache.get(key)
  if (page.error) return { ...base, state: 'failed', note: `整页提取失败: ${page.error}` }

  const opts = page.byNo.get(Number(row.question_number))
  if (!opts || opts.length === 0) {
    return { ...base, state: 'skipped_model_empty', note: '整页提取未给出本题选项（题号未出现在模型输出里）' }
  }
  if (!looksLikeRealOptions(opts)) {
    return {
      ...base,
      state: 'skipped_bad_options',
      note: '整页提取的本题选项是退化形态（如只回抄了 A/B/C/D 标号），已拒绝写入',
      rec_options: opts,
    }
  }
  // 整页模式不设题干一致性闸：键是卷面印刷题号，不依赖 block_coordinates。
  // stem_match 记 null 表示"该闸未参与"，避免报告里被误读成"校验通过"。
  return {
    ...base,
    state: 'filled',
    stem_match: null,
    note: ['整页模式：按卷面印刷题号匹配（未过题干一致性闸）', page.assumed ? '无 page_number，按首页取图' : '']
      .filter(Boolean).join('；'),
    rec_options: opts,
  }
}

/**
 * 选项质量闸：拦住「模型只把标号回抄了一遍」这类退化输出。
 *
 * 2026-09-18 实测（task deb4a13d 第 1 题，选项本身是四张作图）：按题裁剪识别后模型直接返回
 * `["A","B","C","D"]`。若写库，前端会按顺序渲染成「A. A　B. B　C. C　D. D」——
 * 看起来像"有选项了"，实际是垃圾，比缺选项更难发现。宁可判为未补全，交人工。
 *
 * 注意：这条闸只管「明显不是正文」的形态，不判断选项**内容对不对**——
 * 内容正确性由上面的题干一致性闸 + 人工核对 CSV 保证。
 */
const looksLikeRealOptions = (opts) => {
  if (!Array.isArray(opts) || opts.length < 2) return false
  const norm = opts.map(o => String(o).trim())
  if (norm.some(o => o === '')) return false
  // 每一项都只是单个 A–H 字母 → 模型在回抄标号，不是选项正文
  if (norm.every(o => /^[A-Ha-h]$/.test(o))) return false
  // 全部一模一样 → 无区分度
  if (new Set(norm).size === 1) return false
  return true
}

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
    result = await recognizeQuestionImage(cropBuffer, 'image/jpeg', VENDOR ? { vendorName: VENDOR } : {})
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

  if (!looksLikeRealOptions(result.options)) {
    return {
      ...base,
      state: 'skipped_bad_options',
      stem_match: matched,
      note: ['模型返回的选项是退化形态（如只回抄了 A/B/C/D 标号），已拒绝写入', ...note].join('；'),
      rec_content: result.content || '',
      rec_options: result.options,
      rec_answer: result.answer || '',
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
  // ── --replay：回放已核对过的报告表，不调视觉模型 ──
  if (REPLAY) {
    const plan = loadPlanFromCsv(REPLAY)
    console.log('─'.repeat(72))
    console.log(`模式：REPLAY（回放报告表写库）`)
    console.log(`报告表：${REPLAY}`)
    console.log(`计划写入：${plan.length} 道（只取 state=filled 且选项过质量闸的行）`)
    console.log('─'.repeat(72))
    if (plan.length === 0) {
      console.log('报告表里没有可写入的行，退出。')
      await pool.end()
      return
    }
    if (!APPLY) {
      console.log('\n[DRY-RUN] 未写任何数据。加 --apply 执行写库。')
      await pool.end()
      return
    }
    await applyPlan(plan, { replay: REPLAY })
    await pool.end()
    return
  }

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
  console.log(`提取模式：${MODE === 'page' ? 'page（整页提取，按卷面印刷题号匹配，不依赖 block_coordinates）' : 'crop（按题定位框裁剪 + 题干一致性闸）'}`)
  console.log(`视觉供应商：${VENDOR ? VENDOR + '（--vendor 点名）' : '默认（锁魔搭，noBackup）'}`)
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
        const r = await (MODE === 'page' ? processRowByPage(row) : processRow(row))
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
  await applyPlan(filled, { task: TASK_ID, student: STUDENT_ID, limit: LIMIT || null, mode: MODE })
  await pool.end()
}

main().catch(async (e) => {
  console.error('脚本异常：', e)
  try { await pool.end() } catch {}
  process.exit(1)
})
