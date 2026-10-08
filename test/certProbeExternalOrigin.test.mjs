/**
 * 回归锁：闸门④ `cert_probe` 的「外联算不算脏」判据（r246）
 *
 * 修的是**假红**：r244 给批改中心加了 OSS 学生作业图小图后，`#/grade` 一渲染就请求
 * `minxue-app-oss.oss-cn-shanghai.aliyuncs.com` 的图片，而 r224 的判据是「外部 origin 必须为空」
 * ⇒ 探针**恒定 exit 1**。恒红的闸和恒绿的闸一样坏：没人再看它（r198「常量黄灯」同族）。
 * 新口径只把**数据/脚本外联**算脏，图片/字体/媒体算正常静态资源（仍然打印，不藏）。
 *
 * 判据只有一份实现（`scripts/gate/certProbeKit.mjs`），扫描侧与自检侧共用。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { summarizeExternalRequests, isStaticAssetRequest } from '../scripts/certProbeKit.mjs'
import { includesLit } from './sourceLockKit.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const PROBE = fs.readFileSync(path.join(ROOT, 'scripts/gate/cert_probe.mjs'), 'utf8')
const BASE = 'http://127.0.0.1:5490'
const OSS = 'https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com'
const PROD_API = 'https://minxue-api.onrender.com'

// ── 1. 正常业务：只有 OSS 图片 ⇒ 不算脏（这正是本轮修掉的那个恒红）───────────
test('cert_probe 判据：只有 OSS 图片不算脏（旧口径会把它判红 ⇒ 修的是真事）', () => {
  const reqs = [
    { origin: OSS, type: 'image' },
    { origin: OSS, type: 'image' },
    { origin: BASE, type: 'image' },
  ]
  const r = summarizeExternalRequests(reqs, BASE)
  assert.deepEqual(r.all, [OSS], 'OSS 图片应出现在「外部 origin」清单里（要打印，不藏）')
  assert.deepEqual(r.apiLike, [], '只有图片 ⇒ 不该算脏')
  assert.deepEqual(r.staticOnly, [OSS])

  // 反向自检：老口径 `all.length === 0` 对同一份样本会判脏 —— 证明新判据不是空转
  assert.notEqual(r.all.length, 0, '老口径（外部 origin 必须为空）在这份样本上会判红')
})

// ── 2. 烤入生产 API base：fetch 到线上 ⇒ 必须算脏（r224 的原意要保住）────────
test('cert_probe 判据：fetch 到生产 API ⇒ 算脏（r224 的假绿防线没被削）', () => {
  const r = summarizeExternalRequests([{ origin: PROD_API, type: 'fetch' }], BASE)
  assert.deepEqual(r.apiLike, [PROD_API])
  assert.deepEqual(r.staticOnly, [])
  // 图片 CDN 与线上 API 混在一起时，脏的只有线上 API
  const both = summarizeExternalRequests(
    [{ origin: OSS, type: 'image' }, { origin: PROD_API, type: 'xhr' }],
    BASE
  )
  assert.deepEqual(both.apiLike, [PROD_API])
  assert.deepEqual(both.staticOnly, [OSS])
})

// ── 3. 同一 origin 既拉图又发请求 ⇒ 算脏（不能被「有图片」洗白）──────────────
test('cert_probe 判据：同一 origin 既拉图片又发 fetch ⇒ 算脏', () => {
  const r = summarizeExternalRequests(
    [{ origin: PROD_API, type: 'image' }, { origin: PROD_API, type: 'fetch' }],
    BASE
  )
  assert.deepEqual(r.apiLike, [PROD_API])
  assert.deepEqual(r.staticOnly, [], '不能因为「它也有图片」就从脏清单里溜掉')
})

// ── 4. 同源请求必须剔除（严格相等，别把 :54410 当成 :5441）──────────────────
test('cert_probe 判据：同源请求不算外联，端口边界按 origin 严格相等', () => {
  const r = summarizeExternalRequests(
    [
      { origin: BASE, type: 'script' },
      { origin: BASE, type: 'image' },
      { origin: 'http://127.0.0.1:549', type: 'fetch' }, // 只差一位数字的端口
    ],
    BASE
  )
  assert.deepEqual(r.all, ['http://127.0.0.1:549'], '同源要被剔除，只差一位端口的要留下')
  assert.deepEqual(r.apiLike, ['http://127.0.0.1:549'])
})

// ── 5. 类型读不出来 / 没见过的类型 ⇒ 算脏（fail-closed）──────────────────────
test('cert_probe 判据：类型读不出来或没见过 ⇒ 算脏（fail-closed，别放过）', () => {
  for (const t of ['', null, undefined, 'other', 'prefetch']) {
    assert.equal(isStaticAssetRequest(t), false, `类型 ${JSON.stringify(t)} 不该被当成静态资源`)
    const r = summarizeExternalRequests([{ origin: 'https://x.example', type: t }], BASE)
    assert.deepEqual(r.apiLike, ['https://x.example'], `类型 ${JSON.stringify(t)} 应算脏`)
  }
  for (const t of ['image', 'IMAGE', 'font', 'media']) {
    assert.equal(isStaticAssetRequest(t), true, `类型 ${JSON.stringify(t)} 应算静态资源`)
  }
})

// ── 6. 源码契约：探针必须走 kit，且退出码判据必须看 apiLike（不许退回「外联必须为空」）──
test('cert_probe 源码：判据走 certProbeKit，退出码只看数据/脚本外联 + 请求失败', () => {
  assert.ok(includesLit(PROBE, "from '../certProbeKit.mjs'"), 'cert_probe 必须复用 certProbeKit 的判据')
  assert.ok(
    includesLit(PROBE, 'process.exit(apiLike.length === 0 && failures.length === 0 ? 0 : 1)'),
    '退出码判据必须基于 apiLike（数据/脚本外联）—— 退回「外部 origin 必须为空」就是又变回恒红'
  )
  assert.ok(!includesLit(PROBE, 'process.exit(external.length === 0'), '旧的 external 口径不得残留')
  assert.ok(includesLit(PROBE, 'r.request().resourceType()'), '必须按资源类型分流，否则判不了「是不是图片」')
})
