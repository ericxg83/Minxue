/**
 * chapterTaggingService.js — 好题甄选的 AI 教材章节归类（2026-11-17）
 *
 * 职责：读甄选题题干 → 调现成 callTextCompletion → 从静态教材目录里挂多个章节节点 id。
 *
 * 设计要点（评审定稿）：
 *   1. 章节轴 = 静态教材目录 textbookCatalog.js（不是知识点，也不是题集名）；
 *   2. 一道综合题可挂多个章节（好题多是考点丰富的难题，单章归档会丢信息）；
 *   3. ⛔ 严格校验：AI 只能返回目录里存在的节点 id，编造的一律丢弃；
 *   4. 只写甄选表 chapter_ids，不碰任何题目表；
 *   5. 单条失败不影响整批，失败的留空由老师核对。
 */
import { callTextCompletion } from '../config/ai.js'
import { TEXTBOOK_CATALOG } from '../config/textbookCatalog.js'

/** 把静态目录拍平成「id → 名称」候选清单，给 AI 选。只给章/节级，不给课时级（太多、太细）。 */
export function buildChapterCandidates(grade) {
  const catalog = TEXTBOOK_CATALOG.find(c => c.grade === grade)
  if (!catalog) return []
  return catalog.nodes
    .filter(n => n.parentId && !/-s\d+-\d+$/.test(n.id))  // 排除课时级 g9-c27-s2-1 这类
    .map(n => ({ id: n.id, name: n.name }))
}

/** AI 输出 → 合法节点 id 数组；只保留目录里真实存在的 id，去重，最多 4 个。 */
export function parseChapterIds(raw, candidates) {
  let arr = []
  if (Array.isArray(raw)) arr = raw
  else if (typeof raw === 'string') {
    try { arr = JSON.parse(raw) } catch { arr = raw.split(/[,，、]/).map(s => s.trim()).filter(Boolean) }
  }
  const valid = new Set(candidates.map(c => c.id))
  const out = []
  for (const item of arr) {
    const id = typeof item === 'string' ? item : (item?.id ?? item?.chapter_id)
    if (id && valid.has(id) && !out.includes(id)) out.push(id)
    if (out.length >= 4) break
  }
  return out
}

/**
 * 高频误挂章节的关键词硬门槛（2026-11-17 全量实测后加）。
 * 原因：AI 看到题里有「60°/直角/三角形」就把「锐角三角比」挂上，但这些几何题并不考 sin/cos/tan。
 * ⛔ 确定性规则优先于 prompt：没有明确关键词，一律不挂这几个章节。
 */
const CHAPTER_KEYWORD_GATE = {
  'g9-c27': /抛物线|二次函数|y\s*=\s*a[xi]|函数图像|顶点坐标|对称轴/i,
  'g9-c29': /sin|cos|tan|锐角三角比|三角函数|坡度|仰角|俯角|正弦|余弦|正切/i,
  'g9-c30': /三视图|主视图|左视图|俯视图|投影|视图/i,
  'g8-c21': /一元二次方程|x².*=.*0|配方法|公式法|判别式|根与系数/i,
  'g8-c22': /二次根式|√|根号|有理化/i,
  'g8-c20': /平均数|中位数|众数|方差|频数|统计|概率/i,
}

function applyKeywordGate(chapterIds, stem, grade) {
  return chapterIds.filter(cid => {
    const gate = CHAPTER_KEYWORD_GATE[cid]
    if (!gate) return true
    return gate.test(String(stem || ''))
  })
}

/**
 * 给单道题挂章节。返回 {chapterIds, grade, error?}。
 * @param {object} q 甄选题（含 content/parentStem/resourceName）
 * @param {string} grade 年级（初二/初三），决定用哪套目录
 */
export async function tagQuestionChapters(q, grade = '初三') {
  const candidates = buildChapterCandidates(grade)
  if (!candidates.length) return { chapterIds: [], grade, error: `未维护「${grade}」教材目录` }

  const stem = [q?.parentStem, q?.content].filter(Boolean).join(' ').slice(0, 900)
  if (!stem.trim()) return { chapterIds: [], grade }

  const list = candidates.map(c => `${c.id} = ${c.name}`).join('\n')
  const systemContent = [
    '你是上海五四制初中数学教材分类助手。任务：判断一道题涉及哪几个教材章节。',
    '规则：只挂题干里【有明确线索】的章节。好题虽是综合题，但不要广撒网——',
    '  • 挂「二次函数」必须有函数/抛物线/y=ax²/图像等线索；纯几何题不要挂。',
    '  • 挂「锐角三角比」必须有 sin/cos/tan/三角函数/坡度等线索。',
    '  • 挂「投影与视图」必须有视图/投影/三视图线索；一般几何题不要挂。',
    '  • 「相似三角形」需有相似/比例/平行线截线段等线索；「全等三角形」需有全等/SSS/SAS 等。',
    '一道题通常挂 1~2 章，最多 3 章；不确定就少挂，宁缺勿滥。',
    '只能从下面的章节清单里选，返回节点 id，不得编造清单外的 id。',
    '只输出 JSON 数组，形如 ["g9-c28"]。',
    '',
    '章节清单：',
    list,
  ].join('\n')

  try {
    const { content } = await callTextCompletion({
      systemContent,
      userContent: `题目：\n${stem}\n\n请返回涉及的教材章节 id 数组。`,
      temperature: 0.1,
      maxTokens: 200,
      preferredVendor: process.env.BACKFILL_TEXT_VENDOR || undefined,
    })
    const ids = parseChapterIds(content, candidates)
    const gated = applyKeywordGate(ids, stem, grade)
    return { chapterIds: gated, grade, rawIds: ids }
  } catch (e) {
    return { chapterIds: [], grade, error: e?.message || String(e) }
  }
}
