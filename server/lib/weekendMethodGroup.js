/**
 * 周末班课件「按考点/方法分节」（2026-11-08 P0，八年级二次根式试点）
 * ================================================================
 * 目标：把课件的组织轴从「日期」换成「一类方法」，让「学一个会一类」在备课页和
 *       讲题白板上都看得见。默认 groupBy='date' 时本模块完全不参与，零影响既有流程。
 *
 * 边界（红线）：
 *   - 只读：question_knowledge / knowledge_points / teaching_question_types / kp_relations。
 *     不写错题、不写掌握度、不改 lifecycle_status，讲过 ≠ 会了。
 *   - 不新建表、不新增状态字段；方法卡是展示层内容，不是新的学习事实。
 *   - 一题只进一个节（取主考点，primary 优先），禁止同一题在多节重复出现。
 *   - 挂不上考点的题**如实进「待归类」节**，不静默丢（沿用 kpFilter.unlinkedRows 口径）。
 *   - 同名不同 id 的考点节点（实测「一元二次方程」有 2 个）按 (学科, 名称) 归一，
 *     否则同一个专题会被拆成两节。
 */
import { getMethodCard, hasMethodCard } from './methodCardLibrary.js'

export const UNLINKED_KEY = '__unlinked__'
export const UNLINKED_LABEL = '待归类（未挂考点）'
// 「一类」的字面要求：同一方法至少要能凑出两道题。只有 1 题的节单独占一页
// 既讲不出共性、又让首屏全是碎节（实测初三首屏 10 题被切成 6 节，3 节各 1 题）。
export const OTHERS_KEY = '__others__'
export const OTHERS_LABEL = '其他考点（题量不足）'

const TIER_ORDER = { basic: 0, medium: 1, hard: 2, unknown: 3 }

/** 同名节点归一：同学科 + 同名 → 同一节；不同学科同名不合并 */
export function normalizeKpGroupKey(subject, name) {
  return `${String(subject || '').trim()}::${String(name || '').trim()}`
}

/**
 * 只读加载考点/方法卡/知识链元数据。
 * @param {pg.Pool} pool
 * @param {string[]} questionIds 当前课件实际用到的 question_id
 */
