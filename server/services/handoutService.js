import { callTextCompletion } from '../config/ai.js'
import { getQuestionKnowledge } from './knowledgeService.js'
import { getTemplate, pickTemplateBySubject, listTemplates } from './handoutTemplates/index.js'

// ============================================================
// 讲义引擎服务（handoutService）
//
// 职责：
//   1. AI 生成知识点讲解文本（供讲义"知识讲解"部分使用）
//   2. 按"模板"组装讲义内容：知识讲解 → 典型例题（错题取样）→ 变式练习
//   3. 供前端 Web 预览页和 Word 导出共用
//
// 模板系统（P8）：buildHandout({ template: 'default' | 'exam_review' | 'wrong_review' | 'english_default', ... }）
// 模板由 handoutTemplates/ 提供，详情见模板目录。
//
// 讲解缓存（P3/P8 性能）：相同 (kpName, subject) 的 AI 讲解在同一进程内复用，
// 避免 12 个知识点串行调 AI 拖慢 from-diagnosis（30s+ 经常超时）。
// 缓存以 LRU 形式控制大小，进程重启后失效。
// ============================================================

// 讲解缓存：key=`${subject}::${kpName}`，value=讲解文本；LRU 上限 256 条
const _explanationCache = new Map()
const EXPLANATION_CACHE_MAX = 256

/**
 * AI 生成知识点的讲解文本（详讲版，500-800 字 → 1-2 页）。
 * 覆盖：核心定义 / 关键概念 / 常见错误 / 考点 / 解题思路 / 记忆技巧。
 * @param {string} kpName 知识点名称（如"相似三角形"）
 * @param {string} subject 学科
 * @returns {Promise<string>} 讲解 Markdown 文本
 */
export async function generateKnowledgeExplanation(kpName, subject = '数学') {
  if (!kpName) return ''

  // ── 缓存命中：跳过 AI 调用 ──
  const cacheKey = `${subject}::${kpName}::detailed`
  if (_explanationCache.has(cacheKey)) {
    return _explanationCache.get(cacheKey)
  }

  const prompt = {
    systemContent: `你是一位经验丰富的 K12 ${subject}老师。请为"${kpName}"这个知识点写一段**详讲**，目标长度 500-800 字（约 1-2 页讲义）。

要求结构（用 Markdown 标题分层）：
1. **核心定义**：用 1-2 句话说清这个知识点是什么。
2. **关键概念/要素**：列出 3-5 个关键概念或判断准则（用列表）。
3. **常见错误/易错点**：列出 3 个学生最常犯的错误（用列表，每项简短说明）。
4. **典型考法/考点**：列出 2-3 个常见考法方向。
5. **解题思路/步骤**：用 1-2 段说明遇到这类题时怎么思考、怎么落笔。
6. **记忆技巧**：给 1 个口诀或记忆方法。

内容要适合初中生理解，不要过于学术化。可用 Markdown 加粗/列表。`,
    userContent: `请为知识点「${kpName}」撰写一段详讲（${subject}学科），500-800 字。`,
  }

  let text
  try {
    const result = await callTextCompletion({
      systemContent: prompt.systemContent,
      userContent: prompt.userContent,
      temperature: 0.5,
      maxTokens: 1500,
    })
    text = (result.content || '').trim()
  } catch (err) {
    console.warn(`  ⚠️ [Handout] 知识点讲解生成失败 ${kpName}:`, err.message)
    text = `## ${kpName}\n\n*（知识点讲解暂不可用，请参考教材相关内容）*`
  }

  // ── 写入缓存（LRU：超出上限时删最旧） ──
  if (_explanationCache.size >= EXPLANATION_CACHE_MAX) {
    const firstKey = _explanationCache.keys().next().value
    if (firstKey) _explanationCache.delete(firstKey)
  }
  _explanationCache.set(cacheKey, text)
  return text
}

