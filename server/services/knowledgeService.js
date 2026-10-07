import { query, TABLES } from '../config/neon.js'
import { classifyQuestionLocally } from '../utils/localTagger.js'
import { classifyEnglishLocally } from './englishAnalyzer.js'

// ============================================================
// 知识点服务（knowledgeService）
//
// 职责：
//   1. 标签归一化：把 AI / 本地规则产出的扁平知识点标签（如 "抛物线"、"直角三角形"）
//     归一化到 knowledge_points 知识树节点（同义词映射 + 置信回退到本地字典）。
//   2. 一题多知识点关联：写 question_knowledge（primary/secondary + weight）。
//   3. 树查询：getKnowledgeTree / getQuestionKnowledge 供前端成长中心与讲义引擎使用。
//
// 知识树缓存：subject → kp 列表。运行期知识树被运维改动的概率极低，
// 缓存失效只发生在显式调用 clearKnowledgeCache() 时。
// ============================================================

const _kpCache = new Map()

/**
 * 加载某学科的全部知识点节点（含 synonyms），带进程内缓存。
 *
 * ⛔ 2026-10-07 起排除 archived=true 的节点：
 *   知识树里混着 8 个高中/超范围节点（数列、数学归纳法、二项式定理、极限概念…），
 *   它们会被初中题目误挂上（如"找规律"题被标成"数列"）。archived 是唯一过滤开关，
 *   由 `server/scripts/applyKnowledgeStage.mjs` 维护。
 *   ⚠️ 排除只影响「打标匹配」与「前端树」；question_knowledge 里指向它们的存量边
 *     需要跑 recomputeQuestionKnowledge.mjs 重算才会消失。
 *
 * @param {string} subject
 * @returns {Promise<Array<{id, parent_id, name, subject, level, sort_order, synonyms}>>}
 */
export async function loadKnowledgePoints(subject = '数学') {
  const key = subject || '数学'
  if (_kpCache.has(key)) return _kpCache.get(key)
  const { rows } = await query(
    `SELECT id, parent_id, name, subject, level, sort_order, synonyms
     FROM ${TABLES.KNOWLEDGE_POINTS}
     WHERE subject = $1 AND archived = false
     ORDER BY level ASC, sort_order ASC, name ASC`,
    [key]
  )
  const list = rows.map(r => ({
    ...r,
    synonyms: Array.isArray(r.synonyms) ? r.synonyms : []
  }))
  _kpCache.set(key, list)
  return list
}

export function clearKnowledgeCache() {
  _kpCache.clear()
}

// ── 标签归一化 ──
// ⛔ 2026-10-07 打标粒度根治（第一刀）：
//   原来只去空格。实测 AI 标签与树节点名**大量只差一个「的」**——
//   "平行线性质" vs "平行线的性质"、"相似三角形性质" vs "相似三角形的性质"。
//   不去虚词 ⇒ 精确匹配失败 ⇒ 只能靠子串兜底（60+长度）⇒ 落到更粗的节点上。
//   ⚠️ 只去结构助词「的/之」，**不要再去尾缀**（运算/性质/…）：
//      实测再去尾缀会把「二次根式的运算」抢到更长的「二次根式的性质」上（赢错了）。
const normalizeText = (s) => String(s || '')
  .replace(/[\s　]+/g, '')
  .replace(/[的之]/g, '')
  .toLowerCase()

// ── 标签 → 知识树节点匹配 ──
// 匹配置信度（score）：
//   name 精确命中    → 100
//   synonym 精确命中 → 95
//   双向子串命中     → 60 + 命中长度（较短者 >=2 才允许，避免单字噪声）
// 相同 name 的父/子节点同时命中时都保留，role 由 score 排序后决定。
const SCORE_NAME_EXACT = 100
const SCORE_SYNONYM_EXACT = 95
// 宽松归一化精确命中（去「的/之」+ 去尾缀后完全相同）。
// ⛔ 必须严格小于 95：否则「精确命中」会被宽松命中抢走（如 tag="分式" 抢到"分式化简"）。
//    + 节点名长度做微调，让更具体的节点在同分时胜出（"实数的运算" > "实数"）。
const SCORE_LOOSE_EXACT = 84

