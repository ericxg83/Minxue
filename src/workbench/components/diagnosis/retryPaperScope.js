/**
 * 专项重练卷预览 · 纯逻辑层（r142）
 *
 * 为什么要抽出来：预筛与勾选是本轮的核心逻辑，且**必须能被真跑验证**。
 * 只写在 .vue 里就只能靠 grep 源码做锁 —— 那种锁看不见语义变化
 * （把 `>= 2` 改成 `> 2` 依然全绿）。这里把三件事提成纯函数：
 *
 *   normalizeWrongItems  错题行 → 候选题（同题去重 + 字段归一）
 *   inScope             预筛判据（错因 / 反复错 / 基本掌握）
 *   pickDefaults        打开弹窗时的默认勾选
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

/** 预筛判据。scope = { kind: 'error-cause' | 'repeat' | 'basic', errorType? } */
export function inScope(item, scope) {
  if (!item) return false
  const kind = scope?.kind
  if (kind === 'error-cause') return !!scope.errorType && item.errorType === scope.errorType
  if (kind === 'repeat') return item.errorCount >= 2
  if (kind === 'basic') return item.lifecycle === LIFECYCLE_STATUS.REVIEW_1 || item.lifecycle === LIFECYCLE_STATUS.REVIEW_2
  return true
}

/** 打开弹窗时的默认勾选：命中预筛的全部勾上（老师点开看到的就该是诊断页承诺的那 N 道） */
export function pickDefaults(items = [], scope) {
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
 * 组卷题单：剔除不可用项（question_id 为空的练习册自包含错题）。
 * @returns {{ questionIds: string[], dropped: number }}
 */
export function toExamQuestionIds(items = []) {
  const valid = (items || []).filter((it) => it?.questionId)
  return { questionIds: valid.map((it) => it.questionId), dropped: (items || []).length - valid.length }
}
