/**
 * questionGroupExpand.js — 错题卷「整题入卷」扩展（2026-11-04 负责人口径）
 *
 * 【背景】
 * 一道多小问大题在库里被拆成多条 questions 行（每行一个小问，公共条件在
 * parent_stem）。老师勾选错题时勾到的是**某一个小问**，于是重练卷上只印
 * 「(2) 求证……」这样一条孤立小问 —— 学生看不到 (1)(3)，也不知道公共条件从哪来，
 * 做起来莫名其妙（2026-11-04 负责人报障，实测 2005 条错题里 672 条属于多小问大题）。
 *
 * 【新口径】小问成为错题 ⇒ 整道大题（同 task + 页 + 题号的全部小问）一起组卷。
 *
 * 【为什么要有质量闸】库里的「同 task+页+题号」并不总是同一道大题：
 *   · OCR 会把相邻几道题错编成同一个题号（组内混进空 sub_no 的无关题）；
 *   · 少数组里同一 sub_no 重复入库两次（内容相同，只是 LaTeX 空格不同）；
 *   · 更少数组里 sub_no 干净但 parent_stem 各不相同（其实是不同题共用题号）。
 * 无脑整组展开会把无关题塞进学生的卷子 —— 比"缺上下文"更糟。
 * 所以只扩展有强证据的组，宁可少扩不可乱扩：
 *   ① 选中行必须有 sub_no（整题行本身已完整，扩它只会重复）；
 *   ② 组内 sub_no 非空的兄弟行 ≥ 2；
 *   ③ 同一 sub_no 若有多行，内容归一化后必须一致（不一致 = 题号错编，放弃整组）；
 *   ④ 组内非空 parent_stem 归一化后必须一致（忽略空 stem 的历史行）。
 *
 * 【与排卷口径的关系】扩展只决定「哪些行进卷」，卷面编号仍由
 * utils/retryPaperOrder.js 统一生成（同组相邻 ⇒ 自动连排、公共题干只印一次）。
 * 本文件不重写任何排卷/判题逻辑。
 */
import { query, TABLES } from '../config/neon.js'
import { getQuestionGroupKey, normalizeStemForCompare } from './questionStem.js'

/** sub_no 归一化：去空白、剥括号（OCR 常给 '(2)' / '（2）'） */
export const normalizeSubNo = (v) =>
  v == null ? '' : String(v).trim().replace(/[()（）]/g, '').trim()

/**
 * 小问号排序值：'1' < '2' < '10'，并兼容 '2-1' / '2.1' 这类二级编号。
 * 非数字（'a' / '①' / 空）排到最后，保持稳定顺序（调用方用 Array.sort 稳定排序）。
 */
export const subNoSortValue = (v) => {
  const s = normalizeSubNo(v)
  const m = s.match(/^(\d+)(?:[-.](\d+))?/)
  if (!m) return Number.MAX_SAFE_INTEGER
  return parseInt(m[1], 10) * 1000 + (m[2] ? parseInt(m[2], 10) : 0)
}

/**
 * 判断一个题组能不能整组入卷（纯函数，可被真跑断言）。
 *
 * @param {Object} selectedRow 老师勾中的那一行（需含 sub_no / task_id / page_number / question_number）
 * @param {Array<Object>} groupRows 同组全部行（含 selectedRow；需含 id / sub_no / parent_stem / content）
 * @returns {{ ids: ?string[], reason: string, subCount: number }}
 *   ids 为 null 表示「不扩展」，调用方保留原行。
 */
export function planGroupExpansion(selectedRow, groupRows = []) {
  const selSub = normalizeSubNo(selectedRow?.sub_no)
  if (!selSub) return { ids: null, reason: 'selected_without_sub_no', subCount: 0 }
  if (!selectedRow?.task_id
      || selectedRow?.page_number == null
      || selectedRow?.question_number == null) {
    return { ids: null, reason: 'selected_missing_group_fields', subCount: 0 }
  }

  // 只认带 sub_no 的兄弟行：空 sub_no 的行多是 OCR 把相邻题编成同一题号，
  // 混进来就是给学生的卷子里塞无关题。
  const subs = (Array.isArray(groupRows) ? groupRows : []).filter((r) => r && normalizeSubNo(r.sub_no))
  if (subs.length < 2) return { ids: null, reason: 'no_sibling_sub', subCount: subs.length }

  // 同一 sub_no 可能重复入库：内容一致则去重保留一条，不一致则整组放弃。
  const bySub = new Map()
  for (const r of subs) {
    const k = normalizeSubNo(r.sub_no)
    if (!bySub.has(k)) bySub.set(k, [])
    bySub.get(k).push(r)
  }
  const picked = []
  for (const [sub, rows] of bySub) {
    const uniq = new Map()
    for (const r of rows) uniq.set(normalizeStemForCompare(r.content), r)
    if (uniq.size > 1) return { ids: null, reason: 'duplicate_sub_conflict', subCount: subs.length }
    picked.push({ sub, row: uniq.values().next().value })
  }

  // 公共题干必须一致（空 stem 的历史行不参与比较，避免数据缺失反而挡住扩展）
  const stems = new Set(
    picked.map((p) => normalizeStemForCompare(p.row.parent_stem)).filter(Boolean)
  )
  if (stems.size > 1) return { ids: null, reason: 'parent_stem_mismatch', subCount: subs.length }

  picked.sort((a, b) => subNoSortValue(a.sub) - subNoSortValue(b.sub))
  return { ids: picked.map((p) => String(p.row.id)), reason: 'ok', subCount: picked.length }
}

