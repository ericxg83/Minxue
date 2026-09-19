#!/usr/bin/env node
/**
 * 周末班课件生成器（只读）
 * ============================================================================
 * 把某年级某时段的全班错题整理成一份可打印的讲题课件：
 *   · 按「自然日」倒序分节（昨天的排前面）—— 用户口径
 *   · 每天内部按「难度」升序分三档（1-2 基础 / 3 中等 / 4-5 较难）
 *   · 同题干（归一化精确匹配）跨学生合并，标注「共 N 人错」+ 名单
 *
 * 只读：仅 SELECT，不写任何业务表、不改错题生命周期、不改掌握度。
 *
 * 用法：
 *   node server/scripts/weekend-handout.mjs
 *   node server/scripts/weekend-handout.mjs --grade 初三 --days 20
 *   node server/scripts/weekend-handout.mjs --grade 初三 --from 2026-09-01 --to 2026-09-18
 *   node server/scripts/weekend-handout.mjs --grade 初三 --students 程思豪,李哲瀚
 *   node server/scripts/weekend-handout.mjs --merge-thin 5      # 题量<5 的天并入更早一节
 *   node server/scripts/weekend-handout.mjs --max-per-day 15    # 每天只取最易的 N 题
 *   node server/scripts/weekend-handout.mjs --limit 24          # 整份课件最多 N 题（一节课的量）
 *   node server/scripts/weekend-handout.mjs --no-answer         # 出「重练版」（不含答案）
 *
 * 参数：
 *   --grade      年级，默认「初三」（注意：库里是 初三/初二/初一/六年级，没有「九年级」）
 *   --subject    学科过滤，默认不过滤。⚠️ 练习册管线不写 questions.subject，
 *                传了学科会漏掉最近一周的错题（详见文末 SUBJECT 说明）
 *   --days       最近 N 天，默认 20（与 --from/--to 二选一）
 *   --from --to  自定义时段（含头不含尾，按上海时区自然日）
 *   --students   逗号分隔的学生姓名，限定子集（"周末班"若只是部分学生就传这个）
 *   --merge-thin 题量小于该值的天，并入相邻更早一节；默认 0（不合并）
 *   --max-per-day 每天最多取多少题（按难度从易到难），默认 0（不限）
 *   --limit      整份课件最多 N 题，按「日期倒序 → 段内难度由易到难」截取；默认 0（不限）
 *   --name       自定义产物文件名（不带扩展名），默认自动生成；用于同一天出多个跨度
 *   --out        输出目录，默认 <repo>/deliverables
 *   --no-answer  不输出正确答案（重练版口径）
 *
 * 产物：
 *   <base>.html         可打印的分节讲义
 *   <base>.slides.json  幻灯片数据（供 weekend-handout-ppt.py 出 PPT/PDF）
 *   <base>.summary.txt  文字摘要
 */

import dotenv from 'dotenv'
import pg from 'pg'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeStem } from '../utils/stemNormalize.js'
import { ocrStemKey } from '../utils/ocrStemKey.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..')

// .env 固定从 server/ 读 —— 否则从仓库根目录跑（cwd 不同）会拿不到 NEON_DATABASE_URL
dotenv.config({ path: path.resolve(__dirname, '..', '.env') })

// 崩溃也要留痕（PowerShell 工具的 stdout 不回传，只能靠文件）
const LOG_PATH = path.join(REPO_ROOT, '_weekend-handout.log')
const logLines = []
const log = (...a) => { logLines.push(a.map(x => typeof x === 'string' ? x : String(x)).join(' ')) }
function flushLog() { try { fs.writeFileSync(LOG_PATH, logLines.join('\n'), 'utf8') } catch {} }
process.on('uncaughtException', (e) => { log('UNCAUGHT: ' + (e?.stack || e)); flushLog(); process.exit(1) })
process.on('unhandledRejection', (e) => { log('UNHANDLED: ' + (e?.stack || e)); flushLog(); process.exit(1) })

// ────────────────────────────── 参数解析 ──────────────────────────────
const argv = {}
{
  const raw = process.argv.slice(2)
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i]
    if (!a.startsWith('--')) continue
    const eq = a.indexOf('=')
    if (eq !== -1) { argv[a.slice(2, eq)] = a.slice(eq + 1); continue }
    const next = raw[i + 1]
    if (next && !next.startsWith('--')) { argv[a.slice(2)] = next; i++ }
    else argv[a.slice(2)] = true
  }
}

const GRADE = String(argv.grade ?? '初三')
const SUBJECT = argv.subject ? String(argv.subject) : ''
const DAYS = Number(argv.days ?? 20)
const MERGE_THIN = Number(argv['merge-thin'] ?? 0)
const MAX_PER_DAY = Number(argv['max-per-day'] ?? 0)
const LIMIT = Number(argv.limit ?? 0)
const WITH_ANSWER = !argv['no-answer']
const OUT_DIR = argv.out ? path.resolve(String(argv.out)) : path.join(REPO_ROOT, 'deliverables')
const STUDENT_FILTER = argv.students
  ? String(argv.students).split(/[,，]/).map(s => s.trim()).filter(Boolean)
  : []

// 时段：--from/--to 优先，否则最近 --days 天
const now = new Date()
let periodStart, periodEnd
if (argv.from || argv.to) {
  periodStart = new Date(String(argv.from ?? '2000-01-01') + 'T00:00:00+08:00')
  periodEnd = new Date(String(argv.to ?? toYmd(now)) + 'T00:00:00+08:00')
  periodEnd = new Date(periodEnd.getTime() + 24 * 3600 * 1000)
} else {
  periodEnd = new Date(now.getTime() + 24 * 3600 * 1000)
  periodStart = new Date(periodEnd.getTime() - DAYS * 24 * 3600 * 1000)
}

function toYmd(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(d)
}

const TIERS = [
  { key: 'basic', label: '基础', hint: '难度 1-2', desc: '识记 / 简单', match: d => d !== null && d <= 2 },
  { key: 'medium', label: '中等', hint: '难度 3', desc: '常规题', match: d => d === 3 },
  { key: 'hard', label: '较难', hint: '难度 4-5', desc: '综合 / 压轴', match: d => d !== null && d >= 4 },
  { key: 'unknown', label: '难度未判定', hint: 'difficulty IS NULL', desc: '需人工判断', match: d => d === null },
]
const QTYPE_LABEL = {
  choice: '选择题', fill: '填空题', blank: '填空题', answer: '解答题',
  essay: '解答题', proof: '证明题', drawing: '作图题', composition: '作文',
}
const ANSWER_SOURCE_LABEL = {
  recognized: '卷面识别', worksheet: '练习册答案库', teacher_input: '教师录入',
  blank: '学生未作答', ai: 'AI 生成', cached: '缓存复用',
  wrong_book: '错题本（自包含）',
}

// ────────────────────────────── 取数 ──────────────────────────────
const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

const { rows: studentRows } = await pool.query(
  `SELECT id, name FROM students WHERE grade = $1 ORDER BY name`, [GRADE]
)
if (studentRows.length === 0) {
  const { rows: all } = await pool.query(`SELECT DISTINCT grade FROM students ORDER BY 1`)
  console.error(`⚠️ 年级「${GRADE}」下没有学生。库里实际年级值：${all.map(r => r.grade).join(' / ')}`)
  process.exit(1)
}
const studentIds = STUDENT_FILTER.length
  ? studentRows.filter(s => STUDENT_FILTER.includes(s.name)).map(s => s.id)
  : studentRows.map(s => s.id)
