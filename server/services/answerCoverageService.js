/**
 * 练习册「答案册完整性体检」（2026-09-22）
 *
 * 背景：练习册管线的参考答案**全部来自答案册**（`worksheet_answers` / `resource_answers`）。
 * 答案册本身缺题号（或答案册某一单元的尾巴被划进了别的单元）时，批改那一刻才发现
 * 「参考答案与本题不匹配 / 缺少参考答案」—— 那时学生作业已经批完了，老师只能一道道手工补。
 * 本模块把这件事**提前到上传答案册的时刻**：按单元体检题号连续性，把缺口直接报给老师。
 *
 * 判据（按单元，与 `worker.js` 的 `unitGapStart` 同源，但列全部缺口而不只首个）：
 *   · missing_nos —— **内部空洞**：题号 n 缺席且 n-1、n+1 都在（强证据「这一题漏解析/答案册漏印」）
 *   · stray_nos   —— 孤立题号：n 远在「1..最长连续前缀」之外，且 n-1、n+1 都不在
 *                    （疑似答案串行/归属错配 —— 长答案被 OCR 拆碎后，碎片被塞进本单元并给了错题号）
 *   · sub_gaps    —— 某题号的各行**全部**带数字小问号时，1..max(小问) 中缺席的小问
 *   · conflicts   —— 同一「section|题号|小问」出现多行且答案不一致（答案册串行）
 *
 * ⚠️ 判据刻意保守（宁可漏报不误报）—— 2026-09-22 实测教训：
 *   · **绝不按 1..max(题号) 全量报缺**。`f8cf5d96` 的「第28章评价测试(一)」里有两条
 *     长答案被 OCR 拆出的碎片（题号 40、64），max 被抬到 64 → 全量报缺会给出
 *     「缺 25～63 共 39 个题号」这种纯属幻觉的清单，把老师引向根本不存在的缺口。
 *     改用「内部空洞」后同一单元 0 条误报，而真实空洞（如 27.2(3) 缺第 7 题）照报。
 *   · 混着整题行（sub_no 为空）的题号不判小问缺口 —— 答案册按整题存一条是合法形态。
 *   · 同一单元里不同 section 可以有相同题号（「一、填空题 1」与「三、解答题 1」），
 *     因此重复/冲突判定必须带上 section，不能只按题号。
 *   · 已知盲区：某单元在答案册里**一条都没有**时，它不会出现在 answers 里，
 *     本体检看不见（`getWorksheetPublishRisk` 的「未归属单元」等规则另管一类）。
 *
 * 实测（2026-09-22 全库 4 本练习册 / 190 个单元）：内部空洞 8 处、孤立题号 4 处，
 * 全部落在真实存在解析异常的单元里（`abf39957` 1 处、`c63bd246` 1 处、`f8cf5d96` 8 处），
 * 干净的 `83cf0c4b`（52 单元 / 963 条）零命中。
 */
import { getWorksheetAnswers } from './neonService.js'

// 缺口清单最多列几个，超出用「等 N 个」收尾 —— 避免告警文案长到没人读
const MAX_LIST = 10

const fmtList = (arr) => (arr.length <= MAX_LIST
  ? arr.join('、')
  : `${arr.slice(0, MAX_LIST).join('、')} 等 ${arr.length} 个`)

/**
 * 纯函数：由答案行数组算出完整性体检结果。
 * 导出供回归测试直接喂样例，无需连库。
 *
 * @param {Array<object>} answers `getWorksheetAnswers()` 的行（需含 unit_key / section / question_no / sub_no / answer）
 * @returns {{ok:boolean, summary:object, problem_units:Array, messages:string[]}}
 */
