/**
 * 重练批改页左侧题目列表的「第N页」页标。
 *
 * 背景（bc94558 → 2026-09-15 P1）：
 *   bc94558 曾把 paper（重练卷）模式的页标整个关掉，原因是当时的页码源是
 *   `q.page_number`——那是【原始作业】的页码，与重练答卷图不是同一套编号，
 *   加上题目按卷面顺序（选择→填空→解答）分块排，逐段「换页即标注」会打出
 *   第1页 → 第2页 → 第1页 的乱跳序列。
 *
 *   现在页码源换成 `retryAlign[].pageNumber`（逐页 OCR 时写死的【答卷图】页码，
 *   f717242 起才有），并由 reviewStore.retryAnswerPageMap 换算成与中央页指示器
 *   一致的**索引**（多行 task 时每行 images 的 page_number 都是 1，直接用原始
 *   pageNumber 当页标会串页）。于是只剩一条规则要守：
 *
 *   **同一页只在首次出现处标一次。** 这样即便页码交错也不会重复跳号。
 *
 * 守住的底线：无对位记录（`matchedBy='none'`，图上没痕迹）的题**不标** —— 不猜页码；
 * 答卷只有 1 页时全部不标 —— 没有「页」可言，页信息由中央查看器承载。
 *
 * @param {Array<{id:string}>} questions 当前题目列表（卷面顺序，与 allQuestions 同序）
 * @param {Record<string, number>} pageMap questionId → 答卷页序号（1-based）
 * @param {number} pageCount 答卷页数（currentPaperPages.length）
 * @returns {Array<string>} 与 questions 等长的标签数组，'' 表示该行不显示页标
 */
export function buildRetryAnswerPageLabels(questions, pageMap, pageCount) {
  const list = Array.isArray(questions) ? questions : []
  if (!(Number(pageCount) > 1)) return list.map(() => '')
  const labels = []
  const seenPage = new Set()
  for (const q of list) {
    const page = pageMap?.[q?.id]
    if (page == null) {
      labels.push('')
      continue
    }
    const isFirstOnPage = !seenPage.has(page)
    seenPage.add(page)
    labels.push(isFirstOnPage ? `第${page}页` : '')
  }
  return labels
}
