import { Router } from 'express'
import { query } from '../config/neon.js'
// r145：只 import 路由真正用到的三个。取数/解析都封在 induceMethodsForKp 内部，
// 路由层不直接调 parseMethodResponse，避免同一套质量闸出现第二个调用点走偏。
import { induceMethodsForKp, fetchCandidateKps } from '../services/kaofaInduction.js'

const router = Router()
const DEFAULT_USER = 'default-user'
const userOrDefault = (req) => (req.query.userId || req.body?.userId || req.headers['x-user-id'] || DEFAULT_USER).toString().trim()
const subject = '数学'

function normalizeTags(value) {
  return Array.isArray(value) ? [...new Set(value.map(item => String(item).trim()).filter(Boolean))].slice(0, 12) : []
}

// ⛔ autoName 已于 r145 删除。
//   它是 r144 存量 67 条 draft 机械拼接的罪魁祸首：
//     `${knowledgeName} · ${label}`，label ∈ {选择题方法辨析, 填空题关键结论, 判断题条件辨析, 综合解答与建模}
//   ——「考点 × 题型形式」，**0 条考法信息**（题型形式是 questions.question_type 的值，
//   主管三次澄清：「老师嘴里的题型 = 考法 = 这道题在考哪套动作」，不是形式）。
//   替代路径 = services/kaofaInduction.js 的 AI 归纳（按考点分批，动作导向命名 + 多对多考点关联）。
//   ⛔ 别把它"恢复"回来。历史 draft 仍在库里（status='draft'，等老师确认或忽略）。

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v) => UUID_RE.test(String(v == null ? '' : v).trim())

async function getTypeDetail(id, userId) {
  // r145：脏 id（空/非 UUID）会让 Postgres 抛 22P02 invalid input syntax → 500。
  // 「不存在」和「压根不是 id」对老师是同一件事，都该 404，不要泄漏数据库错误。
  if (!isUuid(id)) return null
  const { rows } = await query(
    `SELECT t.*, kp.name AS knowledge_name,
      COALESCE(jsonb_agg(jsonb_build_object(
        'id', e.id, 'sourceQuestionId', e.source_question_id, 'sourceWrongQuestionId', e.source_wrong_question_id,
        'snapshot', e.snapshot, 'note', e.note, 'sortOrder', e.sort_order, 'createdAt', e.created_at
      ) ORDER BY e.sort_order, e.created_at) FILTER (WHERE e.id IS NOT NULL), '[]'::jsonb) AS examples
     FROM teaching_question_types t
     JOIN knowledge_points kp ON kp.id = t.kp_id
     LEFT JOIN teaching_question_type_examples e ON e.type_id = t.id
     WHERE t.id = $1 AND t.user_id = $2
     GROUP BY t.id, kp.name`, [id, userId])
  const type = rows[0] || null
  if (!type) return null
  // r145：挂上多对多考点（考法天然跨知识点，见 services/kaofaInduction.js 文件头）
  const { rows: kps } = await query(
    `SELECT k.id, kp.name, kp.level, k.role, k.question_count
       FROM teaching_question_type_kps k
       JOIN knowledge_points kp ON kp.id = k.kp_id
      WHERE k.type_id = $1
      ORDER BY CASE k.role WHEN 'primary' THEN 0 ELSE 1 END, k.question_count DESC, kp.sort_order`, [id])
  type.kps = kps
  return type
}

// ⛔ r145：`getAutoGroups` / `createAutoType` 已删除。
//   旧实现按 `qk.role='primary'` **单值** + `GROUP BY kp.id, kp.name, q.question_type` 分组，
//   产出「平方根 · 填空题关键结论」这类「考点 × 题型形式」的机械拼接 —— 0 条考法信息。
//   它还有第二个毛病：`role='primary'` 单值会把跨考点的题压进一个桶，
//   而考法**天然跨知识点**（主管：「考法本身就是知识点网的胶水」）⇒ 网退化成树。
//   替代：`services/kaofaInduction.js`（按考点分批 AI 归纳 + 多对多考点关联）。
//   ⛔ 别把这段"恢复"回来。

