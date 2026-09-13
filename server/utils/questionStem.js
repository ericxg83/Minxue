/**
 * questionStem.js — 多小问（题组）共享题干的展示口径
 *
 * ⚠️ 本文件有两份镜像：server/utils/questionStem.js 与 src/utils/questionStem.js，
 *    两份实现必须**逐字一致**（同一道题在 PC 端、移动端、PDF 三处渲染出的题干完全相同）。
 *    修改任一份都必须同步另一份。
 *
 * 背景（2026-09-11 产品评审定稿）：
 *   一道大题含 (1)(2) 时会被拆成两条 questions 行，拆行时公共题干容易丢失
 *   （练习册提示词曾要求「content 只写该小问的题干」）。迁移 057 新增
 *   questions.parent_stem 单独承载「第一个小问标号之前的公共题干原文」。
 *
 * 三条口径：
 *   1. parent_stem 只是**展示字段**，绝不参与判题、答案引擎、完整性闸、题干指纹。
 *   2. content 才是题目的权威文本，保持原语义不动。
 *   3. 渲染时若 content 自身已经包含 parent_stem（历史数据：代码拆题时 stem 被
 *      拼进 content），**不要重复渲染**，否则会出现两遍条件。
 */

/**
 * 归一化用于「content 是否已包含 parent_stem」的比较。
 * NFKC 统一全半角 → 去所有空白 → 去标点 → 小写。
 * 只用于包含判断，不用于展示，也不用于落库。
 */
export const normalizeStemForCompare = (text) => {
  if (text == null) return ''
  return String(text)
    .normalize('NFKC')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。；：、,.;:!！?？"'“”‘’()（）【】\[\]{}<>《》·—\-_~`|/\\]/g, '')
    .toLowerCase()
}

/**
 * content 是否已经自带 parent_stem 的内容。
 * 空 parent_stem 视为「无需渲染」，返回 true。
 */
export const isStemContainedInContent = (parentStem, content) => {
  const stem = normalizeStemForCompare(parentStem)
  if (!stem) return true
  const body = normalizeStemForCompare(content)
  if (!body) return false
  return body.includes(stem)
}

/**
 * 解析一道题在展示层应该怎么渲染题干。
 *
 * @returns {{ parentStem: string, content: string }}
 *   - parentStem 非空：先渲染它（弱化样式），再渲染 content；
 *   - parentStem 为空：只渲染 content（历史行为，零变化）。
 *
 * 调用方（错题本卡片 / 重练卷 PDF / 批改页题干区）都走这个函数，
 * 保证三处口径一致。
 */
export const resolveQuestionDisplayStem = (q) => {
  const parentStem = q && typeof q.parent_stem === 'string' ? q.parent_stem.trim() : ''
  const content = q && q.content != null ? String(q.content) : ''
  if (!parentStem) return { parentStem: '', content }
  // 历史数据：代码拆题时 stem 已被拼进 content，渲染时跳过 parent_stem 避免重复
  if (isStemContainedInContent(parentStem, content)) return { parentStem: '', content }
  return { parentStem, content }
}

/**
 * 题组标识：同一 (task_id, question_number) 的多条行属于同一道大题。
 * 跨页相同题号（第1页第5题 / 第2页第5题）不是同一大题，故 page_number 必须参与。
 * 缺 task_id 时退化为 `p{page}|n{no}`；两者都缺则返回 ''（不归组）。
 */
export const getQuestionGroupKey = (q) => {
  if (!q || q.question_number == null || q.question_number === '') return ''
  const page = q.page_number == null ? '' : String(q.page_number)
  const task = q.task_id == null ? '' : String(q.task_id)
  const no = String(q.question_number)
  return task ? `${task}|p${page}|n${no}` : `p${page}|n${no}`
}

/**
 * 题目标注文案：`第10题(2)` / `第10题` / `第3题`（fallbackIndex 为展示序号）。
 * 用于让老师在小问连排时看清「这是第几题的第几问」。
 */
export const formatQuestionLabel = (questionNumber, subNo, fallbackIndex) => {
  const n = questionNumber == null || questionNumber === '' ? '' : String(questionNumber).trim()
  const s = subNo == null || String(subNo).trim() === '' ? '' : String(subNo).trim()
  if (n && s) return `第${n}题(${s})`
  if (n) return `第${n}题`
  if (fallbackIndex != null) return `第${fallbackIndex}题`
  return '题目'
}