if (studentIds.length === 0) {
  console.error(`⚠️ --students 过滤后没有匹配学生。可选：${studentRows.map(s => s.name).join(', ')}`)
  process.exit(1)
}
log(`[1] 参数 OK: grade=${GRADE} subject=${SUBJECT || '(不过滤)'} 时段=${toYmd(periodStart)}~${toYmd(periodEnd)} studentIds=${studentIds.length}`)
flushLog()

const params = [studentIds, periodStart, periodEnd]
let subjectClause = ''
if (SUBJECT) {
  params.push(SUBJECT)
  subjectClause = ` AND COALESCE(NULLIF(q.subject,''), NULLIF(wq.subject,''), t.subject) = $${params.length}`
}

const { rows } = await pool.query(
  `SELECT
     wq.id AS wq_id, wq.student_id, wq.question_id, wq.added_at, wq.error_count,
     wq.lifecycle_status, wq.is_blank, wq.error_type, wq.error_reason,
     wq.student_answer AS wq_student_answer, wq.correct_answer AS wq_correct_answer,
     wq.content AS wq_content,
     wq.question_no, wq.page_number AS wq_page_number, wq.question_image_url,
     wq.source_type, wq.last_wrong_task_id, wq.worksheet_id,
     s.name AS student_name,
     q.id AS q_id, q.content, q.answer AS q_answer, q.options,
     q.question_type AS q_qtype, q.answer_source, q.subject AS q_subject,
     q.difficulty, q.question_number, q.page_number AS q_page_number, q.task_id AS q_task_id,
     q.geometry_image_url, q.clean_geometry_image_url, q.image_url AS q_image_url,
     q.parent_stem, q.sub_no, q.ai_answer_risk_reason, q.ai_tags, q.analysis,
     q.answer_exception, q.review_status, q.is_complete,
     t.images AS task_images, t.subject AS t_subject, t.original_name AS task_name,
     tq.images AS qtask_images
   FROM wrong_questions wq
   JOIN students s ON s.id = wq.student_id
   LEFT JOIN questions q ON q.id = wq.question_id
   LEFT JOIN tasks t ON t.id = wq.last_wrong_task_id
   -- 题目自身所属的卷：wq.last_wrong_task_id 存在量空值时，原卷图回退到它
   LEFT JOIN tasks tq ON tq.id = q.task_id
   WHERE wq.student_id = ANY($1::uuid[])
     AND wq.added_at >= $2 AND wq.added_at < $3
     AND COALESCE(wq.lifecycle_status, 'new') <> 'mastered'
     ${subjectClause}
   ORDER BY wq.added_at DESC`,
  params
)

// ── 同大题配图索引（多小问拆行时，配图常只挂在其中一行；整组共用同一张图）──
const figureByQGroup = new Map()
{
  const scopeTaskIds = [...new Set(rows.map(r => r.q_task_id).filter(Boolean))]
  if (scopeTaskIds.length) {
    const { rows: sibRows } = await pool.query(
      `SELECT task_id, question_number, geometry_image_url, clean_geometry_image_url
       FROM questions
       WHERE task_id = ANY($1::uuid[]) AND question_number IS NOT NULL AND deleted_at IS NULL`,
      [scopeTaskIds])
    for (const r of sibRows) {
      const key = `${r.task_id}#${r.question_number}`
      if (figureByQGroup.has(key)) continue
      const f = r.clean_geometry_image_url || r.geometry_image_url
      if (f) figureByQGroup.set(key, f)
    }
  }
  for (const r of rows) {
    const key = r.q_task_id && r.question_number != null ? `${r.q_task_id}#${r.question_number}` : null
    if (!key || figureByQGroup.has(key)) continue
    const f = r.clean_geometry_image_url || r.geometry_image_url
    if (f) figureByQGroup.set(key, f)
  }
  log(`[2b] 同大题配图索引: ${figureByQGroup.size} 组`)
}

/**
 * 同卷（task）同题号的小问行索引：task#question_number → 该大题的所有小问行。
 *
 * 用途（2026-09-17）：多小问大题被 OCR 拆成 (1)(2)(3) 多行后，错题本可能只存了
 * 其中错掉的小问（如只有 (3)）。若课件只展示错的那一行，老师讲题没有前提。
 * 这里把同 task 同题号的全部小问行（含未错、未入错题本的行）一次性取回，
 * 组装时拼成「完整题干 = parent_stem + 全部小问按序」，答案取完整整题三段。
 */
const subRowsByQGroup = new Map()
{
  const scopeTaskIds = [...new Set(rows.map(r => r.q_task_id).filter(Boolean))]
  if (scopeTaskIds.length) {
    const { rows: subRows } = await pool.query(
      `SELECT task_id, question_number, sub_no, parent_stem, content,
              answer, is_correct, page_number
         FROM questions
        WHERE task_id = ANY($1::uuid[])
          AND question_number IS NOT NULL
          AND deleted_at IS NULL
        ORDER BY question_number, sub_no NULLS FIRST, page_number`,
      [scopeTaskIds])
    for (const r of subRows) {
      const key = `${r.task_id}#${r.question_number}`
      if (!subRowsByQGroup.has(key)) subRowsByQGroup.set(key, [])
      subRowsByQGroup.get(key).push(r)
    }
    log(`[2c] 同卷同题小问索引: ${subRowsByQGroup.size} 组（用于多小问合并成完整题）`)
  }
}

await pool.end()

log(`[2] 取数 OK: ${rows.length} 条错题`)
flushLog()

if (rows.length === 0) {
  console.error('⚠️ 该时段没有符合条件的错题，未生成课件。')
  process.exit(1)
}

// ────────────────────────────── 组装 ──────────────────────────────

/** topic 键：parent_stem + content 归一化（完整题干跨卷/跨学生合并，与旧版一致）。
 *  多小问聚合在组装阶段做次级分组（同 task#题号 → 完整题），这里不用 task 维度，
 *  否则不同学生各自 task 的同题面会拆散「共 N 人错」。 */
const MIN_MERGE_KEY_LEN = 12

function topicKey(r) {
  // 练习册错题：同一练习册 + 页码 + 题号 + OCR 等价题干指纹。
  // 同一道题在不同学生任务里可能各生成一条 questions 行（question_id 不同），
  // 只按 question_id 分组会把同卷同题拆成多张 slide（线上 42/43、45/46 事故）。
  // 不能只用 worksheet+page+question_no 裸合并：OCR 题号/页码不可靠，
  // 同页同题号可能混入完全不同的题。
  if (r.source_type === 'workbook' && r.worksheet_id && r.question_no != null) {
    const page = r.wq_page_number ?? r.q_page_number ?? null
    const stem = `${r.parent_stem || ''}${r.content || ''}`
    const norm = ocrStemKey(stem)
    if (page != null && norm.length >= MIN_MERGE_KEY_LEN) {
      return 'ws:' + `${r.worksheet_id}|p${page}|n${r.question_no}|s:${norm}`
    }
  }
  const stem = `${r.parent_stem || ''}${r.content || ''}`
  const norm = normalizeStem(stem)
  if (norm.length >= MIN_MERGE_KEY_LEN) return 'topic:' + norm
  // 太短：退化成「自己一组」，只做同学生同题的合并
  const own = r.question_id || `${r.worksheet_id || ''}#${r.question_no ?? ''}#${r.content || ''}`
  return 'self:' + (own || r.wq_id)
}

