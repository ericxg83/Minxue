/**
 * 练习册答案文本解析服务
 * 从 worksheets.js 抽出，供路由解析与离线修复脚本共用。
 *
 * 核心能力：
 *  1. 练习单元检测（堂堂练① 19.1(1) 算术平方根 / 第X章 / 单元测试卷）
 *     —— 题号的真实作用域是「单元」，每个单元从 1 重新编号
 *  2. 行内多题拆分（OCR 常把 "13. D 14. C 15. C" 挤在一行，需按题号递增安全拆开）
 *  3. 子题拆分（"(1)7/2 (2)4/3 (3)0.9" 拆成 3 条 sub_no 记录）
 *  4. 题型识别：选择题（A-D）/ 判断题（√×）/ 一般答案
 */

// 检测章节标题行（如"第一章阶段卷Ⅰ""期中测试卷""第一单元综合练习"等）
export function isSectionHeader(line) {
  if (/^\d/.test(line)) return false // 数字开头的行是答案行
  // 第X章/节/单元/部分/篇
  if (/^第[一二三四五六七八九十\d]+[章节单元部分篇]/.test(line)) return true
  // 中文数字开头的章节/单元
  if (/^[一二三四五六七八九十]+[章节单元]/.test(line)) return true
  // 常见试卷/练习关键词
  if (/(?:阶段卷|评价测试|阶段练|综合练习|单元测试|测试卷|月考卷|期中卷|期末卷|模拟卷|真题卷|专题练习|专项练习|专项训练|复习卷|巩固卷|提升卷|拓展卷|检测卷|验收卷|达标卷|冲刺卷|押题卷|预测卷|闯关练习|水平测试|能力测试|单元卷|综合卷|练习卷|模拟测试|真题演练)/.test(line)) return true
  return false
}

/** 章节名归一化：去掉冒号后的说明、压掉内部空白（"第一章阶段练 3" 与 "第一章阶段练3" 统一） */
export function normalizeSectionName(raw) {
  if (!raw) return null
  return String(raw).replace(/[：:].*$/, '').replace(/[\s　]+/g, '').trim() || null
}

// 圈序号 ①..㉚ → 1..30
const CIRCLED_DIGITS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚'
const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

function toOrdinal(token) {
  if (!token) return null
  const idx = CIRCLED_DIGITS.indexOf(token)
  if (idx >= 0) return idx + 1
  if (/^\d{1,3}$/.test(token)) return parseInt(token, 10)
  if (CN_NUM[token]) return CN_NUM[token]
  // 十一 ~ 十九 / 二十 / 二十一
  const m = token.match(/^([二三四五六七八九])?十([一二三四五六七八九])?$/)
  if (m) return (m[1] ? CN_NUM[m[1]] : 1) * 10 + (m[2] ? CN_NUM[m[2]] : 0)
  return null
}

// 单元标签：练习册里一个「重新从 1 编号」的最小单位
const UNIT_LABEL_RE = new RegExp(
  `^(堂堂练|课课练|课时练|随堂练|同步练|课时作业|课后练)\\s*([${CIRCLED_DIGITS}]|\\d{1,3})?\\s*(.*)$`
)
// 课时编号：19.1(1) / 21.2 —— 后面必须跟中文标题，否则可能是答案行
const LESSON_CODE_RE = /(\d{1,2}\.\d{1,2}(?:\s*[（(]\s*\d{1,2}\s*[）)])?)/
const LESSON_LINE_RE = /^(\d{1,2}\.\d{1,2}(?:\s*[（(]\s*\d{1,2}\s*[）)])?)\s*[、.．]?\s*([一-龥][^\n]{0,40})$/

// 课时编号归一化：压空白 + 全角括号→半角。导出供 route 层（预埋答案解析）复用。
export const normLesson = (raw) => (raw ? String(raw).replace(/[\s　]+/g, '').replace(/[（）]/g, c => (c === '（' ? '(' : ')')) : null)

/**
 * 识别练习单元标题行。
 * 必须在 isSectionHeader 之前调用——后者的 /^\d/ 早退会把 "19.1(1) 算术平方根" 当答案行吃掉。
 *
 * @returns {{unit_key, unit_title, lesson_code, ordinal}|null}
 */