/* ─────────────────────────────────────────────────────────────
 * 方案 A：前置小问联动（2026-09-12 用户拍板）
 *
 * 「(1)对 (2)错」且 (2) 写着「在(1)的条件下」时，只有 (2) 进重练卷，
 * 学生缺 (1) 的数值结论。解决：重练卷渲染 (2) 时，在其上方印一行
 * 「已知：第(1)问的结果为 …」（取前置小问行 questions.answer）。
 *
 * 纯函数放这里与展示口径同住；查兄弟行的数据部分由调用方完成
 * （服务端重练卷 PDF 查库；移动端暂未接数据，注入了才显示）。
 * ───────────────────────────────────────────────────────────── */

// 引用语：在(1)的条件下 / 根据(1)(2)的结果 / 由(1)可知 / 结合(1) …
// 动词后可能跟连续多个括号标号（「根据(1)(2)的结果」同时引用两问），逐个提取
const PREREQ_REF_RE_SOURCE = '(?:在|根据|由|结合|利用|按照|依)\\s*((?:[（(]\\s*\\d{1,2}\\s*[）)])+)'

/** 提取小问题干里引用的前置小问号，如「在(1)的条件下」→ ['1']；无引用返回 [] */
export const extractPrereqRefs = (content) => {
  const out = []
  const re = new RegExp(PREREQ_REF_RE_SOURCE, 'g')
  const numRe = /[（(]\s*(\d{1,2})\s*[）)]/g
  let m
  while ((m = re.exec(String(content || ''))) !== null) {
    let n
    numRe.lastIndex = 0
    while ((n = numRe.exec(m[1])) !== null) out.push(String(parseInt(n[1], 10)))
  }
  return [...new Set(out)]
}

/** 极简答案拆段：仅当 (1)(2)(3)… 从 1 开始且连续递增时才拆（与 answerParseService
 *  的严格口径同向），拆不出返回 null。只用于展示提示，宁可不给也不给错。 */
const splitAnswerSegmentsLoose = (ans) => {
  const text = String(ans || '').trim()
  if (!text) return null
  const re = /[（(]\s*(\d{1,2})\s*[）)]/g
  const marks = []
  let m
  while ((m = re.exec(text)) !== null) marks.push({ no: String(parseInt(m[1], 10)), start: m.index, end: re.lastIndex })
  if (marks.length < 2 || marks[0].no !== '1') return null
  // 首标记前允许 ≤6 字、不含数字与括号的短前缀（「解：」等），与后端拆分口径一致
  if (marks[0].start > 2) {
    const prefix = text.slice(0, marks[0].start)
    if (!(prefix.length <= 6 && !/\d/.test(prefix) && !/[（()）]/.test(prefix))) return null
  }
  for (let i = 0; i < marks.length; i++) {
    if (marks[i].no !== String(i + 1)) return null
  }
  return marks.map((mk, i) => ({
    sub_no: mk.no,
    answer: text.slice(mk.end, i + 1 < marks.length ? marks[i + 1].start : text.length).trim()
  }))
}

const normSub = (v) => (v == null ? '' : String(v).trim())

/**
 * 计算一道小问的「前置答案提示」。
 *
 * @param q            当前小问题行（需含 content / task_id / page_number / question_number）
 * @param siblingRows  同一道大题全部行的数据（含未进本卷的前置行），需含 sub_no / answer
 * @param selectedRows 本次重练卷选中的全部行 —— 前置小问若已在卷上（会被连排渲染，
 *                     学生自己重做），就不剧透答案。
 * @returns [{ ref: '1', answer: 'a=5, b=6' }]；无需提示返回 []
 */
export const resolvePrereqHints = (q, siblingRows = [], selectedRows = []) => {
  const refs = extractPrereqRefs(q?.content)
  if (refs.length === 0) return []
  const gk = getQuestionGroupKey(q)
  if (!gk) return []
  const selectedSubs = new Set(
    selectedRows.filter(r => getQuestionGroupKey(r) === gk).map(r => normSub(r.sub_no))
  )
  const hints = []
  for (const ref of refs) {
    if (selectedSubs.has(ref)) continue
    const groupRows = siblingRows.filter(r => getQuestionGroupKey(r) === gk)
    // 优先找独立的小问行（sub_no === ref）
    const sib = groupRows.find(r => normSub(r.sub_no) === ref)
    let ans = sib ? (sib.answer == null ? '' : String(sib.answer).trim()) : ''
    // 找不到独立行时，答案常存在整题行（sub_no 为空、answer 含 (1)(2) 全部分段）
    // → 按严格口径拆段取对应小问；拆不出宁可不给，不给错
    if (!ans) {
      for (const whole of groupRows.filter(r => normSub(r.sub_no) === '')) {
        const segs = splitAnswerSegmentsLoose(String(whole.answer || ''))
        const seg = segs && segs.find(x => x.sub_no === ref)
        if (seg && seg.answer) { ans = seg.answer; break }
      }
    }
    if (!ans) continue
    hints.push({ ref, answer: ans })
  }
  return hints
}
