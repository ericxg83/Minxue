/**
 * 回归锁：**恒真断言**（永远不可能失败的断言）不得再进测试套件（r246）
 *
 * 缺陷（实测，非推理）：`assert.ok(<表达式> || true, '...')` 里的 `|| true`
 * 让整条断言恒为真 ⇒ 它长得像一道门禁，实际一次都没查过。
 * 全仓实测命中 2 处：
 *   ① `test/dailyBackupResult.test.mjs` —— 「BACKUP_ROOT 常量必须存在」；
 *   ② `test/geomConstraintExtract.test.mjs` —— 「结论式不得进约束集」（几何配图链上最该盯的一句）。
 * 两处都已改成真正会失败的写法；本锁负责不让新的再长出来。
 *
 * 判据只有一份实现（`test/assertionVacuityKit.mjs`），扫描侧与自检侧共用，
 * 免得两边各抄一套、迟早漂移成假绿（r215 教训）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { findVacuousAssertions, maskLiteralsAndComments } from './assertionVacuityKit.mjs'
import { MUST_COVER, MAIN_GLOB_RE } from './testSuiteCoverageKit.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** 坏样本里**真实存在过**的那两行（逐字，来自修复前的两个测试文件）。 */
const REAL_OLD_LINES = [
  "assert.ok(existsSync(resolve(ROOT, BACKUP_ROOT)) || true, 'BACKUP_ROOT 常量必须存在')",
  "assert.ok(!eqDropped || true, '结论式可被丢弃或忽略，但不能进约束集')",
]

/** `npm test` 实际会跑到的全部测试文件（与 testSuiteCoverageKit 的判据同源）。 */
function listSuiteFiles() {
  const files = []
  for (const f of fs.readdirSync(path.join(ROOT, 'test'))) {
    if (MAIN_GLOB_RE.test('test/' + f)) files.push('test/' + f)
  }
  for (const f of MUST_COVER) files.push(f)
  return files
}

// ── 1. 坏样本逐条判红（含两处真实旧写法）────────────────────────────────────
test('恒真断言：坏样本逐条判红，两处真实旧写法必须被点名', () => {
  const src = read('test/fixtures/vacuousAssertBad.txt')

  // 自证钩子（r211 同款）：先证明 fixture 里**逐字**躺着那两条真实旧写法，
  // 否则探针可能拿着一句自己编的近似文本在跑，测了个寂寞。
  for (const line of REAL_OLD_LINES) {
    assert.ok(src.includes(line), `坏样本 fixture 里必须逐字包含真实旧写法：${line}`)
  }

  const hits = findVacuousAssertions(src)
  assert.equal(hits.length, 8, `坏样本应命中 8 条，实际 ${hits.length}：${JSON.stringify(hits.map((h) => h.line))}`)

  // 两处真实旧写法各自落在 fixture 的第 1、2 行，必须都被抓到
  const lines = src.split('\n')
  for (const line of REAL_OLD_LINES) {
    const lineNo = lines.findIndex((l) => l === line) + 1
    assert.ok(lineNo > 0, `fixture 里找不到这一行：${line}`)
    assert.ok(
      hits.some((h) => h.line === lineNo),
      `第 ${lineNo} 行的恒真断言没被抓到：${line}`
    )
  }

  // 跨行写法（第 8 行起）也要抓到 —— 括号配对必须扛得住换行
  assert.ok(hits.some((h) => h.line === 8), '跨行写的 `assert.ok(... \\n || true)` 没被抓到')
  for (const h of hits) {
    assert.ok(h.reason.includes('永远为真'), `命中理由要说清后果：${JSON.stringify(h)}`)
  }
})

// ── 2. 好样本零误报（判据不许变成新的假红源，r214 教训）────────────────────
test('恒真断言：好样本零误报', () => {
  const hits = findVacuousAssertions(read('test/fixtures/vacuousAssertGood.txt'))
  assert.deepEqual(hits.map((h) => h.line), [], `不该报的行被报了：${JSON.stringify(hits)}`)
})

// ── 3. 字符串与注释里的同款写法不算违规（自豁免洞已堵）────────────────────
test('恒真断言：注释与字符串里的同款写法不算违规（本判据因此无需给自己开豁免）', () => {
  const src = [
    "// 反面教材：assert.ok(x || true, '别这么写')",
    '/* 块注释里也一样',
    "   assert.ok(y || true, '别这么写')",
    '*/',
    `const sample = 'assert.ok(z || true, "文案里的样本")'`,
    "assert.ok(count > 0, '真断言')",
  ].join('\n')
  assert.deepEqual(findVacuousAssertions(src), [], '注释/字符串里的样本被误报了')

  // 掩码本身必须等长、等行号 —— 否则上面报的行号全是错的
  const masked = maskLiteralsAndComments(src)
  assert.equal(masked.length, src.length, '掩码改变了长度')
  assert.equal(masked.split('\n').length, src.split('\n').length, '掩码改变了行号')
})

// ── 4. 真实测试文件全量扫描：一处都不许有 ─────────────────────────────────
test('恒真断言：真实测试套件里 0 处恒真断言（扫描清单非空，fail-closed）', () => {
  const files = listSuiteFiles()
  // 元判据：扫不到文件时不许判绿 —— 否则扫描一坏，这把锁就退化成永真（r216 教训）
  assert.ok(files.length > 10, `扫描到的测试文件太少（${files.length}）—— 扫描本身失效了，不能判绿`)
  assert.ok(files.includes('test/dailyBackupResult.test.mjs'), '扫描清单里缺 dailyBackupResult（判据口径变了？）')
  assert.ok(files.includes('test/geomConstraintExtract.test.mjs'), '扫描清单里缺 geomConstraintExtract（判据口径变了？）')

  const offenders = []
  for (const f of files) {
    const abs = path.join(ROOT, f)
    assert.ok(fs.existsSync(abs), `${f} 不在磁盘上 —— 清单与磁盘不一致，不能判绿`)
    for (const h of findVacuousAssertions(fs.readFileSync(abs, 'utf8'))) {
      offenders.push(`${f}:${h.line}  ${h.expr}  —— ${h.reason}`)
    }
  }
  assert.deepEqual(offenders, [], `测试套件里还有恒真断言（永远不会失败）：\n  ${offenders.join('\n  ')}`)
})

// ── 5. 反向自检：把两处真实缺陷原样写回去，判据必须判红 ────────────────────
test('恒真断言：反向自检 —— 真实旧写法原样放回必须判红', () => {
  for (const line of REAL_OLD_LINES) {
    const hits = findVacuousAssertions(line)
    assert.equal(hits.length, 1, `这条真实旧写法应被抓到 1 条：${line}`)
  }
  // 修复后的写法必须判绿（证明改的是「恒真」而不是把断言删了）
  assert.deepEqual(findVacuousAssertions("assert.ok(typeof BACKUP_ROOT === 'string' && BACKUP_ROOT.length > 0)"), [])
  assert.deepEqual(
    findVacuousAssertions("assert.equal(constraints.filter((c) => String(c.raw || '').includes('BD')).length, 0)"),
    []
  )
})