/**
 * AI 归纳"本知识点换着样考的题型"（题型归纳页用）。
 * 基于本周错题样本，让 AI 反推出本知识点还会怎么考。
 * @param {string} kpName
 * @param {string} subject
 * @param {Array} sampleQuestions 错题样本（按题型聚合）
 * @returns {Promise<Array<{type, description, example, tip}>>}
 */
export async function generateQuestionTypeSummary(kpName, subject = '数学', sampleQuestions = []) {
  if (!kpName) return []

  const cacheKey = `${subject}::${kpName}::types::${sampleQuestions.length}`
  if (_explanationCache.has(cacheKey)) {
    return _explanationCache.get(cacheKey)
  }

  // 压缩错题样本为提示词（只取题型 + 错因 + 内容前 30 字）
  const questionDigest = sampleQuestions.slice(0, 8).map((q, i) =>
    `${i + 1}. [${q.questionType || '其他'}] ${(q.content || '').slice(0, 60)}${q.content && q.content.length > 60 ? '...' : ''} (${q.isBlank ? '空题' : '错题'})`
  ).join('\n')

  const prompt = {
    systemContent: `你是一位经验丰富的 K12 ${subject}老师，正在备课。基于"${kpName}"这个知识点的本周错题样本，请归纳这个知识点在**真实考试里会怎么考**的题型（3-5 种），帮老师提前预判考试方向与学生易错点。

输出 JSON 数组（不要任何额外说明文字），每条结构：
[
  {
    "type": "题型名，用「知识点 + 具体考法」命名（如：一元一次方程 - 应用题 / 一元一次方程 - 含参方程求根 / 一元一次方程 - 配套问题）",
    "description": "一句话说这种题型在考试里怎么出、考什么、通常出现在选择/填空/解答哪一类",
    "example": "用 1 句话给一道贴合中考难度的典型题干（只给题干，不要给答案）",
    "tip": "一句话给学生的解题策略 / 给老师的讲解要点"
  }
]

要求（考试导向，务必遵守）：
- 至少 3 种，至多 5 种；按「考试出现频率/重要性」排序（最常考的排最前）。
- type 命名必须"知识点 + 题型/考法"组合，让老师一眼定位（如"一元一次方程 - 移项去括号"而非笼统的"方程题"）。
- 必须覆盖：① 错题样本里实际出现过的题型；② 该知识点在中考/升学考试里常考、但样本里没有的延伸题型（这是最该补的）。
- description 要落到具体考法（怎么变形、怎么设问、常见坑），不要泛泛而谈。
- example 用于老师课堂举例，难度贴合该学段真实考试。
- 严禁编造题目无法成立的考法；严格按该知识点真实考纲范围。`,
    userContent: `知识点：${kpName}（${subject}）

本周错题样本：
${questionDigest || '（暂无错题样本，请基于该知识点中考/升学常见考法推断）'}

请输出 JSON 数组。`,
  }

  let types = []
  try {
    const result = await callTextCompletion({
      systemContent: prompt.systemContent,
      userContent: prompt.userContent,
      temperature: 0.6,
      maxTokens: 800,
    })
    let raw = (result.content || '').trim()
    // 兜底：AI 偶发包成 ```json ... ```
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/\[[\s\S]*\]/)
    if (jsonMatch) raw = jsonMatch[1] || jsonMatch[0]
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      types = parsed.filter(t => t && t.type).slice(0, 5)
    }
  } catch (err) {
    console.warn(`  ⚠️ [Handout] 题型归纳生成失败 ${kpName}:`, err.message)
    // 兜底：基于错题样本中实际出现过的题型回退
    const seen = new Map()
    for (const q of sampleQuestions) {
      const t = q.questionType || '其他'
      seen.set(t, (seen.get(t) || 0) + 1)
    }
    types = Array.from(seen.entries()).slice(0, 3).map(([type, count]) => ({
      type,
      description: `本周出现 ${count} 次错题`,
      example: '',
      tip: '',
    }))
  }

  if (_explanationCache.size >= EXPLANATION_CACHE_MAX) {
    const firstKey = _explanationCache.keys().next().value
    if (firstKey) _explanationCache.delete(firstKey)
  }
  _explanationCache.set(cacheKey, types)
  return types
}