export async function loadKnowledgeMeta(pool, questionIds, preferredKpIds = null) {
  const ids = [...new Set((questionIds || []).filter(Boolean))]
  // 老师显式选了考点（含递归展开的子孙）时，主考点优先从这个集合里挑。
  // 实测：不收敛的话，挂了 3 个考点的二次根式题会按字典序挑中「一元二次方程」，
  // 试点专题里凭空多出无关分节。
  const preferred = preferredKpIds instanceof Set
    ? preferredKpIds
    : new Set((preferredKpIds || []).filter(Boolean))
  const meta = {
    kpByQuestion: new Map(),
    kpNamesById: new Map(),
    kaofaByKpId: new Map(),
    kaofaByKpKey: new Map(),
    chainByKpId: new Map(),
  }
  if (!ids.length) return meta

  // ① 题目 → 考点（带角色，主考点优先）
  const { rows: qk } = await pool.query(
    `SELECT qk.question_id, qk.kp_id, qk.role, kp.name, kp.subject
       FROM question_knowledge qk
       JOIN knowledge_points kp ON kp.id = qk.kp_id AND kp.archived = false
      WHERE qk.question_id = ANY($1::uuid[])`, [ids])
  const byQuestion = new Map()
  for (const r of qk) {
    if (!byQuestion.has(r.question_id)) byQuestion.set(r.question_id, [])
    byQuestion.get(r.question_id).push(r)
    meta.kpNamesById.set(r.kp_id, r.name)
  }
  for (const [qid, list] of byQuestion) {
    const scoped = preferred.size ? list.filter(x => preferred.has(x.kp_id)) : list
    const candidates = scoped.length ? scoped : list
    const primary = candidates.find(x => x.role === 'primary')
      || [...candidates].sort((a, b) =>
        String(a.name).localeCompare(String(b.name), 'zh')
        || String(a.kp_id).localeCompare(String(b.kp_id)))[0]
    meta.kpByQuestion.set(qid, {
      kpId: primary.kp_id,
      kpName: primary.name,
      kpSubject: primary.subject || '',
      groupKey: normalizeKpGroupKey(primary.subject, primary.name),
    })
  }

  const kpIds = [...new Set(qk.map(r => r.kp_id))]
  if (!kpIds.length) return meta

  // ② 考法库已有的方法要点（未命中静态方法卡时的回退内容）
  // ⚠️ 考点树存在同名不同 id（实测「有理数」等有多个节点），只按 kp_id 精确查会漏掉
  //    挂在另一个同名节点下的考法 ⇒ 方法卡显示「无」。故同时按 (学科,名称) 归一补命中。
  const kpNames = [...new Set(meta.kpNamesById.values())].filter(Boolean)
  const { rows: kaofa } = await pool.query(
    `SELECT t.kp_id, t.name, t.teaching_notes, t.common_mistakes,
            kp.name AS kp_name, kp.subject AS kp_subject
       FROM teaching_question_types t
       JOIN knowledge_points kp ON kp.id = t.kp_id
      WHERE t.kp_id = ANY($1::uuid[]) OR kp.name = ANY($2::text[])
      ORDER BY t.created_at`, [kpIds, kpNames])
  for (const r of kaofa) {
    if (!meta.kaofaByKpId.has(r.kp_id)) meta.kaofaByKpId.set(r.kp_id, [])
    meta.kaofaByKpId.get(r.kp_id).push(r)
    const key = normalizeKpGroupKey(r.kp_subject, r.kp_name)
    if (!meta.kaofaByKpKey.has(key)) meta.kaofaByKpKey.set(key, [])
    meta.kaofaByKpKey.get(key).push(r)
  }

  // ③ 知识链：只认 confirmed，候选里约 1/3 讲不通（kpRelationService 口径）
  const { rows: rel } = await pool.query(
    `SELECT r.from_kp_id, r.to_kp_id, f.name AS from_name, t.name AS to_name
       FROM kp_relations r
       JOIN knowledge_points f ON f.id = r.from_kp_id AND f.archived = false
       JOIN knowledge_points t ON t.id = r.to_kp_id AND t.archived = false
      WHERE r.status = 'confirmed'
        AND (r.from_kp_id = ANY($1::uuid[]) OR r.to_kp_id = ANY($1::uuid[]))`, [kpIds])
  const chainOf = (id) => {
    if (!meta.chainByKpId.has(id)) meta.chainByKpId.set(id, { prerequisites: [], successors: [] })
    return meta.chainByKpId.get(id)
  }
  for (const r of rel) {
    chainOf(r.to_kp_id).prerequisites.push(r.from_name)
    chainOf(r.from_kp_id).successors.push(r.to_name)
  }
  return meta
}

/** 汇总一节的考法行 / 知识链（同名节点合并后要去重） */
function collectSectionContent(kpIds, groupKey, meta, label) {
  const seen = new Set()
  const kaofaRows = []
  const push = (rows) => {
    for (const r of rows || []) {
      if (!seen.has(r)) { seen.add(r); kaofaRows.push(r) }
    }
  }
  for (const id of kpIds) push(meta.kaofaByKpId?.get(id))
  // 同名不同 id 的补命中：按 (学科,名称) 归一后的 key 再取一次
  push(meta.kaofaByKpKey?.get(groupKey))
  const pre = new Set()
  const suc = new Set()
  for (const id of kpIds) {
    const c = meta.chainByKpId?.get(id)
    if (!c) continue
    for (const n of c.prerequisites) if (n !== label) pre.add(n)
    for (const n of c.successors) if (n !== label) suc.add(n)
  }
  return {
    methodCard: getMethodCard(label, kaofaRows),
    knowledgeChain: {
      prerequisites: [...pre].slice(0, 3),
      successors: [...suc].slice(0, 3),
    },
  }
}

/**
 * 把按日期生成的 slides 重组为按考点/方法分节（纯函数，可测）。
 * @param {Array} slides buildHandout 产出的 slides（section + question）
 * @param {object} meta loadKnowledgeMeta 的结果
 * @param {object} [options]
 * @param {number} [options.minPerSection=0] 每节最少题数。>1 时题数不足的节并入
 *   「其他考点（题量不足）」，避免「一类」只有一道题、首屏全是碎节。
 *   ⚠️ 只在**至少两个**薄节时才合并——单独一个薄节保留原名信息量更大，
 *   不值得为它造一个含糊的「其他」节。
 * @returns {{slides:Array, sections:Array, overview:Array}}
 */
