/**
 * paperBasket.js — 试卷题库「试题篮」（2026-10-21）
 *
 * 纯函数、零依赖（不 import 任何渲染/浏览器模块），供回归测试直接跑。
 * 版式在 composePaperPdf.js，本文件只管「选了什么题、怎么分大题、多少分」。
 *
 * ── 为什么不落库 ──
 * 试题篮是**一次组卷的临时选择**，不是长期资产。组卷产物是教学素材（出 PDF 打印），
 * 不是学习事实，因此：
 *   ⛔ 不写 generated_exams（那张表只允许来自 wrong_questions，见 AGENTS.md 第 10 条）；
 *   ⛔ 不新建表；篮子只活在页面状态里，关掉即散。
 * 将来若要「保存我的试卷」，需另开评审（会引入编辑态与版本问题，不是加张表就完事）。
 *
 * ── 与讲义的区别（两套版式方向相反，别混）──
 *   讲义（handoutPdf.js）   ：保留**原卷题号**、按卷分组 —— 老师讲的正是「第 19 题」；
 *   组卷（composePaperPdf.js）：**重新编号** 1..N、按题型分大题 —— 这是一份新卷子。
 *   两者共用本文件的题型定义，但编号口径完全不同。
 */

/**
 * 大题定义（顺序 = 卷面顺序）。
 * 默认分值按上海中考数学卷的常见配比：选择 4 分 / 填空 4 分 / 解答 10 分，
 * ⛔ 只是初始值，老师在篮子里逐题可改（不同卷型分值不同）。
 */
export const PAPER_BASKET_BLOCKS = [
  { key: 'choice', label: '选择题', defaultScore: 4 },
  { key: 'fill', label: '填空题', defaultScore: 4 },
  { key: 'judge', label: '判断题', defaultScore: 4 },
  { key: 'answer', label: '解答题', defaultScore: 10 },
]

const BLOCK_KEYS = new Set(PAPER_BASKET_BLOCKS.map(b => b.key))
const BLOCK_DEF = new Map(PAPER_BASKET_BLOCKS.map(b => [b.key, b]))

/** 题型归一到四个大题（未知一律解答题，与 paperBankService.normalizeQuestionType 同口径）。 */
export function normalizeBasketType(t) {
  const v = String(t || '').trim().toLowerCase()
  return BLOCK_KEYS.has(v) ? v : 'answer'
}

export function defaultScoreForType(t) {
  return BLOCK_DEF.get(normalizeBasketType(t))?.defaultScore ?? 4
}

/** 该题型在卷面大题里的中文名（「选择题」）。 */
export function basketBlockLabel(t) {
  return BLOCK_DEF.get(normalizeBasketType(t))?.label || '解答题'
}

/**
 * 分值归一：空值/非数字/负数 → 回落默认值；保留一位小数（允许 2.5 这种半分）。
 * ⚠ `Number('')` 是 0（有限且非负），所以空串必须**先**判掉，
 * 否则老师把输入框清空会变成「这题 0 分」，卷面总分凭空少 4 分。
 */
export function normalizeScore(value, questionType) {
  if (value == null || value === '') return defaultScoreForType(questionType)
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return defaultScoreForType(questionType)
  return Math.round(n * 10) / 10
}

const asArray = (v) => (Array.isArray(v) ? v : [])

/**
 * 把一行 resource_questions 转成篮子项。
 * ⛔ 只做字段搬运 + 分值归一，不改题干、不推断答案 —— 「答案一定要对，不要去猜」。
 * @param {object} q
 * @param {number} [score] 不传则按题型取默认分
 */
export function createBasketItem(q, score) {
  const src = q || {}
  const type = normalizeBasketType(src.question_type)
  return {
    id: src.id,
    question_type: type,
    question_no: src.question_no == null ? null : Number(src.question_no),
    sub_no: src.sub_no == null ? '' : String(src.sub_no),
    parent_stem: src.parent_stem || null,
    content: src.content || '',
    options: asArray(src.options),
    answer: src.answer == null || String(src.answer).trim() === '' ? null : String(src.answer),
    answer_source: src.answer_source || null,
    analysis: src.analysis || null,
    image_url: src.image_url || null,
    resource_id: src.resource_id || null,
    resource_name: src.resource_name || '',
    difficulty: src.difficulty == null ? null : Number(src.difficulty),
    tags: asArray(src.tags),
    score: normalizeScore(score, type),
  }
}

/** 是否已在篮子里（按题目 id，禁止重复加入同一道题）。 */
export function isInBasket(items, questionId) {
  return asArray(items).some(it => it.id === questionId)
}

/** 加入（已存在则原样返回，幂等）。 */
export function addBasketItem(items, q, score) {
  const list = asArray(items)
  if (!q || q.id == null || isInBasket(list, q.id)) return list.slice()
  return list.concat(createBasketItem(q, score))
}

/** 移除。 */
export function removeBasketItem(items, questionId) {
  return asArray(items).filter(it => it.id !== questionId)
}

