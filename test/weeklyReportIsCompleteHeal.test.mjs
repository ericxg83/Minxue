/**
 * 周报/分享卡 is_complete 读前自愈回归锁（提案㉘，2026-10-10 负责人拍板落地）
 *
 * ── 事故 ──
 * `questions.is_complete` 是 `checkQuestionCompleteness()` 的反范式缓存列，
 * 存在的唯一理由是让 SQL 能直接 `WHERE is_complete = TRUE` 过滤。
 * 但**周报 / 分享卡这条链路从来不写它**（写侧自愈在 index.js:3719、worker.js:6235、
 * 错题本读前自愈在 index.js:3770），于是缓存长期偏旧：
 *
 *   r215 实测：近 30 天家长看到的「批改题量」少 **141 题（6.0%）**，正确率被**抬高**。
 *   实测 2214题 / 61.2%，真实应为 2355 题 / 59.7%。
 *   个别学生偏差极大：陈施君 51.2% → 40.4%（−10.8pp）、王艺博 50.0% → 43.6%。
 *   这 141 行所属 90 个任务状态全是 `reviewed`（老师早完复核的终态），
 *   却被 `AND is_complete = TRUE` 静默滤掉 ⇒ **给家长的数字比孩子实际掌握的好看**。
 *
 * ── 本次修法（负责人拍板：只做读前自愈、不改库结构）──
 * 取数前把「动态口径判完整、缓存却是假」的题回写，本次响应即含它们。
 * 口径定义一个字没动，只让缓存回到动态真值。
 *
 * ── 本锁锁什么 ──
 *   1. **纯函数真跑**：heal 的候选筛选判据（只挑 `IS DISTINCT FROM TRUE`）——
 *      方向必须「只增不减」，绝不能把已可见的题踢出去。
 *   2. **源码契约**：周报三条链路（单学生 / 全班 / 周期对比）都必须调自愈，
 *      且必须排在统计 SQL **之前**（顺序错了照样漏题）。
 *   3. **失败不阻断**：自愈抛错不能让周报变 500。
 *   4. **反向自检**：判据套修复前的旧树必须判红（防「测试写得太松，自己骗自己」）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { checkQuestionCompleteness } from '../server/utils/questionCompleteness.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => {
  const p = join(ROOT, rel)
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

/**
 * 扫源码前必须先剥掉注释。
 * ⚠️ r253 踩过：判据用 indexOf('is_complete = TRUE') 找统计 SQL，结果**函数上方的
 * 说明注释里也写了这句话**（那是解释「为什么必须先自愈」的），于是判据把注释当成了
 * SQL，得出「自愈排在统计 SQL 之后」的反向结论—— 测试自己造了个假红。
 * 注释里的判据文字永远不算代码路径。
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')            // 块注释
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')        // 行注释（排除 https:// 这类 URL）
}

const SYNC_REL = 'server/services/questionCompletenessSync.js'
const WR_REL = 'server/routes/weeklyReport.js'

// ─────────────────────────────────────────────────────────────
// 1. 判据纯函数化：把「哪些行该被自愈捞出来」这条规则写成可测的纯函数，
//    避免只能靠读 SQL 字符串猜判据对不对。
// ─────────────────────────────────────────────────────────────

/**
 * 该不该把这行交给 syncQuestionCompleteness 回写？
 * 与 `healStaleCompletenessForPeriod` 的 SQL WHERE 子句同源。
 * ⚠️ 只认「当前不是 TRUE」——方向是只增不减。
 */
export function shouldHealRow(row, { periodStart, periodEnd, studentId = null }) {
  if (!row) return false
  if (row.created_at < periodStart || row.created_at >= periodEnd) return false
  if (studentId && row.student_id !== studentId) return false
  return row.is_complete !== true
}

test('判据：陈旧缓存（is_complete=false）且落在周期内 → 该自愈', () => {
  const row = {
    student_id: 's1',
    is_complete: false,
    created_at: new Date('2026-10-05T10:00:00Z')
  }
  assert.equal(shouldHealRow(row, {
    periodStart: new Date('2026-10-01T00:00:00Z'),
    periodEnd: new Date('2026-10-11T00:00:00Z')
  }), true)
})

