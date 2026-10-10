/**
 * taskCacheKeys · 「任务列表缓存键」的唯一判据（2026-10-10 r253）
 *
 * ── 起因（缓存没被清掉，老师以为按钮没生效）──
 * 任务列表按**学生**缓存：键是 `tasks_cache_{studentId}`（见 apiService.getTasksByStudent）。
 * 但 `retryTask` / `convertTaskRoute` 过去清的是 `tasks_cache_{taskId}` —— 拿**任务 id** 拼了
 * **学生**的缓存键，这个键根本不存在 ⇒ 等于什么都没清。
 *
 * 后果（实测链路）：老师在工作台批改中心点「重新处理」/「改批改方式」后，
 * `GradeCenterWorkbench.loadData()` 紧接着走 `getTasksByStudent(studentId, useCache = true)`，
 * 命中 5 分钟内的旧缓存（CACHE_MAX_AGE.TASKS）⇒ 那一行状态不变、「重新处理」按钮还在，
 * 看着像没点上（服务端其实已经重新入队）。移动端同样吃这份缓存。
 *
 * ── 收敛方式 ──
 * 把「哪些键算任务列表缓存」收敛成唯一判据（本模块），清理逻辑与回归测试共用同一份，
 * 避免以后再出现「清错键」这类静默失效。
 */

/** 任务列表缓存的键前缀（按学生隔离）。 */
export const TASKS_CACHE_PREFIX = 'tasks_cache_'

/**
 * 这个 localStorage 键是不是「任务列表缓存」本体？
 * ⛔ `_ts` 兄弟键（`tasks_cache_x_ts`，写缓存时一并落下的写入时间）不算 ——
 *    它由 clearCache(key) 连带清除；把它也当成一个「本体」会重复清且语义混乱。
 */
export const isTasksCacheKey = (key) =>
  typeof key === 'string' && key.startsWith(TASKS_CACHE_PREFIX) && !key.endsWith('_ts')

/**
 * 从 localStorage 的全部键里挑出要清掉的任务列表缓存键。
 *
 * @param {string[]} keys  localStorage 的全部键（`Object.keys(localStorage)`）
 * @param {Object}   [opts]
 * @param {string}   [opts.taskId]        给了 taskId 就只清「缓存里确实含这道任务」的那几个学生缓存（精准）
 * @param {(key: string) => boolean} [opts.containsTask]
 *        判「某个缓存键的内容里含不含这道任务」；不给则退化为「清全部任务列表缓存」（保守兜底）。
 * @returns {string[]}  要清掉的键（不含 `_ts` 兄弟键，由 clearCache 连带清除）
 */
export function pickTasksCacheKeys(keys, { taskId = null, containsTask = null } = {}) {
  if (!Array.isArray(keys)) return []
  const out = []
  for (const key of keys) {
    if (!isTasksCacheKey(key)) continue
    // 给了 taskId 但没给判定函数 → 无法精准定位，退回清全部（宁可多刷一次，也不留旧列表）。
    if (taskId && typeof containsTask === 'function' && !containsTask(key)) continue
    out.push(key)
  }
  return out
}