export const buildAnswerCoverage = (answers = []) => {
  const rows = Array.isArray(answers) ? answers : []

  // ── 按单元分组（unit_key 为空归到「未归属单元」）──
  const byUnit = new Map()
  for (const a of rows) {
    const key = a && a.unit_key ? String(a.unit_key) : ''
    if (!byUnit.has(key)) byUnit.set(key, [])
    byUnit.get(key).push(a)
  }

  const allUnits = []
  for (const [unitKey, list] of byUnit) {
    const nos = [...new Set(list.map(r => Number(r && r.question_no)).filter(Number.isFinite))].sort((x, y) => x - y)
    const maxNo = nos.length ? nos[nos.length - 1] : 0
    const has = new Set(nos)

    // 最长连续前缀：1..prefix 全在（单元里第 1 题就缺 → prefix = 0）
    let prefix = 0
    while (has.has(prefix + 1)) prefix++

    // 内部空洞：n 缺席但 n-1、n+1 都在。只有这种才是「答案册确实漏了这一题」的强证据；
    // 尾部的连续缺席既可能是「答案册本来只印到第几题」，也可能是错题号把 max 抬高，
    // 报出来就是幻觉（见文件头 2026-09-22 实测教训）。
    const missingNos = []
    for (let n = 2; n < maxNo; n++) {
      if (!has.has(n) && has.has(n - 1) && has.has(n + 1)) missingNos.push(n)
    }

    // 孤立题号：远在连续前缀之外，且左右邻居都不在 —— 更像答案串行/归属错配的碎片
    const strayNos = nos.filter(n => n > prefix + 1 && !has.has(n - 1) && !has.has(n + 1))

    // 重复/冲突：键必须带 section（同单元不同 section 允许同题号）
    const byKey = new Map()
    for (const r of list) {
      const k = `${r && r.section ? r.section : ''}|${r && r.question_no}|${r && r.sub_no ? r.sub_no : ''}`
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k).push(String((r && r.answer) != null ? r.answer : '').trim())
    }
    const conflicts = []
    let redundant = 0
    for (const [k, ansList] of byKey) {
      if (ansList.length < 2) continue
      const uniq = [...new Set(ansList)]
      const [sec, qno, sub] = k.split('|')
      const label = `第${qno}题${sub ? `(${sub})` : ''}${sec ? `（${sec}）` : ''}`
      if (uniq.length > 1) conflicts.push({ label, answers: uniq })
      else redundant++
    }

    // 小问缺口：该题号的行**全部**带纯数字小问号时才判（否则整题行/混合形态，不判）
    const subByQ = new Map()
    for (const r of list) {
      const q = Number(r && r.question_no)
      if (!Number.isFinite(q)) continue
      if (!subByQ.has(q)) subByQ.set(q, [])
      subByQ.get(q).push(String((r && r.sub_no) || '').trim())
    }
    const subGaps = []
    for (const [q, subs] of subByQ) {
      if (!subs.length) continue
      if (subs.some(s => s === '')) continue
      if (subs.some(s => !/^\d+$/.test(s))) continue
      const numeric = subs.map(Number)
      const subSet = new Set(numeric)
      const maxSub = Math.max(...numeric)
      const miss = []
      for (let i = 1; i <= maxSub; i++) if (!subSet.has(i)) miss.push(i)
      if (miss.length) subGaps.push({ question_no: q, missing: miss })
    }

    allUnits.push({
      unit_key: unitKey || null,
      unit_title: (list.find(r => r && r.unit_title) || {}).unit_title || null,
      answer_count: list.length,
      question_count: nos.length,
      max_question_no: maxNo,
      contiguous_prefix: prefix,
      missing_nos: missingNos,
      stray_nos: strayNos,
      sub_gaps: subGaps,
      conflicts,
      redundant,
    })
  }

  // 缺口多的排前面，老师先看到最该补的
  allUnits.sort((a, b) => (b.missing_nos.length - a.missing_nos.length)
    || (b.stray_nos.length - a.stray_nos.length)
    || (b.conflicts.length - a.conflicts.length)
    || String(a.unit_key || '').localeCompare(String(b.unit_key || '')))

  const problemUnits = allUnits.filter(u =>
    u.missing_nos.length || u.stray_nos.length || u.sub_gaps.length || u.conflicts.length)

  // ── 可直接展示给老师的中文清单 ──
  const messages = []
  for (const u of problemUnits) {
    const parts = []
    if (u.missing_nos.length) parts.push(`缺题号 ${fmtList(u.missing_nos)}`)
    if (u.sub_gaps.length) {
      parts.push(`缺小问 ${u.sub_gaps.map(g => `第${g.question_no}题(${fmtList(g.missing)})`).join('、')}`)
    }
    if (u.conflicts.length) parts.push(`${u.conflicts.length} 处同题号答案不一致`)
    if (u.stray_nos.length) {
      parts.push(`${u.stray_nos.length} 条答案题号孤立（第${fmtList(u.stray_nos)}题），疑似答案串行或归属错配`)
    }
    messages.push(`单元「${u.unit_key || '未归属单元'}」${parts.join('；')}`)
  }
  const ungroupedCount = (allUnits.find(u => !u.unit_key) || {}).answer_count || 0
  const namedUnitCount = allUnits.filter(u => u.unit_key).length
  // 只有一本册子含多个单元时，「未归属单元」才是真问题（单单元册子不带 unit_key 属正常）
  if (ungroupedCount > 0 && namedUnitCount > 1) {
    messages.push(`有 ${ungroupedCount} 条答案未归属到任何单元`)
  }

  const summary = {
    unit_count: allUnits.length,
    answer_count: rows.length,
    units_with_gaps: problemUnits.length,
    missing_count: problemUnits.reduce((s, u) => s + u.missing_nos.length, 0),
    stray_count: problemUnits.reduce((s, u) => s + u.stray_nos.length, 0),
    sub_gap_count: problemUnits.reduce((s, u) => s + u.sub_gaps.length, 0),
    conflict_count: problemUnits.reduce((s, u) => s + u.conflicts.length, 0),
    redundant_count: allUnits.reduce((s, u) => s + u.redundant, 0),
    ungrouped_count: ungroupedCount,
  }

  return { ok: messages.length === 0, summary, problem_units: problemUnits, messages }
}

/** 连库版：按练习册 id 体检答案册完整性 */
export const getWorksheetAnswerCoverage = async (worksheetId) => {
  const answers = await getWorksheetAnswers(worksheetId)
  return buildAnswerCoverage(answers)
}
