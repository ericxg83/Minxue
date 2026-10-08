// 回归测试：每日备份脚本「成功/失败口径」（2026-10-05 r159 修）
//
// 缺陷（实测 sources/dailyBackup.mjs 原版）：
//   ① 全文 0 处 process.exit —— 调用方只能靠隐式抛错判断成败，没有显式失败信号；
//   ② 核心表 0 行照样写空 JSON + 打「完成」—— 连错库 / 库被清空时**谎报平安**；
//   ③ 快照目录名用 toISOString()（UTC，本地 00:00~08:00 会写成**昨天**），
//      而同一份文件的轮换判断用 +08:00 —— 一个文件里两种时区口径；
//   ④ manifest.json 只在全表成功后写 —— 半途失败留下「残缺却看不出来」的快照，
//      30 天后才被轮换掉。
//
// 本锁分两层：
//   A. 真跑纯函数（backupKit 的三个函数都是纯计算，可以直接喂造出来的时刻）；
//   B. 源码契约（对 dailyBackup.mjs 逐条判据）。
// 反向自检：同一把判据套「旧行为」样本必须判红——否则这把锁是空锁。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  BACKUP_ROOT,
  KEEP_DAYS,
  TABLES,
  assessBackupResult,
  planExpiredSnapshots,
  snapshotDirName,
} from '../scripts/backupKit.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const SCRIPT = 'scripts/dailyBackup.mjs'
const scriptSrc = () => readFileSync(resolve(ROOT, SCRIPT), 'utf8')

// ── A1. 快照目录名必须走本地日历日（Asia/Shanghai），不是 UTC ──────────────

test('快照目录名 = 本地日历日，本地 00:00~08:00 不得退化成昨天', () => {
  // 本地 2026-10-06 00:00 (+08:00) = UTC 2026-10-05 16:00
  const midnightLocal = new Date('2026-10-05T16:00:00Z')
  assert.equal(snapshotDirName(midnightLocal), '2026-10-06')
  // 与 UTC 口径对照：toISOString 此刻会印 10-05 —— 这正是要防的错
  assert.equal(midnightLocal.toISOString().slice(0, 10), '2026-10-05')
  assert.notEqual(snapshotDirName(midnightLocal), midnightLocal.toISOString().slice(0, 10))
})

test('快照目录名在白天与 UTC 一致（不误伤正常时段）', () => {
  // 本地 2026-10-06 09:00 (+08:00) = UTC 2026-10-06 01:00，两种口径同日
  const morning = new Date('2026-10-06T01:00:00Z')
  assert.equal(snapshotDirName(morning), '2026-10-06')
  assert.equal(snapshotDirName(morning), morning.toISOString().slice(0, 10))
})

test('跨月/跨年边界仍按本地日（1 月 1 日零点不能退化成上一年 12-31）', () => {
  const newYear = new Date('2025-12-31T16:00:00Z') // = 本地 2026-01-01 00:00
  assert.equal(snapshotDirName(newYear), '2026-01-01')
  assert.notEqual(snapshotDirName(newYear), newYear.toISOString().slice(0, 10))
})

// ── A2. 备份结果判定：核心表空 ⇒ 不成立（不许谎报成功）────────────────────

test('核心表都取到行 ⇒ 备份成立', () => {
  const r = assessBackupResult({ tables: { students: 21, tasks: 480, wrong_questions: 900, questions: 5000, knowledge_mastery: 300 } })
  assert.deepEqual(r, { ok: true, emptyTables: [] })
})

test('任何一张核心表 0 行 ⇒ 备份不成立，且点名是哪张表', () => {
  const r = assessBackupResult({ tables: { students: 21, tasks: 480, wrong_questions: 0, questions: 5000, knowledge_mastery: 300 } })
  assert.equal(r.ok, false)
  assert.deepEqual(r.emptyTables, ['wrong_questions'])
})

test('表没被导出（键缺失，半途失败）也算不成立', () => {
  const r = assessBackupResult({ tables: { students: 21 } })
  assert.equal(r.ok, false)
  assert.deepEqual(r.emptyTables, TABLES.filter((t) => t !== 'students'))
})

