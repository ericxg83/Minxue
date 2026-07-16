/**
 * 练习册答案文本解析服务
 * 从 worksheets.js 抽出，供路由解析与离线修复脚本共用。
 *
 * 核心能力：
 *  1. 章节标题检测（多套试卷答案按章节分组，避免题号互相覆盖）
 *  2. 行内多题拆分（OCR 常把 "13. D 14. C 15. C" 挤在一行，需按题号递增安全拆开）
 *  3. 题型识别：选择题（A-D）/ 判断题（√×）/ 一般答案
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
  return parts.map(s => s.trim()).filter(Boolean)
}

const JUDGE_SYMBOL_RE = /^[✓√✔✗✘×]$/

/**
 * 解析答案文本。
 * @param {string} text - OCR 或 PDF 提取出的答案文本
 * @param {Array} lowConfidence - 低置信度条目收集器（原地 push）
 * @param {string|null} initialSection - 起始章节（多页图片按顺序解析时，接续上一页的章节）
 * @returns {{ answers: Array, lastSection: string|null }}
 */
export function parseAnswerText(text, lowConfidence = [], initialSection = null) {
  const results = []
  const lines = String(text || '').split('\n')
  let currentSection = normalizeSectionName(initialSection)

  const processedLines = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // 检测章节标题
    if (isSectionHeader(trimmed)) {
      currentSection = normalizeSectionName(trimmed)
      continue // 标题行不加入答案解析
    }

    // 行内多题拆分（如 "19. 2 因素；20. 1/10" 或 "13. D 14. C 15. C 16. B"）
    for (const part of splitInlineAnswers(trimmed)) {
      processedLines.push({ line: part, section: currentSection })
    }
  }

  for (const { line: trimmed, section } of processedLines) {
    // 选择题：单字母 A-D
    let m = trimmed.match(/^\(?(\d+)\)?[.．、\s]\s*([A-Da-d])\s*$/)
    if (m) {
      results.push({
        question_no: parseInt(m[1], 10),
        answer: m[2].toUpperCase(),
        answer_type: 'choice',
        confidence: 0.95,
        section,
      })
      continue
    }

    // 判断题：√ / × 等符号
    m = trimmed.match(/^\(?(\d+)\)?[.．、\s]\s*([✓√✔✗✘×])\s*$/)
    if (m) {
      results.push({
        question_no: parseInt(m[1], 10),
        answer: m[2],
        answer_type: 'judge',
        confidence: 0.95,
        section,
      })
      continue
    }

    // 连续选择题："13-17 ABCDB"
    m = trimmed.match(/^(\d+)\s*[-~]\s*(\d+)\s+([A-Da-d]+)\s*$/)
    if (m) {
      const start = parseInt(m[1], 10)
      const letters = m[3].toUpperCase().split('')
      for (let i = 0; i < letters.length; i++) {
        results.push({
          question_no: start + i,
          answer: letters[i],
          answer_type: 'choice',
          confidence: 0.9,
          section,
        })
      }
      continue
    }

    // 一般答案
    m = trimmed.match(/^(\d+)[.．、\s]\s*(.+)$/)
    if (m) {
      const ans = m[2].trim()
      if (ans.length < 200) {
        const questionNo = parseInt(m[1], 10)
        const isJudge = JUDGE_SYMBOL_RE.test(ans)
        results.push({
          question_no: questionNo,
          answer: ans,
          answer_type: isJudge ? 'judge' : 'answer',
          confidence: 0.8,
          section,
        })
        if (!isJudge) lowConfidence.push({ question_no: questionNo, answer: ans, section })
      }
    }
  }

  return { answers: results, lastSection: currentSection }
}