export function regroupSlidesByKp(slides, meta = {}, options = {}) {
  const minPerSection = Math.max(0, Number(options?.minPerSection) || 0)
  const questions = (slides || []).filter(s => s.kind === 'question')
  const buckets = new Map()
  for (const q of questions) {
    const key = q.kpGroupKey || UNLINKED_KEY
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        label: q.kpName || UNLINKED_LABEL,
        kpIds: new Set(),
        questions: [],
        unlinked: key === UNLINKED_KEY,
        others: false,
      })
    }
    const b = buckets.get(key)
    b.questions.push(q)
    if (q.kpId) b.kpIds.add(q.kpId)
  }

  // 薄节合并：只并非待归类的节，且至少两个才并（见 options.minPerSection 注释）
  if (minPerSection > 1) {
    const thin = [...buckets.values()].filter(b => !b.unlinked && b.questions.length < minPerSection)
    if (thin.length >= 2) {
      const merged = {
        key: OTHERS_KEY,
        label: OTHERS_LABEL,
        kpIds: new Set(),
        questions: [],
        unlinked: false,
        others: true,
      }
      for (const b of thin) {
        buckets.delete(b.key)
        merged.questions.push(...b.questions)
        for (const id of b.kpIds) merged.kpIds.add(id)
      }
      // 按原 index 排序，保持「同一批题的整体顺读性」；节内稍后还会按难度重排
      merged.questions.sort((a, c) => a.index - c.index)
      buckets.set(OTHERS_KEY, merged)
    }
  }

  // 节排序：题多的在前（先讲错的多的「一类」），其他/待归类依次垫底
  const rank = (b) => (b.unlinked ? 2 : b.others ? 1 : 0)
  const ordered = [...buckets.values()].sort((a, b) =>
    rank(a) - rank(b)
    || b.questions.length - a.questions.length
    || a.label.localeCompare(b.label, 'zh'))

  // 同名不同学科的节标签会撞（前端 questionsOf / applySelection 都按 label 匹配）
  const usedLabels = new Set()
  for (const b of ordered) {
    if (usedLabels.has(b.label)) b.label = `${b.label}（${String(b.key).split('::')[0]}）`
    usedLabels.add(b.label)
  }

  const out = []
  const sections = []
  const overview = []
  let seq = 0
  for (const b of ordered) {
    const qs = [...b.questions].sort((a, c) =>
      (TIER_ORDER[a.tier] ?? 3) - (TIER_ORDER[c.tier] ?? 3)
      || (a.difficulty ?? 99) - (c.difficulty ?? 99)
      || a.index - c.index)

    const students = [...new Set(qs.flatMap(q => (q.students || []).map(s => s.name).filter(Boolean)))]
      .sort((a, c) => a.localeCompare(c, 'zh'))
    const tiers = { basic: 0, medium: 0, hard: 0, unknown: 0 }
    for (const q of qs) tiers[q.tier] = (tiers[q.tier] || 0) + 1

    const isMixed = b.unlinked || b.others
    const content = isMixed
      ? { methodCard: { title: b.label, signals: '', steps: '', pitfalls: '', source: 'none' }, knowledgeChain: { prerequisites: [], successors: [] } }
      : collectSectionContent([...b.kpIds], b.key, meta, b.label)

    const section = {
      kind: 'section',
      label: b.label,
      day: '',
      dayFrom: '',
      mergedDays: [],
      topicCount: qs.length,
      studentCount: students.length,
      students,
      tiers,
      groupBy: 'kp',
      unlinked: b.unlinked,
      others: !!b.others,
      kpGroupKey: b.key,
      methodCard: content.methodCard,
      knowledgeChain: content.knowledgeChain,
    }
    sections.push(section)
    out.push(section)
    overview.push({
      label: b.label,
      topics: qs.length,
      students: students.length,
      basic: tiers.basic, medium: tiers.medium, hard: tiers.hard, unknown: tiers.unknown,
    })

    for (const q of qs) {
      seq += 1
      out.push({
        ...q,
        index: seq,
        sectionLabel: b.label,
        kpGroupKey: q.kpGroupKey || null,
        // 白板讲题现场用：这一题属于哪一类、这套动作怎么走。
        // 「其他考点」是多方法混合，不能给单一方法名，留空由白板降级显示。
        methodKind: isMixed ? '' : b.label,
        methodSteps: hasMethodCard(content.methodCard) ? content.methodCard.steps : '',
      })
    }
  }
  return { slides: out, sections, overview }
}