test('判据：NULL 也算陈旧（IS DISTINCT FROM TRUE 的语义，不是 = FALSE）', () => {
  const row = {
    student_id: 's1',
    is_complete: null,
    created_at: new Date('2026-10-05T10:00:00Z')
  }
  assert.equal(shouldHealRow(row, {
    periodStart: new Date('2026-10-01T00:00:00Z'),
    periodEnd: new Date('2026-10-11T00:00:00Z')
  }), true)
})

test('判据：已TRUE 的行绝不回写（只增不减，不能踢掉已可见的题）', () => {
  const row = {
    student_id: 's1',
    is_complete: true,
    created_at: new Date('2026-10-05T10:00:00Z')
  }
  assert.equal(shouldHealRow(row, {
    periodStart: new Date('2026-10-01T00:00:00Z'),
    periodEnd: new Date('2026-10-11T00:00:00Z')
  }), false)
})

test('判据：周期外 / 其他学生的行不捞（不做全表扫描）', () => {
  const base = { student_id: 's1', is_complete: false }
  const win = {
    studentId: 's1',       // 单学生口径：必须按学生限定
    periodStart: new Date('2026-10-01T00:00:00Z'),
    periodEnd: new Date('2026-10-11T00:00:00Z')
  }
  assert.equal(shouldHealRow({ ...base, created_at: new Date('2026-09-20T10:00:00Z') }, win), false)
  assert.equal(shouldHealRow({ ...base, student_id: 's2', created_at: new Date('2026-10-05T10:00:00Z') }, win), false)
  // 周期右端是开区间：恰好等于 periodEnd 的行不属于本周期
  assert.equal(shouldHealRow({ ...base, created_at: new Date('2026-10-11T00:00:00Z') }, win), false)
})

test('判据：全班口径传 studentId=null 时不按学生限定（否则漏掉别的学生）', () => {
  const win = {
    studentId: null,
    periodStart: new Date('2026-10-01T00:00:00Z'),
    periodEnd: new Date('2026-10-11T00:00:00Z')
  }
  assert.equal(shouldHealRow({
    student_id: 's2', is_complete: false, created_at: new Date('2026-10-05T10:00:00Z')
  }, win), true)
})

// ─────────────────────────────────────────────────────────────
// 2. 端到端口径复核：动态口径判完整 ⇒ 自愈后必定计入周报题量
//    （用 r215 的真实缺口类型：字段齐全，只是缓存没跟上）
// ─────────────────────────────────────────────────────────────

test('口径复核：字段齐全但缓存为 false 的题，动态口径判完整 ⇒ 自愈后计入题量', () => {
  const q = {
    content: '计算：2 + 3 × 4 = ____',
    parent_stem: null,
    geometry_image_url: null,
    question_type: 'fill',
    options: [],
    answer: '14'
  }
  // 动态口径（唯一真值源）说它完整
  assert.equal(checkQuestionCompleteness(q).isComplete, true)
  // 而缓存列是假的 ⇒ 会被 `AND is_complete = TRUE` 滤掉 ⇒ 自愈必须捞它
  assert.equal(shouldHealRow({ student_id: 's1', is_complete: false, created_at: new Date('2026-10-05') }, {
    periodStart: new Date('2026-10-01'), periodEnd: new Date('2026-10-11')
  }), true)
})

test('口径复核：真残题（缺参考答案）即便被捞出来也不会被误算成完整题', () => {
  const q = {
    content: '计算：2 + 3 × 4 = ____',
    parent_stem: null,
    geometry_image_url: null,
    question_type: 'fill',
    options: [],
    answer: ''            // 真缺答案 ⇒ 动态口径判残题
  }
  assert.equal(checkQuestionCompleteness(q).isComplete, false)
  // 自愈把它交给 syncQuestionCompleteness 后会落回 FALSE，不会带病进周报
})

// ─────────────────────────────────────────────────────────────
// 3. 源码契约：三条链路都要调，且必须排在统计 SQL 之前
// ─────────────────────────────────────────────────────────────