router.get('/', async (req, res) => {
  try {
    const userId = userOrDefault(req)
    const kpId = String(req.query.kpId || '')
    const keyword = String(req.query.keyword || '').trim()
    const mode = String(req.query.mode || 'all')
    const params = [userId, subject]
    const clauses = ['t.user_id = $1', 't.subject = $2', "t.status <> 'archived'"]
    if (mode === 'recommended') clauses.push("t.status = 'draft' AND t.source = 'auto'")
    if (mode === 'library') clauses.push("t.status = 'active'")
    // r145：按考点筛选放宽到**多对多表** —— 落点仍是 (知识点, 考法)，
    // 但一个考法可跨多个知识点，只按 t.kp_id 过滤会漏掉「作为 secondary 关联」的考法。
    if (kpId && isUuid(kpId)) {
      params.push(kpId)
      clauses.push(`(t.kp_id = $${params.length}
        OR EXISTS (SELECT 1 FROM teaching_question_type_kps k
                    WHERE k.type_id = t.id AND k.kp_id = $${params.length}::uuid))`)
    }
    if (keyword) { params.push(`%${keyword}%`); clauses.push(`(t.name ILIKE $${params.length} OR t.teaching_notes ILIKE $${params.length})`) }
    const { rows } = await query(
      `SELECT t.id, t.kp_id, t.name, t.teaching_notes, t.common_mistakes, t.tags, t.status, t.source, t.auto_summary, t.updated_at,
              kp.name AS knowledge_name, COUNT(e.id)::int AS example_count
       FROM teaching_question_types t
       JOIN knowledge_points kp ON kp.id = t.kp_id
       LEFT JOIN teaching_question_type_examples e ON e.type_id = t.id
       WHERE ${clauses.join(' AND ')}
       GROUP BY t.id, kp.name
       ORDER BY CASE WHEN t.status = 'draft' THEN 0 ELSE 1 END, MIN(kp.sort_order), t.sort_order, t.updated_at DESC`, params)
    res.json({ success: true, types: rows })
  } catch (error) { res.status(500).json({ success: false, error: error.message }) }
})

router.get('/summary', async (req, res) => {
  try {
    const userId = userOrDefault(req)
    const { rows } = await query(
      `SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS type_count,
        COUNT(DISTINCT kp_id) FILTER (WHERE status = 'active')::int AS knowledge_count,
        COUNT(*) FILTER (WHERE status = 'draft' AND source = 'auto')::int AS recommendation_count,
        COUNT(*) FILTER (WHERE updated_at >= date_trunc('week', now()))::int AS updated_this_week
       FROM teaching_question_types WHERE user_id = $1 AND subject = $2 AND status <> 'archived'`, [userId, subject])
    res.json({ success: true, summary: rows[0] })
  } catch (error) { res.status(500).json({ success: false, error: error.message }) }
})

/**
 * POST /api/teaching-question-types/auto-organize
 *
 * r145 重做：从「按 primary 考点 × 题型形式分组」改成 **AI 按考点分批归纳考法**。
 *
 * ⛔ 三个必须知道的参数语义：
 *   - `apply` 默认 **false**（只预演不写库）。AI 归纳每次 27-48 秒、还要花钱，
 *     绝不能因为手滑就写一库 draft 让人去清理。确认结果满意再带 apply=true 重跑。
 *   - `kpIds` 不传 = 按错题量取 Top N 个候选考点逐个归纳。
 *   - 单个考点失败**不中断整轮**（AI 调用会 429/超时），失败项进 errors 数组原样返回。
 */
