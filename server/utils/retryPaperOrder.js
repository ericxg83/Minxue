/**
 * retryPaperOrder.js — 错题重练卷「排卷与编号」唯一口径（服务端）
 *
 * 【为什么要有这个文件】
 * 2026-09-13 严重事故：重练卷「题号对不上，第一条就错」。
 *   打印卷的题序 = 【按题型分块：一、选择题 → 二、填空题 → 三、解答题，
 *                    块内保持题目原本的相对顺序】，卷面编号 1..N 由此产生；
 *   而判题（worker.js processSlimGrading）用的是 generated_exams.question_ids
 *   原序（未分块），并把 OCR 的第 i 个答案直接对到第 i 个 question_id。
 * 两套顺序只要题型混合就必然错位 —— 实测 25 份卷里 21 份对位错误，
 * 单卷最多 20 题全错，首个错位几乎都是第 1 题：学生卷面第 1 题的答案
 * 被判给了另一道题，判对/判错、错题掌握度随之全部污染。
 *
 * 因此排卷口径必须**只有一份实现**，且被以下三处共同使用：
 *   ① 打印：server/services/wrongRetryPdfService.buildPaperBody
 *   ② 判题：server/worker.js processSlimGrading
 *   ③ 批改页题目列表/预览：src 侧同构文件 src/utils/retryPaperOrder.js
 *
 * ⚠️ 前端有一份逐字同构的 src/utils/retryPaperOrder.js。
 *    任一侧改动必须同步另一侧，否则「打印的卷」与「判的题」会再次分叉。
 *
 * 输入约定：questions 已按「分块前的相对顺序」排列（判题侧即 question_ids
 * 顺序，打印侧即取数顺序）。分块只重排桶间顺序，**桶内相对顺序保持不变**。
 */
import { getQuestionGroupKey } from './questionStem.js'

/** 卷面分块顺序：选择题 → 填空题 → 解答题（与 PDF 章节标题一一对应） */
export const RETRY_PAPER_BLOCKS = [
  { key: 'choice', label: '一、选择题' },
  { key: 'fill', label: '二、填空题' },
  { key: 'answer', label: '三、解答题' },
]

/**
 * 题型 → 分块。
 * 与服务端 buildPaperBody 同口径：choice/fill 各自成块，其余（answer / judge /
 * 未知值）一律归解答题块 —— 归错块只是排版，漏块会整题消失，宁错勿漏。
 */
export const retryPaperBucketOf = (questionType) => {
  if (questionType === 'choice') return 'choice'
  if (questionType === 'fill') return 'fill'
  return 'answer'
}

/**
 * 卷面编号归一化：把「题号 + 小问号」压成与卷面印刷一致的键。
 * 用于判题时把 OCR 读到的 question_number/sub_no 对回卷面编号。
 *   1 → '1'；4 + '1' → '4(1)'
 * OCR 常给字符串（"4"）或带空格（" (1) "），一律容错。
 */
export const normalizeRetryPaperLabel = (questionNumber, subNo) => {
  if (questionNumber == null) return ''
  const n = String(questionNumber).trim()
  if (!n) return ''
  // OCR 常把小问号输出成 '(2)' / '（2）' 这类带括号形态，统一剥掉括号再拼，
  // 否则会拼出 '3((2))' 与卷面印刷的 '3(2)' 对不上。
  const s = subNo == null ? '' : String(subNo).trim().replace(/[()（）]/g, '')
  return s ? `${n}(${s})` : n
}

/**
 * 生成重练卷的排卷结果与卷面编号。
 *
 * @param {Array<Object>} questions 分块前的题目（按各自相对顺序）
 * @returns {Array<{
 *   question: Object,
 *   blockKey: 'choice'|'fill'|'answer',
 *   num: number,          // 卷面大题号（跨块累加，连排小问共用一个号）
 *   subNo: string,        // 小问号（无则 ''）
 *   label: string,        // 卷面印刷编号：'3' 或 '4(1)'
 *   isContinuation: boolean, // 是否大题连排的后继小问（公共题干已在组内首题渲染）
 *   paperIndex: number    // 卷面顺序下标（0-based），即「卷面第 paperIndex+1 题」
 * }>}
 */
