/**
 * 打标回填：把存量题目的 ai_tags 用「闭集提示词」重打一遍，再重算知识点关联
 * ═══════════════════════════════════════════════════════════════
 * ⛔ 为什么必须重打而不是只重算映射：
 *   旧 ai_tags 是自由发挥的产物（「平方」「实数」），逐字对不上树，
 *   归一化只能靠子串兜底 → 落到最粗的节点。改提示词后必须让模型**重新产出**标签。
 *
 * ⛔ 红线（2026-10-07 知识树治理实测结论）：**不要拿这个脚本做全量重打**。
 *   实测平手甚至更差 —— 「错的答案比空答案糟」。打标质量靠 `knowledgeService.js`
 *   的匹配器修复（每个标签只取最高分节点）保证，不靠重跑 AI。本脚本仅作历史留痕。
 *
 * ⛔ 默认 dry-run（抽 20 题看效果）。--apply 才全量重打并写库。
 * ⛔ 断点续跑：进度写 _tmp_tag_backfill_progress.json，中断后重跑自动跳过已处理的题。
 * ⛔ 单题失败保留原 ai_tags（绝不因为打标失败把标签弄丢）。
 *
 * 用法：
 *   node server/scripts/backfillQuestionTags.mjs                # dry-run 抽样 20
 *   node server/scripts/backfillQuestionTags.mjs --limit 100     # dry-run 抽 100
 *   node server/scripts/backfillQuestionTags.mjs --apply          # 全量重打 + 重算关联
 *   node server/scripts/backfillQuestionTags.mjs --apply --concurrency 4
 */
import '../loadEnv.js'
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')

const APPLY = process.argv.includes('--apply')
const argOf = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null }
const LIMIT = Number(argOf('--limit') || 0)
const CONC = Math.min(Math.max(Number(argOf('--concurrency') || 4), 1), 8)

const { default: pg } = await import('pg')
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const { query } = await import('../config/neon.js')
const { buildTaggingInput, normalizeQuestionTags, assignQuestionsKnowledgeBulk, coerceAiTags, loadKnowledgePoints, clearKnowledgeCache } =
  await import('../services/knowledgeService.js')
const { generateTagsForQuestion, AI_TAGGING_ENABLED } = await import('../worker.js')

const out = []
const say = (...a) => { const s = a.join(' '); out.push(s); console.log(s) }
const dump = () => fs.writeFileSync(path.resolve(ROOT, '_tmp_tag_backfill.txt'), out.join('\n'), 'utf8')

// 泛化考点（用于度量改善）
const GENERIC = new Set(['数与式', '方程与方程组', '不等式与不等式组', '函数', '几何基础', '图形变换',
  '三角形', '四边形', '圆', '相似', '锐角三角函数、投影与视图', '统计与概率', '综合与实践',
  '平方', '实数', '代数', '比例', '几何', '统计', '数的性质', '面积计算', '实际问题解决', '方程', '未分类'])

say('AI 打标开关：' + (AI_TAGGING_ENABLED ? '开' : '关'))
say('并发：' + CONC + '｜模式：' + (APPLY ? '全量落库' : 'dry-run'))

// ── 载入题目 ──
const { rows: qs } = await pool.query(`
  SELECT id, content, parent_stem, options, subject, ai_tags
    FROM questions WHERE subject = '数学'
   ORDER BY ${process.argv.includes('--random') ? 'random()' : 'created_at DESC'}` + (LIMIT > 0 ? ` LIMIT ${LIMIT}` : ''))
say('待处理题目：' + qs.length)

const PROGRESS = path.resolve(ROOT, '_tmp_tag_backfill_progress.json')
let done = new Set()
if (APPLY && fs.existsSync(PROGRESS)) {
  try { done = new Set(JSON.parse(fs.readFileSync(PROGRESS, 'utf8')).done || []) } catch { done = new Set() }
  say('断点续跑：已完成 ' + done.size + ' 道，跳过')
}

// ── 逐题重打 ──
const results = new Array(qs.length)
let aiOk = 0, localFb = 0, kept = 0, cursor = 0
const t0 = Date.now()

async function worker() {
  while (cursor < qs.length) {
    const i = cursor++
    const q = qs[i]
    if (done.has(q.id)) { results[i] = { questionId: q.id, tags: coerceAiTags(q.ai_tags), source: 'skipped', before: coerceAiTags(q.ai_tags) }; continue }
    const full = buildTaggingInput({ parentStem: q.parent_stem, content: q.content, options: q.options })
    const before = coerceAiTags(q.ai_tags)
    let tags = null, source = 'local'
    try {
      const r = await generateTagsForQuestion(full, q.subject)
      if (r && Array.isArray(r.tags) && r.tags.length) { tags = r.tags; source = r.source || 'ai' }
    } catch (e) { /* 吞掉，保留原标签 */ }
    if (!tags || !tags.length) { tags = before; kept++; source = 'kept-old' }
    else if (source === 'ai') aiOk++
    else localFb++
    results[i] = { questionId: q.id, tags, source, before }
    if ((i + 1) % 100 === 0) {
      const el = (Date.now() - t0) / 1000
      say(`  ... ${i + 1}/${qs.length}  AI ${aiOk} 本地回落 ${localFb} 保留原标签 ${kept}  已用 ${Math.round(el)}s  预计剩余 ${Math.round(el / (i + 1) * (qs.length - i - 1))}s`)
      if (APPLY) fs.writeFileSync(PROGRESS, JSON.stringify({ done: results.slice(0, i + 1).filter(Boolean).map(r => r.questionId) }), 'utf8')
    }
  }
}
await Promise.all(Array.from({ length: Math.min(CONC, qs.length) }, worker))
say(`\n重打完成：AI ${aiOk}｜本地回落 ${localFb}｜保留原标签 ${kept}｜用时 ${Math.round((Date.now() - t0) / 1000)}s`)