/**
 * 算单个「标签 → 节点」的匹配置信度。0 表示不命中。
 * 抽成纯函数是为了让 matchKnowledgePoints 能分两遍跑（先算每个标签的最高分，再筛节点）。
 */
const scoreTagAgainstNode = (tag, name, synonyms) => {
  if (name && name === tag) return SCORE_NAME_EXACT
  if (synonyms.includes(tag)) return SCORE_SYNONYM_EXACT
  let best = 0
  // 单向子串匹配：仅当「标签包含节点名/同义词」时命中（如 tag="相似三角形" → 节点"三角形"）。
  // 不反向匹配（tag="函数" 不会因此命中"一次函数"），防止通用标签污染全部子节点掌握度。
  for (const n of [name, ...synonyms]) {
    if (!n) continue
    if (n.length >= 2 && tag.includes(n)) best = Math.max(best, 60 + n.length)
  }
  return best
}

/**
 * 把一组扁平标签匹配到知识树节点。
 *
 * ⛔ 2026-10-07 打标粒度根治（第二刀，也是真正的主因）：
 *   旧实现把**所有** score>0 的节点都返回。于是标签「平方差公式」同时命中
 *   「平方差公式」(精确 100) 和「平方」(子串 62)，两个都被挂上 ——
 *   泛化节点（平方 454、实数 475、函数 431）的边数就是这么被灌出来的，
 *   实测占全部关联边的 28%。
 *   现在改为：**每个标签只保留得分最高的节点**（同分并列都留，如
 *   「相似三角形的判定与性质」同时精确命中判定和性质）。
 *   父节点不再因为「子节点名里含它」而被顺带挂上。
 *
 * @param {string[]} tags 扁平标签（如 ['相似三角形', '勾股定理']）
 * @param {string} subject 学科（决定用哪棵知识树）
 * @returns {Promise<Array<{id, parent_id, name, level, subject, score}>>} 按 score 降序
 */
export async function matchKnowledgePoints(tags, subject = '数学') {
  const list = await loadKnowledgePoints(subject)
  if (!Array.isArray(tags) || tags.length === 0) return []

  const tagList = tags.map(t => normalizeText(t)).filter(Boolean)
  if (tagList.length === 0) return []

  // 第一遍：每个标签的最高分（用于第二遍筛「只保留最高分节点」）
  const bestPerTag = new Map()
  for (const kp of list) {
    const name = normalizeText(kp.name)
    const synonyms = (kp.synonyms || []).map(normalizeText).filter(Boolean)
    for (const t of tagList) {
      const s = scoreTagAgainstNode(t, name, synonyms)
      if (s > 0 && s > (bestPerTag.get(t) || 0)) bestPerTag.set(t, s)
    }
  }

  // 第二遍：只收「在某个标签上拿到最高分」的节点
  const matched = []
  for (const kp of list) {
    const name = normalizeText(kp.name)
    const synonyms = (kp.synonyms || []).map(normalizeText).filter(Boolean)
    let nodeBest = 0
    let isTopForSomeTag = false
    for (const t of tagList) {
      const s = scoreTagAgainstNode(t, name, synonyms)
      if (s <= 0) continue
      nodeBest = Math.max(nodeBest, s)
      if (s === bestPerTag.get(t)) isTopForSomeTag = true
    }
    if (isTopForSomeTag) matched.push({ ...kp, score: nodeBest })
  }

  // 优先级：更具体（level 更高）的节点优先 → 其次匹配置信度 → 其次 sort_order。
  // 这样"相似三角形"(level2) 会排在"三角形"(level1) 前面，成为 primary。
  matched.sort((a, b) => b.level - a.level || b.score - a.score || (a.sort_order ?? 0) - (b.sort_order ?? 0))
  return matched
}