test('空 tables / 坏结构 ⇒ 不成立（fail-closed，不许默认通过）', () => {
  assert.equal(assessBackupResult({ tables: {} }).ok, false)
  assert.equal(assessBackupResult({}).ok, false)
  assert.equal(assessBackupResult(null).ok, false)
  assert.equal(assessBackupResult({ tables: { tasks: 'abc' } }).ok, false)
})

// ── A3. 过期轮换：只认合法目录名，边界「刚好 30 天」不删 ───────────────────

test('只删超过保留天数的合法快照目录，非快照目录一律不碰', () => {
  const now = new Date(2026, 9, 5, 12, 0, 0) // 本地 2026-10-05 12:00
  const gone = planExpiredSnapshots(
    ['2026-09-01', '2026-09-05', '2026-10-01', '2026-10-05', 'readme.txt', '2026-11-01', '.DS_Store', '2026-13-01'],
    now,
    30,
  )
  // 09-01 = 34.5 天 > 30；09-05 = 30.5 天 > 30（也超了）；10-01 = 4.5 天；
  // 10-05 = 0.5 天；readme.txt / .DS_Store / 未来日 / 非法月 2026-13-01 都不删
  assert.deepEqual(gone, ['2026-09-01', '2026-09-05'])
})

test('轮换判据是「> 保留天数」，刚好一天不多就留着', () => {
  const now = new Date(2026, 9, 5, 0, 0, 0) // 本地 2026-10-05 00:00
  assert.deepEqual(planExpiredSnapshots(['2026-09-05'], now, 30), [])
  assert.deepEqual(planExpiredSnapshots(['2026-09-04'], now, 30), ['2026-09-04'])
})

test('保留天数可注入（默认走 KEEP_DAYS = 30）', () => {
  const now = new Date(2026, 9, 5, 0, 0, 0)
  assert.equal(KEEP_DAYS, 30)
  assert.deepEqual(planExpiredSnapshots(['2026-09-20'], now, 7), ['2026-09-20'])
  assert.deepEqual(planExpiredSnapshots(['2026-09-20'], now, 30), [])
})

// ── B. 源码契约 + 反向自检 ─────────────────────────────────────────────────

/**
 * 对一份 dailyBackup 源码逐条判据，返回违例清单（空数组 = 全过）。
 * 反向自检时把这把判据套旧版，必须不是空数组，否则说明是空锁。
 */