/** 同卷同题小问完整化：给一组错题成员（可能来自不同学生/不同 task，但题面相同），
 *  把同一 task#题号 的多小问行拼成完整题干 + 整题答案。
 *  返回 { stem, parentStem, subParts, missingSubs, answer }；无多小问则原样返回。 */
function buildCompleteQuestion(members) {
  // 取第一个带 q_task_id + 题号 的成员作为题面代表（同 topic 内题面已一致）
  const rep = members.find(m => m.q_task_id && m.question_number != null) || members[0]
  const gKey = rep.q_task_id && rep.question_number != null
    ? `${rep.q_task_id}#${rep.question_number}`
    : null
  const group = gKey ? (subRowsByQGroup.get(gKey) || null) : null
  if (!group || group.length <= 1) {
    // 非多小问：原取值链
    const stem = rep.content || rep.wq_content || rep.wq_correct_answer || ''
    return {
      stem,
      parentStem: rep.parent_stem || '',
      subParts: [],
      missingSubs: [],
      answer: '',
      mergedSubNos: [],
    }
  }
  const sorted = [...group].sort((a, b) =>
    (a.sub_no ?? '') < (b.sub_no ?? '') ? -1 : (a.sub_no ?? '') > (b.sub_no ?? '') ? 1 : 0)
  const subItems = sorted.filter(x => x.sub_no != null && x.content)
  const wholeItem = sorted.find(x => x.sub_no == null && x.content)
  const parentStem = group.map(x => x.parent_stem).find(Boolean) || ''
  // 去重小问号前缀：OCR 拆行时 content 常自带 "(1)"，与渲染端 sub-tag 叠加会显示成 "(1) (1)…"
  const stripSubPrefix = (subNo, content) => {
    const re = new RegExp(`^\\s*[（(]\\s*${subNo}\\s*[）)]\\s*`)
    return String(content || '').replace(re, '')
  }
  const subParts = subItems.map(x => ({ subNo: x.sub_no, content: stripSubPrefix(x.sub_no, x.content) }))
  let stem
  if (wholeItem) stem = wholeItem.content
  else if (subItems.length > 1) stem = subItems.map(x => `(${x.sub_no})${stripSubPrefix(x.sub_no, x.content)}`).join('')
  else if (subItems.length === 1) stem = subItems[0].content
  else stem = group.map(x => x.content).find(Boolean) || ''
  const answer = group.map(x => x.answer || '').filter(Boolean).sort((a, b) => b.length - a.length)[0] || ''
  // 缺的小问：成员涉及 sub 但完整组里没有该行
  const memberSubs = [...new Set(members.map(m => m.sub_no).filter(Boolean))]
  const mergedSubNos = subParts.map(x => String(x.subNo))
  const missingSubs = memberSubs.filter(s => !mergedSubNos.includes(String(s)))
  if (missingSubs.length) {
    log(`   [合并] ${gKey} 缺小问: 组内=${mergedSubNos.join('/') || '整题'} 错题涉及=${missingSubs.join('/')} — 渲染端会标注「见原卷图」`)
  }
  return { stem, parentStem, subParts, missingSubs, answer, mergedSubNos }
}

function resolveDocImage(r) {
  // 原卷/答卷整页图：question_image_url → q.image_url → task.images 按页
  if (r.question_image_url) return r.question_image_url
  if (r.q_image_url) return r.q_image_url
  const imgs = Array.isArray(r.task_images) ? r.task_images : []
  const page = r.wq_page_number ?? r.q_page_number ?? null
  const byPage = page == null ? null : imgs.find(i => Number(i?.page_number) === Number(page))
  const pick = byPage || imgs[0]
  if (pick?.image_url) return pick.image_url
  // 末级兜底（2026-09-19，同 lib/weekendHandout.js）：wq.last_wrong_task_id 为空
  // （重练结算历史写入未落该列）时，改用题目所属卷 tq.images 的整页图。
  const qImgs = Array.isArray(r.qtask_images) ? r.qtask_images : []
  const qByPage = page == null ? null : qImgs.find(i => Number(i?.page_number) === Number(page))
  return qByPage?.image_url || qImgs[0]?.image_url || null
}

function resolveFigure(r) {
  // 配图口径（2026-09-17 定。实测：图形裁片 53 张、0 张宽扁；错题本行裁片 24 张里 17 张宽条，
  // 投屏就是一条灰带 —— 所以默认只用图形裁片）：
  //   ① clean_geometry_image_url / geometry_image_url —— 题库图形裁片（App 几何图展示口径）
  //   ② wrong_questions.question_image_url —— 错题本那条链的"题目行裁片"，
  //      默认不引用；需要时用 --wb-image 打开（见 resolveWbImage）
  return r.clean_geometry_image_url || r.geometry_image_url || null
}

/** 错题本字段（题目行裁片）：与 apiService 的 image_url = wq.question_image_url || q.image_url 同源 */
function resolveWbImage(r) {
  return r.question_image_url || r.q_image_url || null
}

/**
 * 同大题（task + 题号）配图索引。
 * 多小问被 OCR 拆成多行时，配图常常只挂在其中一行（其余行 image_type 为 NULL），
 * 而公共题干里写的是「如图」—— 图本来就是整个大题共用的，所以缺图的行
 * **引用兄弟行已有的配图**即可（同样是库内现成字段，不新增字段、不重裁）。
 */
/** 组内难度：取众数；并列取较小值；全空为 null */function aggregateDifficulty(vals) {
  const nums = vals.filter(v => v !== null && v !== undefined)
  if (nums.length === 0) return null
  const cnt = new Map()
  for (const n of nums) cnt.set(n, (cnt.get(n) || 0) + 1)
  let best = null, bestN = -1
  for (const [v, n] of [...cnt.entries()].sort((a, b) => a[0] - b[0])) {
    if (n > bestN) { best = v; bestN = n }
  }
  return best
}

function parseOptions(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter(Boolean)
  if (typeof raw === 'string') {
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p.filter(Boolean) : [] } catch { return [] }
  }
  return []
}

// 按天分桶
const dayMap = new Map()
for (const r of rows) {
  const day = toYmd(new Date(r.added_at))
  if (!dayMap.has(day)) dayMap.set(day, [])
  dayMap.get(day).push(r)
}

