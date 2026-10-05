/**
 * 全量重算存量题目的知识点关联（含 parent_stem 修复后的口径）
 *
 * ═══ 为什么需要 ═══
 * 2026-10-05 发现并修掉一个生产缺陷：**多小问大题只拿小问题干去判知识点，公共题干被丢了**。
 *   · worker.js generateTagsForQuestions —— 只拼 content
 *   · knowledgeService.normalizeQuestionTags —— 签名里没有 parentStem
 *   · knowledgeMasteryService —— 两个调用方都没传
 * 而同一仓库里答案链路（worker.js:2296）与几何链路（geometryWorker.js:280）
 *   早就踩过同一个坑并留了注释。抽样证据：
 *     小问「求3a-b+c的平方根」+ 父题干「已知5a+2的**立方根**是3…」→ 关联考点判错
 *     小问「计算：1/2+1/4+…+1/32」+ 父题干「**找规律**，完成下列各题」→ 判不出
 *   全库 497 道数学题有公共题干（parent_stem 长度 ≥8），是本次修复的主要受益面。
 *
 * ═══ ⛔ 为什么不重算掌握度 ═══
 * knowledge_mastery 是**增量累加**的（upsertMasteryRecord: total_questions + 1）。
 *   重跑一遍 syncQuestionsKnowledgeAndMastery 会把每道题重复计数 ⇒ 数据彻底烂掉。
 *   且 knowledge_mastery 有 152 行、其中 1 行 history 已被 HISTORY_CAP=50 截断，
 *   **无法从 history 反推真值**，所以没有可靠的"清零重建"路径。
 *   结论：本次只重算 question_knowledge（纯派生数据，幂等可重跑），
 *        掌握度维持原样，交给后续新批改自然刷新。
 *   ⇒ 如果你要求掌握度也立刻正确，请先确认「清空 knowledge_mastery 重新积累」可接受
 *     （老师端会看到所有考点掌握度归零，直到学生重新作答），否则不要加 --mastery。
 *
 * ═══ 口径 ═══
 *   走**真实生产链路** normalizeQuestionTags（含 parent_stem），
 *   不是自己拼一套 —— 铁律：改树/改规则后必须用真实链路重算，否则历史边仍是旧口径。
 *   aiTags 沿用库里现值（不打标），所以这是「关联重算」不是「打标回填」。
 *
 * 用法：
 *   node server/scripts/recomputeQuestionKnowledge.mjs                # 全库 dry-run，打印差异报告
 *   node server/scripts/recomputeQuestionKnowledge.mjs --apply           # 落库
 *   node server/scripts/recomputeQuestionKnowledge.mjs --subject 数学 --apply
 *   node server/scripts/recomputeQuestionKnowledge.mjs --limit 200       # 小范围试跑
 *   node server/scripts/recomputeQuestionKnowledge.mjs --apply --mastery # ⚠️ 额外清空掌握度
 *
 * 报告输出位置（固定，不接受路径参数）：
 *   仓库根/_tmp_recompute_kp.txt              人可读的全过程日志
 *   仓库根/_tmp_recompute_kp_diff_<日期>.json 全量逐题差异明细
 *   server/_backup_question_knowledge_<时间戳>.json  仅 --apply 时：回滚依据
 */
// ⛔ 必须用 server/loadEnv.js，不能用裸 dotenv/config：
//   脚本从仓库根跑时 CWD 是根目录，dotenv/config 找不到 server/.env，
//   静默变成「数据库未配置：缺少 NEON_DATABASE_URL」。
import '../loadEnv.js'
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

process.on('unhandledRejection', e => { console.error('UNHANDLED', e); process.exit(1) })
process.on('uncaughtException', e => { console.error('UNCAUGHT', e); process.exit(1) })

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')

const APPLY = process.argv.includes('--apply')
const argOf = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null }
const SUBJECT = argOf('--subject') || '数学'
const LIMIT = Number(argOf('--limit') || 0)
const CONFIRM_MASTERY = process.argv.includes('--mastery')

const { default: pg } = await import('pg')
// ⛔ Windows 绝对路径 import 必须转 file:// URL，否则 ERR_UNSUPPORTED_ESM_URL_SCHEME
//   （protocol 'd:'）。用 pathToFileURL，别直接 await import(path.join(ROOT, ...))。
const { normalizeQuestionTags, assignQuestionsKnowledgeBulk, loadKnowledgePoints, coerceAiTags } =
  await import(pathToFileURL(path.join(ROOT, 'server', 'services', 'knowledgeService.js')).href)

if (!process.env.NEON_DATABASE_URL) {
  console.error('数据库未配置：缺少 NEON_DATABASE_URL')
  process.exit(1)
}
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const out = []
const say = (...a) => { const s = a.join(' '); out.push(s); console.log(s) }