/**
 * 拼「打标 / 知识点匹配」用的完整题干。
 *
 * ⛔ 必须包含 parent_stem（多小问大题的公共题干原文）—— 2026-10-05 实测事故：
 *   题目形如「content=求3a-b+c的平方根」+「parent_stem=已知5a+2的立方根是3，3a+b-1的
 *   算术平方根是4，c是√15的整数部分」。只看 content 的话：
 *     - 纯文本端（本地规则 / AI）根本判不出考点 → 返回 ["未分类"] → 零关联；
 *     - 更糟的是判错：小问「计算：1/2+1/4+…+1/32」单独看毫无方向，
 *       父题干「找规律，完成下列各题」才点明是等比数列求和。
 *   答案链路（worker.js:2296）与几何链路（geometryWorker.js:280）早已踩过同一个坑
 *   并留了注释，只有打标 → 知识点关联 → 掌握度这条链路漏了。
 *
 * 顺序固定为 parent_stem → content → 选项，缺项跳过（filter(Boolean)），
 * 与答案链路的输入口径（[parent_stem, content].join('\n')）保持一致。
 *
 * 导出原因：这是纯函数，可被 test/ 直接 import 做回归锁，不依赖数据库。
 *
 * @param {Object} p
 * @param {string|null} p.parentStem 公共题干
 * @param {string|null} p.content    本小问题干
 * @param {string[]|null} p.options  选项
 * @returns {string}
 */
export function buildTaggingInput({ parentStem = null, content = null, options = null } = {}) {
  const parts = []
  if (parentStem && String(parentStem).trim()) parts.push(String(parentStem).trim())
  if (content && String(content).trim()) parts.push(String(content).trim())
  if (Array.isArray(options) && options.length > 0) {
    const opts = options.map(o => (o == null ? '' : String(o).trim())).filter(Boolean)
    if (opts.length) parts.push(`选项：${opts.join('；')}`)
  }
  return parts.join('\n')
}

/**
 * 把 questions.ai_tags（**text 列**，不是 jsonb）归一成字符串数组。
 *
 * ⛔ 这不是可选的健壮性，是2026-10-05 实测发现的生产缺陷：
 *   `questions.ai_tags` 列类型是 text，SELECT 出来是字符串
 *   `'["抛物线方程", "抛物线上的点坐标"]'`。
 *   而 normalizeQuestionTags 原来只做 `Array.isArray(aiTags) ? ... : []`
 *   ⇒ **库里有 3011 道题的标签，一道都没被用上**，静默全部回落本地规则。
 *   症状：改了知识树/加了 AI 打标却看不到任何关联变化，排查极难。
 *
 * 兼容三种形态：真数组 / JSON 字符串 / 老式逗号分隔串（"根式化简, 实数"）。
 * ⚠️ 解析失败一律返回空数组（调用方回落本地规则），绝不抛错。
 */
export function coerceAiTags(raw) {
  if (Array.isArray(raw)) return raw.map(t => String(t == null ? '' : t).trim()).filter(Boolean)
  if (typeof raw !== 'string') return []
  const s = raw.trim()
  if (!s || s === '[]' || s === 'null' || s === 'undefined') return []
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s)
      return Array.isArray(arr) ? arr.map(t => String(t == null ? '' : t).trim()).filter(Boolean) : []
    } catch { return [] }
  }
  // JSON 对象串（{"tags":[...]}）不是标签数组，落到下面的逗号切分会被切碎成垃圾标签。
  if (s.startsWith('{')) return []
  // 老式逗号/顿号/分号分隔
  return s.split(/[,，;；、]/).map(t => t.trim()).filter(Boolean)
}

/**
 * 题目 → 归一化知识点列表（knowledgeService 核心入口）。
 *
 * 策略：
 *   1. 优先使用传入的 aiTags（去掉 '未分类' 占位）
 *   2. aiTags 不可用时回退到本地规则分类（classifyQuestionLocally，零 LLM）
 *   3. 匹配知识树节点；按 score 排序，首节点 role=primary，其余 secondary
 *   4. subject 缺省时用 '数学'（当前知识树只播种了数学）
 *
 * ⚠️ parentStem 必须由调用方传入（多小问大题的公共题干，见 buildTaggingInput 注释）。
 *   漏传不会报错、只会静默判错考点 —— 存量未重算前，历史关联可能仍是旧口径。
 * ⚠️ aiTags 允许传 text 列读出来的字符串，coerceAiTags 会解析（见其注释的生产缺陷说明）。
 *
 * @param {Object} params
 * @param {string} params.content 题干
 * @param {string|null} params.subject 学科
 * @param {string[]|null} params.options 选项
 * @param {string[]|string|null} params.aiTags AI/本地标签（数组或 text 列字符串）
 * @param {string|null} [params.parentStem] 多小问大题的公共题干
 * @returns {Promise<{subject, tagSource, kps: Array<{kp_id, name, level, role, weight, score}>}>}
 */
