/**
 * 「这个失败任务，系统还会不会自己救回来？」—— 前端唯一口径（2026-10-04 第 90 轮）
 *
 * 起因：自动重试其实一直在跑（`server/pendingTaskRecovery.js`，5 分钟一轮），但任务失败后
 * 到下次扫描之前（最长 5 分钟；配额/限流类要等到第二天）会一直以「识别异常 / 重新上传」示人。
 * 老师看到红色就点，既白等，又和服务端的自动重捞撞车 —— 同一份作业处理两遍、重复烧配额。
 *
 * 正解不是加一句「系统会自动重试」的提示（那还是把活推给老师），而是**这类任务根本不该
 * 显示成失败**：它在界面上的身份就是"还在处理"。
 *
 * ⛔ 判定不在前端算。服务端 `pendingTaskRecovery.js#describeAutoRetry` 是唯一实现，
 *    随任务列表（`/api/tasks/student/:id` 的 `auto_retry`）与通知摘要（`autoRetry`）下发。
 *    前端再判一套（比如自己看 retry_count < 3）必然漂移：列表说会自愈、扫描其实已放弃。
 * ⛔ 缺字段一律按「不是自愈」处理 —— 老缓存（localStorage 里的 tasks_cache_*）、老接口
 *    在升级瞬间都会缺这个字段，宁可多显示一次失败，也不能把真失败藏起来。
 *
 * 三个入口共用本模块：移动端任务页 `pages/ProcessingPage.jsx`、移动端首页
 * `components/HomeDashboardV2.jsx`、PC 批改中心 `workbench/views/GradeCenterWorkbench.vue`。
 */

/** 服务端下发的原始状态：'' | 'n/a' | 'retrying' | 'quota-wait' | 'gave-up' | 'blocked' */
export function autoRetryState(task) {
  const s = task?.auto_retry?.state ?? task?.autoRetry?.state
  return typeof s === 'string' ? s : ''
}

/**
 * 系统还会自己救（自动重试排队中 / 等配额跨日重置）⇒ 不要显示成失败。
 * 只有服务端明确说 `willRetry === true` 才算，缺字段不算。
 */
export function isSelfHealing(task) {
  const flag = task?.auto_retry?.willRetry ?? task?.autoRetry?.willRetry
  return flag === true
}

/** 该不该给老师看「失败」：状态是 failed 且系统不再自己救 */
export function isFailedForTeacher(task) {
  return task?.status === 'failed' && !isSelfHealing(task)
}

/**
 * 自愈中那一行该怎么描述（**不出现"重试"字样** —— 老师不需要知道系统内部在做什么，
 * 只需要知道"这活还在，不用你管"）。
 * 配额类例外：它要等一整天，若也写「正在处理」会像卡死，所以说清是等 AI 服务恢复。
 */
export function selfHealingNote(task) {
  return autoRetryState(task) === 'quota-wait'
    ? 'AI 服务额度已用满，恢复后自动继续'
    : '正在处理'
}