export function collectFailures(root) {
  const fails = []
  const r = (rel) => {
    const p = join(root, rel)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }

  const sync = r(SYNC_REL)
  if (sync === null) {
    fails.push('questionCompletenessSync.js 不见了')
  } else {
    if (!sync.includes('healStaleCompletenessForPeriod')) {
      fails.push('questionCompletenessSync: 缺 healStaleCompletenessForPeriod（周报链路读前自愈）')
    }
    if (!sync.includes('IS DISTINCT FROM TRUE')) {
      fails.push('questionCompletenessSync: 自愈候选必须用 IS DISTINCT FROM TRUE（否则漏 NULL /误伤 TRUE）')
    }
    if (!sync.includes('truncated')) {
      fails.push('questionCompletenessSync: 命中上限必须回报 truncated（不能静默只扫了 500 行）')
    }
  }

  const wr = r(WR_REL)
  if (wr === null) {
    fails.push('weeklyReport.js 不见了')
  } else {
    const wrCode = stripComments(wr)   // 注释里的判据文字不算代码路径
    if (!wrCode.includes('healStaleCompletenessForPeriod')) {
      fails.push('weeklyReport: 未引入读前自愈')
    }
    // 三条链路：单学生 fetchStudentWeeklyReport / 全班 router.get('/') / fetchPeriodCompare
    const routes = [
      ['单学生周报 fetchStudentWeeklyReport', 'export async function fetchStudentWeeklyReport'],
      ['周期对比 fetchPeriodCompare', 'export async function fetchPeriodCompare']
    ]
    for (const [label, anchor] of routes) {
      const i = wrCode.indexOf(anchor)
      if (i < 0) {
        fails.push(`weeklyReport: 找不到 ${anchor}`)
        continue
      }
      const seg = wrCode.slice(i, i + 4000)
      const iHeal = seg.indexOf('healPeriodCompletenessQuietly')
      if (iHeal < 0) {
        fails.push(`weeklyReport: ${label} 没调读前自愈（家长会看到偏旧的题量）`)
        continue
      }
      // 顺序：自愈必须早于第一条 `is_complete = TRUE` 的统计 SQL
      const iStat = seg.indexOf('is_complete = TRUE')
      if (iStat < 0) {
        fails.push(`weeklyReport: ${label} 找不到 is_complete 过滤，自愈判据可能已漂移`)
      } else if (iHeal > iStat) {
        fails.push(`weeklyReport: ${label} 自愈排在统计 SQL 之后（顺序错→ 本次响应仍漏题）`)
      }
    }

    // 全班口径：必须只跑一次（不按学生逐个跑 → 21 次往返）
    const iAll = wrCode.indexOf("router.get('/', async (req, res) => {")
    if (iAll < 0) {
      fails.push('weeklyReport: 找不到全班周报路由')
    } else {
      const seg = wrCode.slice(iAll, iAll + 3000)
      if (!seg.includes('healPeriodCompletenessQuietly')) {
        fails.push('weeklyReport: 全班周报没调读前自愈')
      } else if (/healPeriodCompletenessQuietly\(\s*student\.id/.test(seg)) {
        fails.push('weeklyReport: 全班周报逐个学生跑自愈（应为一次传 null，避免 N 次往返）')
      }
    }

    // 失败不阻断：自愈抛错只能记日志，不能把周报打成 500
    const iHelper = wrCode.indexOf('async function healPeriodCompletenessQuietly')
    if (iHelper < 0) {
      fails.push('weeklyReport: 缺 healPeriodCompletenessQuietly 包装')
    } else {
      const seg = wrCode.slice(iHelper, iHelper + 2000)
      if (!seg.includes('try') || !seg.includes('catch')) {
        fails.push('weeklyReport: 读前自愈必须 try/catch 兜住（失败不该让周报 500）')
      }
    }

    // 反向自愈方向保护：自愈函数里不得出现会把 TRUE 翻回 FALSE 的全表操作
    if (sync !== null && sync.includes('healStaleCompletenessForPeriod')) {
      const iFn = sync.indexOf('export const healStaleCompletenessForPeriod')
      const seg = sync.slice(iFn, iFn + 3000)
      if (/UPDATE[\s\S]*is_complete\s*=\s*FALSE/.test(seg)) {
        fails.push('questionCompletenessSync: 周报自愈不得把 TRUE 翻回 FALSE（方向必须只增不减）')
      }
    }
  }
  return fails
}

test('源码契约：三条周报链路都有读前自愈，且顺序在统计 SQL 之前', () => {
  assert.deepEqual(collectFailures(ROOT), [])
})

test('反向自检：判据套「修复前旧树」必须判红', () => {
  // 构造一棵修复前的树：自愈函数完全不存在、周报也没调
  const legacy = new Map([
    [SYNC_REL, `import { query } from '../config/neon.js'
export const syncQuestionCompleteness = async () => ({ checked: 0, updated: 0 })
export const syncQuestionCompletenessQuietly = () => {}
`],
    [WR_REL, read(WR_REL).replace(/import \{ healStaleCompletenessForPeriod \}[^\n]*\n/, '')
      .replace(/async function healPeriodCompletenessQuietly[\s\S]*?\n}\n/, '')
      .replace(/\s*await healPeriodCompletenessQuietly\([^)]*\)\n/g, '\n')]
  ])
  const fails = collectFailuresFrom(legacy)
  assert.ok(fails.length > 0, '旧树居然全绿 ⇒ 本锁判据写得太松，等于没锁')
  assert.ok(
    fails.some(f => f.includes('healStaleCompletenessForPeriod'))
    || fails.some(f => f.includes('读前自愈')),
    `旧树应因缺自愈判红，实际失败项：${JSON.stringify(fails)}`
  )
})