export async function normalizeQuestionTags({ content, subject = null, options = null, aiTags = null, parentStem = null } = {}) {
  const resolvedSubject = subject && String(subject).trim() ? String(subject).trim() : '数学'

  let tags = coerceAiTags(aiTags).filter(t => t !== '未分类')
  let tagSource = 'ai'

  if (tags.length === 0) {
    const fullContent = buildTaggingInput({ parentStem, content, options })
    // 英语走英语分析器（题型识别 + 细粒度语法点匹配）
    const local = resolvedSubject === '英语'
      ? classifyEnglishLocally(fullContent, '英语', options)
      : classifyQuestionLocally(fullContent, resolvedSubject)
    tags = local.tags.filter(t => t !== '未分类')
    tagSource = 'local'
  }

  const matched = await matchKnowledgePoints(tags, resolvedSubject)
  const kps = matched.map((m, idx) => ({
    kp_id: m.id,
    name: m.name,
    level: m.level,
    role: idx === 0 ? 'primary' : 'secondary',
    weight: idx === 0 ? 1.0 : Math.max(0.4, 1 - idx * 0.15),
    score: m.score
  }))

  return { subject: resolvedSubject, tagSource, kps }
}

/**
 * 替换题目的知识点关联（先删后插，幂等）。
 * 不抛错：知识点关联是增值数据，失败不应影响主流程。
 * @param {string} questionId
 * @param {Array<{kp_id, role, weight}>} kps
 * @param {Object} [client] 可选，传入 pg 事务 client 时在事务内执行
 */
export async function assignQuestionKnowledge(questionId, kps, client = null) {
  const run = async (q) => {
    await q.query(
      `DELETE FROM ${TABLES.QUESTION_KNOWLEDGE} WHERE question_id = $1`,
      [questionId]
    )
    if (!Array.isArray(kps) || kps.length === 0) return 0
    const values = kps.map((_, i) =>
      `($1, $${i * 3 + 2}, $${i * 3 + 3}, $${i * 3 + 4})`
    ).join(',')
    const params = [questionId]
    for (const k of kps) {
      params.push(k.kp_id, k.role || 'secondary', k.weight ?? 0.7)
    }
    const { rowCount } = await q.query(
      `INSERT INTO ${TABLES.QUESTION_KNOWLEDGE} (question_id, kp_id, role, weight)
       VALUES ${values}
       ON CONFLICT (question_id, kp_id) DO UPDATE SET role = EXCLUDED.role, weight = EXCLUDED.weight`,
      params
    )
    return rowCount
  }
  try {
    if (client) return await run(client)
    return await run({ query })
  } catch (err) {
    console.warn(`  ⚠️ [Knowledge] 题目 ${String(questionId).slice(0, 8)} 知识点关联失败:`, err.message)
    return 0
  }
}

/**
 * 批量关联一组题目的知识点。
 * @param {Array<{questionId, kps}>} entries
 */
export async function assignQuestionsKnowledge(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return 0
  let linked = 0
  for (const e of entries) {
    if (!e.questionId) continue
    const n = await assignQuestionKnowledge(e.questionId, e.kps || [])
    linked += n > 0 ? 1 : 0
  }
  return linked
}

/**
 * 批量关联一组题目的知识点（性能优化版本）：
 *   1. 用单个 SQL 把所有 (questionId, kpId) 对 UPSERT（ON CONFLICT）
 *   2. 再用一个 SQL 把这次出现过的 questionId 的旧次要记录删掉（保留 primary 中重复的）
 * 相比单题循环 2N 次 round-trip，本方法只需 1 次 UPSERT + 1 次 DELETE。
 *
 * 注意：当前调用方不区分 primary/secondary 的删除（每次全量重写），
 * 行为与 assignQuestionKnowledge 保持一致：先删后插，幂等。
 *
 * @param {Array<{questionId, kps}>} entries - 与 assignQuestionsKnowledge 同
 * @returns {Promise<number>} 成功关联的题目数
 */