/**
 * 把「老师勾选的错题 id」扩展成「整题入卷的 id 序列」。
 *
 * 行为：
 *   · 保持入参顺序；某个组首次出现的位置整体展开，后续同组 id 跳过（不重复）；
 *   · 不能扩展的组（见 planGroupExpansion 判据）原样保留该行 —— 退化成今天的行为；
 *   · 幂等：把扩展结果再喂一遍，结果不变（组员已在入参里）。
 *
 * @param {string[]} questionIds
 * @param {{ runQuery?: Function }} [opts] 注入查询函数（测试用）
 * @returns {Promise<{ ids: string[], groups: Array<{key:string, questionNumber:number, addedIds:string[], subCount:number}>, addedCount:number }>}
 */
export async function expandQuestionIdsForPaper(questionIds, { runQuery = query } = {}) {
  const ids = [...new Set((Array.isArray(questionIds) ? questionIds : []).map(String).filter(Boolean))]
  const empty = { ids, groups: [], addedCount: 0 }
  if (ids.length === 0) return empty

  const { rows: selRows } = await runQuery(
    `SELECT id, task_id, page_number, question_number, sub_no, parent_stem, content
     FROM ${TABLES.QUESTIONS} WHERE id = ANY($1::uuid[])`,
    [ids]
  )
  const selMap = new Map((selRows || []).map((r) => [String(r.id), r]))

  // 需要查兄弟行的组：只处理 task/页/题号三件齐全的（缺一个就无法精确定位，
  // 退化键会跨 task 混组，比不扩展更危险）。
  const needGroups = new Map()
  for (const id of ids) {
    const r = selMap.get(id)
    if (!r) continue
    if (!normalizeSubNo(r.sub_no)) continue
    if (!r.task_id || r.page_number == null || r.question_number == null) continue
    const gk = getQuestionGroupKey(r)
    if (gk && !needGroups.has(gk)) needGroups.set(gk, r)
  }
  if (needGroups.size === 0) return empty

  const tuples = [...needGroups.values()]
  const where = tuples.map((_, i) => `($${i * 3 + 1}::uuid, $${i * 3 + 2}::int, $${i * 3 + 3}::int)`).join(', ')
  const params = tuples.flatMap((r) => [r.task_id, r.page_number, r.question_number])
  const { rows: groupRows } = await runQuery(
    `SELECT id, task_id, page_number, question_number, sub_no, parent_stem, content
     FROM ${TABLES.QUESTIONS}
     WHERE (task_id, page_number, question_number) IN (${where})`,
    params
  )
  const rowsByGroup = new Map()
  for (const r of groupRows || []) {
    const gk = getQuestionGroupKey(r)
    if (!gk) continue
    if (!rowsByGroup.has(gk)) rowsByGroup.set(gk, [])
    rowsByGroup.get(gk).push(r)
  }

  const out = []
  const outSet = new Set()
  const emitted = new Set()
  const groups = []
  for (const id of ids) {
    const sel = selMap.get(id)
    const gk = sel ? getQuestionGroupKey(sel) : ''
    if (!gk || !needGroups.has(gk)) {
      if (!outSet.has(id)) { out.push(id); outSet.add(id) }
      continue
    }
    if (emitted.has(gk)) continue
    emitted.add(gk)
    const plan = planGroupExpansion(sel, rowsByGroup.get(gk) || [])
    if (!plan.ids) {
      if (!outSet.has(id)) { out.push(id); outSet.add(id) }
      continue
    }
    const addedIds = []
    for (const gid of plan.ids) {
      if (outSet.has(gid)) continue
      out.push(gid)
      outSet.add(gid)
      if (!ids.includes(gid)) addedIds.push(gid)
    }
    if (addedIds.length > 0) {
      groups.push({
        key: gk,
        questionNumber: sel.question_number,
        addedIds,
        subCount: plan.ids.length,
      })
    }
  }

  return { ids: out, groups, addedCount: out.length - ids.length }
}
