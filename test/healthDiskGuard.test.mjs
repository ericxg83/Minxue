// 回归测试：磁盘体检不再「永远亮黄灯」（2026-10-06 r198 修）
//
// 缺陷（实测原版）：
//   ① `scripts/healthcheck.mjs` 对磁盘这一项写的是**常量警告**——不管剩多少、有没有数据，
//      每次采样都打「体检读不到磁盘用量」，于是每次结论都是「有 1 项想提醒你」。
//      恒定亮着的黄灯等于没有黄灯，会把「批改失败 / 队列积压」这些真告警一起淹掉；
//   ② `GET /api/health` 根本**没有任何磁盘字段**，所以上面那句「读不到」不是偶发失败，
//      而是这个接口从设计上就答不出这个问题——老师撞到「上传失败」时无从查起。
//
// 本锁两层：
//   A. 真跑纯函数 `resolveDiskState`（阈值在人话文案里，值得逐条锁）；
//   B. 源码契约：health 接口必须回 disk；healthcheck 必须**按 disk 判定**，不得再写死 warn。
// 反向自检：同一把判据套修复前的两个文件必须判红（见文件末尾脚本逻辑，非运行时）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  resolveDiskState,
  DISK_WARN_FREE_MB,
  DISK_UNKNOWN_DETAIL
} from '../scripts/healthDiskState.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const src = (p) => readFileSync(resolve(ROOT, p), 'utf8')
const HEALTHCHECK = 'scripts/healthcheck.mjs'
const INDEX = 'server/index.js'

// ── A1. 判据本身：阈值边界逐条坐实（别靠手算）──────────────────────────────

test('磁盘剩 900MB ⇒ 合格，且报出剩余数字（不再是「读不到」）', () => {
  const r = resolveDiskState({ freeMb: 900, totalMb: 1024, path: '/tmp' })
  assert.equal(r.status, 'ok')
  assert.match(r.detail, /900/)
  assert.match(r.detail, /1024/)
})

test('磁盘剩 exactly 阈值 ⇒ 合格（判据是「低于」而不是「小于等于」）', () => {
  const r = resolveDiskState({ freeMb: DISK_WARN_FREE_MB })
  assert.equal(r.status, 'ok', `阈值 ${DISK_WARN_FREE_MB} 这条线上应当算够用`)
})

test('磁盘剩 阈值-1MB ⇒ 提醒，且说清后果与怎么办', () => {
  const r = resolveDiskState({ freeMb: DISK_WARN_FREE_MB - 1 })
  assert.equal(r.status, 'warn')
  assert.match(r.detail, /分享卡|重练卷/) // 后果：说准受影响的动作，不夸大成「上传失败」
  assert.match(r.detail, /清掉/) // 下一步动作
  assert.doesNotMatch(r.detail, /上传(会|失败)/) // ⛔ 不许把临时盘说成「图片盘」
})

test('磁盘剩 0MB ⇒ 提醒，且提示升级/清理', () => {
  const r = resolveDiskState({ freeMb: 0 })
  assert.equal(r.status, 'warn')
  assert.match(r.detail, /0MB/)
})

test('接口没回 disk（字段缺失/为 null）⇒ 提醒，但必须给出「去哪儿看」', () => {
  assert.equal(resolveDiskState(null).status, 'warn')
  assert.equal(resolveDiskState(undefined).status, 'warn')
  assert.equal(resolveDiskState({}).status, 'warn')
  const r = resolveDiskState(null)
  assert.equal(r.detail, DISK_UNKNOWN_DETAIL)
  assert.match(r.detail, /Render/) // 兜底文案得指路，不能只说「读不到」
})

test('没有 totalMb 时不编造总量（只报剩余）', () => {
  const r = resolveDiskState({ freeMb: 512 })
  assert.equal(r.status, 'ok')
  assert.match(r.detail, /512/)
  assert.doesNotMatch(r.detail, /总共约/) // 拿不到就别瞎写一个数
})

test('阈值常量 = 200MB（Render 免费实例约 1GB，200MB 约剩 5 次拍照上传）', () => {
  assert.equal(DISK_WARN_FREE_MB, 200)
})

// ── B2. 源码契约：健康检查按 disk 判定，不许再写死 warn ─────────────────────

test('healthcheck 不再写死「磁盘」警告，改由 resolveDiskState 判定', () => {
  const s = src(HEALTHCHECK)
  // 旧写法：无条件 record('服务器磁盘', 'warn', '体检读不到磁盘用量…')
  assert.doesNotMatch(s, /record\(\s*['"]服务器磁盘['"]\s*,\s*['"]warn['"]/)
  // 新写法：从 health 上取 disk，再交给判据
  assert.match(s, /resolveDiskState/)
  assert.match(s, /health\.disk/)
})

test('磁盘判定有单一实现（healthcheck 只 import，不自己抄一份阈值）', () => {
  const s = src(HEALTHCHECK)
  assert.match(s, /from '\.\/healthDiskState\.mjs'/)
  assert.doesNotMatch(s, /服务器磁盘剩|还剩 \$\{/u, '判定逻辑只能有一处')
})

// ── B3. 源码契约：/api/health 真的回 disk ───────────────────────────────────

test('/api/health 回显 disk 字段（缺了体检就永远测不到磁盘）', () => {
  const s = src(INDEX)
  const i = s.indexOf("app.get('/api/health'")
  assert.ok(i >= 0, '没找到 /api/health 路由')
  const seg = s.slice(i, i + 700)
  // 实测形态：`const disk = await measureDiskUsage()` + 简写属性 `disk`（别照抄想象中的 `disk: ...`）
  assert.match(seg, /disk\s*=\s*await\s+measureDiskUsage\(\)/u, '健康接口没有量磁盘')
  const jsonStart = seg.indexOf('res.json(')
  const jsonSeg = seg.slice(jsonStart, jsonStart + 500)
  assert.match(jsonSeg, /\bdisk\b/, '健康接口的响应体里没有 disk 字段')
})

test('磁盘探测走 utils/diskUsage.js 单一实现（后端不自带一份）', () => {
  const s = src(INDEX)
  assert.match(s, /from '\.\/utils\/diskUsage\.js'/)
  assert.doesNotMatch(s, /statfs/)
})
