// ============================================================
// 投屏备课讲义模板（classroomProjection）
//
// 定位：极简投屏，老师课堂投屏使用。
// 结构（一知识点 = 三页）：
//   1. 知识点精讲页 — 纵向结构，定义/重点/难点/易错/口诀
//   2. 错题精讲页 — 对比卡片 + 分步作答过程
//   3. 题型全览页 — 题型+例题+解题过程+技巧
//
// 关键设计：
//   - 纯白背景，无多余装饰
//   - 大字体、高对比度，适配投影仪
//   - 知识点讲细，字号区分重难点
//   - 错题包含完整分步作答过程
// ============================================================

import { generateKnowledgeExplanation, generateQuestionTypeSummary } from '../handoutService.js'

export default {
  id: 'classroom_projection',
  label: '投屏备课讲义',
  description: '极简投屏：纯白背景、纵向结构、知识点精讲+错题分步作答+题型全览',
  supportsSubject: 'all',

  /**
   * @param {Object} ctx
   * @param {string} ctx.kpName
   * @param {string} ctx.subject
   * @param {Array}  ctx.sampleQuestions
   * @param {string} [ctx.explanation]
   * @returns {Promise<{pages: Array<{name, blocks}>}>}
   */
  buildSections: async ({ kpName, subject = '数学', sampleQuestions = [], explanation = null }) => {
    const pages = []

    // ─── Page 1: 知识点精讲（纵向结构） ───
    const text = explanation || await generateKnowledgeExplanation(kpName, subject)
    const kpBlocks = parseKpSections(text, kpName, subject)
    pages.push({
      name: `${kpName} · 知识点精讲`,
      blocks: [
        { type: 'time-hint', content: estimateTeachingTime(kpName, sampleQuestions) },
        { type: 'kp-section', content: kpName },
        ...kpBlocks,
      ],
    })

    if (sampleQuestions.length === 0) {
      return { pages }
    }

    // ─── Page 2: 错题精讲 ───
    const blankCount = sampleQuestions.filter(q => q.isBlank).length
    const wrongCount = sampleQuestions.length - blankCount
    const typeGroups = groupByType(sampleQuestions)
    const typeSummary = Array.from(typeGroups.entries()).map(([t, qs]) => ({
      type: t,
      count: qs.length,
    }))

    const exBlocks = [
      {
        type: 'kp-stats',
        content: { total: sampleQuestions.length, blankCount, wrongCount, typeCount: typeGroups.size, types: typeSummary },
      },
      { type: 'section', content: '📋 本周典型错题' },
    ]

    let qIdx = 0
    for (const [qType, qs] of typeGroups) {
      exBlocks.push({
        type: 'type-section',
        content: `${qType}（${qs.length} 道${qs.some(q => q.isBlank) ? `，含空题 ${qs.filter(q => q.isBlank).length}` : ''}）`,
        questionType: qType,
        count: qs.length,
      })
      for (const q of qs) {
        qIdx += 1
        // 题干
        exBlocks.push({
          type: 'question',
          content: `第 ${qIdx} 题 · ${q.content || '(题干缺失)'}`,
          options: q.options,
          imageUrls: q.imageUrls || [],
          questionType: qType,
          questionId: q.questionId,
        })
        // 对比卡片：学生作答 vs 正确答案（简洁左右对比）
        exBlocks.push({
          type: 'compare-card',
          content: {
            studentAnswer: q.isBlank ? '（空题，未作答）' : (q.studentAnswer || '—'),
            correctAnswer: q.correctAnswer || '—',
            isBlank: q.isBlank,
            studentName: q.studentName || '学生',
          },
        })
        // 错因简析
        if (q.errorType) {
          exBlocks.push({
            type: 'error-cause',
            content: `错因：${q.errorType}${q.errorReason ? `——${q.errorReason}` : ''}`,
          })
        }
        // 分步作答过程
        exBlocks.push({
          type: 'solution-steps',
          content: buildSolutionSteps(q, kpName),
        })
      }
    }
    pages.push({
      name: `${kpName} · 错题精讲`,
      blocks: exBlocks,
    })

    // ─── Page 3: 题型全览 ───
    const typeSummaryList = await generateQuestionTypeSummary(kpName, subject, sampleQuestions)
    const typeBlocks = [{ type: 'section', content: '🎯 本知识点考试题型全览' }]
    if (Array.isArray(typeSummaryList)) {
      typeSummaryList.forEach((t, i) => {
        typeBlocks.push({
          type: 'type-section',
          content: `${i + 1}. ${t.type || '未命名题型'}`,
        })
        if (t.example) {
          typeBlocks.push({
            type: 'type-example',
            content: t.example,
          })
        }
        if (t.solutionSteps && Array.isArray(t.solutionSteps)) {
          typeBlocks.push({
            type: 'solution-steps',
            content: t.solutionSteps,
          })
        }
        if (t.tip) {
          typeBlocks.push({
            type: 'type-tip',
            content: t.tip,
          })
        }
      })
    }
    pages.push({
      name: `${kpName} · 题型全览`,
      blocks: typeBlocks,
    })

    return { pages }
  },
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 将 AI 讲解 Markdown 文本解析为纵向 block 数组。
 * AI 输出格式：## 核心定义 / ## 重点内容 / ## 难点突破 / ## 易错警示 / ## 记忆口诀
 * 解析后映射到：kp-definition / kp-key-points / kp-difficult-points / kp-mistakes / kp-mnemonic
 */
function parseKpSections(text, kpName, subject) {
  const blocks = []

  if (!text) {
    blocks.push({ type: 'kp-definition', content: `${kpName}是${subject}学科中的重要知识点。` })
    blocks.push({ type: 'kp-key-points', content: ['请参考教材相关章节'], label: '重点' })
    blocks.push({ type: 'kp-difficult-points', content: ['暂无数据'], label: '难点' })
    blocks.push({ type: 'kp-mistakes', content: ['暂无错题数据'] })
    blocks.push({ type: 'kp-mnemonic', content: '理解定义，多做练习' })
    return blocks
  }

  // 按 ## 标题分割
  const sections = text.split(/\n(?=## )/)
  for (const sec of sections) {
    const lines = sec.trim().split('\n')
    const header = lines[0].replace(/^##\s*/, '').trim()
    const body = lines.slice(1).join('\n').trim()

    if (header.includes('定义') || header.includes('核心')) {
      const clean = body.replace(/^[*-]\s*/gm, '').replace(/\n+/g, ' ').trim()
      blocks.push({ type: 'kp-definition', content: clean.slice(0, 300) || `${kpName}是${subject}学科中的重要知识点。` })
    } else if (header.includes('重点') || header.includes('关键')) {
      const items = extractListItems(body)
      blocks.push({ type: 'kp-key-points', content: items.length > 0 ? items.slice(0, 6) : [body.slice(0, 120)], label: '重点' })
    } else if (header.includes('难点')) {
      const items = extractListItems(body)
      blocks.push({ type: 'kp-difficult-points', content: items.length > 0 ? items.slice(0, 5) : [body.slice(0, 120)], label: '难点' })
    } else if (header.includes('易错') || header.includes('错误') || header.includes('警示')) {
      const items = extractListItems(body)
      blocks.push({ type: 'kp-mistakes', content: items.length > 0 ? items.slice(0, 5) : [body.slice(0, 120)] })
    } else if (header.includes('口诀') || header.includes('记忆') || header.includes('技巧')) {
      const clean = body.replace(/^[>*-]\s*/gm, '').replace(/\n+/g, ' ').trim()
      blocks.push({ type: 'kp-mnemonic', content: clean.slice(0, 200) || '理解定义，多做练习，注意细节' })
    } else if (header.includes('考法') || header.includes('考点')) {
      // 兼容旧格式：考法/考点内容合并到重点
      const items = extractListItems(body)
      const existing = blocks.find(b => b.type === 'kp-key-points')
      if (existing) {
        existing.content = [...existing.content, ...items].slice(0, 8)
      }
    }
  }

  // 兜底：确保每个 block 类型都存在
  if (!blocks.find(b => b.type === 'kp-definition')) {
    blocks.unshift({ type: 'kp-definition', content: `${kpName}是${subject}学科中的重要知识点。` })
  }
  if (!blocks.find(b => b.type === 'kp-key-points')) {
    blocks.push({ type: 'kp-key-points', content: ['请参考教材相关章节'], label: '重点' })
  }
  if (!blocks.find(b => b.type === 'kp-difficult-points')) {
    blocks.push({ type: 'kp-difficult-points', content: ['暂无数据'], label: '难点' })
  }
  if (!blocks.find(b => b.type === 'kp-mistakes')) {
    blocks.push({ type: 'kp-mistakes', content: ['暂无错题数据'] })
  }
  if (!blocks.find(b => b.type === 'kp-mnemonic')) {
    blocks.push({ type: 'kp-mnemonic', content: '理解定义，多做练习，注意细节' })
  }

  return blocks
}

function extractListItems(text) {
  if (!text) return []
  return text
    .split('\n')
    .map(line => line.replace(/^[*-]\s*/, '').replace(/^\d+[.、]\s*/, '').trim())
    .filter(s => s.length > 0)
}

function estimateTeachingTime(kpName, sampleQuestions) {
  const base = sampleQuestions.length > 0 ? 8 : 5
  const extra = Math.min(sampleQuestions.length, 5)
  const minutes = Math.min(base + extra, 20)
  return `⏱ 建议讲解 ${minutes} 分钟（知识点 ${base} 分钟 + 错题分析 ${extra} 分钟）`
}

function groupByType(questions) {
  const groups = new Map()
  for (const q of questions) {
    const t = normalizeType(q.questionType)
    if (!groups.has(t)) groups.set(t, [])
    groups.get(t).push(q)
  }
  for (const [, qs] of groups) {
    qs.sort((a, b) => {
      if (a.isBlank && !b.isBlank) return -1
      if (!a.isBlank && b.isBlank) return 1
      return 0
    })
  }
  return new Map(
    Array.from(groups.entries()).sort((a, b) => {
      const aBlank = a[1].filter(q => q.isBlank).length
      const bBlank = b[1].filter(q => q.isBlank).length
      if (aBlank !== bBlank) return bBlank - aBlank
      return b[1].length - a[1].length
    })
  )
}

function normalizeType(t) {
  if (!t || t === 'unknown' || t === 'other' || t === '未分类') return '未分类题型'
  return t
}

/**
 * 从题干中提取一句话摘要（去掉选项标记，截取前80字）。
 * @param {string} content - 题目原始内容
 * @returns {string} 摘要文本
 */
function extractQuestionSummary(content) {
  if (!content) return '题目'
  let cleaned = content
    .replace(/[A-D][.、．]\s*[^\n]*/g, '')    // 去掉选项行 "A. xxx"
    .replace(/[A-D]\s*[.、．]/g, '')          // 去掉残留选项标记
    .replace(/\n+/g, ' ')                      // 换行合并为空格
    .trim()
  if (cleaned.length > 80) {
    cleaned = cleaned.slice(0, 80) + '…'
  }
  return cleaned || '题目'
}

/**
 * 从题干中提取所有数字。
 * @param {string} content
 * @returns {number[]}
 */
function extractNumbers(content) {
  if (!content) return []
  const matches = content.match(/-?\d+(?:\.\d+)?/g)
  return matches ? matches.map(Number) : []
}

/**
 * 尝试解析一元一次方程：ax + b = c 或 ax - b = c。
 * @param {string} content - 题干文本
 * @returns {null|{a: number, op: string, b: number, c: number}}
 */
function parseLinearEquation(content) {
  if (!content) return null

  // 1. 带括号的方程：(x + a) * b = c 或 (x - a) * b = c
  let m = content.match(/\(\s*x\s*([+\-])\s*(\d+\.?\d*)\s*\)\s*\*\s*(\d+\.?\d*)\s*[=＝]\s*(\d+\.?\d*)/)
  if (m) {
    return {
      type: 'bracket',
      a: parseFloat(m[3]),
      op: m[1],
      b: parseFloat(m[2]),
      c: parseFloat(m[4]),
    }
  }
  // 也支持 b * (x + a) = c
  m = content.match(/(\d+\.?\d*)\s*\*\s*\(\s*x\s*([+\-])\s*(\d+\.?\d*)\s*\)\s*[=＝]\s*(\d+\.?\d*)/)
  if (m) {
    return {
      type: 'bracket',
      a: parseFloat(m[1]),
      op: m[2],
      b: parseFloat(m[3]),
      c: parseFloat(m[4]),
    }
  }

  // 2. 分式方程：a/x = b
  m = content.match(/(\d+\.?\d*)\s*\/\s*x\s*[=＝]\s*(\d+\.?\d*)/)
  if (m) {
    return {
      type: 'fraction',
      a: parseFloat(m[1]),
      b: parseFloat(m[2]),
    }
  }

  // 3. 不等式：ax + b > c, ax + b < c, ax + b ≥ c, ax + b ≤ c
  m = content.match(/(\d*\.?\d*)\s*x\s*([+\-])\s*(\d+\.?\d*)\s*([><≥≤])\s*(\d+\.?\d*)/)
  if (m) {
    return {
      type: 'inequality',
      a: m[1] === '' ? 1 : parseFloat(m[1]),
      op: m[2],
      b: parseFloat(m[3]),
      cmp: m[4],
      c: parseFloat(m[5]),
    }
  }

  // 4. 简单二元一次方程：ax + by = c
  m = content.match(/(\d*\.?\d*)\s*x\s*([+\-])\s*(\d*\.?\d*)\s*y\s*[=＝]\s*(\d+\.?\d*)/)
  if (m) {
    return {
      type: 'two_var',
      a: m[1] === '' ? 1 : parseFloat(m[1]),
      op: m[2],
      b: m[3] === '' ? 1 : parseFloat(m[3]),
      c: parseFloat(m[4]),
    }
  }

  // 5. 标准一元一次方程：ax + b = c 或 ax - b = c（系数a可为空，默认为1）
  m = content.match(/(\d*\.?\d*)\s*x\s*([+\-])\s*(\d+\.?\d*)\s*[=＝]\s*(\d+\.?\d*)/)
  if (m) {
    return {
      type: 'standard',
      a: m[1] === '' ? 1 : parseFloat(m[1]),
      op: m[2],
      b: parseFloat(m[3]),
      c: parseFloat(m[4]),
    }
  }

  // 6. b + ax = c
  m = content.match(/(\d+\.?\d*)\s*([+\-])\s*(\d*\.?\d*)\s*x\s*[=＝]\s*(\d+\.?\d*)/)
  if (m) {
    return {
      type: 'standard',
      a: m[3] === '' ? 1 : parseFloat(m[3]),
      op: m[2],
      b: parseFloat(m[1]),
      c: parseFloat(m[4]),
    }
  }

  return null
}

/**
 * 根据题目内容和答案构建具体公式表达式（KaTeX 格式）。
 * @param {string} correctAnswer - 正确答案
 * @param {string} content - 题干文本
 * @returns {string} KaTeX 公式字符串
 */
function buildFormulaFromAnswer(correctAnswer, content) {
  if (!correctAnswer || !content) return ''
  const answer = String(correctAnswer).trim()
  if (!answer) return ''

  // 尝试从题干中提取等式片段
  const eqMatch = content.match(/([^，,;\n]{3,60}?[=＝]\s*[^，,;\n]{1,30})/)
  if (eqMatch) {
    return `$${eqMatch[1].trim()}$`
  }

  // 有数字则尝试构建具体计算式
  const nums = extractNumbers(content)
  if (nums.length >= 2) {
    // 尝试从题干中提取运算符
    const opMatch = content.match(/[+\-×÷\*\/]/)
    if (opMatch) {
      const op = opMatch[0]
      let katexOp = op
      if (op === '×' || op === '*') katexOp = '\\times'
      if (op === '÷' || op === '/') katexOp = '\\div'
      return `$${nums[0]} ${katexOp} ${nums[1]} = ${answer}$`
    }
    return `$${nums[0]} \\times ${nums[1]} = ${answer}$`
  }

  return `$= ${answer}$`
}

/**
 * 为各类方程/不等式生成具体解题步骤。
 * 支持标准型、括号型、分式型、不等式、二元一次方程。
 * @param {Object} eq - 解析后的方程对象，包含 type 字段
 * @returns {Array<{text: string, formula: string}>}
 */
function buildEquationSteps(eq) {
  const steps = []

  if (eq.type === 'bracket') {
    // (x + a) * b = c → x + a = c / b → x = c/b - a
    const divided = eq.c / eq.a
    const dividedStr = Number.isInteger(divided) ? divided.toString() : parseFloat(divided.toFixed(4)).toString()
    const result = eq.op === '+' ? divided - eq.b : divided + eq.b
    const resultStr = Number.isInteger(result) ? result.toString() : parseFloat(result.toFixed(4)).toString()

    steps.push({
      text: `我先把括号外的系数 ${eq.a} 移到右边，两边同时除以 ${eq.a}`,
      formula: `$x ${eq.op} ${eq.b} = ${eq.c} \\div ${eq.a} = ${dividedStr}$`,
    })
    steps.push({
      text: `再把常数项 ${eq.b} 移到右边`,
      formula: `$x = ${dividedStr} ${eq.op === '+' ? '-' : '+'} ${eq.b} = ${resultStr}$`,
    })
  } else if (eq.type === 'fraction') {
    // a/x = b → x = a/b
    const result = eq.a / eq.b
    const resultStr = Number.isInteger(result) ? result.toString() : parseFloat(result.toFixed(4)).toString()

    steps.push({
      text: `我两边同时乘以 x，把分式化为整式`,
      formula: `$${eq.a} = ${eq.b} \\times x$`,
    })
    steps.push({
      text: `两边同时除以 ${eq.b}，求出 x`,
      formula: `$x = ${eq.a} \\div ${eq.b} = ${resultStr}$`,
    })
  } else if (eq.type === 'inequality') {
    const rhs = eq.op === '+' ? eq.c - eq.b : eq.c + eq.b
    const result = rhs / eq.a
    const resultStr = Number.isInteger(result) ? result.toString() : parseFloat(result.toFixed(4)).toString()

    steps.push({
      text: `我先把常数项 ${eq.b} 移到不等号右边`,
      formula: `$${eq.a}x ${eq.cmp} ${eq.c} ${eq.op === '+' ? '-' : '+'} ${eq.b}$`,
    })
    steps.push({
      text: `化简后两边同时除以 ${eq.a}，求出 x 的范围`,
      formula: `$${eq.a}x ${eq.cmp} ${rhs}$，$x ${eq.cmp} ${resultStr}$`,
    })
  } else if (eq.type === 'two_var') {
    steps.push({
      text: `这是一个二元一次方程，需要联立另一个方程才能求出唯一解`,
      formula: `$${eq.a}x ${eq.op} ${eq.b}y = ${eq.c}$`,
    })
  } else {
    // standard 类型：ax + b = c
    const rhs = eq.op === '+' ? eq.c - eq.b : eq.c + eq.b

    steps.push({
      text: `我把常数项 ${eq.b} 移到等号右边`,
      formula: `$${eq.a}x = ${eq.c} ${eq.op === '+' ? '-' : '+'} ${eq.b}$`,
    })

    if (eq.a !== 1) {
      const result = rhs / eq.a
      const resultStr = Number.isInteger(result) ? result.toString() : parseFloat(result.toFixed(4)).toString()
      steps.push({
        text: `化简得 $${eq.a}x = ${rhs}$，两边同时除以 ${eq.a}`,
        formula: `$x = ${rhs} \\div ${eq.a} = ${resultStr}$`,
      })
    } else {
      steps.push({
        text: `化简得 $x = ${rhs}$，得出结果`,
        formula: `$x = ${rhs}$`,
      })
    }
  }

  return steps
}

/**
 * 处理算术/计算类题目（非方程类）的分步计算。
 * 从题干中提取数字和运算符，生成逐步计算步骤。
 * @param {string} content - 题干文本
 * @param {string} answer - 正确答案
 * @returns {Array<{text: string, formula: string}>}
 */
function buildArithmeticSteps(content, answer) {
  const steps = []
  const nums = extractNumbers(content)
  if (nums.length < 2) return steps

  // 尝试识别运算模式
  if (/[＋+加]/.test(content) || /[－\-减]/.test(content)) {
    // 加减混合运算
    const expr = nums.map((n, i) => i === 0 ? n : (n >= 0 ? `+ ${n}` : `- ${Math.abs(n)}`)).join(' ')
    steps.push({
      text: `我按题目中的运算顺序，列出算式`,
      formula: `$${expr}$`,
    })
    if (answer) {
      steps.push({
        text: `逐步计算，求出结果`,
        formula: `$= ${answer}$`,
      })
    }
  } else if (/[×\*乘]/.test(content) || /[÷\/除]/.test(content)) {
    // 乘除运算
    const katexOp = /[÷\/除]/.test(content) ? '\\div' : '\\times'
    steps.push({
      text: `我按运算规则进行计算`,
      formula: `$${nums[0]} ${katexOp} ${nums[1]} = ${answer}$`,
    })
  } else {
    // 默认：按顺序列出
    steps.push({
      text: `我把已知数字代入计算`,
      formula: `$${nums.slice(0, 3).join(' \\times ')}${nums.length > 3 ? ' \\times \\cdots' : ''} = ${answer}$`,
    })
  }

  return steps
}

/**
 * 处理几何类题目的分步推理。
 * 识别几何题型（面积、周长、体积、三角形、圆等），生成公式代入→计算步骤。
 * @param {string} content - 题干文本
 * @param {string} answer - 正确答案
 * @returns {Array<{text: string, formula: string}>}
 */
function buildGeometrySteps(content, answer) {
  const steps = []
  const nums = extractNumbers(content)
  if (nums.length < 1) return steps

  const isArea = /面积|平方/.test(content)
  const isPerimeter = /周长|周/.test(content)
  const isTriangle = /三角形/.test(content)
  const isCircle = /圆/.test(content)
  const isRectangle = /长方形|矩形/.test(content)
  const isSquare = /正方形/.test(content)
  const isVolume = /体积|容积/.test(content)
  const isTrapezoid = /梯形/.test(content)

  if (isCircle && (isArea || isPerimeter)) {
    const r = nums[0]
    if (isArea) {
      steps.push({
        text: `圆的面积公式是 $S = \\pi r^2$，我把半径 $r = ${r}$ 代入`,
        formula: `$S = \\pi \\times ${r}^2 = \\pi \\times ${r * r}$`,
      })
      if (answer) {
        steps.push({
          text: `计算得出面积`,
          formula: `$S = ${answer}$`,
        })
      }
    } else {
      steps.push({
        text: `圆的周长公式是 $C = 2\\pi r$，我把半径 $r = ${r}$ 代入`,
        formula: `$C = 2 \\times \\pi \\times ${r}$`,
      })
      if (answer) {
        steps.push({
          text: `计算得出周长`,
          formula: `$C = ${answer}$`,
        })
      }
    }
  } else if (isTriangle && isArea) {
    if (nums.length >= 2) {
      const [base, height] = [nums[0], nums[1]]
      steps.push({
        text: `三角形面积公式 $S = \\frac{1}{2} \\times 底 \\times 高$，我把底=${base}、高=${height} 代入`,
        formula: `$S = \\frac{1}{2} \\times ${base} \\times ${height}$`,
      })
      if (answer) {
        steps.push({
          text: `计算得出面积`,
          formula: `$S = ${answer}$`,
        })
      }
    }
  } else if (isSquare && isArea) {
    const side = nums[0]
    steps.push({
      text: `正方形面积公式 $S = a^2$，我把边长 $a = ${side}$ 代入`,
      formula: `$S = ${side}^2 = ${answer}$`,
    })
  } else if (isRectangle && isArea) {
    if (nums.length >= 2) {
      steps.push({
        text: `长方形面积公式 $S = 长 \\times 宽$，我把长=${nums[0]}、宽=${nums[1]} 代入`,
        formula: `$S = ${nums[0]} \\times ${nums[1]} = ${answer}$`,
      })
    }
  } else if (isTrapezoid && isArea && nums.length >= 3) {
    steps.push({
      text: `梯形面积公式 $S = \\frac{(上底 + 下底) \\times 高}{2}$，我把上底=${nums[0]}、下底=${nums[1]}、高=${nums[2]} 代入`,
      formula: `$S = \\frac{(${nums[0]} + ${nums[1]}) \\times ${nums[2]}}{2} = ${answer}$`,
    })
  } else if (isVolume && nums.length >= 3) {
    steps.push({
      text: `体积公式代入长=${nums[0]}、宽=${nums[1]}、高=${nums[2]}`,
      formula: `$V = ${nums[0]} \\times ${nums[1]} \\times ${nums[2]} = ${answer}$`,
    })
  } else {
    // 通用几何：用数字构建公式
    if (nums.length >= 2) {
      steps.push({
        text: `我根据几何公式，把已知数据代入`,
        formula: `$${nums.join(' \\times ')} = ${answer}$`,
      })
    }
  }

  return steps
}

/**
 * 生成分步作答过程。
 * 基于题目具体内容（q.content、q.correctAnswer、q.errorType、q.errorReason）
 * 生成针对性解题步骤，每步包含具体说明文字和 KaTeX 公式。
 *
 * 错题流程：分析错因 → 正确解法 → 具体计算 → 得结果
 * 空题流程：回顾知识点 → 具体列式 → 逐步计算 → 得结果 → 检验
 *
 * @param {Object} q - 题目对象
 * @param {string} q.content - 题干
 * @param {string} q.correctAnswer - 正确答案
 * @param {string} [q.errorType] - 错误类型
 * @param {string} [q.errorReason] - 错误原因
 * @param {boolean} q.isBlank - 是否为空题
 * @param {string} kpName - 知识点名称
 * @returns {Array<{step: number, text: string, formula: string}>}
 */
function buildSolutionSteps(q, kpName) {
  const steps = []
  const summary = extractQuestionSummary(q.content)
  const answer = String(q.correctAnswer || '').trim()
  const isBlank = q.isBlank
  let n = 0

  const eq = parseLinearEquation(q.content)
  const isGeometry = /面积|周长|体积|三角形|圆|正方形|长方形|矩形|梯形|平行四边形|扇形|角度|边长|半径|直径/.test(q.content || '')
  const isArithmetic = !eq && !isGeometry && extractNumbers(q.content).length >= 2

  if (isBlank) {
    // ══════════════════════════════════════════════
    // 空题：从零开始完整解题
    // ══════════════════════════════════════════════

    steps.push({
      step: ++n,
      text: `回顾「${kpName}」的知识点，回忆相关公式和解题方法`,
      formula: '',
    })

    if (eq) {
      const eqTypeDesc = eq.type === 'bracket' ? '带括号的' : eq.type === 'fraction' ? '分式' : eq.type === 'inequality' ? '不等' : eq.type === 'two_var' ? '二元一次' : '一元一次'
      steps.push({
        step: ++n,
        text: `我仔细读题：「${summary}」，确定这是一个${eqTypeDesc}方程`,
        formula: '',
      })
      for (const s of buildEquationSteps(eq)) {
        steps.push({ step: ++n, ...s })
      }
    } else if (isGeometry) {
      steps.push({
        step: ++n,
        text: `我仔细读题：「${summary}」，分析图形的已知条件和求解目标`,
        formula: '',
      })
      const geoSteps = buildGeometrySteps(q.content, answer)
      for (const s of geoSteps) {
        steps.push({ step: ++n, ...s })
      }
    } else if (isArithmetic) {
      steps.push({
        step: ++n,
        text: `我仔细读题：「${summary}」，提取题目中的数字和运算关系`,
        formula: '',
      })
      const arithSteps = buildArithmeticSteps(q.content, answer)
      for (const s of arithSteps) {
        steps.push({ step: ++n, ...s })
      }
    } else {
      const formula = buildFormulaFromAnswer(answer, q.content)
      steps.push({
        step: ++n,
        text: `我仔细读题：「${summary}」，把已知条件代入计算`,
        formula: formula,
      })
      if (answer) {
        steps.push({
          step: ++n,
          text: `逐步计算，得出最终结果`,
          formula: `$= ${answer}$`,
        })
      }
    }

    if (answer) {
      steps.push({
        step: ++n,
        text: `我把结果 $${answer}$ 代回原题检验，确保计算正确`,
        formula: '',
      })
    }
  } else {
    // ══════════════════════════════════════════════
    // 错题：分析错因 → 纠正 → 求解
    // ══════════════════════════════════════════════

    if (q.errorType) {
      const errDesc = q.errorReason
        ? `${q.errorType}（${q.errorReason}）`
        : q.errorType
      steps.push({
        step: ++n,
        text: `我之前的错误是${errDesc}，现在重新分析这道题`,
        formula: '',
      })
    } else {
      steps.push({
        step: ++n,
        text: `我上次答错了，现在重新审题：「${summary}」`,
        formula: '',
      })
    }

    if (eq) {
      const eqTypeDesc = eq.type === 'bracket' ? '带括号的' : eq.type === 'fraction' ? '分式' : eq.type === 'inequality' ? '不等' : eq.type === 'two_var' ? '二元一次' : '一元一次'
      const solveMethod = eq.type === 'bracket' ? '先去括号再移项' : eq.type === 'fraction' ? '去分母后求解' : eq.type === 'inequality' ? '移项求解（注意不等号方向）' : eq.type === 'two_var' ? '需要联立方程组' : '移项化简求解'
      steps.push({
        step: ++n,
        text: `确定正确的解题思路：这是一个${eqTypeDesc}方程，${solveMethod}`,
        formula: '',
      })
      for (const s of buildEquationSteps(eq)) {
        steps.push({ step: ++n, ...s })
      }
    } else if (isGeometry) {
      steps.push({
        step: ++n,
        text: `确定正确的解题思路：分析图形特征，选择正确的几何公式`,
        formula: '',
      })
      const geoSteps = buildGeometrySteps(q.content, answer)
      for (const s of geoSteps) {
        steps.push({ step: ++n, ...s })
      }
    } else if (isArithmetic) {
      steps.push({
        step: ++n,
        text: `确定正确的解题思路：理清运算顺序，逐步计算`,
        formula: '',
      })
      const arithSteps = buildArithmeticSteps(q.content, answer)
      for (const s of arithSteps) {
        steps.push({ step: ++n, ...s })
      }
    } else {
      const formula = buildFormulaFromAnswer(answer, q.content)
      steps.push({
        step: ++n,
        text: `我重新理清思路，把已知条件代入正确的公式计算`,
        formula: formula,
      })
      if (answer) {
        steps.push({
          step: ++n,
          text: `计算出正确答案`,
          formula: `$= ${answer}$`,
        })
      }
    }

    if (answer) {
      steps.push({
        step: ++n,
        text: `正确答案是 $${answer}$，我记住这个解法，下次不再出错`,
        formula: '',
      })
    }
  }

  return steps
}