/**
 * 改分。
 * ⛔ 只接受篮子内已有的题；改不存在的 id 不改动数组（避免拼错 id 时静默插一条空题）。
 */
export function setBasketItemScore(items, questionId, score) {
  return asArray(items).map(it => (
    it.id === questionId ? { ...it, score: normalizeScore(score, it.question_type) } : it
  ))
}

/**
 * 在**同一题型内**上移/下移一位。
 *
 * 为什么只在同题型内动：卷面按题型分大题渲染，跨题型拖动在视觉上等于没动
 * （渲染时会按大题重新归位），会让人以为拖动失灵。跨题型的顺序由大题顺序决定。
 * @param {number} delta -1 上移 / +1 下移
 */
export function moveBasketItem(items, questionId, delta) {
  const list = asArray(items).slice()
  const idx = list.findIndex(it => it.id === questionId)
  if (idx < 0) return list
  const type = normalizeBasketType(list[idx].question_type)
  let target = idx + (delta < 0 ? -1 : 1)
  while (target >= 0 && target < list.length && normalizeBasketType(list[target].question_type) !== type) {
    target += delta < 0 ? -1 : 1
  }
  if (target < 0 || target >= list.length) return list
  const [moved] = list.splice(idx, 1)
  list.splice(target, 0, moved)
  return list
}

/**
 * 按题型分大题，并把「同一道大题的多个小问」收成一个题组，再**重新编号** 1..N。
 *
 * 为什么要收题组：卷面上的 20(1)/20(2) 共用一段公共题干（parent_stem）。
 * 老师两问都选进篮子时，如果按两条独立题目排，公共题干会被印两遍 ——
 * 卷面立刻显得业余，而且题号会平白多出一号。
 * 收组判据：**相邻**且 `resource_id + question_no` 相同且带 parent_stem。
 * （不跨题型、不跨卷，也不做「同题合并」推断 —— 身份就是这两个字段。）
 *
 * @returns {Array<{
 *   key:string, label:string, count:number, score:number,
 *   groups:Array<{ no:number, parent_stem:string|null, score:number,
 *                  items:Array<object & {sub_label:string}> }>
 * }>}
 */
export function groupBasket(items) {
  const list = asArray(items)
  const out = []
  let seq = 0
  for (const def of PAPER_BASKET_BLOCKS) {
    const picked = list.filter(it => normalizeBasketType(it.question_type) === def.key)
    if (!picked.length) continue

    const groups = []
    for (const it of picked) {
      const prev = groups[groups.length - 1]
      const sameStem = prev
        && it.parent_stem
        && prev.parent_stem
        && prev.items[0].resource_id === it.resource_id
        && prev.items[0].question_no === it.question_no
      if (sameStem) prev.items.push(it)
      else groups.push({ parent_stem: it.parent_stem || null, items: [it] })
    }

    for (const g of groups) {
      g.no = ++seq
      const multi = g.items.length > 1
      g.items = g.items.map((it, i) => ({
        ...it,
        sub_label: multi ? `${g.no}(${i + 1})` : `${g.no}`,
      }))
      g.score = Math.round(g.items.reduce((s, q) => s + (Number(q.score) || 0), 0) * 10) / 10
    }

    out.push({
      key: def.key,
      label: def.label,
      groups,
      count: picked.length,
      score: Math.round(groups.reduce((s, g) => s + g.score, 0) * 10) / 10,
    })
  }
  return out
}

/** 组卷后的总题量 / 大题数 / 总分（卷头用）。 */
export function composePaperTotals(blocks) {
  const bs = asArray(blocks)
  return {
    questionCount: bs.reduce((n, b) => n + (b.count || 0), 0),
    blockCount: bs.length,
    totalScore: Math.round(bs.reduce((n, b) => n + (b.score || 0), 0) * 10) / 10,
  }
}

/**
 * 篮子概况：题量、总分、各题型分布、缺答案数。
 * 缺答案数要显式给出来 —— 教师卷里那几题会印「未录入」，不能让人以为是系统漏了。
 */
export function basketSummary(items) {
  const list = asArray(items)
  const byType = {}
  let totalScore = 0
  for (const def of PAPER_BASKET_BLOCKS) byType[def.key] = { count: 0, score: 0 }
  for (const it of list) {
    const type = normalizeBasketType(it.question_type)
    const score = Number(it.score) || 0
    byType[type].count += 1
    byType[type].score = Math.round((byType[type].score + score) * 10) / 10
    totalScore += score
  }
  return {
    count: list.length,
    totalScore: Math.round(totalScore * 10) / 10,
    byType,
    missingAnswer: list.filter(it => !it.answer).length,
  }
}

/**
 * 出卷文件名：`<标题>_<题量>题_<日期>`。
 * 日期由调用方传入（纯函数不做时钟依赖，便于测试）。
 */
export function composePaperFilename(title, count, dateStr) {
  const base = String(title || '组卷').trim() || '组卷'
  const parts = [base]
  if (Number.isFinite(Number(count)) && Number(count) > 0) parts.push(`${Number(count)}题`)
  if (dateStr) parts.push(String(dateStr))
  return parts.join('_')
}