export function parseUnitHeader(line) {
  const raw = String(line || '').trim()
  if (!raw || raw.length > 60) return null

  // ① 堂堂练① 19.1(1) 算术平方根
  const lm = raw.match(UNIT_LABEL_RE)
  if (lm) {
    const label = lm[1]
    const ordinal = toOrdinal(lm[2])
    const lesson = normLesson((lm[3] || '').match(LESSON_CODE_RE)?.[1])
    const keyHead = ordinal ? `${label}${ordinal}` : label
    return {
      unit_key: lesson ? `${keyHead}|${lesson}` : keyHead,
      unit_title: normalizeSectionName(raw),
      lesson_code: lesson,
      ordinal,
    }
  }

  // ② 纯课时编号行：19.1(1) 算术平方根
  const cm = raw.match(LESSON_LINE_RE)
  if (cm) {
    const lesson = normLesson(cm[1])
    return { unit_key: lesson, unit_title: normalizeSectionName(raw), lesson_code: lesson, ordinal: null }
  }

  // ③ 第N课时
  const km = raw.match(/^第\s*([一二三四五六七八九十\d]+)\s*课时/)
  if (km) {
    const ordinal = toOrdinal(km[1])
    const lesson = normLesson(raw.match(LESSON_CODE_RE)?.[1])
    const keyHead = `第${ordinal ?? km[1]}课时`
    return {
      unit_key: lesson ? `${keyHead}|${lesson}` : keyHead,
      unit_title: normalizeSectionName(raw),
      lesson_code: lesson,
      ordinal,
    }
  }

  // ④ 章级 / 试卷级标题（这类同样是独立编号域）
  if (isSectionHeader(raw)) {
    const title = normalizeSectionName(raw)
    return { unit_key: title, unit_title: title, lesson_code: null, ordinal: null }
  }

  return null
}

/**
 * 行内多题安全拆分。
 * 拆分点：分号（；;）或空白，且后面紧跟 "题号." / "题号．" / "题号、"。
 * 防误拆保护：
 *  - ASCII 点号后必须跟空白或单个选项字母（避免把小数 "3.5元"、"18.360" 拆断）
 *  - 题号必须严格递增，且跳跃不超过 30（避免把答案里的普通数字当题号）
 */
export function splitInlineAnswers(line) {
  const re = /(?:[；;]|\s)+(?=(\d{1,3})\s*(?:[．、]|\.(?=\s|[A-Da-d](?:\s|$))))/g

  // 首段题号（作为递增校验起点）
  const firstM = line.match(/^\(?(\d{1,3})\)?\s*[.．、]/)
  let prevNo = firstM ? parseInt(firstM[1], 10) : null

  const parts = []
  let last = 0
  let m
  while ((m = re.exec(line)) !== null) {
    const no = parseInt(m[1], 10)
    if (prevNo !== null && (no <= prevNo || no > prevNo + 30)) continue
    parts.push(line.slice(last, m.index))
    last = m.index + m[0].length
    prevNo = no
  }
  parts.push(line.slice(last))
  // 去掉每段的尾随分隔符（"1. C；" 的分号若残留，会让选择题正则匹配失败被误标为一般答案）
  return parts.map(s => s.trim().replace(/[；;、,\s]+$/, '')).filter(Boolean)
}

/**
 * 子题拆分："(1)7/2 (2)4/3 (3)0.9 (4)0.8" → [{sub_no:'1',answer:'7/2'}, ...]
 *
 * 数学答案里括号极多（"(x+1)(x-2)"），误拆代价高，故要求：
 * 必须从 (1) 开始、开头位置靠前、序号严格 +1、每段非空且不超长。任一不满足则整体不拆。
 */
export function splitSubAnswers(ans) {
  const text = String(ans || '')
  const re = /[（(]\s*(\d{1,2})\s*[）)]/g
  const marks = []
  let m
  while ((m = re.exec(text)) !== null) {
    marks.push({ no: parseInt(m[1], 10), start: m.index, end: re.lastIndex })
  }
  if (marks.length < 2 || marks[0].no !== 1 || marks[0].start > 2) return null

  const picked = [marks[0]]
  for (const k of marks) {
    if (k.no === picked[picked.length - 1].no + 1) picked.push(k)
  }
  if (picked.length < 2) return null

  const segs = picked.map((k, i) => ({
    sub_no: String(k.no),
    answer: text.slice(k.end, i + 1 < picked.length ? picked[i + 1].start : text.length).trim(),
  }))
  if (segs.some(s => !s.answer || s.answer.length > 80)) return null
  return segs
}