router.post('/auto-organize', async (req, res) => {
  try {
    const userId = userOrDefault(req)
    const apply = req.body?.apply === true
    const days = Math.min(Math.max(Number(req.body?.days) || 90, 7), 180)
    const maxKps = Math.min(Math.max(Number(req.body?.maxKps) || 5, 1), 20)
    const minWrong = Math.min(Math.max(Number(req.body?.minWrong) || 6, 3), 50)
    const kpIds = Array.isArray(req.body?.kpIds) ? req.body.kpIds.map(String).filter(Boolean).slice(0, 20) : []

    let targets = []
    if (kpIds.length) {
      const { rows } = await query(
        `SELECT id, name, level FROM knowledge_points WHERE id = ANY($1::uuid[]) AND subject = $2`, [kpIds, subject])
      targets = rows.map((r) => ({ id: r.id, name: r.name }))
    } else {
      targets = await fetchCandidateKps({ days, limit: maxKps, minWrong })
    }

    if (targets.length === 0) {
      return res.json({
        success: true, applied: apply, targets: 0, created: 0,
        message: `近 ${days} 天没有错题量达到 ${minWrong} 道的考点可归纳`,
      })
    }

    const results = []
    const errors = []
    let created = 0
    for (const kp of targets) {
      try {
        // ⛔ 参数名必须与服务签名逐字一致：本服务收的是 `dryRun`，不是 `apply`。
        //   r145 实测踩坑：路由传 `apply`、服务收 `dryRun`（默认 true）⇒ apply=true 也**永不写库**，
        //   但接口照样返回 `applied: true, created: 0` ⇒ 老师点「写库」静默无效果。
        //   服务侧已加 `apply` 未知参数硬断言，这里仍要显式取反传，别依赖默认值。
        const r = await induceMethodsForKp({ userId, kpId: kp.id, kpName: kp.name, days, dryRun: !apply })
        created += r.saved?.length || 0
        results.push({
          kpId: kp.id, kpName: kp.name,
          questionCount: r.questionCount,
          methods: (r.methods || []).map((m) => ({ name: m.name, action: m.action, kps: m.kps, items: m.items.length, saved: (r.saved || []).some((s) => s.name === m.name) })),
          rejected: r.rejected || [],
          elapsedMs: r.elapsedMs, vendor: r.vendor, skipped: r.skipped, reason: r.reason,
        })
      } catch (e) {
        // 单个考点失败不中断整轮：AI 会 429/超时，一个挂掉不该让老师白等剩下几个
        errors.push({ kpId: kp.id, kpName: kp.name, error: e.message })
      }
    }

    const rejectedTotal = results.reduce((n, r) => n + r.rejected.length, 0)
    res.json({
      success: true, applied: apply,
      targets: targets.length,
      created,
      results,
      errors,
      note: apply
        ? '已写入 draft。**老师改过的名字不会被覆盖**（ON CONFLICT 只更新统计不改名）；不认可的用「忽略」归档。'
        : '这是预演结果，没写库。确认满意后带 apply=true 重跑。',
      rejectedTotal,
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// r137（负责人裁决）：原 POST /auto-handout（把已确认题型编排成「周末课讲义初稿」再
// 推进「我的讲义」编辑页）属伪需求，随讲义子系统一并下线；题型库只保留自动整理、
// 确认与代表题快照能力。

router.post('/:id/confirm', async (req, res) => {
  try {
    const { rowCount } = await query(`UPDATE teaching_question_types SET status = 'active', updated_at = now() WHERE id = $1 AND user_id = $2`, [req.params.id, userOrDefault(req)])
    if (!rowCount) return res.status(404).json({ success: false, error: '题型不存在' })
    res.json({ success: true })
  } catch (error) { res.status(500).json({ success: false, error: error.message }) }
})

router.post('/:id/ignore', async (req, res) => {
  try {
    const { rowCount } = await query(`UPDATE teaching_question_types SET status = 'archived', updated_at = now() WHERE id = $1 AND user_id = $2 AND source = 'auto'`, [req.params.id, userOrDefault(req)])
    if (!rowCount) return res.status(404).json({ success: false, error: '自动建议不存在' })
    res.json({ success: true })
  } catch (error) { res.status(500).json({ success: false, error: error.message }) }
})

// ⛔ 共现（co-occurrence）只读侧现算，**不落库**。
//   理由：落库就是第二份真相 —— 知识树一改、共现边就整体过期，且没有任何机制会提醒你。
//   现状实测规模：全量 1553 边 / 294 节点（平均度 21.9），单次查询毫秒级，无需缓存。
//   口径：**同题共现** —— 一道题同时挂上 kpA 与 kpB，则 (A,B) 记 1 次共现。
//   不用「错题共现」是因为它受时间窗影响、每次结果都变，无法作为稳定的导航依据。
//   节点权重 = 该考点自己挂了多少题（共现图里用它决定点的大小）。
// ⛔ 写这段 SQL 时踩过的三个坑，改之前先读：
//   ① 端点方向判据必须用 scope 比对（lo 是否在 scope 内），不能写成
//      CASE WHEN <JOIN 进来的表>.id IS NOT NULL —— INNER JOIN 下恒为真，
//      peer 就永远取 hi 端，uuid 比中心小的邻居会被误判成"自己"再被过滤掉
//      （2026-10-05 实测：4 个大考点全部只返回 1-2 个节点而非 8 个）。
//   ② 去重靠 pair 里的 b.kp_id > a.kp_id（每对只出现一次，天然无向），
//      不要用 LEAST/GREATEST 二次去重 —— 那样要 SUM 合并，容易写错方向。
//   ③ SQL 字符串内部只能用 -- 行注释，不能出现 //（Postgres 语法错误 42601），
//      也不能出现反引号（会提前闭合 JS 模板字符串）。长注释请写在这一段外面。
export async function getKpCooccurrence(kpId, limit = 8) {
  const safeLimit = Math.min(Math.max(Number(limit) || 8, 1), 20)
  const { rows } = await query(
    `WITH RECURSIVE scope AS (
       SELECT id FROM knowledge_points WHERE id = $1::uuid
       UNION ALL
       SELECT k.id FROM knowledge_points k JOIN scope s ON k.parent_id = s.id
     ),
     pair AS (
       SELECT a.kp_id AS lo, b.kp_id AS hi
       FROM question_knowledge a
       JOIN question_knowledge b ON b.question_id = a.question_id AND b.kp_id > a.kp_id
     ),
     edge AS (
       SELECT lo, hi, COUNT(*)::int AS w FROM pair GROUP BY lo, hi
     )
     SELECT CASE WHEN e.lo IN (SELECT id FROM scope) THEN e.hi ELSE e.lo END AS kp_id,
            kp.name, kp.level,
            e.w AS cooccur,
            COALESCE(ow.n, 0) AS own_count,
            (e.lo IN (SELECT id FROM scope) AND e.hi IN (SELECT id FROM scope)) AS in_scope
     FROM edge e
     JOIN knowledge_points kp
       ON kp.id = CASE WHEN e.lo IN (SELECT id FROM scope) THEN e.hi ELSE e.lo END
     LEFT JOIN (SELECT kp_id, COUNT(*)::int AS n FROM question_knowledge GROUP BY kp_id) ow
       ON ow.kp_id = kp.id
     WHERE kp.subject = $2
       AND kp.id <> $1::uuid
       AND (e.lo IN (SELECT id FROM scope) OR e.hi IN (SELECT id FROM scope))
     ORDER BY e.w DESC, own_count DESC
     LIMIT $3::int`,
    [kpId, subject, safeLimit])
  return rows
}

// 折叠成图结构：nodes + links。
// 同一个 peer 可能被 scope 内的多个节点连到（peer_count>1），此时合并成一条边、权重取和。
// ⛔ 不落库（见 getKpCooccurrence 注释），但导出以便纯函数单测。
// @param {string} centerId 选中的考点
// @param {object|null} self 该考点的自身行（getKpCooccurrence 的结果里不含自己）
// @param {Array} rows 共现邻居行
export function buildCooccurGraph(centerId, self, rows) {
  const peerMap = new Map()
  for (const r of rows) {
    const cur = peerMap.get(r.kp_id)
    if (cur) { cur.cooccur += r.cooccur; cur.peer_count += 1; continue }
    peerMap.set(r.kp_id, {
      id: r.kp_id, name: r.name, level: r.level,
      cooccur: r.cooccur, own_count: r.own_count || 0,
      in_scope: !!r.in_scope, peer_count: 1,
    })
  }
  const peers = [...peerMap.values()].sort((a, b) => b.cooccur - a.cooccur || b.own_count - a.own_count)
  const nodes = [
    ...(self ? [{ id: self.id, name: self.name, level: self.level, own_count: self.own_count || 0, is_center: true, peer_count: 0, in_scope: true }] : []),
    ...peers.map(p => ({ ...p, is_center: false })),
  ]
  const links = peers.map(p => ({ source: centerId, target: p.id, value: p.cooccur }))
  return { nodes, links }
}

/**
 * GET /api/teaching-question-types/hot-kp
 * 「关系图」独立入口的默认考点：挑关联题数最多（最"网感"）的考点自动展开，
 * 老师一进考法库就能看到蜘蛛网，不用先手动选考点。
 *
 * r145：之前蜘蛛网藏在「按考点选题 → 还得先选一个考点」三级之后，老师根本找不到。
 *   独立「关系图」入口默认就选一个最热闹的考点直接出图，首屏即见。
 */
router.get('/hot-kp', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT kp.id, kp.name, COUNT(DISTINCT qk.question_id)::int AS question_count
         FROM knowledge_points kp
         JOIN question_knowledge qk ON qk.kp_id = kp.id
        WHERE kp.subject = $1
        GROUP BY kp.id, kp.name
        ORDER BY question_count DESC
        LIMIT 1`, [subject])
    res.json({ success: true, kp: rows[0] || null })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/teaching-question-types/kp-cooccur?kpId=xxx&limit=8
 * 「聚焦网状图」的数据源：选中考点 → 它自己 + 共现最强的 N 个邻居。
 *
 * 为什么是「聚焦」而不是全网：
 *   全量共现有 1553 边 / 294 节点，摊开就是毛线球，找不到任何东西。
 *   聚焦成 1 + 8 = 9 个节点后，每一条边都回答得了「我为什么该连它」。
 */
router.get('/kp-cooccur', async (req, res) => {
  try {
    const kpId = String(req.query.kpId || '')
    if (!kpId) return res.status(400).json({ success: false, error: '缺少 kpId' })
    const limit = Math.min(Math.max(Number(req.query.limit) || 8, 1), 20)
    const [selfRows, rows] = await Promise.all([
      query(`SELECT id, name, level FROM knowledge_points WHERE id = $1::uuid`, [kpId]),
      getKpCooccurrence(kpId, limit),
    ])
    const self = selfRows.rows[0] || null
    // 自己挂了多少题（决定中心点大小）
    let ownCount = 0
    if (self) {
      const { rows: ownRows } = await query(
        `SELECT count(*)::int AS n FROM question_knowledge WHERE kp_id = $1::uuid`, [kpId])
      ownCount = ownRows[0]?.n || 0
    }
    res.json({
      success: true,
      kp: self ? { ...self, own_count: ownCount } : null,
      // ⚠️ 必须把 own_count 一并喂给图：前端按 `is_center ? (own_count||1)` 算中心点半径，
      //   只放在 kp 里的话图里的中心点 own_count 恒为 0 ⇒ 半径退化成 1，中心点几乎看不见。
      //   （2026-10-05 r144 端到端复核时发现，纯函数测试没覆盖到，因为测试传入的 self 自带该字段。）
      graph: buildCooccurGraph(kpId, self ? { ...self, own_count: ownCount } : null, rows),
      note: '共现 = 同题共现（一道题同时挂两个考点记 1 次）。不落库、只现算：落库就成了第二份真相，树一改就过期。',
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/teaching-question-types/kp-questions?kpId=xxx&includeChildren=1&onlyWrong=0&days=0&limit=60
 * 「按考点拉题」——考法库的核心出口：选中一个知识点（考点），把它下面挂的题目全拉出来，
 * 带错次/错的学生，供老师勾选后送进周末班课件讲题。
 *
 * 口径说明（别和「章节」混）：
 *   - 数据源是 question_knowledge（题目↔知识点多对多），不是 textbookCatalog（静态教材章节）。
 *   - includeChildren=1（默认）会把选中节点递归展开到全部子孙 —— 选「函数」就能拉到
 *     「一次函数/二次函数/…」下的题，这是「拉出众多题目」的关键。
 *   - onlyWrong=0（默认）拉全部题；=1 只拉有人错过的题。
 *   - days=0（默认）不限时段；>0 只统计最近 N 天内的错次。
 * ⚠️ 错题里有一批 question_id 为空的练习册自包含错题，它们不在 question_knowledge 里，
 *    因此永远不会被考点拉出来 —— 这是数据模型决定的，不是筛选漏了。
 */
router.get('/kp-questions', async (req, res) => {
  try {
    const kpId = String(req.query.kpId || '')
    if (!kpId) return res.status(400).json({ success: false, error: '缺少 kpId' })
    const includeChildren = String(req.query.includeChildren ?? '1') !== '0'
    const onlyWrong = String(req.query.onlyWrong ?? '0') === '1'
    const days = Math.min(Math.max(Number(req.query.days) || 0, 0), 365)
    const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 300)

    const { rows } = await query(
      `WITH RECURSIVE sub AS (
         SELECT id, name, level FROM knowledge_points WHERE id = $1::uuid
         UNION ALL
         SELECT k.id, k.name, k.level FROM knowledge_points k JOIN sub ON k.parent_id = sub.id
       )
       SELECT q.id AS question_id,
              q.content, q.options, q.answer, q.analysis,
              q.question_type, q.subject, q.difficulty, q.image_url,
              COUNT(wq.id)::int AS wrong_count,
              COUNT(DISTINCT wq.student_id)::int AS student_count,
              COALESCE(array_agg(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL), '{}') AS students,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('id', k2.id, 'name', k2.name))
                          FROM question_knowledge qk2
                          JOIN knowledge_points k2 ON k2.id = qk2.kp_id
                         WHERE qk2.question_id = q.id), '[]'::jsonb) AS kps
         FROM question_knowledge qk
         JOIN sub sc ON sc.id = qk.kp_id
         JOIN questions q ON q.id = qk.question_id AND q.is_complete = TRUE
         LEFT JOIN wrong_questions wq
           ON wq.question_id = q.id
          AND COALESCE(wq.lifecycle_status, 'new') <> 'mastered'
          AND ($3::int = 0 OR wq.added_at >= now() - ($3::int * interval '1 day'))
         LEFT JOIN students s ON s.id = wq.student_id
        WHERE ($2::boolean OR sc.id = $1::uuid)
        GROUP BY q.id
        HAVING ($4::boolean = false OR COUNT(wq.id) > 0)
        ORDER BY wrong_count DESC, student_count DESC, q.id
        LIMIT $5::int`,
      [kpId, includeChildren, days, onlyWrong, limit])

    const { rows: kpRows } = await query(
      `SELECT id, name, level FROM knowledge_points WHERE id = $1::uuid`, [kpId])
    const { rows: subCount } = await query(
      `WITH RECURSIVE sub AS (
         SELECT id FROM knowledge_points WHERE id = $1::uuid
         UNION ALL
         SELECT k.id FROM knowledge_points k JOIN sub ON k.parent_id = sub.id
       ) SELECT COUNT(*)::int AS n FROM sub`, [kpId])

    res.json({
      success: true,
      kp: kpRows[0] || null,
      scope: { includeChildren, onlyWrong, days, expandedNodes: subCount[0]?.n || 0 },
      questions: rows.map(r => ({
        questionId: r.question_id,
        content: r.content,
        options: r.options,
        answer: r.answer,
        analysis: r.analysis,
        questionType: r.question_type,
        subject: r.subject,
        difficulty: r.difficulty,
        imageUrl: r.image_url,
        wrongCount: r.wrong_count,
        studentCount: r.student_count,
        students: (r.students || []).slice(0, 30),
        kps: r.kps || [],
      })),
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/teaching-question-types/candidates
 * 「哪些考点值得归纳考法」—— 按错题量排序的候选清单。
 *
 * ⛔ r145 重做：旧版返回 `getAutoGroups` 的「考点 × 题型形式」桶（名字是机械拼接），
 *   而且它**不调 AI 就先占库**（`/auto-organize` 直接 createAutoType），
 *   老师会收到一屏「平方根 · 填空题关键结论」却不知道该拿它干什么。
 *   现在只列候选考点，归纳动作由 POST /auto-organize 显式触发（默认 apply=false 预演）。
 */
router.get('/candidates', async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 90, 7), 180)
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50)
    const minWrong = Math.min(Math.max(Number(req.query.minWrong) || 6, 3), 50)
    const candidates = await fetchCandidateKps({ days, limit, minWrong })
    res.json({
      success: true,
      candidates: candidates.map((c) => ({
        kpId: c.id, kpName: c.name, level: c.level,
        wrongCount: c.wrong_count,
        hint: `近 ${days} 天 ${c.wrong_count} 道错题，可归纳考法`,
      })),
      note: '考法 = 这道题在考哪套动作（不是题型形式）。点「自动整理」会先预演，确认后才写库。',
    })
  } catch (error) { res.status(500).json({ success: false, error: error.message }) }
})

router.get('/:id', async (req, res) => { try { const type = await getTypeDetail(req.params.id, userOrDefault(req)); if (!type) return res.status(404).json({ success: false, error: '题型不存在' }); res.json({ success: true, type }) } catch (error) { res.status(500).json({ success: false, error: error.message }) } })
router.post('/', async (req, res) => { try { const userId = userOrDefault(req); const { kpId, name, teachingNotes = '', commonMistakes = '', tags = [], status = 'active' } = req.body || {}; if (!kpId || !String(name || '').trim()) return res.status(400).json({ success: false, error: '知识点和题型名称必填' }); const { rows } = await query(`INSERT INTO teaching_question_types (user_id, kp_id, subject, name, teaching_notes, common_mistakes, tags, status) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8) RETURNING id`, [userId, kpId, subject, String(name).trim(), String(teachingNotes), String(commonMistakes), JSON.stringify(normalizeTags(tags)), status]); res.status(201).json({ success: true, type: await getTypeDetail(rows[0].id, userId) }) } catch (error) { res.status(500).json({ success: false, error: error.message }) } })
router.put('/:id', async (req, res) => { try { const userId = userOrDefault(req); if (!isUuid(req.params.id)) return res.status(404).json({ success: false, error: '题型不存在' }); const { name, teachingNotes, commonMistakes, tags, status, kpId } = req.body || {}; const { rowCount } = await query(`UPDATE teaching_question_types SET name = COALESCE($1, name), kp_id = COALESCE($2, kp_id), teaching_notes = COALESCE($3, teaching_notes), common_mistakes = COALESCE($4, common_mistakes), tags = COALESCE($5::jsonb, tags), status = COALESCE($6, status), updated_at = now() WHERE id = $7 AND user_id = $8`, [name == null ? null : String(name).trim(), kpId || null, teachingNotes == null ? null : String(teachingNotes), commonMistakes == null ? null : String(commonMistakes), tags === undefined ? null : JSON.stringify(normalizeTags(tags)), status || null, req.params.id, userId]); if (!rowCount) return res.status(404).json({ success: false, error: '题型不存在' }); res.json({ success: true, type: await getTypeDetail(req.params.id, userId) }) } catch (error) { res.status(500).json({ success: false, error: error.message }) } })
router.post('/:id/examples', async (req, res) => { try { const userId = userOrDefault(req); const type = await getTypeDetail(req.params.id, userId); if (!type) return res.status(404).json({ success: false, error: '题型不存在' }); const { sourceQuestionId = null, sourceWrongQuestionId = null, snapshot, note = '' } = req.body || {}; if ((!sourceQuestionId && !sourceWrongQuestionId) || !snapshot) return res.status(400).json({ success: false, error: '代表题来源和快照必填' }); await query(`INSERT INTO teaching_question_type_examples (type_id, source_question_id, source_wrong_question_id, snapshot, note) VALUES ($1, $2, $3, $4::jsonb, $5)`, [req.params.id, sourceQuestionId, sourceWrongQuestionId, JSON.stringify(snapshot), String(note)]); res.status(201).json({ success: true, type: await getTypeDetail(req.params.id, userId) }) } catch (error) { res.status(500).json({ success: false, error: error.message }) } })
router.delete('/:id', async (req, res) => { try { if (!isUuid(req.params.id)) return res.status(404).json({ success: false, error: '题型不存在' }); const { rowCount } = await query(`UPDATE teaching_question_types SET status = 'archived', updated_at = now() WHERE id = $1 AND user_id = $2`, [req.params.id, userOrDefault(req)]); if (!rowCount) return res.status(404).json({ success: false, error: '题型不存在' }); res.json({ success: true }) } catch (error) { res.status(500).json({ success: false, error: error.message }) } })

export default router
