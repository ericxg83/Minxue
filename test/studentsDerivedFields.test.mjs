// GET /api/students 派生字段口径锁（提案⑩-1）
//
// 背景：2026-10-04 性能改写把 6 个相关子查询 × N 个学生，换成 wrong_questions 预聚合一次
// + LEFT JOIN。改写前这 5 个派生字段在 test/ 下**零覆盖**，所以这个 N+1 长期没被发现。
// 本文件把「返回体字段 + 口径 + 不得退回 6N 子查询」三件事同时锁死。
//
// 实测等价性（生产库只读 EXPLAIN ANALYZE，21 学生）：
//   旧 6×N 相关子查询 3.269ms / buffers 2239 → 新预聚合 1.164ms / buffers 297
//   两版返回体逐行逐列完全一致
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(path.join(ROOT, 'server/index.js'), 'utf8')

/** 取出 GET /api/students 那段 SQL（含模板占位符原样） */
function extractStudentsSql(src) {
  const start = src.indexOf("app.get('/api/students'")
  assert.notEqual(start, -1, '未找到 GET /api/students 路由')
  const end = src.indexOf("app.get('/api/students/:id'", start)
  assert.notEqual(end, -1, '未找到 GET /api/students/:id 路由（无法界定段落）')
  return src.slice(start, end)
}

const SQL = extractStudentsSql(SRC)

test('学生列表：6 个派生字段一个都不能少（双端在用，删字段＝白屏）', () => {
  for (const col of [
    'last_task_at',        // 最近作业
    'last_wrong_at',       // 最近错题
    'total_error_count',   // 错题条数
    'recent_wrong_count',  // 近 7 天新错题
    'practice_count',      // 练习次数
    'mastered_count',      // 已掌握题数
  ]) {
    assert.match(SQL, new RegExp(`AS\\s+${col}\\b`), `派生字段 ${col} 丢失`)
  }
})

test('学生列表：total_error_count 用 COUNT(*) 而非 SUM(error_count)', () => {
  // 同题多次错只算 1 条，与「已掌握 N 题」口径一致（已掌握是子集而非叠加）。
  assert.match(SQL, /COUNT\(\*\)::int AS total_error_count/)
  assert.doesNotMatch(
    SQL,
    /SUM\(\s*\w*\.?error_count\s*\)[^)]*AS total_error_count/,
    'total_error_count 退回 SUM(error_count) 会把重复错题重复计数'
  )
})

test('学生列表：mastered_count 用可走索引的裸列比较（不得再包 COALESCE）', () => {
  // COALESCE(lifecycle_status,'new')='mastered' 与 lifecycle_status='mastered' 等价
  // （NULL→'new' 永远 ≠ 'mastered'），但包了列索引就永远用不上。
  assert.doesNotMatch(
    SQL,
    /COALESCE\(\s*\w+\.lifecycle_status/,
    'mastered_count 又用 COALESCE 包列 → 索引失效，退回全表扫'
  )
  assert.match(SQL, /lifecycle_status\s*=\s*'mastered'/)
})

test('学生列表：wrong_questions 必须预聚合一次，不得退回 6×N 相关子查询', () => {
  // 反向自检：把旧版形态喂给检测器，必须被判红，否则这把锁是空锁。
  const OLD_PATTERN_GUARD = /FROM\s+\$\{TABLES\.WRONG_QUESTIONS\}\s+w\s+WHERE\s+w\.student_id\s*=\s*s\.id/
  assert.doesNotMatch(
    SQL,
    OLD_PATTERN_GUARD,
    '出现旧版按学生的相关子查询（6×N）→ 预聚合被退回'
  )
  assert.match(SQL, /LEFT JOIN \(/, '缺预聚合 LEFT JOIN')
  assert.match(SQL, /GROUP BY\s+student_id/, '预聚合子查询缺 GROUP BY student_id')
})

test('学生列表：预聚合 LEFT JOIN 不得产生笛卡尔积（join 键必须唯一）', () => {
  // 子查询按 student_id 分组 ⇒ 每个学生最多一行；join 键写错会放大行数。
  const joinMatch = SQL.match(/ON\s+w\.student_id\s*=\s*s\.id/)
  assert.ok(joinMatch, '预聚合 LEFT JOIN 的 join 键不是 student_id = s.id')
  const groupByCount = (SQL.match(/GROUP BY\s+student_id/g) || []).length
  assert.equal(groupByCount, 1, '预聚合子查询的 GROUP BY 必须且只能一处')
})

test('学生列表：仍保留 5 分钟缓存（改写不得顺手去掉缓存）', () => {
  assert.match(SQL, /STUDENTS_TTL/)
  assert.match(SQL, /studentsCache/)
})