const JUDGE_SYMBOL_RE = /^[✓√✔✗✘×]$/

// 大题组标题："一、填空题" "二、选择题（每题3分）"
// 必须识别：同一个单元内，填空题/选择题/解答题各自从 1 重新编号，
// 实测答案 PDF p2 的「1. 13」（填空）与「1. C」（选择）就是这样撞成同一个 key，
// 去重时高置信度的选择题答案覆盖了填空题答案。故大题组要作为单元下的第二级定位。
const GROUP_HEADER_RE = /^([一二三四五六七八九十]{1,3})\s*[、.．]\s*(.{0,20})$/
const GROUP_TYPE_RE = /(填空|选择|判断|解答|计算|应用|证明|作图|简答|综合|探究|阅读|操作|实验)/

/** 识别大题组标题行，返回归一化后的组名；不是则返回 null */
export function parseGroupHeader(line) {
  const raw = String(line || '').trim()
  if (!raw || raw.length > 24) return null
  const m = raw.match(GROUP_HEADER_RE)
  if (!m) return null
  // 必须含题型词，否则「一、13」这类答案行会被误当标题吃掉
  if (!GROUP_TYPE_RE.test(m[2])) return null
  return normalizeSectionName(raw)
}

/** 把 initialUnit（旧调用传字符串/单元对象）或 {unit, group} 状态统一成状态对象 */
function toState(input) {
  if (!input) return { unit: null, group: null }
  if (typeof input === 'string') {
    const title = normalizeSectionName(input)
    return { unit: title ? { unit_key: title, unit_title: title, lesson_code: null, ordinal: null } : null, group: null }
  }
  if (input.unit !== undefined || input.group !== undefined) {
    return { unit: input.unit || null, group: input.group || null }
  }
  return { unit: input, group: null }
}

/**
 * 解析答案文本。
 * @param {string} text - OCR 或 PDF 提取出的答案文本
 * @param {Array} lowConfidence - 低置信度条目收集器（原地 push）
 * @param {string|object|null} initialState - 起始状态 {unit, group, pageRanges}（多页按顺序解析时接续上一页）
 *                                         pageRanges: Map<unit_key, { start, end }>，由本页号 1-based 持续更新
 * @param {number} [pageNumber] - 本页在 PDF 中的页号（1-based，可选）。提供后用于
 *                                记录每个单元的起止页范围，落库到 resource_units.answer_page_start/end。
 * @returns {{ answers: Array, lastState: object, lastUnit: object|null, lastSection: string|null }}
 */
