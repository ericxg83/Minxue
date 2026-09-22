/**
 * 锁定两个「诊断/看门狗自身写错，反而掩盖真实问题」的 bug（2026-09-22 修复）。
 *
 * 这类 bug 的特点：**不报错、不崩溃，只是安静地把错误信息变成假的**，
 * 因此只能靠静态断言守住，不能靠行为测试。
 *
 *  ① `config/ai.js` 的 400 诊断把**请求体参数**遮蔽成了响应体
 *     （`const body = err.response?.data`）→ `model=` 恒打印 `(unknown)`、
 *     `dataSize` 恒是响应体大小（~72B）、`imageBase64Size` 恒 0。
 *     危害：据此误判「答案引擎备用链漏传 model」，把矛头指向了无辜的备用链。
 *
 *  ② `pendingTaskRecovery.js` 的 24h 几何看门狗查重循环里把局部变量
 *     `geometryQueue` 误写成 `queue` → ReferenceError 被 catch 吞掉 →
 *     `alreadyQueued` 恒为空集 → 已在队列的资产被**重复入队**，
 *     正好抵消同段注释声明的防重意图。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const AI_JS_RAW = readFileSync(resolve(__dirname, '../server/config/ai.js'), 'utf8')
const RECOVERY_JS_RAW = readFileSync(resolve(__dirname, '../server/pendingTaskRecovery.js'), 'utf8')

/**
 * 去掉整行注释后再断言。
 *
 * 为什么必须这样：修复时会在注释里引用**旧代码的字面串**（例如
 * 「原先这里写 `const body = err.response?.data`」）。若直接扫原文，
 * 这些注释会把「禁止出现」类断言打回失败 —— 断言就变成了「不许写清楚修了什么」。
 * 只按行首 `//` 过滤（不做全量词法分析），足以覆盖本仓两文件的注释风格。
 */
const codeOnly = (src) =>
  src
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      return !(t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('*/'))
    })
    .join('\n')

const AI_JS = codeOnly(AI_JS_RAW)
const RECOVERY_JS = codeOnly(RECOVERY_JS_RAW)

// ── ① 400 诊断不得再遮蔽请求体 ────────────────────────────────────────────

test('400 诊断：请求体与响应体必须是两个变量（reqBody / respBody）', () => {
  assert.ok(
    AI_JS.includes('const reqBody = body'),
    '未找到 `const reqBody = body` —— 请求体必须以 reqBody 暴露给诊断日志'
  )
  assert.ok(
    AI_JS.includes('const respBody = err.response?.data'),
    '未找到 `const respBody = err.response?.data` —— 响应体须单独命名'
  )
})

test('400 诊断：禁止再把请求体参数遮蔽成响应体', () => {
  assert.ok(
    !AI_JS.includes('const body = err.response?.data'),
    '检测到 `const body = err.response?.data` —— 它会把请求体参数遮蔽成响应体，' +
      '导致 model 恒打印 (unknown)。请改用 reqBody / respBody。'
  )
})

test('400 诊断：model 取自请求体，错误文案取自响应体', () => {
  assert.ok(
    AI_JS.includes('`model=${reqBody?.model'),
    'model 必须取自 reqBody（否则永远报不出真正发出去的模型）'
  )
  assert.ok(
    AI_JS.includes('`errorMsg=${respBody?.error?.message'),
    'errorMsg 必须取自 respBody（上游错误文案在响应体里）'
  )
})

// ── ② 几何看门狗查重不得用未定义的 queue ─────────────────────────────────

test('几何看门狗：scanOverdueGeometry 存在且使用 geometryQueue 查重', () => {
  const start = RECOVERY_JS.indexOf('async scanOverdueGeometry()')
  assert.ok(start > -1, '未找到 scanOverdueGeometry（函数被改名/删除？测试需同步更新）')
  const body = RECOVERY_JS.slice(start)

  assert.ok(
    body.includes('await geometryQueue.getJobs('),
    'scanOverdueGeometry 内必须用 geometryQueue.getJobs 读取在队作业'
  )
})

test('几何看门狗：scanOverdueGeometry 内不得出现裸 queue.getJobs', () => {
  const start = RECOVERY_JS.indexOf('async scanOverdueGeometry()')
  assert.ok(start > -1, '未找到 scanOverdueGeometry')
  const body = RECOVERY_JS.slice(start)

  // ⚠️ 必须带前导非标识符边界：`geometryQueue.getJobs` 里也含有子串 `queue.getJobs`，
  //    用 [^A-Za-z] 才能把「裸 queue」与「geometryQueue」区分开。
  const bare = body.match(/[^A-Za-z]queue\.getJobs/)
  assert.equal(
    bare,
    null,
    '检测到裸 `queue.getJobs` —— 本函数局部变量叫 geometryQueue，' +
      '裸 queue 会抛 ReferenceError 并被 catch 吞掉，使查重失效、资产被重复入队'
  )
})

test('几何看门狗：孪生函数 scanGeometryAssets 同样使用 geometryQueue', () => {
  const start = RECOVERY_JS.indexOf('async scanGeometryAssets()')
  assert.ok(start > -1, '未找到 scanGeometryAssets')
  const end = RECOVERY_JS.indexOf('async scanOverdueGeometry()')
  const body = RECOVERY_JS.slice(start, end > start ? end : undefined)
  assert.ok(
    body.includes('await geometryQueue.getJobs('),
    'scanGeometryAssets 必须以 geometryQueue 查重（两处口径必须一致）'
  )
})
