/**
 * 考法归纳服务（r145）
 *
 * ── 这个服务解决什么问题 ────────────────────────────────────────────────
 * 「老师嘴里的题型」= **考法** = 这道题在考哪套动作/思维路径。
 * 它不是知识点名（「相似三角形」不合格），不是题型形式（「二次函数的选择题」不合格），
 * 也不是「知识点 · 形式」的机械拼接（「平方根 · 填空题关键结论」—— 这是 r144 存量
 * 67 条 draft 的原样，由旧 `autoName()` 生成，**0 条考法信息**）。
 *
 * ── 为什么按考点分批，而不是跨考点全局归纳 ──────────────────────────────
 * 2026-10-05 实测（探针 `_diag_kaofa_ai_1005.mjs` / `_diag_kaofa_ai_global_1005.mjs`）：
 *
 *   方案                          覆盖率        产出名字
 *   ─────────────────────────────────────────────────────────────
 *   按考点分批（12 题/1 考点）     11/12 ✅      「辨析错解」「反求原数」（动作导向）
 *   跨考点全局（40 题/84 考点）    18/40 ❌      「化简根式与分式」「应用相似三角形性质」
 *
 * 全局方案有两个致命问题：
 *   ① 覆盖率腰斩 —— 40 道题只归类 18 道，剩一半无处安放；
 *   2️⃣ 名字退化成「知识点 + 动作」—— 它把「应用哪条知识点」当成了「考什么动作」；
 *      更糟的是「解决行程问题」那道题被标了 4 个考点
 *      （行程问题+速度公式+单位换算+科学记数法）—— 那是**一道题的全部标签**，不是考法。
 *
 * 而「考法要有主考点」正是主管定的落点：**(知识点, 考法)**，不是 (知识点, 形式)。
 * 跨考点的部分靠 `teaching_question_type_kps` 多对多表达，不是靠一次全局归纳硬拼。
 *
 * ── 为什么不能拿「考点组合」当分组键 ────────────────────────────────────
 * 1046 道有 question_id 的错题里 958 道（91.6%）跨 2+ 考点，但组合会爆炸：
 *   「三角形+勾股定理+相似+相似三角形+相似三角形的判定」11 道
 *   「三角形+相似+相似三角形+相似三角形的判定」        10 道
 * 这俩本质是同一个考法（相似三角形判定），只是挂的考点数不同。
 * ⇒ 正确路径：**先归纳出有限的考法原型，再把题挂上去**（本服务就是干这个）。
 *
 * ── 质量闸的方向（踩过反面的坑，务必先读）─────────────────────────────
 * 2026-10-05 实测：先试过「考法名里禁止出现任何知识点词」，把 14 个禁词明确列进提示词，
 * BigModel **0/7 全红** —— 它照样产出「辨析**平方根**错误」「**平方根**概念理解」，
 * 而且粒度更碎（7 考法/10 题）、耗时涨到 47.7s。
 *
 * 根因：**动作要落在对象上**，「已知平方根反求原数」这类名字本来就该提到所操作的知识点。
 * 真正要禁的只有两种退化形态：拼接题型形式、退化成知识点名本身。
 * ⇒ `judgeMethodName()` 三条判据（可单测，不依赖 AI）。
 */
import { query } from '../config/neon.js'

const SUBJECT = '数学'
const DEFAULT_DAYS = 90
const DEFAULT_LIMIT_PER_KP = 12
/** 每考法至少要有几道题才算立得住（低于此数的合并进最接近的考法，或整体丢弃） */
export const MIN_ITEMS_PER_METHOD = 2
/** 考法名最长字数（AI 常在解释时写出长句） */
const MAX_NAME_LEN = 24

// ─────────────────────────────────────────────────────────────────────────
// 质量闸（纯函数，可单测 —— 判据不依赖 AI 行为，这是它能当闸的原因）
// ─────────────────────────────────────────────────────────────────────────