export function parseAnswerText(text, lowConfidence = [], initialState = null, pageNumber) {
  const results = []
  const lines = String(text || '').split('\n')
  const state = toState(initialState)
  let currentUnit = state.unit
  let currentGroup = state.group
  // 单元→页范围 记录器：跨页累计，每遇到一个新单元标题，关闭上一个单元的 end 并开启新单元的 start
  // 共享 state 以便跨函数调用延续（同 processOcrBatch 的 lastState 透传模式）
  const pageRanges = state.pageRanges || new Map()
  const pageNoNum = pageNumber != null && Number.isFinite(Number(pageNumber)) ? Number(pageNumber) : null
  // 关闭"上一页遗留的未关闭单元"：该单元到本页前为止
  if (pageNoNum != null && currentUnit && currentUnit.unit_key) {
    const r = pageRanges.get(currentUnit.unit_key)
    if (r && r.end == null) r.end = pageNoNum - 1
  }

  const processedLines = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // 单元标题检测（含章级标题，必须先于答案行判断）
    const unit = parseUnitHeader(trimmed)
    if (unit) {
      // 切换单元：上一个单元的 end = 本页号 - 1；若上一页就出过同一 unit_key 题目，
      // 则 pageRanges 中已有 start，本次只更新 end（不重置 start）。
      if (pageNoNum != null && unit.unit_key) {
        const r = pageRanges.get(unit.unit_key)
        if (r) {
          if (r.end == null || pageNoNum - 1 > r.end) r.end = pageNoNum - 1
        } else {
          pageRanges.set(unit.unit_key, { start: pageNoNum, end: null })
        }
      }
      currentUnit = unit
      currentGroup = null // 换单元 → 大题组重新开始
      continue // 标题行不加入答案解析
    }

    // 大题组标题检测
    const group = parseGroupHeader(trimmed)
    if (group) {
      currentGroup = group
      continue
    }

    // 行内多题拆分（如 "19. 2 因素；20. 1/10" 或 "13. D 14. C 15. C 16. B"）
    for (const part of splitInlineAnswers(trimmed)) {
      processedLines.push({ line: part, unit: currentUnit, group: currentGroup })
    }
  }

  // 本页结束：把 currentUnit 的 end 临时记为本页（最后一页可能 end 仍为 null，
  // 由调用方在整批跑完后做一次"end = totalPages"收尾；这里只覆盖"非末页"的场景）
  if (pageNoNum != null && currentUnit && currentUnit.unit_key) {
    const r = pageRanges.get(currentUnit.unit_key)
    if (r) {
      if (r.end == null) r.end = pageNoNum
    } else {
      // 跨批/批首可能：从未识别到单元标题但 OCR 出题目了；用 pageNoNum 兜底建一个无 key 的范围
      // （不会被落库，仅日志提示）
    }
  }

  // section 存大题组名（单元名存在 resource_units 表，不再挤占 section 列）；
  // 唯一约束含 section，故填空题第1题与选择题第1题不会再互相覆盖。
  const push = (unit, group, row) => {
    results.push({
      ...row,
      sub_no: row.sub_no || '',
      section: group || null,
      unit_key: unit?.unit_key || null,
      unit_title: unit?.unit_title || null,
      lesson_code: unit?.lesson_code || null,
      ordinal: unit?.ordinal ?? null,
    })
  }

  for (const { line: trimmed, unit, group } of processedLines) {
    // 选择题：单字母 A-D
    let m = trimmed.match(/^\(?(\d+)\)?[.．、\s]\s*([A-Da-d])\s*$/)
    if (m) {
      push(unit, group, { question_no: parseInt(m[1], 10), answer: m[2].toUpperCase(), answer_type: 'choice', confidence: 0.95 })
      continue
    }

    // 判断题：√ / × 等符号
    m = trimmed.match(/^\(?(\d+)\)?[.．、\s]\s*([✓√✔✗✘×])\s*$/)
    if (m) {
      push(unit, group, { question_no: parseInt(m[1], 10), answer: m[2], answer_type: 'judge', confidence: 0.95 })
      continue
    }

    // 连续选择题："13-17 ABCDB"
    m = trimmed.match(/^(\d+)\s*[-~]\s*(\d+)\s+([A-Da-d]+)\s*$/)
    if (m) {
      const start = parseInt(m[1], 10)
      const letters = m[3].toUpperCase().split('')
      for (let i = 0; i < letters.length; i++) {
        push(unit, group, { question_no: start + i, answer: letters[i], answer_type: 'choice', confidence: 0.9 })
      }
      continue
    }

    // 一般答案
    m = trimmed.match(/^(\d+)[.．、\s]\s*(.+)$/)
    if (m) {
      const ans = m[2].trim()
      if (ans.length >= 200) continue
      const questionNo = parseInt(m[1], 10)

      // 多空题按 (1)(2)(3) 拆成独立子题，避免整题一坨字符串比对
      const subs = splitSubAnswers(ans)
      if (subs) {
        for (const s of subs) {
          const subJudge = JUDGE_SYMBOL_RE.test(s.answer)
          push(unit, group, {
            question_no: questionNo,
            sub_no: s.sub_no,
            answer: s.answer,
            answer_type: subJudge ? 'judge' : 'answer',
            confidence: 0.8,
          })
        }
        lowConfidence.push({ question_no: questionNo, answer: ans, section: group || null })
        continue
      }

      const isJudge = JUDGE_SYMBOL_RE.test(ans)
      push(unit, group, { question_no: questionNo, answer: ans, answer_type: isJudge ? 'judge' : 'answer', confidence: 0.8 })
      if (!isJudge) lowConfidence.push({ question_no: questionNo, answer: ans, section: group || null })
    }
  }

  return {
    answers: results,
    // pageRanges 也透传：跨批 OCR 时，下一批首行的"上一页遗留单元"关闭逻辑靠它接力
    lastState: { unit: currentUnit, group: currentGroup, pageRanges },
    lastUnit: currentUnit,
    lastSection: currentUnit?.unit_title || null,
  }
}

