import { callTextCompletion } from '../config/ai.js'
import { LRUCache } from 'lru-cache'

// ============================================================
// 讲课提词器脚本生成服务（handoutScriptService）— P4
//
// 职责：基于"知识点 + 错题 + 错因 + 涉及题型"，AI 生成按时间分块的讲课脚本。
// 老师可以直接照着念/修改，docx/PDF/Web 都能渲染。
//
// 输出结构：
//   [
//     { time: '00:00-02:00', title: '开场引入', detail: '...', points: ['...'],
//       board: '...', interaction: '...' },
//     ...
//   ]
//
// 关键设计：
//   - 走 LRU 缓存，key 含 kpName + 错题指纹
//   - 失败兜底：返回简易本地生成脚本（不阻塞主流程）
//   - 4-6 个 step 块（10-15 分钟一节课）
// ============================================================

const _scriptCache = new LRUCache({
  max: 256,
  ttl: 1000 * 60 * 60 * 6, // 6h
})

/**
 * 生成讲课提词器脚本
 * @param {Object} params
 * @param {string} params.kpName 知识点名
 * @param {string} [params.subject] 学科
 * @param {Array}  [params.sampleQuestions] 错题样本（已按 question_type 分组）
 * @param {number} [params.minutes] 课时分钟数（默认 15）
 * @returns {Promise<Array<{time, title, detail, points, board, interaction}>>}
 */
export async function generateLectureScript({ kpName, subject = '数学', sampleQuestions = [], minutes = 15 }) {
  if (!kpName) return []

  // 缓存 key
  const fp = sampleQuestions.slice(0, 3).map(q => `${q.questionId || q.id || ''}:${(q.content || '').slice(0, 30)}`).join('|')
  const cacheKey = `${subject}::${kpName}::${fp}::${minutes}`
  if (_scriptCache.has(cacheKey)) {
    return _scriptCache.get(cacheKey)
  }

  // 准备 prompt
  const qLines = sampleQuestions.slice(0, 5).map((q, i) => {
    const qType = q.questionType || '未分类'
    const errType = q.errorType || '未分类'
    const errReason = q.errorReason ? `（${q.errorReason}）` : ''
    const isBlank = q.isBlank ? '【空题】' : ''
    return `${i + 1}. [${qType}] ${isBlank}${q.content || ''} | 学生答：${q.studentAnswer || '—'} | 错因：${errType}${errReason}`
  }).join('\n')

  const systemContent = `你是一位有经验的 K12 ${subject} 老师，备一节「讲错题」的课。` +
    `你需要为这节课生成一份按时间分块的讲课脚本（总计 ${minutes} 分钟），每块包含：
- time: 时间段，如 "00:00-02:00"
- title: 步骤名（如"开场引入""讲错题 1"）
- detail: 1-2 句话描述这步做什么
- points: 列表，3-5 个要点（讲解顺序、强调点、互动话术）
- board: 板书要点（如果有公式/图形要写黑板）
- interaction: 互动话术（让 X 来回答、提问方式、谁来演示）

脚本要可直接照念，避免空话套话，重点把学生实际错的原因（来自错题）融进讲解。`

  const userContent = `【本节课】"${kpName}" 知识点（共性错题备课）

【本周典型错题】
${qLines || '（暂无错题）'}

【课时】${minutes} 分钟

请输出 JSON 数组，4-6 个时间块，结构如：
[
  {"time":"00:00-02:00","title":"...","detail":"...","points":["...","..."],"board":"...","interaction":"..."},
  ...
]

只输出 JSON 数组，不要其他说明。`

  try {
    const r = await callTextCompletion({
      systemContent,
      userContent,
      temperature: 0.6,
      maxTokens: 1400,
      responseFormat: 'json',
    })
    let script = parseScriptResponse(r.content)
    if (!Array.isArray(script) || script.length === 0) {
      script = buildFallbackScript({ kpName, sampleQuestions, minutes })
    } else {
      // 验证每块结构
      script = script
        .filter(s => s && (s.time || s.title))
        .map(s => ({
          time: String(s.time || '').trim(),
          title: String(s.title || '').trim(),
          detail: String(s.detail || '').trim(),
          points: Array.isArray(s.points) ? s.points.map(p => String(p)) : [],
          board: String(s.board || '').trim(),
          interaction: String(s.interaction || '').trim(),
        }))
    }
    _scriptCache.set(cacheKey, script)
    return script
  } catch (e) {
    console.warn(`[handoutScript] 生成失败 ${kpName}:`, e.message)
    const fb = buildFallbackScript({ kpName, sampleQuestions, minutes })
    _scriptCache.set(cacheKey, fb)
    return fb
  }
}

