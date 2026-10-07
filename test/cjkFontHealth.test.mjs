/**
 * cjkFontHealth.test.mjs — 「发给家长的图，中文还有没有字形」这一盏灯（r241）
 *
 * 锁三件事：
 *   ① 判定 `resolveCjkFontState()`：只有 ok 才合格，字段没回必须**明说没盯**（不许悄悄判合格）；
 *   ② 测量 `probeCjkFontAsset()`：本仓库真的有这份 woff2 资产（没有的话 /api/health 会一直报 missing）；
 *   ③ 接线：healthcheck 真的 import 了这个判定、renderFontFace 真的用 cjkFontState 的路径
 *      （同一个资产路径两边各算一次 = 「同一事实两个写法」，r241 专门拆开过一次）。
 *
 * ⛔ 反向自检要点（沿用 r233/r237 的规矩）：判据必须能自己判红。
 *    这里额外加了自证钩子 —— 先断言源码里**确实是**新写法，再断言行为；
 *    否则「判定函数改名了但测试照绿」这类假绿会一路挂下去（r239 踩过）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const resolverSrc = readFileSync(path.join(here, '..', 'server', 'utils', 'cjkFontState.js'), 'utf8')
const healthcheckSrc = readFileSync(path.join(here, '..', 'scripts', 'healthcheck.mjs'), 'utf8')
const renderFontFaceSrc = readFileSync(path.join(here, '..', 'server', 'services', 'renderFontFace.js'), 'utf8')

const { resolveCjkFontState, probeCjkFontAsset, CJK_FONT_ASSET_PATH } = await import('../server/utils/cjkFontState.js')

// ── 0. 自证：源码里确实是新写法（防止判据和测试一起过期，r239 同款）────────────
test('自证：判定模块与两个接线点都在源码里（防判据整体失效）', () => {
  assert.match(resolverSrc, /export function resolveCjkFontState/)
  assert.match(resolverSrc, /export function probeCjkFontAsset/)
  assert.match(healthcheckSrc, /resolveCjkFontState/)
  assert.match(healthcheckSrc, /家长卡片中文字/)
  assert.match(renderFontFaceSrc, /from '\.\.\/utils\/cjkFontState\.js'/)
})

test('自证：字体资产路径只有一个出处（renderFontFace 不再自己算目录）', () => {
  // r241 之前 renderFontFace 自己 `path.resolve(..., '..', 'assets', 'fonts')`，
  // cjkFontState 又要算一遍同一个路径 —— 改一处忘一处就又变回两个写法。
  assert.ok(!/const ASSET_DIR =/.test(renderFontFaceSrc), 'renderFontFace 不该再自己拼字体目录')
  assert.ok(renderFontFaceSrc.includes('CJK_FONT_ASSET_PATH'))
  assert.match(resolverSrc, /export const CJK_FONT_ASSET_PATH/)
})

// ── 1. 判定：只有 ok 合格 ──────────────────────────────────────────────────
test('字体状态 ok ⇒ 合格，且不许拿「方框」吓人', () => {
  const r = resolveCjkFontState('ok')
  assert.equal(r.status, 'ok')
  assert.ok(!r.detail.includes('方框'), 'ok 的文案不该再提方框（那是出事时的话）')
})

test('字体文件丢了 / 换格式了 ⇒ 不合格，且必须点名「家长的图看不懂」', () => {
  for (const v of ['missing', 'not-woff2']) {
    const r = resolveCjkFontState(v)
    assert.equal(r.status, 'warn', `${v} 必须判不合格`)
    assert.ok(r.detail.includes('方框'), `${v} 的文案必须说清后果`)
    assert.ok(r.detail.includes('家长'), `${v} 的文案必须落到家长身上，别只说服务器`)
  }
})

test('状态压根没回 ⇒ 不合格，并且明说「这一项等于没盯」', () => {
  for (const v of [undefined, null, '']) {
    const r = resolveCjkFontState(v)
    assert.equal(r.status, 'warn', `${JSON.stringify(v)} 必须判不合格`)
    assert.ok(r.detail.includes('等于没盯'), `${JSON.stringify(v)} 必须说清是没盯，不是没问题`)
  }
})

test('没见过的值（接口改了口径）⇒ 不合格，不许当它没问题', () => {
  const r = resolveCjkFontState('some-new-state')
  assert.equal(r.status, 'warn')
  assert.ok(r.detail.includes('没盯'))
})

test('四种输入里只有 ok 合格（反证：把 ok 换成别的就会全绿 = 判据失效）', () => {
  const judged = ['ok', 'missing', 'not-woff2', undefined].map((v) => resolveCjkFontState(v).status)
  assert.deepEqual(judged, ['ok', 'warn', 'warn', 'warn'])
})

// ── 2. 测量：真资产在（否则 /api/health 会一直报 missing）──────────────────
test('本仓库真的带着这份字体资产，且测量结果是 ok', () => {
  // 资产文件存在 + 是 woff2（文件头 wOF2）—— 有人误替换格式时这条会先红
  const bytes = readFileSync(CJK_FONT_ASSET_PATH)
  assert.equal(bytes.slice(0, 4).toString('latin1'), 'wOF2')
  assert.equal(probeCjkFontAsset(), 'ok')
})

test('测量结果只算一次（缓存），不会每次请求都读 968KB', () => {
  const before = probeCjkFontAsset()
  const again = probeCjkFontAsset()
  assert.equal(before, again)
  assert.equal(before, 'ok')
})