/**
 * 判一个 AI 产出的考法名是否合格。
 *
 * 三条判据（缺一不可）：
 *   ① 不含「·」 —— 「平方根 · 填空题关键结论」是「知识点 × 题型形式」的机械拼接。
 *   ② 不**等于**任一知识点名 —— 「相似三角形」就是知识点本身，不是考法。
 *      ⚠️ 判据是「等于」不是「包含」：包含知识点是**对的**（动作要落在对象上），
 *      这条被实测证伪过一次（见文件头）。
 *   ③ 长度在 2~MAX_NAME_LEN 之间 —— 太短是「解方程」这种太泛的词，太长是模型在解释。
 *
 * @param {string} name AI 产出的考法名
 * @param {string[]} kpVocab 本次输入里出现过的全部知识点名（禁「等于」用）
 * @returns {{ok: boolean, reason?: string}}
 */
export function judgeMethodName(name, kpVocab = []) {
  const n = String(name == null ? '' : name).trim()
  if (!n) return { ok: false, reason: '空名' }
  if (n.includes('·')) return { ok: false, reason: '含「·」机械拼接（知识点 × 题型形式）' }
  if (n.length > MAX_NAME_LEN) return { ok: false, reason: `超长（${n.length} > ${MAX_NAME_LEN}），多半是模型在解释` }
  if (n.length < 2) return { ok: false, reason: '过短，够不成一个考法' }
  const hit = kpVocab.find((v) => v && String(v).trim() === n)
  if (hit) return { ok: false, reason: `就是知识点名本身（${hit}），不是考法` }
  return { ok: true }
}

/**
 * 解析 AI 的归纳输出 → 归一化后的考法数组，并逐条过质量闸。
 * 纯函数（只吃字符串 + 词表），所以能直接单测 —— 这正是把它从 AI 逻辑里拆出来的原因。
 *
 * @param {string} text 模型原始返回
 * @param {string[]} kpVocab 禁「等于」的知识点词表
 * @param {number} expectedCount 期望题数（用来校验 items 越界）
 * @returns {{methods: Array, rejected: Array}}
 */
export function parseMethodResponse(text, kpVocab = [], expectedCount = 0) {
  const rejected = []
  const obj = extractJsonObject(text)
  if (!obj || !Array.isArray(obj.methods)) return { methods: [], rejected: [{ raw: null, reason: '解析失败或结构不对' }] }

  const methods = []
  for (const m of obj.methods) {
    const name = String(m?.name == null ? '' : m.name).trim()
    const verdict = judgeMethodName(name, kpVocab)
    const items = Array.isArray(m?.items)
      ? [...new Set(m.items.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 1 && n <= expectedCount))]
      : []
    if (!verdict.ok) { rejected.push({ name, reason: verdict.reason, items: items.length }); continue }
    if (items.length < MIN_ITEMS_PER_METHOD) {
      rejected.push({ name, reason: `只 ${items.length} 道题，低于门槛 ${MIN_ITEMS_PER_METHOD}`, items: items.length })
      continue
    }
    const kps = Array.isArray(m?.kps) ? [...new Set(m.kps.map((s) => String(s == null ? '' : s).trim()).filter(Boolean))] : []
    if (kps.length === 0) { rejected.push({ name, reason: 'kps 为空（无法建立考点关联）', items: items.length }); continue }
    methods.push({
      name,
      action: String(m?.action == null ? '' : m.action).trim().slice(0, 20),
      kps,
      steps: Array.isArray(m?.steps) ? m.steps.map((s) => String(s == null ? '' : s).trim()).filter(Boolean).slice(0, 5) : [],
      pitfalls: String(m?.pitfalls == null ? '' : m.pitfalls).trim().slice(0, 200),
      items,
    })
  }
  return { methods, rejected }
}

/**
 * 取第一个平衡的 JSON 对象（容忍 ```json 包裹与前后废话）。
 * 从 worker.js 的 parseTaggingResponse 学来 —— 模型输出没有 100% 纪律。
 */
function extractJsonObject(text) {
  let raw = String(text == null ? '' : text).trim()
  if (!raw) return null
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) raw = fence[1].trim()
  const start = raw.indexOf('{')
  if (start === -1) return null
  let depth = 0, inStr = false, esc = false, end = -1
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]
    if (esc) { esc = false; continue }
    if (ch === '\\') { esc = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (ch === '{') depth += 1
    else if (ch === '}') { depth -= 1; if (depth === 0) { end = i; break } }
  }
  if (end === -1) return null
  try { const o = JSON.parse(raw.slice(start, end + 1)); return o && typeof o === 'object' ? o : null } catch { return null }
}