/** 与 collectFailures 同逻辑，但读内存 map —— 供反向自检喂旧树 */
function collectFailuresFrom(map) {
  const fails = []
  const r = (rel) => map.get(rel) ?? null
  const sync = r(SYNC_REL)
  if (sync === null) {
    fails.push('questionCompletenessSync.js 不见了')
  } else {
    if (!sync.includes('healStaleCompletenessForPeriod')) {
      fails.push('questionCompletenessSync: 缺 healStaleCompletenessForPeriod（周报链路读前自愈）')
    }
    if (!sync.includes('IS DISTINCT FROM TRUE')) {
      fails.push('questionCompletenessSync: 自愈候选必须用 IS DISTINCT FROM TRUE')
    }
    if (!sync.includes('truncated')) {
      fails.push('questionCompletenessSync: 命中上限必须回报 truncated')
    }
  }
  const wr = r(WR_REL)
  if (wr === null) return fails.concat(['weeklyReport.js 不见了'])
  const wrCode = stripComments(wr)
  if (!wrCode.includes('healStaleCompletenessForPeriod')) {
    fails.push('weeklyReport: 未引入读前自愈')
  }
  for (const [label, anchor] of [
    ['单学生周报 fetchStudentWeeklyReport', 'export async function fetchStudentWeeklyReport'],
    ['周期对比 fetchPeriodCompare', 'export async function fetchPeriodCompare']
  ]) {
    const i = wrCode.indexOf(anchor)
    if (i < 0) { fails.push(`weeklyReport: 找不到 ${anchor}`); continue }
    const seg = wrCode.slice(i, i + 4000)
    const iHeal = seg.indexOf('healPeriodCompletenessQuietly')
    if (iHeal < 0) { fails.push(`weeklyReport: ${label} 没调读前自愈`); continue }
    const iStat = seg.indexOf('is_complete = TRUE')
    if (iStat < 0) fails.push(`weeklyReport: ${label} 找不到 is_complete 过滤`)
    else if (iHeal > iStat) fails.push(`weeklyReport: ${label} 自愈排在统计 SQL 之后`)
  }
  const iAll = wrCode.indexOf("router.get('/', async (req, res) => {")
  if (iAll < 0) fails.push('weeklyReport: 找不到全班周报路由')
  else {
    const seg = wrCode.slice(iAll, iAll + 3000)
    if (!seg.includes('healPeriodCompletenessQuietly')) fails.push('weeklyReport: 全班周报没调读前自愈')
    else if (/healPeriodCompletenessQuietly\(\s*student\.id/.test(seg)) fails.push('weeklyReport: 全班周报逐个学生跑自愈')
  }
  const iHelper = wrCode.indexOf('async function healPeriodCompletenessQuietly')
  if (iHelper < 0) fails.push('weeklyReport: 缺 healPeriodCompletenessQuietly 包装')
  else {
    const seg = wrCode.slice(iHelper, iHelper + 2000)
    if (!seg.includes('try') || !seg.includes('catch')) fails.push('weeklyReport: 读前自愈必须 try/catch 兜住')
  }
  return fails
}