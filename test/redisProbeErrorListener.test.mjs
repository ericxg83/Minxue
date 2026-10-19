// 回归锁（2026-10-19 r308）：RedisManager 熔断自愈回探的临时 client 必须挂 error 监听。
//
// 背景（本轮实测，不是推理）：
//   defbd6d 的 probeInstance 每次回探都新建一个 ioredis client，但没挂 error 监听。
//   r308 只读探针对真实 Upstash 三路径实测（server/_diag_r308_probeclient.mjs，用完已删）：
//     ① 真实超额主库（ERR max requests limit exceeded，Usage 500003/500000）
//     ② 真实已恢复备库（GET 成功）
//     ③ 不存在域名（getaddrinfo ENOTFOUND，连接级错误）
//   三条路径 uncaughtException 计数均为 0 ⇒ 缺监听**不是**崩溃缺陷。
//   根因在 ioredis built/Redis.js:528-534 的 silentEmit 兜底：有监听才 emit，
//   无监听仅 console.error 一行 "[ioredis] Unhandled error event"。
//   但代价是：被熔断实例每次回探失败都往日志堆一条「看似未处理崩溃」的噪音
//   （主库熔断到月底 ≈ 每 15min 一条），真事故时反而干扰判读 ⇒ 补监听，本锁防复发。
//
// 锁三条：
//   ① probeInstance 必须给临时 client 挂 error 监听（剔注释后判，防注释里写假Token）；
//   ② 监听必须挂在发起探测 GET **之前**（挂在后面对 error 事件毫无意义）；
//   ③ 锚点必须可定位（方法体切分依赖 probeInstance / scheduleMonthlyReset 两个声明）。
//
// 反向自检（内联合成坏样本，不依赖 git、不 spawn）：摘掉监听行 / 只把监听写进注释 /
// 把监听挪到 GET 之后，三种坏样本必须分别判红并点名①②。非空锁。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const REDIS_MANAGER_PATH = new URL('../server/redisManager.js', import.meta.url)

/** 剥掉 JS 注释（块 + 行；行注释前的字符非 ':'，避免误伤 rediss:// 之类） */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** 取 probeInstance 方法体（声明处到下一个方法声明 scheduleMonthlyReset） */
function probeInstanceBody(src) {
  const start = src.indexOf('async probeInstance(')
  if (start < 0) throw new Error('③ 锚点缺失：probeInstance 方法必须存在')
  const end = src.indexOf('scheduleMonthlyReset', start)
  if (end < 0) throw new Error('③ 锚点缺失：probeInstance 之后的 scheduleMonthlyReset 必须存在')
  return stripComments(src.slice(start, end))
}

/** 三条判据（收集全部失败再抛，便于反向自检点名） */
function assertProbeErrorListener(src) {
  const body = probeInstanceBody(src)
  const fails = []
  const listenerRe = /client\.on\(\s*['"]error['"]/
  const listenerIdx = body.search(listenerRe)
  const getIdx = body.indexOf('REDIS_BREAKER_PROBE_KEY')
  if (listenerIdx < 0) fails.push('① 探针临时 client 必须挂 error 监听')
  else if (getIdx < 0) fails.push('③ 探测命令 REDIS_BREAKER_PROBE_KEY 必须存在')
  else if (listenerIdx > getIdx) fails.push('② error 监听必须挂在发起探测 GET 之前')
  assert.equal(fails.length, 0, `probeInstance error 监听判据失败：\n- ${fails.join('\n- ')}`)
}

test('探针 client 挂 error 监听且在 GET 之前（真实源码）', () => {
  assertProbeErrorListener(readFileSync(REDIS_MANAGER_PATH, 'utf8'))
})

test('反向自检①：摘掉监听行（defbd6d 旧版形态）必须判红', () => {
  const src = readFileSync(REDIS_MANAGER_PATH, 'utf8')
  const start = src.indexOf('async probeInstance(')
  const end = src.indexOf('scheduleMonthlyReset', start)
  const broken = src.slice(0, start)
    + src.slice(start, end).replace(/\n\s*client\.on\('error'[^\n]*(?=\n)/, '')
    + src.slice(end)
  assert.notEqual(broken, src, '注入必须被证实生效（监听行被摘掉）')
  assert.throws(() => assertProbeErrorListener(broken), /①/, '旧版形态必须判红且点名①（非空锁）')
})

test('反向自检②：监听只写进注释必须判红（证明判据剔注释）', () => {
  const src = readFileSync(REDIS_MANAGER_PATH, 'utf8')
  const start = src.indexOf('async probeInstance(')
  const end = src.indexOf('scheduleMonthlyReset', start)
  const broken = src.slice(0, start)
    + src.slice(start, end).replace(/(\n\s*)client\.on\('error'[^\n]*(?=\n)/, '$1// client.on(\'error\', () => {})\n')
    + src.slice(end)
  assert.notEqual(broken, src, '注入必须被证实生效（监听行被注掉）')
  assert.ok(!/client\.on\(\s*['"]error['"]/.test(probeInstanceBody(broken)), '注释形态不得被算作监听')
  assert.throws(() => assertProbeErrorListener(broken), /①/, '注释假Token必须判红（非空锁）')
})

test('反向自检③：监听挪到探测 GET 之后必须判红（②）', () => {
  const src = readFileSync(REDIS_MANAGER_PATH, 'utf8')
  const start = src.indexOf('async probeInstance(')
  const end = src.indexOf('scheduleMonthlyReset', start)
  const body = src.slice(start, end)
  const listenerLine = body.match(/\n\s*client\.on\('error'[^\n]*(?=\n)/)
  assert.ok(listenerLine, '锚点：监听行必须存在')
  const withoutListener = body.replace(listenerLine[0], '')
  const getLineRe = /\n(\s*)await client\.get\(REDIS_BREAKER_PROBE_KEY\)/
  assert.ok(getLineRe.test(withoutListener), '锚点：探测 GET 行必须存在')
  const moved = withoutListener.replace(getLineRe, (m, indent) => `${m}${listenerLine[0].replace(/\n\s*/, `\n${indent}`)}`)
  const broken = src.slice(0, start) + moved + src.slice(end)
  assert.notEqual(broken, src, '注入必须被证实生效（监听行被挪到 GET 后）')
  assert.throws(() => assertProbeErrorListener(broken), /②/, '顺序坏样本必须判红且点名②（非空锁）')
})
