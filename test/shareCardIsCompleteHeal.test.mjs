/**
 * 分享卡 is_complete 读前自愈回归锁（提案㉙，2026-10-12 负责人拍板落地）
 *
 * ── 事故面 ──
 * `server/routes/shareCard.js` 的 `fetchHasEverGraded()` 用
 * `EXISTS(... WHERE is_complete = TRUE)` 判「该学生曾经被批改过」，
 * 决定家长卡写「学习记录刚起步」还是「老学生这周没作业」（r133 立的口径）。
 * 但它读的 `is_complete` 是 `checkQuestionCompleteness()` 的反范式缓存列，
 * **分享卡这条链路从不写它**：若某学生的题全是陈旧行（缓存假、动态口径真），
 * 判据返回 false ⇒ 家长卡把老学生写成「刚起步」——与事实完全说反。
 * r208（10-06）/ r272（10-12）两次实测：21 名学生无一命中
 * （陈旧行 140 条全是真残题），修的是**结构风险**，不是当前可见的错误。
 *
 * ── 修法（与周报 ㉘ 共用同一实现，负责人拍板）──
 * 取数前按「全历史 + 本学生」跑 `healStaleCompletenessForPeriod`。
 * 同一件事只准一个实现：自愈判据/回写一律走 questionCompletenessSync.js，
 * 分享卡不另立一套。
 *
 * ── 本锁锁什么 ──
 *   1. **源码契约**：fetchHasEverGraded 必须调自愈，且必须排在 EXISTS 查询之前
 *      （顺序错了本次响应仍用旧缓存判）；必须 try/catch（失败不阻断分享卡）；
 *      必须按 studentId 限定（不做全班扫描）；必须宽周期（'曾经' 不限周期）。
 *   2. **反向自检**：判据套修复前的旧树必须判红（防锁自己骗自己）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SC_REL = 'server/routes/shareCard.js'
const SYNC_REL = 'server/services/questionCompletenessSync.js'

const read = (rel) => {
  const p = join(ROOT, rel)
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

/**
 * 扫源码前必须先剥掉注释。
 * ⚠️ 与周报锁同款纪律（r253 踩过）：注释里解释「为什么先自愈」的文字
 * 也可能含判据字样，注释永远不算代码路径。
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')            // 块注释
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')        // 行注释（排除 https:// 这类 URL）
}

/** 取 fetchHasEverGraded 函数体（剥注释后），到 `const router` 为止 */
function fnBody(src) {
  const code = stripComments(src)
  const i = code.indexOf('async function fetchHasEverGraded')
  if (i < 0) return null
  const j = code.indexOf('const router', i)
  return code.slice(i, j < 0 ? undefined : j)
}

// ─────────────────────────────────────────────────────────────
// 1. 源码契约
// ─────────────────────────────────────────────────────────────