export function buildRetryPaperOrder(questions) {
  const list = Array.isArray(questions) ? questions.filter(Boolean) : []
  const buckets = new Map(RETRY_PAPER_BLOCKS.map((b) => [b.key, []]))

  // 分桶：桶内保持输入相对顺序（Array.push 天然稳定）
  for (const q of list) {
    buckets.get(retryPaperBucketOf(q?.question_type)).push(q)
  }

  const out = []
  let num = 0
  let lastGroupKey = ''
  for (const block of RETRY_PAPER_BLOCKS) {
    for (const q of buckets.get(block.key)) {
      const groupKey = getQuestionGroupKey(q)
      const subNo = q?.sub_no == null ? '' : String(q.sub_no).trim()
      // 连排：同一大题（同 task + 同页 + 同题号）的连续小问共用一个大题号
      const isContinuation = !!groupKey && groupKey === lastGroupKey && subNo !== ''
      if (!isContinuation) num++
      lastGroupKey = groupKey

      out.push({
        question: q,
        blockKey: block.key,
        num,
        subNo,
        label: subNo ? `${num}(${subNo})` : String(num),
        isContinuation,
        paperIndex: out.length,
      })
    }
  }
  return out
}

/**
 * 卷面编号 → 排卷项（判题对位用）。
 * 编号重复时（异常数据）只保留卷面靠前的那一项，保证一对一。
 */
export function buildRetryPaperLabelMap(order) {
  const map = new Map()
  for (const item of Array.isArray(order) ? order : []) {
    if (!map.has(item.label)) map.set(item.label, item)
  }
  return map
}

/**
 * OCR 学生答案 → 卷面题 对位（纯函数，便于回归测试）。
 *
 * 对位策略（两级，先准后兜）：
 *   ① 题号优先：按 OCR 读出的卷面题号（question_number + sub_no）精确匹配卷面编号。
 *      —— 学生就是照卷面编号作答的，这是最可信的对位依据。
 *   ② 位置兜底：题号缺失/未命中时，按卷面顺序依次把剩余题配给尚未对位的答案。
 *      —— 兜底，容忍 OCR 没输出题号的情况。
 * 卷面上有、但没对到任何答案的题：返回 { ocr: null, matchedBy: 'none' }
 *   （学生未作答，或整页漏识别），由调用方按"未作答"处理。
 * 卷面上没有对应题目的多余答案：返回 { item: null }，调用方**不得**拿它去判定
 *   任何题目 —— 硬塞就会把别人的答案判到某道题头上。
 *
 * @param {Array} paperOrder buildRetryPaperOrder 的结果
 * @param {Array} ocrQuestions OCR 结果（按卷面出现顺序）
 * @returns {Array<{item: Object|null, ocr: Object|null, matchedBy: 'number'|'position'|'none'|null}>}
 */
export function alignRetryAnswers(paperOrder, ocrQuestions) {
  const order = Array.isArray(paperOrder) ? paperOrder : []
  const ocrList = Array.isArray(ocrQuestions) ? ocrQuestions : []
  const labelMap = buildRetryPaperLabelMap(order)

  const usedItems = new Set()
  const pairs = []

  // ① 题号优先匹配
  for (const ocr of ocrList) {
    const key = normalizeRetryPaperLabel(ocr?.question_number, ocr?.sub_no)
    const hit = key ? labelMap.get(key) : null
    if (hit && !usedItems.has(hit)) {
      usedItems.add(hit)
      pairs.push({ item: hit, ocr, matchedBy: 'number' })
    } else {
      pairs.push({ item: null, ocr, matchedBy: null })
    }
  }

  // ② 位置兜底：按卷面顺序把还没配出去的题依次配给尚未对位的答案
  const remaining = order.filter((it) => !usedItems.has(it))
  let ri = 0
  for (const p of pairs) {
    if (p.item || ri >= remaining.length) continue
    p.item = remaining[ri++]
    usedItems.add(p.item)
    p.matchedBy = 'position'
  }

  // ③ 卷面有、但学生没作答（或漏识别）的题
  for (const item of order) {
    if (!usedItems.has(item)) pairs.push({ item, ocr: null, matchedBy: 'none' })
  }

  return pairs
}

/**
 * 难度 → 卷面星级标记（三档，固定占三格便于学生横向对比）。
 *
 * 与错题再测卷选题排序同一难度口径（weeklyReport 5b 用 COALESCE(q.difficulty, 3)）：
 *   难度 1-2 → 一星（简单）；3 → 二星（中等）；4-5 → 三星（难）。
 * 无难度值（null / undefined / '' / 非数字）返回空串 —— 卷面不标星：
 *   排序把 NULL 当中档只是内部顺序问题，卷面展示不能拿假难度误导学生。
 * 字符用 ★/☆（U+2605/2606）而非彩色 emoji ⭐：服务端 Chromium 渲染 PDF 时
 *   运行环境常无彩色 emoji 字体，emoji 会印成豆腐块 □□□。
 */
export const difficultyStars = (difficulty) => {
  if (difficulty == null || difficulty === '') return ''
  const d = Number(difficulty)
  if (!Number.isFinite(d)) return ''
  if (d <= 2) return '★☆☆'
  if (d === 3) return '★★☆'
  return '★★★'
}
