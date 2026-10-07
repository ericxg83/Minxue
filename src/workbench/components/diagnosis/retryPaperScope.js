/**
 * 专项重练卷预览 · 纯逻辑层（r142）
 *
 * 为什么要抽出来：预筛与勾选是本轮的核心逻辑，且**必须能被真跑验证**。
 * 只写在 .vue 里就只能靠 grep 源码做锁 —— 那种锁看不见语义变化
 * （把 `>= 2` 改成 `> 2` 依然全绿）。这里把三件事提成纯函数：
 *
 *   normalizeWrongItems  错题行 → 候选题（同题去重 + 字段归一）
 *   inScope             预筛判据（错因 / 反复错 / 基本掌握 / 定向重练）
 *   pickDefaults        打开弹窗时的默认勾选
 *   groupOf             定向重练里「主料 / 前置」分组（打标签与计数用）
 *
 * ⚠️ 口径提醒（别当成 bug）：
 *   「重练自动选题只放行 lifecycle='new'」是**系统自动组卷**的规矩；
 *   这里是人手挑题组卷 —— 老师明确勾的就是要练的，不受该限制。
 *
 * 字段来源与错题清单（WrongBookCenterRedesign）同源：自包含字段优先于 questions 表。
 */
import { LIFECYCLE_STATUS } from '../../stores/lifecycleStore.js'

const MAX_STEM = 96

/**
 * 错题行 → 候选题。
 * - 同一道题可能被记多条错题：按 question_id 去重，否则组出会重复题。
 * - question_id 为空的「练习册自包含错题」**保留**（key 用错题行 id）：
 *   它们进不了重练批改链路，但必须让老师看见「命中 49 道、其中 3 道组不进去」，
 *   静默吞掉会让口径失真。真正的排除发生在 toExamQuestionIds。
 */
export function normalizeWrongItems(list = []) {
  const seen = new Set()
  const out = []
  for (const wq of list || []) {
    const q = wq?.question || {}
    const questionId = wq?.question_id || ''
    if (questionId) {
      if (seen.has(questionId)) continue
      seen.add(questionId)
    }
    const stem = String(q.content || wq.content || '').replace(/\s+/g, ' ').trim()
    out.push({
      key: wq?.id || questionId,
      questionId,
      stem: stem.length > MAX_STEM ? `${stem.slice(0, MAX_STEM)}…` : stem || '（题干缺失）',
      subject: wq?.subject || q.subject || '',
      errorType: String(wq?.error_type || q.error_type || '').trim(),
      errorCount: wq?.error_count || q?.wrong_count || 1,
      lifecycle: wq?.lifecycle_status || ''
    })
  }
  return out
}

/** 预筛判据。scope = { kind: 'error-cause' | 'repeat' | 'basic' | 'weak-point', errorType?, questionIds?, prerequisiteQuestionIds? } */
export function inScope(item, scope) {
  if (!item) return false
  const kind = scope?.kind
  if (kind === 'error-cause') return !!scope.errorType && item.errorType === scope.errorType
  if (kind === 'repeat') return item.errorCount >= 2
  if (kind === 'basic') return item.lifecycle === LIFECYCLE_STATUS.REVIEW_1 || item.lifecycle === LIFECYCLE_STATUS.REVIEW_2
  // weak-point（定向重练）：题单由后端按考点**含子考点**算好，前端只认 id 归属，
  // 不自己按字段猜。两组都进候选列表 —— 前置组默认不勾（见 pickDefaults）。
  if (kind === 'weak-point') return !!item.questionId && idSet(scope).has(item.questionId)
  return true
}

/**
 * 题目在「定向重练」里属于哪一组（给列表打标签 / 计数用）：
 *   'main'         该薄弱考点（含子考点）上的错题 —— 默认勾选，这就是定向卷的主料
 *   'prerequisite' 前置考点上该生也做错过的题 —— 默认不勾，老师勾了才加入
 *   ''             不属于本卷（非 weak-point scope 也返回 ''）
 */
export function groupOf(item, scope) {
  if (!item || scope?.kind !== 'weak-point' || !item.questionId) return ''
  if (new Set((scope.questionIds || []).filter(Boolean)).has(item.questionId)) return 'main'
  if (new Set((scope.prerequisiteQuestionIds || []).filter(Boolean)).has(item.questionId)) return 'prerequisite'
  return ''
}

function idSet(scope) {
  return new Set([...(scope?.questionIds || []), ...(scope?.prerequisiteQuestionIds || [])].filter(Boolean))
}

/**
 * 打开弹窗时的默认勾选。
 * - 通用口径：命中预筛的全部勾上（老师点开看到的就该是诊断页承诺的那 N 道）
 * - ⛔ 定向重练（weak-point）例外：**只勾该考点自己的题**，前置考点那组必须老师主动勾 ——
 *   「前置考点未必是这次要练的」，默认替他决定就把卷子撑大了（2026-10-07 负责人拍板）。
 */
export function pickDefaults(items = [], scope) {
  if (scope?.kind === 'weak-point') {
    const main = new Set((scope.questionIds || []).filter(Boolean))
    return items.filter((it) => it?.questionId && main.has(it.questionId)).map((it) => it.key)
  }
  return items.filter((it) => inScope(it, scope)).map((it) => it.key)
}

/** 错因色阶：与错题清单同一套（计算类红 / 审题类黄 / 概念公式类蓝） */
export function errorTypeTone(errorType = '') {
  if (/计算|运算/.test(errorType)) return 'is-danger'
  if (/审题|单位/.test(errorType)) return 'is-warning'
  if (/公式|概念|步骤/.test(errorType)) return 'is-primary'
  return ''
}

/**
 * 候选里还差哪些「在卷的 id」—— 弹窗分页拉取的收敛判据。
 *
 * 为什么要它：定向重练的题单是后端按考点算好的，可能落在错题列表的很后面，
 * 而 `/wrong-questions/student/:id` 默认只返 100 条 ⇒ 一页拉不完就会
 * 「弹窗里少了几道」，而且**不报错**（静默口径不一致）。所以拉取循环必须
 * 以「在卷 id 全覆盖」为停止条件，而不是「拉到一页为止」。
 *
 * @returns {string[]} 还没拿到的 id（空数组 = 可以停了）
 */
export function missingScopeIds(items = [], scope) {
  if (scope?.kind !== 'weak-point') return []
  const got = new Set((items || []).map((it) => it?.questionId).filter(Boolean))
  const want = [...new Set([...(scope.questionIds || []), ...(scope.prerequisiteQuestionIds || [])].filter(Boolean))]
  return want.filter((id) => !got.has(id))
}

/**
 * 组卷题单：剔除不可用项（question_id 为空的练习册自包含错题）。
 * @returns {{ questionIds: string[], dropped: number }}
 */
export function toExamQuestionIds(items = []) {
  const valid = (items || []).filter((it) => it?.questionId)
  return { questionIds: valid.map((it) => it.questionId), dropped: (items || []).length - valid.length }
}
