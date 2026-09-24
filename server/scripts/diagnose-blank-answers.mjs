/**
 * 「参考答案为空」题目的**题面缺陷体检**（只读，零 AI 调用，2026-09-24）
 *
 * ── 为什么需要 ──
 * 盲目把 130 道缺答案的题全丢给引擎重跑，命中率只有 ~22%，因为其中大量题的
 * **题面本身残缺**（只剩「列式计算。」、漏了多小问公共题干、选项全空、题干截断）——
 * 这类题给 AI 重跑 100 次也解不出，只会白烧额度。必须先把它们分出来：
 *   · 题面无缺陷 → 重跑（值得烧额度）
 *   · 题面有缺陷 → 先修题面（补裁/补题干/补选项），修完再重跑
 *
 * 本脚本产出分类计数 + 每类样例，用于决定「下一步动哪一类、动多少」。
 *
 * 用法:
 *   node server/scripts/diagnose-blank-answers.mjs                # 默认只看 answer 空 + analysis 非空
 *   node server/scripts/diagnose-blank-answers.mjs --all-blank    # 所有 answer 为空的题（含 analysis 也空）
 *   node server/scripts/diagnose-blank-answers.mjs --limit 500
 *   node server/scripts/diagnose-blank-answers.mjs --show 5       # 每类打印 5 条样例
 */
import '../loadEnv.js'
import pg from 'pg'

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
  delete process.env[k]
}

const argOf = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null }
const LIMIT = Number(argOf('--limit') || 2000)
const SHOW = Number(argOf('--show') || 3)
const ALL_BLANK = process.argv.includes('--all-blank')

const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  keepAlive: true,
})

const { rows } = await pool.query(
  `SELECT id, task_id, question_number, question_type, parent_stem, content, options,
          analysis, geometry_image_url, image_type, is_complete, confidence, answer_exception_reason
   FROM questions
   WHERE deleted_at IS NULL
     AND (answer IS NULL OR btrim(answer) = '')
     ${ALL_BLANK ? '' : `AND analysis IS NOT NULL AND btrim(analysis) <> ''`}
   ORDER BY task_id, question_number
   LIMIT $1`,
  [LIMIT]
)

// ── 判据（全部本地、确定性，可逐条解释） ──
const t = (s) => String(s || '').trim()
const OPTION_PLACEHOLDER = /^(待?补充|无|略|见解析|-|—|\?|未知)$/

// 「引导语单独成题」：整段只有指令词，没有可解的数学/语文内容
const LEADING_ONLY = /^[（(]?\s*\d*\s*[）)]?\s*(列式计算|计算|解方程|解不等式|化简|求值|解答|证明|作图|填空|选择|判断|口算|直接写出得数|用竖式计算|脱式计算|简算|解决问题|看图列式)[。.：:，,、\s]*$/

const hasSubQuestionMark = (s) => /(^|\n)\s*[（(]\s*[1-9]\d?\s*[）)]/.test(String(s || ''))

const classify = (r) => {
  const content = t(r.content)
  const parent = t(r.parent_stem)
  const analysis = t(r.analysis)
  const options = Array.isArray(r.options) ? r.options : []
  const optTexts = options.map(x => t(typeof x === 'string' ? x : (x?.text ?? x?.label ?? '')))
  const reasons = []

  // 1. 选项全空（选择题却没有任何选项文本）
  if (String(r.question_type || '').toLowerCase() === 'choice') {
    const real = optTexts.filter(x => x && !OPTION_PLACEHOLDER.test(x))
    if (!real.length) reasons.push('OPT_EMPTY')
  }

  // 2. 题干为空 / 极短 / 只剩引导语
  if (!content) reasons.push('STEM_EMPTY')
  else if (content.length < 10) reasons.push('STEM_TINY')
  else if (LEADING_ONLY.test(content)) reasons.push('STEM_LEADING_ONLY')

  // 3. 多小问却漏了公共题干
  if (hasSubQuestionMark(content) && !parent) reasons.push('PARENT_MISSING')

  // 4. 题干疑似截断：以连接符结尾 / 括号不配对
  if (/[，,、；;和与或的]$/.test(content)) reasons.push('STEM_TRUNCATED_TAIL')
  else if ((content.match(/（/g) || []).length !== (content.match(/）/g) || []).length) reasons.push('STEM_UNBALANCED')

  // 5. 题干引图但无配图
  const figRef = /(如图|见图|下图|上图|图中|所示|统计图|条形图|扇形图|折线图|数轴|网格|方格|坐标系|正方形网格)/.test(content + parent)
  const hasFig = !!t(r.geometry_image_url)
  if (figRef && !hasFig) reasons.push('FIG_MISSING')

  // 6. AI 自述不会（analysis 里明写占位串）—— 「解不出」的显式证据
  if (/待人工补充|无法唯一确定|缺少条件|题目不完整|无法作答|无法确定|信息不足/.test(analysis)) reasons.push('AI_SELF_GIVEUP')

  return reasons
}

const buckets = new Map()
for (const r of rows) {
  const reasons = classify(r)
  const key = reasons.length ? reasons.join('+') : 'CLEAN(可重跑)'
  if (!buckets.has(key)) buckets.set(key, [])
  buckets.get(key).push({ r, reasons })
}

console.log(`\n==== 缺答案题面体检：共 ${rows.length} 条（${ALL_BLANK ? '全部 answer 空' : 'answer 空 + analysis 非空'}）====\n`)

const sorted = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length)
for (const [key, list] of sorted) {
  console.log(`【${String(list.length).padStart(4)} 条】${key}`)
  for (const { r } of list.slice(0, SHOW)) {
    const c = t(r.content).replace(/\s+/g, ' ').slice(0, 60)
    console.log(`      q#${r.question_number} [${r.question_type}] ${String(r.id).slice(0, 8)} ${JSON.stringify(c)}`)
  }
  if (list.length > SHOW) console.log(`      … 其余 ${list.length - SHOW} 条`)
  console.log('')
}

// 单维度计数（一条题可命中多个维度）
const single = {}
for (const r of rows) for (const x of classify(r)) single[x] = (single[x] || 0) + 1
console.log('── 单维度计数（可重叠）──')
for (const [k, v] of Object.entries(single).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`)
console.log(`  ${String((buckets.get('CLEAN(可重跑)') || []).length).padStart(4)}  CLEAN(无缺陷，值得重跑)`)

await pool.end()
process.exit(0)