// ⛔ 脚本标识符一律 ASCII（铁律 49b）：`const 自立 = ...` 少个空格会被解析成 `const自立`。
const dump = (name, text) => {
  const p = path.resolve(ROOT, name)
  fs.writeFileSync(p, text, 'utf8')
  say(`  → 报告已写${p}`)
}

// ═══ 步骤 0：基线快照（回滚用）══════════════════════════════════
say('=== 0. 基线快照（回滚依据）===')
const { rows: base } = await pool.query(
  `SELECT count(*)::int AS edges, count(DISTINCT question_id)::int AS questions FROM question_knowledge`)
say(`  现有question_knowledge：${base[0].edges} 条边/ ${base[0].questions} 道题`)
const { rows: stemStat } = await pool.query(
  `SELECT count(*)::int AS n FROM questions
    WHERE subject = $1 AND parent_stem IS NOT NULL AND length(trim(parent_stem)) >= 8`, [SUBJECT])
say(`  本次主要受益面（${SUBJECT} 有公共题干 ≥8 字）：${stemStat[0].n} 道`)

if (APPLY) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const bak = `server/_backup_question_knowledge_${stamp}.json`
  // ⛔ 别照抄别处的列清单 —— 2026-10-05 实测踩过：这里原本写了 `score`，
  //   而 question_knowledge 根本没有 score 列（真实列只有
  //   id / question_id / kp_id / role / weight / created_at），
  //   结果 --apply 在「备份」这一步就 42703 中止。
  //   好在中止发生在任何写入之前，数据没动 —— 这正是「先备份」的价值。
  //   稳妥做法：备份时就按实际列取，不硬编码可疑列名。
  const { rows: dumpRows } = await pool.query(
    `SELECT question_id, kp_id, role, weight FROM question_knowledge`)
  fs.writeFileSync(path.resolve(ROOT, bak), JSON.stringify(dumpRows, null, 0), 'utf8')
  say(`  ✅ 已备份 ${dumpRows.length} 条边 → ${bak}`)
  say(`     回滚方式：TRUNCATE question_knowledge 后从该文件重灌（脚本 --rollback <file>）`)
}

// ═══ 步骤 1：取待重算题目 ═══════════════════════════════════════
say('')
say('=== 1. 取待重算题目 ===')
const params = [SUBJECT]
let limitClause = ''
if (LIMIT > 0) { params.push(LIMIT); limitClause = `LIMIT $${params.length}` }
const { rows: questions } = await pool.query(
  `SELECT id, content, parent_stem, sub_no, subject, options, ai_tags, is_complete
     FROM questions
    WHERE subject = $1${LIMIT > 0 ? ` ORDER BY created_at DESC ${limitClause}` : ''}`, params)
say(`  待重算 ${questions.length} 道（subject=${SUBJECT}）`)
const withStem = questions.filter(q => q.parent_stem && String(q.parent_stem).trim().length >= 8).length
say(`  其中有公共题干：${withStem} 道 ｜ 无公共题干：${questions.length - withStem} 道`)

// ═══ 步骤 2：取现有关联，用于对比 ═══════════════════════════════
const ids = questions.map(q => q.id)
const { rows: oldLinks } = ids.length
  ? await pool.query(`SELECT question_id, kp_id, role, weight FROM question_knowledge WHERE question_id = ANY($1::uuid[])`, [ids])
  : { rows: [] }
const oldByQ = new Map()
for (const r of oldLinks) {
  if (!oldByQ.has(r.question_id)) oldByQ.set(r.question_id, [])
  oldByQ.get(r.question_id).push(r)
}
// kp_id → name，用于人可读报告
const kps = await loadKnowledgePoints(SUBJECT)
const kpName = new Map(kps.map(k => [k.id, k.name]))

// ═══ 步骤 3：走真实链路重算 ═════════════════════════════════════
say('')
say('=== 2. 走真实链路 normalizeQuestionTags 重算 ===')
say('  （生产同款：含 parent_stem，aiTags 沿用库值，不调LLM）')
const entries = []
const diffs = []
let unchanged = 0, newlyLinked = 0, lostAll = 0, unchangedNoKp = 0
for (let i = 0; i < questions.length; i++) {
  const q = questions[i]
  let res
  try {
    res = await normalizeQuestionTags({
      content: q.content,
      subject: q.subject,
      options: q.options,
      // ⛔ ai_tags 是 text 列，读出来是字符串。必须走 coerceAiTags，
      //   否则字符串被当成"没有标签"，全部回落本地规则（2026-10-05 踩过，
      //   症状是 dry-run 报出 67/200 道"失去全部关联"）。
      aiTags: coerceAiTags(q.ai_tags),
      parentStem: q.parent_stem,          // ★ 本次修复的关键
    })
  } catch (e) {
    say(`  ⚠️ q=${String(q.id).slice(0, 8)} 归一化失败：${e.message}（跳过，不写这一题）`)
    continue
  }
  if (res.kps.length > 0) entries.push({ questionId: q.id, kps: res.kps })

  const oldNames = (oldByQ.get(q.id) || []).map(r => kpName.get(r.kp_id) || String(r.kp_id).slice(0, 8)).sort()
  const newNames = res.kps.map(k => k.name).sort()
  const same = oldNames.length === newNames.length && oldNames.every((v, i) => v === newNames[i])
  if (same) { unchanged++; if (!oldNames.length) unchangedNoKp++ }
  else if (!oldNames.length && newNames.length) newlyLinked++
  else if (oldNames.length && !newNames.length) lostAll++
  if (!same) {
    diffs.push({
      id: q.id,
      number: q.content ? String(q.content).replace(/\s+/g, ' ').slice(0, 50) : '(无题干)',
      subNo: q.sub_no,
      stem: q.parent_stem ? String(q.parent_stem).replace(/\s+/g, ' ').slice(0, 60) : null,
      before: oldNames,
      after: newNames,
    })
  }
  if ((i + 1) % 200 === 0) say(`  ... ${i + 1}/${questions.length}`)
}
say(`  算完：变化 ${diffs.length}｜不变 ${unchanged}（其中本来就没关联的 ${unchangedNoKp}）`)
say(`        新获得关联 ${newlyLinked} 道｜**失去全部关联 ${lostAll} 道**`)