if (!APPLY) {
  say('\n── 抽样对照（前 20 题）──')
  for (const r of results.slice(0, 20)) {
    const q = qs.find(x => x.id === r.questionId)
    say('  ' + String(q.content).replace(/\s+/g, ' ').slice(0, 44))
    say('     旧: ' + (r.before.join('/') || '（无）'))
    say('     新: ' + (r.tags.join('/') || '（无）'))
  }
  const oldGen = results.reduce((a, r) => a + r.before.filter(t => GENERIC.has(t)).length, 0)
  const newGen = results.reduce((a, r) => a + r.tags.filter(t => GENERIC.has(t)).length, 0)
  const oldTot = results.reduce((a, r) => a + r.before.length, 0)
  const newTot = results.reduce((a, r) => a + r.tags.length, 0)
  say(`\n泛化标签占比 ${Math.round(oldGen / Math.max(oldTot, 1) * 100)}% → ${Math.round(newGen / Math.max(newTot, 1) * 100)}%`)
  say(`平均每题标签数 ${(oldTot / results.length).toFixed(2)} → ${(newTot / results.length).toFixed(2)}`)
  say('\n── dry-run 结束，未写库 ──')
  dump()
  await pool.end()
  process.exit(0)
}

// ── 落库：备份 → 写 ai_tags → 重算关联 ──
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const bak = path.resolve(ROOT, `server/_backup_question_tags_${stamp}.json`)
fs.writeFileSync(bak, JSON.stringify({
  at: new Date().toISOString(),
  questions: qs.map(q => ({ id: q.id, ai_tags: q.ai_tags })),
  question_knowledge: (await pool.query(`SELECT question_id, kp_id, role, weight FROM question_knowledge`)).rows,
}), 'utf8')
say('\n✅ 已备份 → ' + bak)

say('\n=== 写 ai_tags ===')
const CH = 200
let written = 0
for (let i = 0; i < results.length; i += CH) {
  const chunk = results.slice(i, i + CH)
  const vals = [], params = []
  let p = 1
  for (const r of chunk) { vals.push(`($${p++}::uuid, $${p++}::jsonb)`); params.push(r.questionId, JSON.stringify(r.tags)) }
  await pool.query(`UPDATE questions q SET ai_tags = v.tags FROM (VALUES ${vals.join(',')}) AS v(id, tags) WHERE q.id = v.id`, params)
  written += chunk.length
}
say(`  ✅ 写入 ${written} 道题的 ai_tags`)

say('\n=== 重算知识点关联 ===')
clearKnowledgeCache()
const entries = []
let noKp = 0
for (let i = 0; i < results.length; i++) {
  const r = results[i]
  try {
    const res = await normalizeQuestionTags({ content: qs[i].content, subject: '数学', options: qs[i].options, aiTags: r.tags, parentStem: qs[i].parent_stem })
    if (res.kps.length) entries.push({ questionId: r.questionId, kps: res.kps })
    else noKp++
  } catch (e) { noKp++ }
}
say(`  归一化：有考点 ${entries.length}｜无考点 ${noKp}`)
for (let i = 0; i < entries.length; i += 200) {
  await assignQuestionsKnowledgeBulk(entries.slice(i, i + 200))
  if ((i / 200) % 5 === 0) say(`  写入 ${Math.min(i + 200, entries.length)}/${entries.length}`)
}

// ── 复核 ──
const { rows: after } = await pool.query(`
  SELECT count(*)::int AS edges FROM question_knowledge`)
const { rows: top } = await pool.query(`
  SELECT kp.name, count(*)::int AS n FROM question_knowledge qk
    JOIN knowledge_points kp ON kp.id = qk.kp_id GROUP BY kp.name ORDER BY n DESC LIMIT 15`)
const { rows: orphan } = await pool.query(`
  SELECT count(*)::int AS n FROM question_knowledge qk LEFT JOIN knowledge_points kp ON kp.id = qk.kp_id WHERE kp.id IS NULL`)
const { rows: dead } = await pool.query(`
  SELECT count(*)::int AS n FROM knowledge_points kp WHERE kp.subject='数学' AND kp.archived=false
     AND NOT EXISTS (SELECT 1 FROM question_knowledge qk WHERE qk.kp_id = kp.id)`)
say('\n=== 落库后复核 ===')
say('  关联边：' + after[0].edges + '｜孤儿边：' + orphan[0].n + '（必须 0）')
say('  仍未被挂载的考点：' + dead[0].n)
say('  挂载最多的考点：')
for (const t of top) say(`     ${t.name}  ${t.n}`)
try { fs.unlinkSync(PROGRESS) } catch {}
dump()
await pool.end()
