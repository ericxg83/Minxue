/**
 * 「任务状态变了，任务列表缓存没被清掉」回归锁（2026-10-10 r253，兜底脉冲 → 移动端/工作台共用层）
 *
 * ── 缺陷（实测链路，非推理）──
 * 任务列表按**学生**缓存：键 `tasks_cache_{studentId}`（见 `apiService.getTasksByStudent`）。
 * 而 `retryTask` / `convertTaskRoute` 过去清的是 `clearCache(\`tasks_cache_${taskId}\`)` ——
 * 拿**任务 id** 拼了**学生**的缓存键，这个键永远不存在 ⇒ 等于什么都没清。
 *
 * 后果：老师在工作台批改中心点「重新处理」（或「改批改方式」）后，
 * `GradeCenterWorkbench.handleRetryTask` → `loadData()`（默认 force=false）
 * → `getTasksByStudent(studentId, useCache=true)` 命中 5 分钟内的旧缓存
 * （`CACHE_MAX_AGE.TASKS`）⇒ 那一行状态不变、「重新处理」按钮还在，看着像没点上
 * （服务端其实已经重新入队）。移动端共用同一份缓存，同样吃这个亏。
 *
 * ── 本锁两层 ──
 *   ① 行为层：真跑 `src/services/taskCacheKeys.js` 的键判据（纯函数，不依赖 localStorage）；
 *   ② 接线层：`apiService.js` 的 `retryTask` / `convertTaskRoute` 必须走 `clearTasksCacheForTask`，
 *      且不得再出现 `tasks_cache_${taskId}` 这种错键写法。
 *
 * ── 反向自检 ──
 * 把**修复前**那两段真实写法喂给同一把判据（`badClearSites`），必须判红 —— 证明不是空锁。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { anchoredRange } from './sourceLockKit.mjs'
import {
  TASKS_CACHE_PREFIX,
  isTasksCacheKey,
  pickTasksCacheKeys,
} from '../src/services/taskCacheKeys.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const API_SRC = readFileSync(resolve(ROOT, 'src/services/apiService.js'), 'utf8')
const KEYS_SRC = readFileSync(resolve(ROOT, 'src/services/taskCacheKeys.js'), 'utf8')
const LABEL = 'apiService 任务缓存失效'

/**
 * 错键写法：`clearCache(`tasks_cache_${taskId}`)` —— 任务 id 被当成学生 id 拼缓存键。
 * 只匹配 `clearCache(` 紧跟反引号的实调用，**不匹配注释里的说明文字**（r234：门禁语料别被注释骗了）。
 */
const WRONG_CLEAR_RE = /clearCache\(\s*[`'"]tasks_cache_\$\{taskId\}/

/** 待审的两个函数：[名字, 起点锚点, 终点锚点]。 */
const SITES = [
  ['retryTask', 'export const retryTask =', 'export const convertTaskRoute'],
  ['convertTaskRoute', 'export const convertTaskRoute =', 'const parseQuestionFields'],
]

/**
 * 扫一份 apiService 源码，返回「还在写错键」的违规清单。纯函数，便于反向自检喂合成样本。
 * @returns {string[]}
 */
function badClearSites(src) {
  const fails = []
  for (const [name, from, to] of SITES) {
    const seg = anchoredRange(src, from, to, `${LABEL}#${name}`, fails)
    if (seg !== null && WRONG_CLEAR_RE.test(seg)) {
      fails.push(
        `${LABEL}#${name}：又出现 \`tasks_cache_\${taskId}\` 错键写法（拿任务 id 拼学生缓存键，等于没清）`
      )
    }
  }
  return fails
}

// ───────────────────────── ① 行为层：键判据真跑 ─────────────────────────

test('键判据：只认 tasks_cache_{学生} 本体，不认 _ts 兄弟键与其它缓存', () => {
  assert.equal(TASKS_CACHE_PREFIX, 'tasks_cache_')
  assert.equal(isTasksCacheKey('tasks_cache_bd31776e'), true)
  assert.equal(isTasksCacheKey('tasks_cache_bd31776e_ts'), false, '_ts 是兄弟键，不算本体')
  assert.equal(isTasksCacheKey('tasks_summary_cache'), false)
  assert.equal(isTasksCacheKey('students_cache'), false)
  assert.equal(isTasksCacheKey(''), false)
  assert.equal(isTasksCacheKey(undefined), false)
})