export async function assignQuestionsKnowledgeBulk(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return 0
  const valid = entries.filter(e => e.questionId && Array.isArray(e.kps) && e.kps.length > 0)
  if (valid.length === 0) return 0

  // 收集所有 (questionId, kpId, role, weight)
  const flat = []
  for (const e of valid) {
    for (const k of e.kps) {
      flat.push({
        questionId: e.questionId,
        kpId: k.kp_id,
        role: k.role || 'secondary',
        weight: k.weight ?? 0.7,
      })
    }
  }
  if (flat.length === 0) return 0

  const qIds = valid.map(e => e.questionId)
  // 1. 先把这批题目的旧关联清空（一次 DELETE）
  try {
    await query(
      `DELETE FROM ${TABLES.QUESTION_KNOWLEDGE} WHERE question_id = ANY($1::uuid[])`,
      [qIds]
    )
  } catch (err) {
    console.warn(`  ⚠️ [Knowledge] 批量清理旧关联失败，回退逐题模式:`, err.message)
    return assignQuestionsKnowledge(entries)
  }

  // 2. 一次性 INSERT 全部新关联
  // 注意：单条 INSERT 最多 65535 个参数；本题 4 列 × 1000 题 = 4000 个参数，安全。
  // 若 kp 关联很多，限制单批 ≤ 200 题，更安全
  const BATCH_SIZE = 200
  let inserted = 0
  for (let i = 0; i < valid.length; i += BATCH_SIZE) {
    const batch = valid.slice(i, i + BATCH_SIZE)
    const values = []
    const params = []
    let p = 1
    for (const e of batch) {
      for (const k of e.kps) {
        values.push(`($${p++}, $${p++}, $${p++}, $${p++})`)
        params.push(e.questionId, k.kp_id, k.role || 'secondary', k.weight ?? 0.7)
      }
    }
    if (values.length === 0) continue
    try {
      const { rowCount } = await query(
        `INSERT INTO ${TABLES.QUESTION_KNOWLEDGE} (question_id, kp_id, role, weight)
         VALUES ${values.join(',')}
         ON CONFLICT (question_id, kp_id) DO UPDATE SET role = EXCLUDED.role, weight = EXCLUDED.weight`,
        params
      )
      inserted += rowCount || 0
    } catch (err) {
      console.warn(`  ⚠️ [Knowledge] 批量 INSERT 失败 batch=${i}:`, err.message)
    }
  }
  return inserted > 0 ? valid.length : 0
}

/**
 * 获取某题已关联的知识点（含父级链），供前端展示"这题考什么"。
 * @param {string} questionId
 * @returns {Promise<Array<{kp_id, role, weight, name, level, subject}>>}
 */
export async function getQuestionKnowledge(questionId) {
  const { rows } = await query(
    `SELECT qk.kp_id, qk.role, qk.weight, kp.name, kp.level, kp.subject
     FROM ${TABLES.QUESTION_KNOWLEDGE} qk
     JOIN ${TABLES.KNOWLEDGE_POINTS} kp ON kp.id = qk.kp_id
     WHERE qk.question_id = $1
     ORDER BY qk.weight DESC`,
    [questionId]
  )
  return rows
}

/**
 * 获取知识树（嵌套结构，roots → children）。
 * @param {string} subject
 * @returns {Promise<Array>}
 */
export async function getKnowledgeTree(subject = '数学') {
  const list = await loadKnowledgePoints(subject)
  const byId = new Map(list.map(kp => [kp.id, { ...kp, children: [] }]))
  const roots = []
  for (const kp of byId.values()) {
    if (kp.parent_id && byId.has(kp.parent_id)) {
      byId.get(kp.parent_id).children.push(kp)
    } else {
      roots.push(kp)
    }
  }
  const sortRec = (nodes) => {
    nodes.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name, 'zh'))
    nodes.forEach(n => sortRec(n.children))
    return nodes
  }
  return sortRec(roots)
}
