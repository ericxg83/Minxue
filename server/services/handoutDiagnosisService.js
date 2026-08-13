import { matchKnowledgePoints } from './knowledgeService.js'

// ============================================================
// 讲义诊断聚合服务（handoutDiagnosisService）
//
// 职责：
//   from-diagnosis 原本直接用 ai_tags 自由文本标签（如"一元一次方程的解法"、
//   "解一元一次方程"）按 tag 聚合，导致同一真实知识点因标签写法不同被拆散、
//   名称不规范。本服务做两件事：
//   1. normalizeTagToKnowledgeName —— 把自由标签归一化到 knowledge_points
//      知识树节点名（取最具体的命中节点），拿不到就回退原标签。
//   2. groupByCanonical —— 把归一化后的诊断结果按「规范知识点」合并同类、
//      样本去重、统计聚合，让"一元一次方程"这类规范知识点稳定、成体系地出现。
//
// 设计：groupByCanonical 为纯同步函数；normalizeTagToKnowledgeName 允许注入
// matcher 便于单元测试（node test/handout_knowledge_merge.mjs）。
// ============================================================

/**
 * 把一条自由标签归一化为规范知识点名。
 * 匹配优先级：matchKnowledgePoints 已按「级别更高更具体 > 置信度 > sort_order」
 * 排序，取第一个即最具体的规范节点名。
 * @param {string} tag 自由标签（如"一元一次方程的解法"）
 * @param {string} subject 学科
 * @param {Function} [matcher] 归一化函数，缺省用 matchKnowledgePoints（可注入 mock）
 * @returns {Promise<string>} 规范知识点名；无法匹配时回退原标签
 */
export async function normalizeTagToKnowledgeName(tag, subject = '数学', matcher = matchKnowledgePoints) {
  const t = String(tag == null ? '' : tag).trim()
  if (!t) return t
  try {
    const matched = await matcher([t], subject)
    if (Array.isArray(matched) && matched.length > 0 && matched[0] && matched[0].name) {
      return matched[0].name
    }
  } catch (e) {
    console.warn(`  ⚠️ [Handout] 知识点归一化失败 tag=${t}: ${e.message}`)
  }
  return t
}

/**
 * 按规范化知识点合并诊断结果。
 * @param {Array<Object>} entries 每个诊断项（一条自由标签一组）：
 *   {
 *     kpName: string,        // 归一化后的规范知识点名
 *     subject: string,
 *     blank_count: number,   // 空题数
 *     wrong_count: number,   // 做错数
 *     student_count: number, // 涉及学生数
 *     samples: Array<{ questionId: string|number }>,  // 该组错题样本
 *   }
 * @param {number} [maxItems] 最多保留几个规范知识点（默认不截断）
 * @returns {Array<{kpName, subject, blank, wrong, students, samples}>}
 */
export function groupByCanonical(entries = [], maxItems) {
  const map = new Map() // key = `${subject}::${kpName}`
  for (const e of entries) {
    const key = `${e.subject || '其他'}::${e.kpName || '未分类'}`
    let sec = map.get(key)
    if (!sec) {
      sec = {
        kpName: e.kpName || '未分类',
        subject: e.subject || '其他',
        blank: 0,
        wrong: 0,
        students: 0,
        samples: [],
        seen: new Set(),
      }
      map.set(key, sec)
    }
    sec.blank += e.blank_count || 0
    sec.wrong += e.wrong_count || 0
    // 不同标签属于同一规范知识点时学生可能重叠，用 max 保守近似，避免重复计数
    sec.students = Math.max(sec.students, e.student_count || 0)
    for (const s of e.samples || []) {
      if (!s) continue
      if (sec.seen.has(s.questionId)) continue
      sec.seen.add(s.questionId)
      sec.samples.push(s)
    }
  }
  // 排序：空题多的优先 → 做错多 → 涉及人多
  const list = Array.from(map.values()).sort(
    (a, b) => b.blank - a.blank || b.wrong - a.wrong || b.students - a.students
  )
  return typeof maxItems === 'number' && maxItems > 0 ? list.slice(0, maxItems) : list
}