test('精准清理：只清「缓存里含这道任务」的那个学生', () => {
  const keys = [
    'tasks_cache_A',
    'tasks_cache_A_ts',
    'tasks_cache_B',
    'students_cache',
    'tasks_summary_cache',
  ]
  const got = pickTasksCacheKeys(keys, { taskId: 't1', containsTask: (k) => k === 'tasks_cache_A' })
  assert.deepEqual(got, ['tasks_cache_A'])
})

test('兜底：定位不到时清全部任务列表缓存（宁可多刷一次，也不留旧列表）', () => {
  const keys = ['tasks_cache_A', 'tasks_cache_A_ts', 'tasks_cache_B', 'students_cache']
  // 给了 taskId 但没给判定函数 → 退化为清全部
  assert.deepEqual(pickTasksCacheKeys(keys, { taskId: 't1' }), ['tasks_cache_A', 'tasks_cache_B'])
  // 什么都没给 → 同样清全部
  assert.deepEqual(pickTasksCacheKeys(keys), ['tasks_cache_A', 'tasks_cache_B'])
})

test('健壮性：非数组输入不炸', () => {
  assert.deepEqual(pickTasksCacheKeys(null), [])
  assert.deepEqual(pickTasksCacheKeys(undefined, { taskId: 't' }), [])
})

test('键判据模块自身无副作用：不依赖运行环境（Node 能直接 import）', () => {
  // 该模块要能被 Node 直接 import（本锁就靠它）；一旦引入 import.meta.env / localStorage 就会炸。
  // ⛔ 先剥注释再判：注释里会写「不直接碰 localStorage」这类说明文字（r234：门禁语料别被注释骗了）。
  const code = KEYS_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
  assert.ok(!/import\.meta\.env/.test(code), 'taskCacheKeys.js 不得依赖 Vite 环境变量')
  assert.ok(!/\blocalStorage\b/.test(code), 'taskCacheKeys.js 必须是纯判据，不直接碰 localStorage')
})

// ───────────────────────── ② 接线层：真实源码 ─────────────────────────

test('接线锁：retryTask / convertTaskRoute 不得再写错键', () => {
  assert.deepEqual(badClearSites(API_SRC), [])
})

test('接线锁：两个函数都必须真的调用 clearTasksCacheForTask（不是只删了错键）', () => {
  for (const [name, from, to] of SITES) {
    const seg = anchoredRange(API_SRC, from, to, `${LABEL}#${name}`, [])
    assert.ok(seg !== null, `${name} 切片失败`)
    assert.ok(
      seg.includes('clearTasksCacheForTask('),
      `${name} 必须在写操作后调用 clearTasksCacheForTask —— 否则老师点完那一行 5 分钟内不变`
    )
  }
})

test('接线锁：helper 已定义、且键判据来自唯一实现（taskCacheKeys.js）', () => {
  assert.ok(
    API_SRC.includes('const clearTasksCacheForTask ='),
    'apiService.js 必须定义 clearTasksCacheForTask'
  )
  assert.match(
    API_SRC,
    /import\s*\{\s*pickTasksCacheKeys\s*\}\s*from\s*'\.\/taskCacheKeys'/,
    '键判据必须复用 ./taskCacheKeys 的唯一实现，不得就地另写一套'
  )
})

// ───────────────────────── ③ 反向自检：修复前写法必须判红 ─────────────────────────

test('反向自检：同一把判据套「修复前」写法必须判红（≥2 处）', () => {
  // 修复前那两段真实写法（git 历史里就是这两处）—— 保持字面量，不依赖 git（Windows EBUSY）。
  const oldSrc = [
    'export const retryTask = async (taskId) => {',
    "  const data = await apiRequest(`/tasks/${taskId}/retry`, { method: 'POST' })",
    '  clearCache(`tasks_cache_${taskId}`)',
    '  return data',
    '}',
    '',
    'export const convertTaskRoute = async (taskId, o = {}) => {',
    "  const data = await apiRequest('/x')",
    '  if (!o.dryRun) clearCache(`tasks_cache_${taskId}`)',
    '  return data',
    '}',
    '',
    'const parseQuestionFields = (q) => q',
  ].join('\n')

  const hits = badClearSites(oldSrc)
  assert.ok(
    hits.length >= 2,
    `修复前写法应被揪出 ≥2 处，实际 ${hits.length} —— 判据可能是空锁：${hits.join(' / ')}`
  )
  assert.ok(hits.some((h) => h.includes('#retryTask')), 'retryTask 的错键未被检出')
  assert.ok(hits.some((h) => h.includes('#convertTaskRoute')), 'convertTaskRoute 的错键未被检出')
})