export function collectFailures(root) {
  const fails = []
  const r = (rel) => {
    const p = join(root, rel)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }

  // 共享自愈实现必须还在（同一件事只准一个实现）
  const sync = r(SYNC_REL)
  if (sync === null) {
    fails.push('questionCompletenessSync.js 不见了')
  } else if (!sync.includes('healStaleCompletenessForPeriod')) {
    fails.push('questionCompletenessSync: 缺 healStaleCompletenessForPeriod（周报/分享卡共用的读前自愈）')
  }

  const sc = r(SC_REL)
  if (sc === null) {
    fails.push('shareCard.js 不见了')
    return fails
  }

  if (!stripComments(sc).includes('healStaleCompletenessForPeriod')) {
    fails.push('shareCard: 未引入读前自愈（老学生可能被判成「刚起步」）')
  }

  const body = fnBody(sc)
  if (body === null) {
    fails.push('shareCard: 找不到 fetchHasEverGraded 函数')
    return fails
  }

  const iHeal = body.indexOf('healStaleCompletenessForPeriod(')
  if (iHeal < 0) {
    fails.push('shareCard: fetchHasEverGraded 没调读前自愈')
  } else {
    // 顺序：自愈必须早于 EXISTS 查询里的 is_complete = TRUE
    const iStat = body.indexOf('is_complete = TRUE')
    if (iStat < 0) {
      fails.push('shareCard: fetchHasEverGraded 找不到 is_complete 过滤，判据可能已漂移')
    } else if (iHeal > iStat) {
      fails.push('shareCard: 自愈排在 EXISTS 查询之后（顺序错⇒本次响应仍用旧缓存判）')
    }
    // 按学生限定：调用第一个参数必须是 studentId（不能传 null 扫全班）
    const call = body.slice(iHeal, iHeal + 120)
    if (!/healStaleCompletenessForPeriod\(\s*studentId/.test(call)) {
      fails.push('shareCard: 自愈必须按 studentId 限定（不做全班扫描）')
    }
    // 宽周期：'曾经' 不限周期，periodStart 必须覆盖全历史
    if (!/new Date\(0\)/.test(call)) {
      fails.push('shareCard: 自愈周期必须宽（periodStart 取 epoch 覆盖全历史，不能只用本周期）')
    }
    // 失败不阻断：调用必须在 try 块内，函数体有 catch
    const iTry = body.indexOf('try')
    const iCatch = body.indexOf('catch')
    if (iTry < 0 || iCatch < 0 || iTry > iHeal || iCatch < iHeal) {
      fails.push('shareCard: 自愈调用必须包在 try/catch 里（失败不该让分享卡 500）')
    }
  }

  return fails
}

test('源码契约：分享卡 fetchHasEverGraded 有读前自愈，顺序/限定/周期/容错全对', () => {
  assert.deepEqual(collectFailures(ROOT), [])
})

// ─────────────────────────────────────────────────────────────
// 2. 反向自检：判据套「修复前旧树」必须判红
// ─────────────────────────────────────────────────────────────

test('反向自检：判据套修复前的旧树必须判红', () => {
  const src = read(SC_REL)
  assert.ok(src, 'shareCard.js 应存在')
  // 合成旧树：删掉 import、删掉 try/catch 自愈块（保留其余一切）
  const legacy = src
    .replace(/import \{ healStaleCompletenessForPeriod \}[^\n]*\n/, '')
    .replace(
      / {2}try \{\n {4}await healStaleCompletenessForPeriod\([\s\S]*?\n {2}\} catch \(e\) \{\n {4}console\.error\([^\n]*\n {2}\}\n/,
      ''
    )
  // 确认旧树确实被改坏了（否则下面是假红）
  assert.ok(!legacy.includes('healStaleCompletenessForPeriod'), '旧树合成失败：仍含自愈调用')

  const fails = collectFailuresFrom(legacy, read(SYNC_REL))
  assert.ok(fails.length > 0, '旧树居然全绿 ⇒ 本锁判据写得太松，等于没锁')
  assert.ok(
    fails.some(f => f.includes('自愈')),
    `旧树应因缺自愈判红，实际失败项：${JSON.stringify(fails)}`
  )
})

/** 与 collectFailures 同逻辑，但读内存字符串 —— 供反向自检喂旧树 */
function collectFailuresFrom(scSrc, syncSrc) {
  const fails = []
  if (syncSrc === null || !syncSrc.includes('healStaleCompletenessForPeriod')) {
    fails.push('questionCompletenessSync: 缺 healStaleCompletenessForPeriod')
  }
  if (!stripComments(scSrc).includes('healStaleCompletenessForPeriod')) {
    fails.push('shareCard: 未引入读前自愈（老学生可能被判成「刚起步」）')
  }
  const body = fnBody(scSrc)
  if (body === null) {
    fails.push('shareCard: 找不到 fetchHasEverGraded 函数')
    return fails
  }
  const iHeal = body.indexOf('healStaleCompletenessForPeriod(')
  if (iHeal < 0) {
    fails.push('shareCard: fetchHasEverGraded 没调读前自愈')
  } else {
    const iStat = body.indexOf('is_complete = TRUE')
    if (iStat < 0) fails.push('shareCard: 找不到 is_complete 过滤')
    else if (iHeal > iStat) fails.push('shareCard: 自愈排在 EXISTS 查询之后')
    const call = body.slice(iHeal, iHeal + 120)
    if (!/healStaleCompletenessForPeriod\(\s*studentId/.test(call)) fails.push('shareCard: 自愈必须按 studentId 限定')
    if (!/new Date\(0\)/.test(call)) fails.push('shareCard: 自愈周期必须宽')
    const iTry = body.indexOf('try')
    const iCatch = body.indexOf('catch')
    if (iTry < 0 || iCatch < 0 || iTry > iHeal || iCatch < iHeal) fails.push('shareCard: 自愈调用必须包在 try/catch 里')
  }
  return fails
}