/**
 * 列出所有可用讲义模板（供前端下拉用）
 * @param {string} [subjectFilter]
 */
export function listHandoutTemplates(subjectFilter = null) {
  return listTemplates(subjectFilter)
}

/**
 * 为单个知识点组装讲义内容块。
 * P0 之后讲义定位为"老师备课用"，模板内部已完成"页内按题型分组"，
 * 本函数只负责调模板生成 blocks（不再生成变式题）。
 * @param {Object} params
 * @param {string} params.kpName 知识点名称
 * @param {string} params.subject 学科
 * @param {Array} params.sampleQuestions 典型错题 [{content, options, imageUrls, studentAnswer, correctAnswer, isBlank, errorType, errorReason, studentName, questionType}]
 * @param {string} params.explanation 可选，若已提前生成则传入
 * @param {string} [params.template] 模板 id；缺省走学科兜底
 * @returns {Promise<Array<{name, blocks}>>} 讲义页面列表（多页：知识点 / 例题 / 题型归纳）
 *          兼容老格式：若模板返回 blocks 数组则包装成单页 [{ name: kpName, blocks }]
 */
export async function buildKnowledgeSection({ kpName, subject = '数学', sampleQuestions = [], explanation = null, template = null }) {
  // 选模板：显式传入 > 学科兜底 > lecture_prep
  const tpl = getTemplate(template) || pickTemplateBySubject(subject) || getTemplate('lecture_prep')
  if (!tpl) {
    // 极端兜底：模板系统坏了返回空数组
    console.warn(`[Handout] 未找到任何讲义模板 (template=${template}, subject=${subject})`)
    return []
  }
  const result = await tpl.buildSections({ kpName, subject, sampleQuestions, explanation })
  // 新格式：{ pages: [{ name, blocks }] }，多页结构（知识点 / 例题 / 题型归纳）
  if (result && Array.isArray(result.pages)) {
    return result.pages
  }
  // 老格式：blocks 数组，包装成单页
  if (Array.isArray(result)) {
    return [{ name: kpName, blocks: result }]
  }
  return []
}

/**
 * 组装完整讲义数据（供 Web 预览和 Word 导出共用）。
 * @param {Object} params
 * @param {string} params.title 讲义标题
 * @param {string} params.subject 学科
 * @param {string} params.periodText 时间范围文本
 * @param {Array<{kpName, subject, sampleQuestions, explanation}>} params.knowledgeSections 知识点列表
 * @param {string} [params.template] 模板 id（缺省按学科兜底）
 * @returns {Object} 讲义数据结构
 */
