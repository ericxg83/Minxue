// 回归测试：错题行「入册快照」补齐 SQL 的唯一口径
//
// 事故背景（2026-09-19 用户报障「学生原卷（整页图）就说无原卷图啊」）：
//   重练卷结算路径（gradingFinalizer.finalizeGeneratedExamResults）插入错题行时
//   只写生命周期字段，出处分（last_wrong_task_id / page_number / question_no /
//   content / question_type / block_coordinates）全为空。白板「原卷图」按
//   last_wrong_task_id 取 tasks.images ⇒ 取不到 ⇒ 弹窗恒显示「无原卷图」。
//   全库实测：694 行错题里 248 行缺出处、575 行缺卷面字段。
//
// 本测试锁定三件事：
//   ① 只补空不覆盖（每个字段必须 COALESCE(wq.<col>, q.<col>)，WHERE 必须有 IS NULL 判据）；
//   ② 参数显式类型转换（$1::uuid[] / $2::uuid），不依赖 PG 推断（同类事故 42804）；
//   ③ 结算写入侧必须复用本 SQL，且补齐动作在 INSERT 之后、exam.status 落库之前（同一事务）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildWrongQuestionSnapshotSql, SNAPSHOT_FIELDS } from '../server/utils/wrongQuestionSnapshot.js'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')
const FINALIZER = 'server/services/gradingFinalizer.js'

test('每个快照字段都必须 COALESCE(wq.col, q.col) —— 只补空，绝不覆盖已有值', () => {
  const sql = buildWrongQuestionSnapshotSql()
  for (const { col, src } of SNAPSHOT_FIELDS) {
    assert.ok(
      new RegExp(`${col}\\s*=\\s*COALESCE\\(`).test(sql),
      `字段 ${col} 必须用 COALESCE(wq.${col}, q.${src}) 补齐，不能直接赋值`
    )
  }
  // 反例守卫：出现 `SET <col> = q.` 说明有人把 COALESCE 拆了（会覆盖已有值）
  assert.equal(
    /\b(last_wrong_task_id|page_number|question_no|question_type|block_coordinates)\s*=\s*q\./.test(sql),
    false,
    '发现直接覆盖写法：必须保留 COALESCE 以只补空'
  )
})

test('WHERE 里逐字段带 IS NULL 判据 —— 只动真正会变的行', () => {
  const sql = buildWrongQuestionSnapshotSql()
  for (const { col, guard } of SNAPSHOT_FIELDS) {
    assert.ok(
      sql.includes(guard),
      `WHERE 必须包含「${guard}」判据，否则会全表空转写放大（字段 ${col}）`
    )
  }
})

test('参数必须显式类型转换，不依赖 PG 推断', () => {
  const sql = buildWrongQuestionSnapshotSql()
  assert.ok(sql.includes('$1::uuid[]'), '$1 必须显式 ::uuid[]')
  assert.ok(sql.includes('$2::uuid'), '$2 必须显式 ::uuid')
  const bare = (sql.match(/THEN \$\d+(?!::)/g) || [])
  assert.deepEqual(bare, [], `发现未加类型转换的 THEN 占位符：${bare.join(', ')}`)
})

test('结算写入侧必须复用同一 SQL，且补齐紧跟在错题 INSERT 之后', () => {
  const src = read(FINALIZER)
  const calls = src.match(/buildWrongQuestionSnapshotSql\(\)/g) || []
  assert.equal(calls.length, 1, 'gradingFinalizer 必须且只调用一次快照补齐 SQL')

  const fnStart = src.indexOf('export const finalizeGeneratedExamResults')
  assert.ok(fnStart > 0, '未找到 finalizeGeneratedExamResults')
  const body = src.slice(fnStart)
  const insertIdx = body.indexOf('INSERT INTO ${TABLES.WRONG_QUESTIONS}')
  const snapshotIdx = body.indexOf('buildWrongQuestionSnapshotSql()')
  const examIdx = body.indexOf("SET status = 'graded'")
  assert.ok(insertIdx > 0 && snapshotIdx > 0 && examIdx > 0, '三处语句必须都存在')
  assert.ok(insertIdx < snapshotIdx, '快照补齐必须在错题 INSERT 之后（否则补不到刚插入的行）')
  assert.ok(snapshotIdx < examIdx, '快照补齐必须在 exam.status 落库之前（同事务内完成）')
})