const days = []
for (const [day, list] of [...dayMap.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
  // 桶内按 topic 合并
  const topicMap = new Map()
  for (const r of list) {
    const k = topicKey(r)
    if (!topicMap.has(k)) topicMap.set(k, [])
    topicMap.get(k).push(r)
  }
  let topics = []
  for (const [key, members] of topicMap.entries()) {
    // primary 升级选择（2026-09-17）：同卷同题多小问合并时，优先选「内容/答案最完整」的行，
    // 而不是第一条——避免 primary 恰好是空内容行导致整题题干退化。
    const rankPrimary = (a, b) => {
      const score = (x) => (x.content ? 2 : 0) + (x.q_answer ? 2 : 0) + (x.wq_content ? 1 : 0) + (x.parent_stem ? 1 : 0)
      return score(b) - score(a)
    }
    const primary = [...members].sort(rankPrimary)[0]

    // 多小问完整化（2026-09-17）：同题（无论错哪一小问）拼成完整题干+整题三段答案。
    // 跨学生/跨卷已在 topicMap 聚合；这里只负责把 (1)(2)(3) 补全，不再动 topicKey。
    const complete = buildCompleteQuestion(members)

    const studentMap = new Map()
    for (const m of members) {
      const cur = studentMap.get(m.student_id)
      const item = {
        id: m.student_id,
        name: m.student_name,
        wrongTimes: (cur?.wrongTimes || 0) + 1,
        difficulty: m.difficulty,
        studentAnswer: m.wq_student_answer,
        errorType: m.error_type || (m.is_blank ? '空题' : null),
        errorReason: m.error_reason,
        docImage: resolveDocImage(m),
        docPage: m.wq_page_number ?? m.q_page_number ?? null,
        isBlank: !!m.is_blank,
      }
      if (cur) {
        cur.wrongTimes = item.wrongTimes
        cur.studentAnswer = cur.studentAnswer || item.studentAnswer
        cur.docImage = cur.docImage || item.docImage
        cur.isBlank = cur.isBlank && item.isBlank
        if (cur.errorType && item.errorType && cur.errorType !== item.errorType) {
          cur.errorType = `${cur.errorType} / ${item.errorType}`
        } else {
          cur.errorType = cur.errorType || item.errorType
        }
      } else {
        studentMap.set(m.student_id, item)
      }
    }
    const students = [...studentMap.values()].sort((a, b) => b.wrongTimes - a.wrongTimes || a.name.localeCompare(b.name))
    const diffVals = members.map(m => m.difficulty).filter(v => v !== null && v !== undefined)
    const difficulty = aggregateDifficulty(diffVals)
    const diffInconsistent = new Set(diffVals).size >= 2

    // 题干取值链（2026-09-17 修）：多小问完整题干优先 → 题库 content → 错题本 content
    //   （自包含错题只有这一路）→ 最后才退「参考答案」，并显式标记（否则会出现题干只写着一个"B"的荒唐页）
    const stemText = complete.stem || primary.content || primary.wq_content || primary.wq_correct_answer || ''
    const stemFallback = !primary.content && !primary.wq_content && !!primary.wq_correct_answer
    // 答案取值链：多小问整题三段答案优先（完整），否则题库 answer → 错题本 correct_answer
    const ansText = complete.answer || primary.q_answer || primary.wq_correct_answer || ''
    const isMultiSub = complete.subParts.length > 1

    topics.push({
      key,
      questionId: primary.q_id,
      questionNumber: primary.question_number ?? primary.question_no ?? null,
      content: stemText,
      // 题干实在没有时退化成「作答内容」——显式标记，渲染端要提示老师
      stemIsFallback: stemFallback,
      parentStem: complete.parentStem || primary.parent_stem || '',
      subNo: isMultiSub ? null : (primary.sub_no || null),
      // 多小问聚合后仍保留明细，渲染端逐小问展示（PPT 大师可整块排版）
      subParts: complete.subParts || [],
      missingSubs: complete.missingSubs || [],
      options: parseOptions(primary.options),
      questionType: primary.q_qtype || '',
      answer: WITH_ANSWER ? ansText : '',
      hasAnswer: !!ansText,
      answerSource: primary.answer_source || (primary.q_answer ? null : (ansText ? 'wrong_book' : null)),
      answerRisk: primary.ai_answer_risk_reason || null,
      analysis: WITH_ANSWER ? (primary.analysis || '') : '',
      figure: (() => {
        const own = resolveFigure(primary) || members.map(resolveFigure).find(Boolean)
        if (own) return own
        const sibKey = primary.q_task_id && primary.question_number != null
          ? `${primary.q_task_id}#${primary.question_number}` : null
        return (sibKey && figureByQGroup.get(sibKey)) || null
      })(),
      // 错题本口径的题图（题目行裁片），仅 --wb-image 时由渲染端使用
      wbImage: resolveWbImage(primary) || members.map(resolveWbImage).find(Boolean) || null,
      students,
      studentCount: students.length,
      rawCount: members.length,
      difficulty,
      diffInconsistent,
      diffValues: [...new Set(diffVals)].sort(),
      sourceTypes: [...new Set(members.map(m => m.source_type).filter(Boolean))],
    })
  }

  // 二次合并（2026-09-17 产品化发现）：多小问完整化后，「完整题干」相同的条目
  // 若因错的小问不同（topicKey 在完整化之前按 content 分桶）会拆成两条完全相同的题。
  // 例：同一学生同一天错题本里题11 有两条（一条错(2)问、一条错(3)问），完整化后
  // 都是 3 小问 + 同一份答案 —— 应合并为一条，学生/错次累加。
  const completeMap = new Map()
  for (const t of topics) {
    const key = normalizeStem(
      `${t.parentStem || ''}|${(t.subParts || []).map(p => `(${p.subNo})${p.content}`).join('')}|${t.content}`
    )
    if (!key) { completeMap.set(t.key, t); continue }
    const cur = completeMap.get(key)
    if (!cur) { completeMap.set(key, t); continue }
    const students = [...cur.students]
    for (const st of t.students) {
      const exist = students.find(x => x.id === st.id)
      if (exist) {
        exist.wrongTimes += st.wrongTimes
        if (!exist.studentAnswer) exist.studentAnswer = st.studentAnswer
      } else {
        students.push(st)
      }
    }
    cur.students = students.sort((a, b) => b.wrongTimes - a.wrongTimes || a.name.localeCompare(b.name))
    cur.studentCount = students.length
    cur.rawCount += t.rawCount
    cur.diffValues = [...new Set([...(cur.diffValues || []), ...(t.diffValues || [])])].sort()
    cur.diffInconsistent = cur.diffValues.length >= 2
    log(`   [去重] 完整题干相同合并: ${cur.questionNumber ?? ''} 现 ${cur.studentCount} 人错`)
  }
  topics = [...completeMap.values()]

  // 排序：难度档 → 难度值 → 共错人数 → 首次出现
  const tierIdx = t => TIERS.findIndex(x => x.match(t.difficulty))
  topics.sort((a, b) =>
    tierIdx(a) - tierIdx(b) ||
    (a.difficulty ?? 99) - (b.difficulty ?? 99) ||
    b.studentCount - a.studentCount ||
    String(a.questionNumber ?? '').localeCompare(String(b.questionNumber ?? ''))
  )

  let clipped = 0
  let kept = topics
  if (MAX_PER_DAY > 0 && topics.length > MAX_PER_DAY) {
    clipped = topics.length - MAX_PER_DAY
    kept = topics.slice(0, MAX_PER_DAY)
  }

  days.push({
    day,
    topics: kept,
    rawRows: list.length,
    studentCount: new Set(list.map(r => r.student_id)).size,
    studentIds: [...new Set(list.map(r => r.student_id))],
    clipped,
    totalTopics: topics.length,
  })
}

// ── 薄天合并：题量 < MERGE_THIN 的自然日并入「其后第一个足量日」，合成一节 ──
// days 已按日期倒序（新→旧）。薄天先攒起来，遇到足量日就把攒下的（更晚的）薄天挂上去；
// 末尾若只剩薄天，则它们自成最后一节。足量日之间绝不互相吞并（修掉过一次级联吞并 8 天的 bug）。
function tierIndexOf(t) { return TIERS.findIndex(x => x.match(t.difficulty)) }
function sortTopics(list) {
  return [...list].sort((a, b) =>
    tierIndexOf(a) - tierIndexOf(b) ||
    (a.difficulty ?? 99) - (b.difficulty ?? 99) ||
    b.studentCount - a.studentCount ||
    String(a.questionNumber ?? '').localeCompare(String(b.questionNumber ?? ''))
  )
}

function combineDays(group) {
  const dayLabels = group.map(d => d.day)                       // 新→旧
  const multi = group.length > 1
  const topics = sortTopics(group.flatMap(d =>
    d.topics.map(t => multi ? { ...t, dayLabel: d.day } : t)))
  const ids = new Set(group.flatMap(d => d.studentIds))
  return {
    day: dayLabels[0],
    dayFrom: dayLabels[dayLabels.length - 1],
    mergedDays: multi ? dayLabels.slice(1) : [],
    topics,
    rawRows: group.reduce((s, d) => s + d.rawRows, 0),
    studentCount: ids.size,
    studentIds: [...ids],
    clipped: group.reduce((s, d) => s + d.clipped, 0),
    totalTopics: group.reduce((s, d) => s + d.totalTopics, 0),
    allDayLabels: dayLabels,
  }
}

let sections = days.map(d => combineDays([d]))
if (MERGE_THIN > 0) {
  const out = []
  let pending = []
  for (const d of days) {
    if (d.totalTopics < MERGE_THIN) { pending.push(d); continue }
    out.push(combineDays([...pending, d]))
    pending = []
  }
  if (pending.length) out.push(combineDays(pending))
  sections = out
}

// ── 总题数上限（--limit）：按「分节顺序（日期倒序）→ 段内难度档升序」截取 ──
let limitDropped = 0
if (LIMIT > 0 && sections.reduce((s, d) => s + d.topics.length, 0) > LIMIT) {
  let left = LIMIT
  const kept = []
  for (const s of sections) {
    if (left <= 0) { limitDropped += s.topics.length; continue }
    const topics = s.topics.slice(0, left)
    limitDropped += s.topics.length - topics.length
    left -= topics.length
    kept.push({ ...s, topics })
  }
  sections = kept.filter(s => s.topics.length > 0)
}

// ────────────────────────────── 渲染 ──────────────────────────────
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 极简数学排版：只做无损美化，不做完整 LaTeX 渲染（题干本身多为 Unicode 数学） */
function mathText(s) {
  let t = String(s ?? '')
  t = esc(t)
  t = t.replace(/\$\$?/g, '')
  t = t.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '（<span class="frac"><i>$1</i><i>$2</i></span>）')
  t = t.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
  t = t.replace(/\\times/g, '×').replace(/\\div/g, '÷')
  t = t.replace(/\\leq/g, '≤').replace(/\\geq/g, '≥').replace(/\\neq/g, '≠')
  t = t.replace(/\^\{([^{}]*)\}/g, '<sup>$1</sup>')
  t = t.replace(/\^(\d)/g, '<sup>$1</sup>')
  t = t.replace(/\n+/g, '<br>')
  return t
}