export async function buildHandout({ title, subject = '数学', periodText = '', knowledgeSections = [], template = null }) {
  const pages = []

  // 选模板（封面也会用模板 label）
  const tpl = getTemplate(template) || pickTemplateBySubject(subject) || getTemplate('lecture_prep')
  const templateLabel = tpl ? tpl.label : '备课讲义'

  // 封面
  pages.push({
    name: 'cover',
    blocks: [
      { type: 'cover-title', content: title },
      { type: 'cover-subtitle', content: `学科：${subject}` },
      { type: 'cover-info', content: `时间范围：${periodText || '全部'}` },
      { type: 'cover-info', content: `讲义模板：${templateLabel}` },
      { type: 'cover-date', content: `生成日期：${new Date().toLocaleDateString('zh-CN')}` },
    ],
  })

  // 目录页：每个知识点展开 3 个子项（知识点 / 例题 / 题型归纳）
  const tocItems = []
  knowledgeSections.forEach((ks, idx) => {
    const base = idx + 1
    tocItems.push({ index: base, name: ks.kpName, sub: null })
    tocItems.push({ index: `${base}.1`, name: '知识点', sub: true })
    tocItems.push({ index: `${base}.2`, name: '例题（本周错题）', sub: true })
    tocItems.push({ index: `${base}.3`, name: '题型归纳', sub: true })
  })
  pages.push({
    name: 'toc',
    blocks: [
      { type: 'section', content: '目录' },
      ...tocItems.map(item => ({
        type: 'toc-item',
        content: `${item.index}. ${item.name}`,
        sub: !!item.sub,
      })),
    ],
  })

  // 每个知识点可能生成多页（知识点 / 例题 / 题型归纳）。
  // 分批并发生成 AI 讲解（避免触发上游限流）。
  // 全并发 12 个常被摩搭/Qwen 限速,反而比串行还慢;每批 3 个 + LRU 跨请求缓存可
  // 把首跑从 84s 降到 ~30s,二跑走缓存降到 <10s。
  const BATCH_SIZE = 3
  const kpResults = []
  for (let i = 0; i < knowledgeSections.length; i += BATCH_SIZE) {
    const batch = knowledgeSections.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map(async (ks, batchIdx) => {
        const idx = i + batchIdx
        const kpPages = await buildKnowledgeSection({
          kpName: ks.kpName,
          subject: ks.subject || subject,
          sampleQuestions: ks.sampleQuestions || [],
          explanation: ks.explanation || null,
          template,
        })
        return { idx, kpName: ks.kpName, kpPages }
      })
    )
    kpResults.push(...batchResults)
  }
  kpResults.sort((a, b) => a.idx - b.idx)
  for (const r of kpResults) {
    // 模板可返回 0-N 页：每页直接追加到主 pages 数组。
    // page.name 已经会通过 HandoutPreview 的 <h2 class="page-title"> 渲染，无需再加 page-title block。
    for (const p of (r.kpPages || [])) {
      pages.push({
        name: p.name || r.kpName,
        blocks: p.blocks || [],
      })
    }
  }

  return {
    title,
    subject,
    periodText,
    template: tpl ? tpl.id : 'default',
    templateLabel,
    pages: pages.map(p => ({ ...p, blocks: sanitizeBlocks(p.blocks) })),
    generatedAt: new Date().toISOString(),
  }
}

// ============================================================
// 防御性过滤：去掉任何含老版字样（变式改写/强化训练/独立完成 等）的 block
//
// 历史背景：旧版讲义模板会输出"变式改写 / 强化训练"块，用户已明确表示
// 不要变式题、不要题库化训练。模板已删除这些 block，但以下两种情况仍会漏出：
//   1. Render 还在跑旧版代码（部署延迟）
//   2. AI 讲解中输出了"建议独立完成"等变式题相关字样
// 本函数做最后一道兜底——所有 block.content / block.title 包含禁用关键词时丢弃。
// 涉及块类型：section、type-section、question、analysis、lecture-guidance、text、note
// ============================================================
const FORBIDDEN_BLOCK_KEYWORDS = [
  '变式改写', '强化训练', '变式题与', '以下变式题', '建议独立完成',
  '同类题练习', '同考点变式', '变式练习', '举一反三', '拓展训练',
  '强化提升', '错题重练', '再做一遍', '巩固练习',
]

function blockText(b) {
  if (!b) return ''
  return [b.content, b.title, b.subtitle].filter(Boolean).join(' ').toString()
}

function blockHasForbiddenKeyword(b) {
  const text = blockText(b)
  if (!text) return false
  return FORBIDDEN_BLOCK_KEYWORDS.some(kw => text.includes(kw))
}

export function sanitizeBlocks(blocks) {
  if (!Array.isArray(blocks)) return blocks
  return blocks.filter(b => !blockHasForbiddenKeyword(b))
}