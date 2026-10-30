// 跨页补选项纯函数集（2026-10-30 英语语篇「题干在第 2 页、选项表在第 1 页」事故沉淀）。
//
// 根因：逐页独立 OCR 时选项表页与题干页被拆开，切出的选择题 options=[]——
// 完整性闸（questionCompleteness missing_options）拦住错题本，老师手动重裁
// 又因裁剪弹窗是单页作用域、物理上无法一次框到两页内容（2026-10-30 实测）。
// 英语页组合并重识别（worker.js selectEnglishMergePages）覆盖部分场景，但
// 合并弃用/失败回落时，缺选项的题没有任何补救（任务 606935bf 实锤：21 题全部
// is_suspicious、第 2 页 5 道语篇选择题 options=[]）。
//
// 兜底链路：worker.js backfillMissingChoiceOptions 把题干页与相邻页竖拼成一张图，
// 用 buildOptionsBackfillPrompt（config/ai.js）做定向提取，本模块负责全部
// 判定/分组/解析/校验/回填——纯函数、零副作用、可回归测试。
// 铁律：只回填「当前 options 为空的选择题」，绝不覆盖已有选项、绝不动题干与答案。

import { normalizeQuestionType } from '../services/judgeService.js'

/**
 * 判定一道题是否「缺选项的选择题」。
 * 题型归一走 judgeService.normalizeQuestionType（同一件事只准一个实现）：
 * choice 家族直接命中；fill/answer 无选项是正常形态，不算缺。
 */
export const isMissingChoiceOptions = (q) => {
  if (!q) return false
  if (normalizeQuestionType(q.question_type, q.options) !== 'choice') return false
  return !(Array.isArray(q.options) && q.options.length > 0)
}

/**
 * 从各页识别结果里收集缺选项的题。
 * @returns [{pageIndex, pageNumber, q, questionNumber, stem}] —— q 是页结果题对象引用，
 *          后续 applyOptionsBackfill 直接原地回填。
 */
export const collectMissingChoiceItems = (pageResults) => {
  const items = []
  const pages = Array.isArray(pageResults) ? pageResults : []
  pages.forEach((r, idx) => {
    const qs = Array.isArray(r?.pageQuestions) ? r.pageQuestions : []
    qs.forEach(q => {
      if (!isMissingChoiceOptions(q)) return
      const stem = [q.parent_stem, q.content].filter(Boolean).map(String).join(' ')
      items.push({
        pageIndex: idx,
        pageNumber: r.pageNumber ?? null,
        q,
        questionNumber: q.question_number ?? null,
        stem,
      })
    })
  })
  return items
}

/**
 * 拼接分组：缺选项题所在页 P 与相邻页拼成一张图（前页优先——选项表常印在上页
 * 底部；P 是首页时取后页）。同页的多道缺选项题共用一次模型调用。
 * @returns [{pageNumbers, pages, items}]
 */
export const buildBackfillGroups = (pageResults, items) => {
  const pages = Array.isArray(pageResults) ? pageResults : []
  const groups = []
  const byKey = new Map()
  for (const it of (Array.isArray(items) ? items : [])) {
    const idx = it.pageIndex
    if (!pages[idx]) continue
    const prev = idx > 0 ? pages[idx - 1] : null
    const next = idx < pages.length - 1 ? pages[idx + 1] : null
    const groupPages = prev ? [prev, pages[idx]] : (next ? [pages[idx], next] : [pages[idx]])
    const key = groupPages.map(p => p.pageNumber).join('-')
    let g = byKey.get(key)
    if (!g) {
      g = { pageNumbers: groupPages.map(p => p.pageNumber), pages: groupPages, items: [] }
      byKey.set(key, g)
      groups.push(g)
    }
    g.items.push(it)
  }
  return groups
}

/** 容错解析模型返回：直接 JSON → 截取 {…} → 截取 […]，全失败返回 null */
export const parseBackfillJson = (text) => {
  const s = String(text ?? '').trim()
  if (!s) return null
  const tryParse = (str) => { try { return JSON.parse(str) } catch { return null } }
  const direct = tryParse(s)
  if (direct) return direct
  const a = s.indexOf('{')
  const b = s.lastIndexOf('}')
  if (a >= 0 && b > a) {
    const obj = tryParse(s.slice(a, b + 1))
    if (obj) return obj
  }
  const c = s.indexOf('[')
  const d = s.lastIndexOf(']')
  if (c >= 0 && d > c) return tryParse(s.slice(c, d + 1))
  return null
}

/**
 * 清洗一组候选选项：非空字符串、去首尾空白、压内部空白。
 * 合法范围 2~10 项、单项 ≤80 字符；重复项去重；清洗后不足 2 项整组拒绝。
 * 词库型（选词填空）与四选一都落在这个范围内。返回 null = 整组不可用。
 */
const MAX_OPTIONS = 10
const MAX_OPTION_LEN = 80
export const sanitizeBackfillOptions = (list) => {
  if (!Array.isArray(list)) return null
  const cleaned = [...new Set(
    list.map(o => String(o ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean)
  )]
  if (cleaned.length < 2 || cleaned.length > MAX_OPTIONS) return null
  if (cleaned.some(o => o.length > MAX_OPTION_LEN)) return null
  return cleaned
}

/**
 * 把模型返回的 [{index, options}] 回填到缺选项题上（原地写 q.options）。
 * 防线：
 *   · index 越界/非整数 → 拒绝；
 *   · 目标题已不缺选项（避免覆盖并发写入）→ 拒绝；
 *   · options 清洗不通过（含模型老实返回的「没找到」空表）→ 拒绝并保持现状。
 * @returns {filled, rejected}
 */
export const applyOptionsBackfill = (items, parsed) => {
  const arr = Array.isArray(parsed)
    ? parsed
    : (parsed && Array.isArray(parsed.items) ? parsed.items : null)
  if (!arr) return { filled: 0, rejected: 0 }
  let filled = 0
  let rejected = 0
  for (const entry of arr) {
    const idx = Number(entry?.index)
    if (!Number.isInteger(idx) || idx < 0 || idx >= items.length) { rejected++; continue }
    const q = items[idx].q
    if (!isMissingChoiceOptions(q)) { rejected++; continue }
    const options = sanitizeBackfillOptions(entry?.options)
    if (!options) { rejected++; continue }
    q.options = options
    filled++
  }
  return { filled, rejected }
}
