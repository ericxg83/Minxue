/**
 * handoutGrouping.js — 讲义「按卷分组」的唯一口径（2026-10-10）
 *
 * 单独成文件（而不是塞进 handoutPdf.js）的原因：handoutPdf.js 依赖 pdfGenerator
 * （html2canvas / katex 等**浏览器专属**依赖，且用无扩展名 import），在 Node 测试里
 * 根本 import 不进来。分组口径是纯函数、要能被回归锁直接跑，所以剥离出来。
 * handoutPdf.js 从这里 re-export，调用方只认 handoutPdf。
 *
 * 分组规则：按 resource_id 聚，**保持传入顺序**（同卷的行会连在一起）。
 * ⛔ 不做任何排序/重编号 —— 讲义必须保留原卷题号顺序（老师讲的是「第 19 题」）。
 */
export function groupHandoutQuestions(rows) {
  const groups = []
  const index = new Map()
  for (const q of rows || []) {
    const key = q.resource_id || q.resourceId || '__unknown__'
    if (!index.has(key)) {
      const g = {
        key,
        paperName: q.resource_name || q.paperName || '未命名试卷',
        grade: q.grade || '',
        examDate: q.exam_date || null,
        questions: [],
      }
      index.set(key, g)
      groups.push(g)
    }
    index.get(key).questions.push(q)
  }
  return groups
}