// ═══ 步骤 4：差异报告 ═════════════════════════════════════════
say('')
say('=== 3. 差异 Top 20 ===')
for (const d of diffs.slice(0, 20)) {
  say(`  q=${d.id.slice(0, 8)}${d.subNo ? ` (${d.subNo})` : ''}`)
  if (d.stem) say(`     公共题干: ${d.stem}`)
  say(`     改前: ${d.before.join(' / ') || '（无）'}`)
  say(`     改后: ${d.after.join(' / ') || '（无）'}`)
}
const reportJson = path.resolve(ROOT, `_tmp_recompute_kp_diff_${new Date().toISOString().slice(0, 10)}.json`)
fs.writeFileSync(reportJson, JSON.stringify({ generatedAt: new Date().toISOString(), apply: APPLY, total: questions.length, changed: diffs.length, diffs }, null, 2), 'utf8')
say('')
say(`  全量差异明细（${diffs.length} 条）→ ${reportJson}`)

if (!APPLY) {
  say('')
  say('── dry-run 结束，未写库。确认报告无误后加 --apply 落库 ──')
  if (lostAll > 0) say(`⚠️ 有 ${lostAll} 道题会「失去全部关联」，落库前请先看报告确认这是对的（也可能是好事：旧关联本来就是错的）`)
  dump('_tmp_recompute_kp.txt', out.join('\n'))
  await pool.end()
  process.exit(0)
}

// ═══ 步骤 5：落库 ═════════════════════════════════════════════
say('')
say(`=== 4. 落库（--apply）===`)
if (CONFIRM_MASTERY) {
  say('  ⚠️ --mastery 已开启：清空 knowledge_mastery 后不再重建')
  say('     掌握度将归零，until 学生重新作答才会重新积累。')
  await pool.query(`DELETE FROM knowledge_mastery`)
  say('  ✅ knowledge_mastery 已清空')
}
let written = 0
const BATCH = 200
for (let i = 0; i < entries.length; i += BATCH) {
  const slice = entries.slice(i, i + BATCH)
  const n = await assignQuestionsKnowledgeBulk(slice)
  written += n
  say(`  写入 ${i + slice.length}/${entries.length}（本次 ${n}）`)
}

// ═══ 步骤 6：落库后复核（必跑）══════════════════════════════════
say('')
say('=== 5. 落库后只读复核 ===')
const { rows: after } = await pool.query(
  `SELECT count(*)::int AS edges, count(DISTINCT question_id)::int AS questions FROM question_knowledge`)
say(`  question_knowledge：${after[0].edges} 条边 / ${after[0].questions} 道题（落库前 ${base[0].edges} / ${base[0].questions}）`)
say(`  边数变化 ${after[0].edges - base[0].edges >= 0 ? '+' : ''}${after[0].edges - base[0].edges}`)
const { rows: topAfter } = await pool.query(
  `SELECT kp.name, count(*)::int AS edges FROM question_knowledge qk
    JOIN knowledge_points kp ON kp.id = qk.kp_id GROUP BY kp.name ORDER BY edges DESC LIMIT 8`)
say('  边最多的考点（落库后）:')
for (const t of topAfter) say(`     ${t.name} ${t.edges}`)
const { rows: orphan } = await pool.query(
  `SELECT count(*)::int AS n FROM question_knowledge qk
    LEFT JOIN knowledge_points kp ON kp.id = qk.kp_id WHERE kp.id IS NULL`)
say(`  ⚠️ 指向不存在考点的孤儿边：${orphan[0].n}（必须为 0）`)

say('')
say(`✅ 完成：写入 ${written} 道题的关联`)
dump('_tmp_recompute_kp.txt', out.join('\n'))
await pool.end()
