// Neon 连接池配置口径锁（提案⑮）
//
// 背景：池原来只设 max:10、没设 min，而 idleTimeoutMillis:10000 会把空闲连接全回收，
// 导致「空闲后第一个请求」要重新付建连成本。实测 513ms → 加 min:1 后 78ms（省 435ms）。
// 这是「隔一段时间打开 App 要重新加载、而且要很久」的根因之一。
//
// 本锁同时锁住 min:1 所依赖的三项安全前提，防止后人改配置时连带拆掉风险缓解：
//   ① keepAlive + keepAliveInitialDelayMillis —— 能识别被掐断的连接
//   ② idleTimeoutMillis 仍是 10000 —— 没为了保连接而放宽（放宽会把死连接风险带回来）
//   ③ pool.on('error') 监听 —— 异常连接会被剔除并留痕
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(path.join(ROOT, 'server/config/neon.js'), 'utf8')

// 只取 new Pool({...}) 那一段，避免误匹配到文件其它地方
function poolConfig() {
  const start = SRC.indexOf('new Pool({')
  assert.notEqual(start, -1, '未找到 new Pool({')
  const end = SRC.indexOf('})', start)
  assert.notEqual(end, -1, '未找到 Pool 配置结尾')
  return SRC.slice(start, end)
}
const CFG = poolConfig()

test('连接池：min 至少为 1（消掉空闲后首个请求的建连惩罚）', () => {
  const m = CFG.match(/\bmin:\s*(\d+)/)
  assert.ok(m, '连接池未配置 min —— 空闲后首个请求会重新付 ~435ms 建连成本（提案⑮）')
  assert.ok(Number(m[1]) >= 1, `min=${m[1]}，应为 >= 1`)
})

test('连接池：安全前提 keepAlive 仍在（min:1 依赖它识别死连接）', () => {
  assert.match(CFG, /keepAlive:\s*true/, 'keepAlive 被关掉 ⇒ 保底连接变死连接会抛 "Connection terminated unexpectedly"')
  assert.match(CFG, /keepAliveInitialDelayMillis:\s*\d+/, '缺 keepAliveInitialDelayMillis，探针不会生效')
})

test('连接池：idleTimeoutMillis 仍为 10000（不得为了保连接而放宽）', () => {
  // 放宽会把 2026-09-23 事故那类死连接风险带回来；真要调必须先另开一轮评估。
  const m = CFG.match(/idleTimeoutMillis:\s*(\d+)/)
  assert.ok(m, '缺 idleTimeoutMillis')
  assert.equal(Number(m[1]), 10000, `idleTimeoutMillis 被改成 ${m[1]}，需重新评估死连接风险`)
})

test('连接池：建连超时仍为 20000ms（不得退回 5s）', () => {
  const m = CFG.match(/connectionTimeoutMillis:\s*(\d+)/)
  assert.ok(m, '缺 connectionTimeoutMillis')
  assert.equal(Number(m[1]), 20000, `建连超时被改成 ${m[1]}ms，新加坡 RTT 下会频繁建连失败`)
})

test('连接池：IPv4 优先解析仍在（绕开本机不通的 IPv6 优先顺序）', () => {
  assert.match(CFG, /lookup:\s*ipv4FirstLookup/, '丢了 ipv4FirstLookup ⇒ 本机会重新出现 connection timeout 卡顿')
  assert.match(SRC, /const ipv4FirstLookup =/, 'ipv4FirstLookup 实现被删')
})

test('连接池：error 监听仍在（异常连接要能被剔除并留痕）', () => {
  assert.match(SRC, /_pool\.on\(\s*'error'/, '缺 pool error 监听，异常连接不会被剔除')
})

test('连接池：查询失败仍上抛（不得新增静默吞错）', () => {
  // 长期记忆铁律 11：核心状态写入禁静默 catch；查询失败必须上抛。
  const qStart = SRC.indexOf('export const query')
  assert.notEqual(qStart, -1, '未找到 query 导出')
  const seg = SRC.slice(qStart, qStart + 900)
  assert.match(seg, /throw error/, 'query() 不再上抛错误 —— 会把数据库故障变成静默成功')
})