const EYE_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'

const totalTopics = sections.reduce((s, d) => s + d.topics.length, 0)
const totalRows = sections.reduce((s, d) => s + d.rawRows, 0)
const allStudents = [...new Map(rows.map(r => [r.student_id, r.student_name])).values()]
const unknownSubject = rows.filter(r => !r.q_subject && !r.t_subject).length

const periodLabel = `${toYmd(periodStart)} ~ ${toYmd(new Date(periodEnd.getTime() - 1))}`

function renderTopic(t, idx) {
  const qtype = QTYPE_LABEL[t.questionType] || (t.questionType || '未标题型')
  const diffBadge = t.difficulty === null
    ? '<span class="badge badge-warn">难度未判定</span>'
    : `<span class="badge badge-diff d${t.difficulty}">难度 ${t.difficulty}</span>`
  const shared = t.studentCount >= 2
    ? `<span class="badge badge-shared">共 ${t.studentCount} 人错</span>`
    : '<span class="badge badge-single">1 人错</span>'
  const jitter = t.diffInconsistent
    ? `<span class="badge badge-jitter" title="同题不同学生拿到的难度不一致（AI 判定抖动）">难度标注不一致 ${t.diffValues.join('/')}</span>`
    : ''
  const dayTag = t.dayLabel ? `<span class="badge badge-day">${esc(t.dayLabel)}</span>` : ''

  const stem = (t.parentStem ? `<div class="parent-stem">${mathText(t.parentStem)}</div>` : '')
    + (t.subParts && t.subParts.length > 1
        ? `<div class="stem subparts">${t.subParts.map((s, i) =>
            `<div class="subpart ${s.subNo === String(t.subNo) && t.subNo ? 'is-wrong' : ''}"><span class="sub-tag">(${esc(s.subNo)})</span>${mathText(s.content)}</div>`
          ).join('')}</div>
           ${t.missingSubs && t.missingSubs.length ? `<div class="missing-subs">⚠ 本题错在第 ${esc(t.missingSubs.join('/'))} 问，但题库缺该小问的题干 — 讲前请看「原卷」图</div>` : ''}`
        : `<div class="stem">${mathText(t.content)}</div>`
        + (t.subNo ? `<div class="subno">本小题：(${esc(t.subNo)})</div>` : ''))

  const options = t.options.length
    ? `<ol class="options">${t.options.map(o => `<li>${mathText(o)}</li>`).join('')}</ol>`
    : ''

  const figure = t.figure
    ? `<figure class="fig"><img src="${esc(t.figure)}" alt="题图" loading="lazy"><figcaption>题图（系统裁片）</figcaption></figure>`
    : ''

  const answerBlock = WITH_ANSWER
    ? (t.hasAnswer
        ? `<div class="answer"><span class="k">参考答案</span><span class="v">${mathText(t.answer)}</span>
             ${t.answerSource ? `<span class="src">来源：${esc(ANSWER_SOURCE_LABEL[t.answerSource] || t.answerSource)}</span>` : ''}
             ${t.answerRisk ? `<span class="risk">⚠ ${esc(t.answerRisk)}</span>` : ''}</div>`
        : `<div class="answer answer-missing"><span class="k">参考答案</span><span class="v muted">库里为空 — 讲前请人工补</span></div>`)
    : ''

  const students = t.students.map(s => {
    const bits = []
    if (s.studentAnswer) bits.push(`<span class="sa">学生答：<em>${mathText(s.studentAnswer)}</em></span>`)
    else if (s.isBlank) bits.push('<span class="sa blank">未作答</span>')
    if (s.errorType) bits.push(`<span class="et">${esc(s.errorType)}</span>`)
    if (s.errorReason) bits.push(`<span class="er">${esc(s.errorReason)}</span>`)
    const eye = s.docImage
      ? `<a class="eye" href="${esc(s.docImage)}" target="_blank" rel="noopener" title="查看该学生原卷图">${EYE_SVG}<span>原卷</span></a>`
      : '<span class="eye-disabled" title="无原卷图">无图</span>'
    return `<li><span class="sname">${esc(s.name)}</span>${s.wrongTimes > 1 ? `<span class="times">×${s.wrongTimes}</span>` : ''}${bits.join('')}${eye}</li>`
  }).join('')

  return `<article class="q">
  <header class="q-head">
    <span class="q-idx">${idx}</span>
    ${t.questionNumber != null ? `<span class="q-no">第 ${esc(t.questionNumber)} 题</span>` : ''}
    <span class="badge badge-type">${esc(qtype)}</span>
    ${dayTag}${diffBadge}${shared}${jitter}
  </header>
  ${stem}
  ${options}
  ${figure}
  ${answerBlock}
  <div class="who"><span class="k">错的学生</span><ul class="students">${students}</ul></div>
</article>`
}