// ─────────────────────────────────────────────────────────────────────────
// 提示词
// ─────────────────────────────────────────────────────────────────────────
function buildPrompt(kpName, kpVocab, items) {
  const block = items.map((it, i) => {
    const stem = it.parentStem ? String(it.parentStem).replace(/\s+/g, ' ').slice(0, 180) : ''
    const body = String(it.content || '').replace(/\s+/g, ' ').slice(0, 300)
    const head = `[${i + 1}]（${it.wrongCount}人错｜${it.allKps || kpName}）`
    return head + (stem ? `\n     题干：${stem}` : '') + `\n     小问：${body}`
  }).join('\n')
  const vocab = kpVocab.join('、')
  return {
    system: `你是资深初中数学教研员，帮老师整理"考法库"。

【考法的定义 —— 必须严格遵守】
考法 = 这道题在考哪套**解题动作/思维路径**。
考法**不是**知识点名，**不是**题型形式（选择/填空/解答）。

考法名要**动作 + 对象**：对象是题目里出现的知识（那是正常的、必须的），
但不能退化成知识点本身。
✅ 合格：辨析错解并改正 / 已知平方根反求原数 / 新定义问题建模 / 动点求取值范围 / 辨析错误解法
❌ 不合格1（拼接题型形式）：${kpName} · 填空题关键结论
❌ 不合格2（就是知识点名）：${kpName}
❌ 不合格3（太泛）：解方程

【粒度要求】
- 归纳 2-4 个考法，**宁可粗不可碎**：每个考法至少 ${MIN_ITEMS_PER_METHOD} 道题。
- 同一考法内的题必须是"同一套动作"，只是数字/情境不同。
- 若两组的动作其实一样，合并成一组。
- 实在归不进去的题就别硬塞（宁可漏，不要错归）。

【字段要求】
- action：4-8 字动宾短语，只写动作（辨析错解 / 反求原数 / 分类讨论）
- kps：只能从这些知识点里挑（可多个）：${vocab}
- steps：2-4 步关键动作链
- pitfalls：学生最常犯的错
- items：归入本考法的题号数组
- 只输出 JSON，不要解释文字。

格式：{"methods":[{"name":"考法名","action":"动宾短语","kps":["知识点1"],"steps":["步骤1"],"pitfalls":"常犯错误","items":[1,2]}]}`,
    user: `【${kpName}】下学生真实做错的 ${items.length} 道题：\n\n${block}`,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 取数：按考点取真实错题（**题目级去重**）
// ─────────────────────────────────────────────────────────────────────────
/**
 * ⛔ 为什么要题目级去重（实测踩到）：
 *   按 `wrong_questions` 行去重会拿到**同一道题的多行**（不同学生错）——
 *   2026-10-05 实测「平方根」桶里 12 道题有 2 组重复，AI 看到 [3] 和 [5] 一模一样，
 *   会误以为「这两道题是同一考法的两道独立证据」，把粒度算错。
 */
export async function fetchKpWrongQuestions(kpId, { days = DEFAULT_DAYS, limit = DEFAULT_LIMIT_PER_KP } = {}) {
  const { rows } = await query(
    `SELECT q.id, q.question_type, q.content, q.parent_stem, q.options,
            COUNT(DISTINCT wq.student_id)::int AS wrong_count,
            s.name AS all_kps
       FROM wrong_questions wq
       JOIN questions q ON q.id = wq.question_id
       LEFT JOIN LATERAL (
         SELECT string_agg(k2.name, '、' ORDER BY k2.level) AS name
           FROM question_knowledge qk2
           JOIN knowledge_points k2 ON k2.id = qk2.kp_id
          WHERE qk2.question_id = q.id
       ) s ON TRUE
      WHERE wq.added_at >= now() - ($2::int * interval '1 day')
        AND EXISTS (
          SELECT 1 FROM question_knowledge qk3
           WHERE qk3.question_id = q.id AND qk3.kp_id = $1::uuid
        )
      GROUP BY q.id, s.name
      ORDER BY wrong_count DESC, q.id
      LIMIT $3`,
    [kpId, days, limit])
  return rows.map((r) => ({
    questionId: r.id,
    questionType: r.question_type,
    content: r.content,
    parentStem: r.parent_stem,
    options: r.options,
    wrongCount: r.wrong_count || 0,
    allKps: r.all_kps,
  }))
}

/** 候选考点：按错题量取 TopN（有最低门槛，低于门槛的考点不值得花 30+ 秒归纳） */
export async function fetchCandidateKps({ days = DEFAULT_DAYS, limit = 10, minWrong = 8 } = {}) {
  const { rows } = await query(
    `SELECT kp.id, kp.name, kp.level, COUNT(DISTINCT wq.question_id)::int AS wrong_count
       FROM wrong_questions wq
       JOIN questions q ON q.id = wq.question_id AND q.is_complete = TRUE
       JOIN question_knowledge qk ON qk.question_id = q.id
       JOIN knowledge_points kp ON kp.id = qk.kp_id AND kp.subject = $1
      WHERE wq.added_at >= now() - ($2::int * interval '1 day')
      GROUP BY kp.id, kp.name, kp.level
     HAVING COUNT(DISTINCT wq.question_id) >= $3
      ORDER BY wrong_count DESC
      LIMIT $4`,
    [SUBJECT, days, minWrong, limit])
  return rows
}

// ─────────────────────────────────────────────────────────────────────────
// 落库
// ─────────────────────────────────────────────────────────────────────────
/**
 * 写一条考法 draft + 它的多对多考点关联。
 *
 * ⛔ 两个关键口径：
 *   1. **老师改过的名字不被 AI 覆盖** —— ON CONFLICT DO UPDATE 只更新统计，
 *      **绝不改 name / teaching_notes**。status 也不从 active 打回 draft
 *      （老师确认过的东西不该被自动建议推翻）。archived 才会被复活成 draft。
 *   2. `teaching_question_types.kp_id` = 传入的主考点（落点 = (知识点, 考法)），
 *      同时往 `teaching_question_type_kps` 写 1 行 primary + N 行 secondary。
 */
export async function saveMethod({ userId, kpId, method, exampleQuestions, commonMistakes = '' }) {
  const summary = {
    action: method.action || '',
    steps: method.steps || [],
    pitfalls: method.pitfalls || '',
    kps: method.kps || [],
    itemCount: (method.items || []).length,
    inducedBy: 'ai',
    generatedAt: new Date().toISOString(),
  }
  const notes = [
    `考法动作：${method.action || method.name}。`,
    method.steps?.length ? `关键步骤：${method.steps.join(' → ')}` : '',
  ].filter(Boolean).join('\n')

  const { rows } = await query(
    `INSERT INTO teaching_question_types
       (user_id, kp_id, subject, name, teaching_notes, common_mistakes, tags, status, source, auto_summary)
     VALUES ($1, $2::uuid, $3, $4, $5, $6, $7::jsonb, 'draft', 'auto', $8::jsonb)
     ON CONFLICT (user_id, kp_id, name) DO UPDATE SET
       auto_summary = EXCLUDED.auto_summary,
       status = CASE WHEN teaching_question_types.status = 'archived' THEN 'draft'
                     ELSE teaching_question_types.status END,
       updated_at = now()
     RETURNING id, (xmax = 0) AS inserted`,
    [userId, kpId, SUBJECT, method.name, notes, commonMistakes || method.pitfalls || '',
     JSON.stringify(['AI 归纳', ...(method.kps || []).slice(0, 4)]), JSON.stringify(summary)])

  const typeId = rows[0]?.id
  if (!typeId) return null

  // 多对多考点：primary 1 行 + secondary N 行
  // ⛔ 不动 teaching_question_types.kp_id：那是主考点，由上面的 upsert 决定。
  await query(
    `INSERT INTO teaching_question_type_kps (type_id, kp_id, role)
     SELECT $1, kp.id, CASE WHEN kp.id = $2::uuid THEN 'primary' ELSE 'secondary' END
       FROM knowledge_points kp
      WHERE kp.name = ANY($3::text[])
     ON CONFLICT (type_id, kp_id) DO NOTHING`,
    [typeId, kpId, method.kps || []])

  // 代表题快照：只挂 items 里点名的那几道（不是整批）
  for (const q of exampleQuestions) {
    await query(
      `INSERT INTO teaching_question_type_examples (type_id, source_question_id, snapshot, note)
       SELECT $1, $2::uuid, $3::jsonb, $4
        WHERE NOT EXISTS (
          SELECT 1 FROM teaching_question_type_examples
           WHERE type_id = $1 AND source_question_id = $2::uuid
        )`,
      [typeId, q.questionId, JSON.stringify({
        content: q.content, parentStem: q.parentStem, options: q.options,
        questionType: q.questionType, subject: SUBJECT, kps: method.kps,
      }), 'AI 从近期错题归纳的代表题'])
  }

  // 刷新 question_count 展示缓存（⛔ 派生数据，不当真相同来源）
  await query(
    `UPDATE teaching_question_type_kps k
        SET question_count = COALESCE(sub.n, 0)
       FROM teaching_question_types t
       LEFT JOIN (
         SELECT e.type_id, COUNT(DISTINCT e.source_question_id)::int AS n
           FROM teaching_question_type_examples e
          WHERE e.source_question_id IS NOT NULL
          GROUP BY e.type_id
       ) sub ON sub.type_id = t.id
      WHERE k.type_id = t.id AND t.id = $1`,
    [typeId])

  return { typeId, inserted: rows[0]?.inserted === true }
}

// ─────────────────────────────────────────────────────────────────────────
// 主入口：对单个考点跑一轮归纳
// ─────────────────────────────────────────────────────────────────────────
/**
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.kpId
 * @param {boolean} opts.dryRun  true = 只返回结果不写库（默认 true，防手滑）
 * @param {Function} opts.callText 注入式 AI 调用（默认走生产 callTextCompletion）
 */
export async function induceMethodsForKp({
  userId,
  kpId,
  kpName,
  days = DEFAULT_DAYS,
  limit = DEFAULT_LIMIT_PER_KP,
  minWrong = 3,
  dryRun = true,
  callText,
  // ⛔ r145 事故留痕：调用方曾传 `apply: true`，而本函数只解构 `dryRun`（默认 true）
  //   ⇒ 写库被静默跳过，接口还返回 `applied: true`，老师点「写库」毫无反应且无报错。
  //   根因是「同名不同义」而非逻辑错，所以这里显式吞掉已知误用并**硬失败**，
  //   逼调用方当场改正，而不是悄悄什么都不做。
  ...unknown
} = {}) {
  if ('apply' in unknown || 'write' in unknown || 'persist' in unknown) {
    throw new Error(
      `induceMethodsForKp 参数名错误：收到 ${Object.keys(unknown).join(',')}，本函数只认 dryRun（true=预演不写库）。`
    )
  }
  const questions = await fetchKpWrongQuestions(kpId, { days, limit })
  if (questions.length < minWrong) {
    return { kpId, kpName, skipped: true, reason: `只有 ${questions.length} 道错题，低于门槛 ${minWrong}`, questions: questions.length }
  }

  // 词表 = 主考点 + 这批题实际关联到的全部知识点（供「不等于知识点名」判据与 kps 约束）
  const kpVocab = new Set([kpName])
  for (const q of questions) if (q.allKps) q.allKps.split('、').forEach((x) => x.trim() && kpVocab.add(x.trim()))

  const { system, user } = buildPrompt(kpName, [...kpVocab], questions)

  const call = callText || (async (payload) => {
    const { callTextCompletion } = await import('../config/ai.js')
    // ⛔ 归纳是纯文本任务，视觉模型无用（实测慢 10 倍+）。
    //   BigModel 免费且最快，作主；Bailian 付费作备（preferredVendor 直连绕开降级链，治理 429）。
    return callTextCompletion({ ...payload, temperature: 0.3, maxTokens: 1600, preferredVendor: 'BigModel' })
  })

  const startedAt = Date.now()
  let content = ''
  let vendor = null
  let error = null
  try {
    const res = await call({ systemContent: system, userContent: user })
    content = String(res?.content || '')
    vendor = res?.vendor || null
  } catch (e) {
    error = e.message
  }
  const elapsedMs = Date.now() - startedAt

  const { methods, rejected } = parseMethodResponse(content, [...kpVocab], questions.length)

  const saved = []
  if (!dryRun && methods.length && userId) {
    for (const m of methods) {
      const r = await saveMethod({
        userId, kpId, method: m,
        exampleQuestions: m.items.map((n) => questions[n - 1]).filter(Boolean),
      })
      if (r) saved.push({ ...r, name: m.name })
    }
  }

  return {
    kpId, kpName,
    questionCount: questions.length,
    methods,
    rejected,
    vendor, elapsedMs, error,
    dryRun,
    saved,
  }
}