/**
 * 解析 AI 返回（兼容 ```json ... ``` 包裹）
 */
function parseScriptResponse(raw) {
  if (!raw) return null
  let s = String(raw).trim()
  // 去掉 markdown 包裹
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  try {
    return JSON.parse(s)
  } catch (e) {
    // 尝试找第一段 [...] 数组
    const m = s.match(/\[[\s\S]*\]/)
    if (m) {
      try { return JSON.parse(m[0]) } catch {}
    }
    return null
  }
}

/**
 * 兜底：本地生成 4 步脚本（不依赖 AI，保证主流程不卡）
 */
function buildFallbackScript({ kpName, sampleQuestions = [], minutes = 15 }) {
  const blankCount = sampleQuestions.filter(q => q.isBlank).length
  const total = sampleQuestions.length
  const timeForBlock = (i, n) => {
    const start = Math.round((minutes * i) / n)
    const end = Math.round((minutes * (i + 1)) / n)
    return `${pad2(start)}-${pad2(end)}`
  }
  const pad2 = (n) => String(n).padStart(2, '0')
  const blocks = []

  blocks.push({
    time: '00:00-' + pad2(Math.round(minutes * 0.13)),
    title: '开场引入',
    detail: `复习前置知识，引出本节"${kpName}"。`,
    points: [
      '提问：上节课谁还记得 X 的含义？',
      '板书：本节课核心词',
      '展示本周错题中该知识点的典型错',
    ],
    board: `${kpName} 的核心定义 / 公式`,
    interaction: '让 1 个学生口述上节内容',
  })

  if (total > 0) {
    blocks.push({
      time: blocks[blocks.length - 1].time.split('-')[1] + '-' + pad2(Math.round(minutes * 0.5)),
      title: `讲错题（${Math.min(total, 3)} 道）`,
      detail: `挑 ${blankCount > 0 ? '空题' : '错题'} 最有代表性的讲。`,
      points: [
        '原题展示（投影或手抄）',
        '不要直接给答案，先问学生卡在哪',
        '现场演示完整解题步骤',
        '邀请 1 个学生复述',
      ],
      board: '完整解题过程',
      interaction: '你来试着说说思路？',
    })
  }

  blocks.push({
    time: pad2(Math.round(minutes * 0.5)) + '-' + pad2(Math.round(minutes * 0.85)),
    title: '知识点延展',
    detail: `从错题抽象出"${kpName}"的本质。`,
    points: [
      '给出易错点 TOP 3',
      '讲解该知识点在不同题型中的变体',
      '强调"先讲什么、再讲什么"的逻辑链',
    ],
    board: '易错点对比 / 题型分类',
    interaction: '谁能举例说明 X 和 Y 的区别？',
  })

  blocks.push({
    time: pad2(Math.round(minutes * 0.85)) + `-${pad2(minutes)}`,
    title: '小结 + 留作业',
    detail: '回顾本节核心，布置 1-2 道巩固题。',
    points: [
      '本节我们学了 X',
      '关键步骤是 Y',
      '作业：完成 1-2 道同类型题',
    ],
    board: '本节核心一句话',
    interaction: '谁来说说今天最关键的一步？',
  })

  return blocks
}

export const _handoutScriptService = {
  generateLectureScript,
  buildFallbackScript,
}