export function auditBackupScript(src) {
  const bad = []
  const has = (re) => re.test(src)

  // ① 必须有显式失败退出码（调用方靠它判断「今天没备份上」）
  if (!has(/process\.exit\(\s*1\s*\)/)) bad.push('R1:必须显式 process.exit(1) 表示失败')
  // ② 必须有显式成功退出码
  if (!has(/process\.exit\(\s*0\s*\)/)) bad.push('R2:必须显式 process.exit(0) 表示成功')
  // ③ 快照目录名不得用 UTC 印日期
  if (has(/\.toISOString\(\)\s*\.\s*slice\(\s*0\s*,\s*10\s*\)/)) {
    bad.push('R3:目录名不得用 toISOString()（UTC 会在本地 00:00~08:00 退化成昨天）')
  }
  // ④ manifest 必须在 finally 里写（半途失败也要留一份，能看出 ok:false）
  const poolIdx = src.indexOf('const pool = getPool()')
  if (!has(/finally\s*\{[\s\S]*?manifest\.json/)) bad.push('R4:manifest.json 必须在 finally 里写（失败也要留痕）')
  // ⑤ 必须引 backupKit 的空表判定，不能自己「写完就算成功」
  if (poolIdx <= 0 || !has(/from '\.\/backupKit\.mjs'/)) {
    bad.push('R5:必须引 backupKit（空表/fail-closed 口径只有一处实现）')
  }
  // ⑥ 成败判定必须**真的调用** assessBackupResult（光 import 不算，import 行里也有这串字）
  const mainBody = poolIdx > 0 ? src.slice(poolIdx) : ''
  if (!has(/assessBackupResult\(/)) bad.push('R6:主流程必须调用 assessBackupResult 判定成败（禁自己写完就算成功）')
  if (mainBody && !/assessBackupResult\(/.test(mainBody)) {
    bad.push('R6:assessBackupResult 必须在主流程里被调用')
  }
  // ⑦ 核心取数路径禁止静默 catch
  if (/catch\s*\(\s*\w+\s*\)\s*\{\s*\}/.test(mainBody)) bad.push('R7:核心取数路径不得有空 catch')
  if (!has(/manifest\.error\s*=/)) bad.push('R8:失败必须写进 manifest.error（留痕）')
  void has
  return bad
}

/** 旧行为样本（修复前的写法形态，用来证明判据不是空锁） */
const OLD_STYLE = `
const pool = getPool()
const today = new Date().toISOString().slice(0, 10)
const manifest = { date: today, createdAt: new Date().toISOString(), tables: {} }
try {
  for (const table of TABLES) {
    const { rows } = await pool.query('SELECT * FROM ' + table)
    fs.writeFileSync(file, JSON.stringify(rows))
    manifest.tables[table] = rows.length
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log('完成')
} finally { await pool.end() }
`

test('现行 dailyBackup.mjs 必须逐条满足成败口径', () => {
  assert.deepEqual(auditBackupScript(scriptSrc()), [])
})

test('★反向自检：同一把判据套「旧行为」必须判红（锁不能是空锁）', () => {
  const violations = auditBackupScript(OLD_STYLE)
  assert.ok(violations.length >= 5, `旧行为应触发多条判据，实际 ${violations.length}: ${violations.join(' | ')}`)
  // 逐条点名，避免「恰好撞中一条」的假通过
  for (const id of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R8']) {
    assert.ok(
      violations.some((v) => v.startsWith(id)),
      `反向自检漏判 ${id}（说明判据没写到位）`,
    )
  }
})

test('★反向自检（真回退）：把当前脚本改回旧写法形态必须判红', () => {
  const src = scriptSrc()
  // 逐条把修复点改回旧写法，看判据是否都能抓到
  const regressions = {
    '去掉失败退出码': src.replace(/process\.exit\(\s*1\s*\)/, '/* no exit */'),
    '目录名退回 toISOString': src.replace(
      /snapshotDirName\(new Date\(\)\)/,
      "new Date().toISOString().slice(0, 10)",
    ),
    '成败判定退回「写完就算成功」': src.replace(/assessBackupResult\(manifest\)/, '({ ok: true, emptyTables: [] })'),
    'manifest 改成只在成功后写': src.replace(
      /\} finally \{\n([\s\S]*?)\n\}/,
      (m, body) => `  if (manifest.ok) {\n${body}\n  }\n  } finally {`,
    ),
  }
  for (const [label, mutated] of Object.entries(regressions)) {
    const bad = auditBackupScript(mutated)
    assert.ok(bad.length > 0, `回退「${label}」后判据竟全过 —— 锁失效了`)
  }
})

// ── C. 备份面本身（防止以后改 TABLES 时漏表）──────────────────────────────

test('备份核心表覆盖面没被偷偷缩小（至少含学生/作业/错题/题目/掌握度）', () => {
  for (const t of ['students', 'tasks', 'wrong_questions', 'questions', 'knowledge_mastery']) {
    assert.ok(TABLES.includes(t), `核心表漏备份：${t}`)
  }
  // r246：原写法是 `assert.ok(existsSync(resolve(ROOT, BACKUP_ROOT)) || true, ...)` ——
  //   `|| true` 让整条断言恒真 ⇒ 一次都没查过（目录不存在时它照样绿）。
  //   判据改成真正会失败的那种：常量本身必须是非空字符串（下一行再管它的形状）。
  assert.ok(typeof BACKUP_ROOT === 'string' && BACKUP_ROOT.length > 0, 'BACKUP_ROOT 必须是非空字符串常量')
  assert.ok(BACKUP_ROOT.startsWith('D:/'), '备份根目录必须是本地磁盘常量（当前常量 changed）')
})