function renderDay(d) {
  const title = d.mergedDays.length
    ? `${d.dayFrom} ~ ${d.day}（${d.mergedDays.length + 1} 天合并，共 ${d.topics.length} 题 · ${d.studentCount} 名学生）`
    : `${d.day}（${d.topics.length} 题 · ${d.studentCount} 名学生）`
  const secs = []
  let running = 0
  for (const tier of TIERS) {
    const list = d.topics.filter(t => tier.match(t.difficulty))
    if (list.length === 0) continue
    secs.push(`<section class="tier tier-${tier.key}">
      <h3 class="tier-title"><span class="tier-name">${tier.label}</span>
        <span class="tier-hint">${tier.hint} · ${tier.desc} · ${list.length} 题</span></h3>
      ${list.map(t => renderTopic(t, ++running)).join('\n')}
    </section>`)
  }
  const clipNote = d.clipped
    ? `<p class="clip-note">⚠ 本日共 ${d.totalTopics} 题，按「由易到难」截取了前 ${d.topics.length} 题，未收录 ${d.clipped} 题（用 <code>--max-per-day 0</code> 可全部输出）。</p>`
    : ''
  return `<section class="day">
  <h2 class="day-title">${esc(title)}</h2>
  ${clipNote}
  ${secs.join('\n')}
</section>`
}

const overview = sections.map(d => `<tr>
  <td>${esc(d.mergedDays.length ? `${d.dayFrom} ~ ${d.day}（${d.mergedDays.length + 1}天）` : d.day)}</td>
  <td>${d.totalTopics}</td><td>${d.studentCount}</td>
  <td>${d.topics.filter(t => t.difficulty !== null && t.difficulty <= 2).length}</td>
  <td>${d.topics.filter(t => t.difficulty === 3).length}</td>
  <td>${d.topics.filter(t => t.difficulty !== null && t.difficulty >= 4).length}</td>
  <td>${d.topics.filter(t => t.difficulty === null).length}</td>
</tr>`).join('')

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(GRADE)}${esc(SUBJECT)} 周末班错题课件 · ${esc(periodLabel)}</title>
<style>
  :root{
    --ink:#1b1f24; --ink-2:#4b5563; --ink-3:#8b949e; --line:#e3e6ea; --line-2:#eef1f4;
    --bg:#ffffff; --bg-soft:#f7f8fa; --bg-tint:#fbfcfd;
    --basic:#0f7b4f; --medium:#1e6fd9; --hard:#c2410c;
    --warn:#b45309; --danger:#b91c1c; --shadow:0 1px 2px rgba(16,24,40,.06);
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg-soft);color:var(--ink);
    font:15px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
    -webkit-font-smoothing:antialiased}
  .wrap{max-width:960px;margin:0 auto;padding:24px 20px 64px}
  .cover{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:26px 28px;box-shadow:var(--shadow)}
  .cover h1{margin:0 0 6px;font-size:22px;letter-spacing:.2px}
  .cover .sub{color:var(--ink-2);font-size:13px;margin-bottom:16px}
  .meta{display:flex;flex-wrap:wrap;gap:8px 22px;font-size:13px;color:var(--ink-2)}
  .meta b{color:var(--ink);font-weight:600}
  .note{margin-top:16px;padding:12px 14px;border-left:3px solid var(--medium);background:var(--bg-tint);
    border-radius:0 8px 8px 0;font-size:12.5px;color:var(--ink-2)}
  .note code{background:#eef1f4;padding:1px 5px;border-radius:4px;font-size:12px}
  table.ov{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px}
  table.ov th,table.ov td{padding:7px 10px;border-bottom:1px solid var(--line-2);text-align:right}
  table.ov th:first-child,table.ov td:first-child{text-align:left}
  table.ov th{color:var(--ink-3);font-weight:500;font-size:12px}
  .day{background:var(--bg);border:1px solid var(--line);border-radius:12px;margin-top:20px;
    padding:22px 24px;box-shadow:var(--shadow)}
  .day-title{margin:0 0 4px;font-size:17px;padding-bottom:10px;border-bottom:2px solid var(--ink);}
  .clip-note{font-size:12.5px;color:var(--warn);background:#fffbeb;border:1px solid #fde68a;
    padding:8px 12px;border-radius:8px;margin:12px 0 0}
  .tier{margin-top:20px}
  .tier-title{display:flex;align-items:baseline;gap:10px;margin:0 0 10px}
  .tier-name{font-size:15px;padding:2px 10px;border-radius:999px;color:#fff;background:var(--ink-2)}
  .tier-basic .tier-name{background:var(--basic)}
  .tier-medium .tier-name{background:var(--medium)}
  .tier-hard .tier-name{background:var(--hard)}
  .tier-unknown .tier-name{background:#9aa4b2}
  .tier-hint{font-size:12px;color:var(--ink-3)}
  .q{border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:12px 0;background:var(--bg-tint)}
  .q-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:10px}
  .q-idx{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;padding:0 6px;
    border-radius:6px;background:var(--ink);color:#fff;font-size:12.5px;font-weight:600}
  .q-no{font-size:12.5px;color:var(--ink-2)}
  .badge{font-size:11.5px;padding:2px 8px;border-radius:999px;border:1px solid var(--line);
    background:#fff;color:var(--ink-2);white-space:nowrap}
  .badge-type{background:#eef4ff;border-color:#d6e4ff;color:#1e4fa8}
  .d1,.d2{background:#e9f7f0;border-color:#c7ead9;color:var(--basic)}
  .d3{background:#eaf2fe;border-color:#cfe1fb;color:var(--medium)}
  .d4,.d5{background:#fdf0e9;border-color:#fadcc8;color:var(--hard)}
  .badge-warn{background:#fffbeb;border-color:#fde68a;color:var(--warn)}
  .badge-shared{background:#fdecec;border-color:#f8d0d0;color:var(--danger);font-weight:600}
  .badge-single{color:var(--ink-3)}
  .badge-jitter{background:#f5f3ff;border-color:#ddd6fe;color:#6d28d9}
  .badge-day{background:var(--bg-soft);border-color:var(--line);color:var(--ink-3);font-variant-numeric:tabular-nums}
  .parent-stem{font-size:13px;color:var(--ink-2);padding:8px 10px;background:#fff;border-left:2px solid var(--line);
    border-radius:0 6px 6px 0;margin-bottom:8px}
  .stem{font-size:15.5px;line-height:1.9}
  .subno{font-size:12px;color:var(--ink-3);margin-top:4px}
  .options{margin:10px 0 0;padding-left:0;list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:4px 14px}
  .options li{font-size:14px;color:var(--ink-2);padding-left:20px;position:relative}
  .options li::before{display:inline-block;position:absolute;left:0;color:var(--ink-3)}
  .options li:nth-child(1)::before{content:"A."}
  .options li:nth-child(2)::before{content:"B."}
  .options li:nth-child(3)::before{content:"C."}
  .options li:nth-child(4)::before{content:"D."}
  .options li:nth-child(5)::before{content:"E."}
  .fig{margin:12px 0 0;padding:0}
  .fig img{max-width:min(420px,100%);border:1px solid var(--line);border-radius:8px;background:#fff}
  .fig figcaption{font-size:11.5px;color:var(--ink-3);margin-top:4px}
  .answer{margin-top:12px;padding:9px 12px;background:#e9f7f0;border:1px solid #c7ead9;border-radius:8px;
    font-size:14px;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:baseline}
  .answer .k{font-size:11.5px;color:var(--basic);font-weight:600;letter-spacing:.4px}
  .answer .v{font-weight:600}
  .answer .src,.answer .risk{font-size:11.5px;color:var(--ink-3)}
  .answer .risk{color:var(--warn)}
  .answer-missing{background:#fffbeb;border-color:#fde68a}
  .answer-missing .k{color:var(--warn)}
  .muted{color:var(--ink-3);font-weight:400}
  .who{margin-top:12px;border-top:1px dashed var(--line);padding-top:10px}
  .who .k{font-size:11.5px;color:var(--ink-3);letter-spacing:.4px}
  ul.students{list-style:none;margin:6px 0 0;padding:0}
  ul.students li{font-size:13px;color:var(--ink-2);display:flex;flex-wrap:wrap;align-items:center;
    gap:4px 10px;padding:4px 0;border-bottom:1px solid var(--line-2)}
  ul.students li:last-child{border-bottom:0}
  .sname{font-weight:600;color:var(--ink);min-width:52px}
  .times{font-size:11.5px;color:var(--danger)}
  .sa em{font-style:normal;color:var(--danger)}
  .sa.blank{color:var(--ink-3)}
  .et{font-size:11.5px;padding:1px 7px;border-radius:999px;background:#fff;border:1px solid var(--line);color:var(--ink-2)}
  .er{font-size:11.5px;color:var(--ink-3)}
  a.eye{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;color:var(--medium);
    text-decoration:none;padding:1px 7px;border:1px solid #cfe1fb;background:#fff;border-radius:999px}
  a.eye:hover{background:#eef4ff}
  .eye-disabled{font-size:11.5px;color:var(--ink-3)}
  .frac{display:inline-flex;flex-direction:column;vertical-align:middle;text-align:center;font-size:.86em;
    line-height:1.1;margin:0 1px;padding:0 2px}
  .frac i{font-style:normal;border-bottom:1px solid currentColor;padding:0 2px}
  .frac i:last-child{border-bottom:0}
  sub,sup{font-size:.72em}
  @media print{
    body{background:#fff}
    .wrap{max-width:none;padding:0}
    .cover,.day{box-shadow:none;border:none;border-radius:0;padding:0;margin:0}
    .day{page-break-before:always}
    .day:first-of-type{page-break-before:auto}
    .q{break-inside:avoid;page-break-inside:avoid;background:#fff}
    a.eye{display:none}
    .note{display:none}
    .cover{padding-bottom:16px}
  }
</style>
</head>
<body>
<div class="wrap">

<div class="cover">
  <h1>${esc(GRADE)}${esc(SUBJECT)} · 周末班错题课件</h1>
  <div class="sub">按「日期倒序 → 难度由易到难」组织 · 生成于 ${esc(new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }))}</div>
  <div class="meta">
    <span>时段 <b>${esc(periodLabel)}</b></span>
    <span>学生 <b>${allStudents.length} 人</b></span>
    <span>错题 <b>${totalRows} 条</b></span>
    <span>去重题 <b>${totalTopics} 题</b></span>
    <span>有课日 <b>${days.length} 天</b></span>
    <span>分节 <b>${sections.length} 节</b></span>
    ${unknownSubject ? `<span>学科字段缺失 <b>${unknownSubject} 条</b></span>` : ''}
    ${LIMIT > 0 ? `<span>本份截取 <b>前 ${totalTopics} 题</b>（共 ${totalTopics + limitDropped} 题）</span>` : ''}
  </div>
  <table class="ov">
    <thead><tr><th>日期</th><th>题数</th><th>学生数</th><th>基础 1-2</th><th>中等 3</th><th>较难 4-5</th><th>未判定</th></tr></thead>
    <tbody>${overview}</tbody>
  </table>
  <div class="note">
    <b>口径说明</b><br>
    1. 同一道题由多人错时合并为一条，标注「共 N 人错」并列出各人错答 —— 合并走<b>归一化题干精确匹配</b>，不做相似度合并。<br>
    2. 难度来自 <code>questions.difficulty</code>（1–5，AI 判定，<code>tags_source='ai'</code>）；同题多人错时取众数。<br>
    3. 每题「原卷」小眼睛链接指向该学生上传的整页图 —— 系统不提供可靠的题目裁图，讲题时以整页图为准。<br>
    4. 页面右侧留白可直接打印：每日自动分页，题目不跨页断开。<br>
    ${WITH_ANSWER ? '5. 本份为<b>讲义版</b>（含参考答案）。出不含答案的版本加 <code>--no-answer</code>。' : '5. 本份为<b>重练版</b>（不含参考答案）。'}
  </div>
</div>

${sections.map(renderDay).join('\n')}

</div>
</body>
</html>`

// ────────────────────────────── 输出 ──────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true })
const stamp = toYmd(new Date()).replace(/-/g, '')
const base = (argv.name ? String(argv.name) : `${GRADE}${SUBJECT || ''}周末班错题课件_${stamp}`)
  + (LIMIT > 0 ? `_前${totalTopics}题` : '')
  + (WITH_ANSWER ? '' : '_无答案')
const htmlPath = path.join(OUT_DIR, base + '.html')
const jsonPath = path.join(OUT_DIR, base + '.json')
const slidesPath = path.join(OUT_DIR, base + '.slides.json')
fs.writeFileSync(htmlPath, html, 'utf8')

// ── 幻灯片数据：一课一题（含分节页），供 weekend-handout-ppt.py 出 PPT / PDF ──
const nameOf = id => studentRows.find(s => s.id === id)?.name || ''
const slideList = []
let seq = 0
for (const sec of sections) {
  const secLabel = sec.mergedDays.length ? `${sec.dayFrom} ~ ${sec.day}` : sec.day
  slideList.push({
    kind: 'section',
    label: secLabel,
    day: sec.day,
    dayFrom: sec.dayFrom,
    mergedDays: sec.mergedDays || [],
    topicCount: sec.topics.length,
    studentCount: sec.studentCount,
    students: [...new Set(sec.studentIds.map(nameOf).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh')),
    tiers: TIERS.reduce((acc, t) => { acc[t.key] = sec.topics.filter(x => t.match(x.difficulty)).length; return acc }, {}),
  })
  for (const t of sec.topics) {
    const tier = TIERS.find(x => x.match(t.difficulty)) || TIERS[TIERS.length - 1]
    seq++
    slideList.push({
      kind: 'question',
      index: seq,
      sectionLabel: secLabel,
      day: sec.day,
      dayLabel: t.dayLabel || sec.day,
      tier: tier.key,
      tierLabel: tier.label,
      questionNumber: t.questionNumber,
      questionType: t.questionType,
      typeLabel: QTYPE_LABEL[t.questionType] || t.questionType || '',
      difficulty: t.difficulty,
      diffValues: t.diffValues,
      diffInconsistent: t.diffInconsistent,
      studentCount: t.studentCount,
      students: t.students.map(s => ({
        name: s.name, wrongTimes: s.wrongTimes, answer: s.studentAnswer,
        errorType: s.errorType, errorReason: s.errorReason, blank: s.isBlank,
        docImage: s.docImage, docPage: s.docPage,
      })),
      parentStem: t.parentStem || '',
      stem: t.content || '',
      stemIsFallback: !!t.stemIsFallback,
      subNo: t.subNo,
      // 多小问聚合（2026-09-17）：完整小问列表 + 缺失小问提示，PPT 端整块排版
      subParts: t.subParts || [],
      missingSubs: t.missingSubs || [],
      options: t.options,
      figure: t.figure || null,
      wbImage: t.wbImage || null,
      answer: t.answer || '',
      hasAnswer: t.hasAnswer,
      answerSource: t.answerSource,
      answerSourceLabel: t.answerSource ? (ANSWER_SOURCE_LABEL[t.answerSource] || t.answerSource) : '',
      answerRisk: t.answerRisk,
      analysis: (t.analysis || '').slice(0, 600),
    })
  }
}

fs.writeFileSync(slidesPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  grade: GRADE,
  subject: SUBJECT || null,
  title: `${GRADE}${SUBJECT ? ' · ' + SUBJECT : ''} 周末班错题课件`,
  period: { start: toYmd(periodStart), end: toYmd(new Date(periodEnd.getTime() - 1)) },
  withAnswer: WITH_ANSWER,
  scope: {
    days: DAYS, from: argv.from ? String(argv.from) : null, to: argv.to ? String(argv.to) : null,
    limit: LIMIT || null, maxPerDay: MAX_PER_DAY || null, mergeThin: MERGE_THIN || null,
    students: STUDENT_FILTER.length ? STUDENT_FILTER : null,
  },
  stats: {
    rawRows: totalRows, topics: totalTopics, questionSlides: seq,
    days: days.length, sections: sections.length,
    students: allStudents.length, studentNames: allStudents,
    limitDropped,
  },
  overview: sections.map(d => ({
    label: d.mergedDays.length ? `${d.dayFrom} ~ ${d.day}` : d.day,
    topics: d.topics.length,
    students: d.studentCount,
    basic: d.topics.filter(t => t.difficulty !== null && t.difficulty <= 2).length,
    medium: d.topics.filter(t => t.difficulty === 3).length,
    hard: d.topics.filter(t => t.difficulty !== null && t.difficulty >= 4).length,
    unknown: d.topics.filter(t => t.difficulty === null).length,
  })),
  slides: slideList,
}, null, 2), 'utf8')
fs.writeFileSync(jsonPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  grade: GRADE, subject: SUBJECT || null,
  period: { start: toYmd(periodStart), end: toYmd(new Date(periodEnd.getTime() - 1)) },
  students: STUDENT_FILTER.length ? STUDENT_FILTER : studentRows.map(s => s.name),
  totals: { rawRows: totalRows, topics: totalTopics, days: days.length, sections: sections.length },
  days: sections.map(d => ({
    day: d.day, dayFrom: d.dayFrom, mergedDays: d.mergedDays || [], rawRows: d.rawRows, totalTopics: d.totalTopics,
    topics: d.topics.map(t => ({
      questionNumber: t.questionNumber, difficulty: t.difficulty, diffValues: t.diffValues,
      questionType: t.questionType, studentCount: t.studentCount, rawCount: t.rawCount,
      content: (t.parentStem ? t.parentStem + ' ' : '') + t.content,
      answer: t.answer || null, answerSource: t.answerSource, answerRisk: t.answerRisk,
      students: t.students.map(s => ({ name: s.name, wrongTimes: s.wrongTimes, studentAnswer: s.studentAnswer, errorType: s.errorType })),
    })),
  })),
}, null, 2), 'utf8')

// 摘要（写文件，便于 PowerShell 工具取回）
const summary = [
  `年级：${GRADE}${SUBJECT ? ' · ' + SUBJECT : ''}    时段：${periodLabel}`,
  `学生：${allStudents.length} 人（${allStudents.join('、')}）`,
  `错题 ${totalRows} 条 → 去重 ${totalTopics} 题，分布在 ${days.length} 个自然日 / ${sections.length} 个分节`,
  unknownSubject ? `⚠ 其中 ${unknownSubject} 条 questions.subject 与 tasks.subject 均为空（练习册管线不写 subject）` : '',
  MAX_PER_DAY > 0 ? `⚠ 每天最多取 ${MAX_PER_DAY} 题（--max-per-day）` : '',
  MERGE_THIN > 0 ? `⚠ 题量 < ${MERGE_THIN} 的天已并入其后第一个足量日（--merge-thin）` : '',
  LIMIT > 0 ? `⚠ 整份课件截取前 ${LIMIT} 题，未收录 ${limitDropped} 题（--limit）` : '',
  '',
  '分节                          题数  学生数  基础(1-2)  中等(3)  较难(4-5)  未判定',
  ...sections.map(d => [
    (d.mergedDays.length ? `${d.dayFrom}~${d.day}(${d.mergedDays.length + 1}天)` : d.day).padEnd(28),
    String(d.totalTopics).padStart(3),
    String(d.studentCount).padStart(6),
    String(d.topics.filter(t => t.difficulty !== null && t.difficulty <= 2).length).padStart(9),
    String(d.topics.filter(t => t.difficulty === 3).length).padStart(8),
    String(d.topics.filter(t => t.difficulty !== null && t.difficulty >= 4).length).padStart(9),
    String(d.topics.filter(t => t.difficulty === null).length).padStart(8),
  ].join('  ')),
  '',
  `HTML: ${htmlPath}`,
  `JSON: ${jsonPath}`,
  `SLIDES: ${slidesPath}`,
].filter(Boolean).join('\n')

fs.writeFileSync(path.join(OUT_DIR, base + '.summary.txt'), summary, 'utf8')
log('DONE')
log('HTML: ' + htmlPath)
log('JSON: ' + jsonPath)
log('SLIDES: ' + slidesPath)
log(summary)
flushLog()
console.log('DONE')
console.log(htmlPath)
