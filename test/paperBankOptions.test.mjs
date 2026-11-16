/**
 * 选项归一化回归锁（2026-11-16 徐汇 q3/q5、松江 q4、闵行 q5 事故）
 *
 * 旧正则 `^[（(]?[A-Da-d][）)]?[.、．:：]?` 把**以 a/b/c/d 开头的数学式子**当选项标号删掉：
 *   `a>0` → `>0`、`abc<0` → `bc<0`、`a⃗ // c⃗` → `⃗ // c⃗`、`a+b+c>0` → `+b+c>0`。
 * 四道题的选项因此语义残缺（选项全废 = 这道选择题不可用）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeOptions } from '../server/services/paperBankService.js'

test('★ 首字母是数学变量（a/b/c/d）时严禁当标号删掉', () => {
  assert.deepEqual(normalizeOptions(['a>0', 'b<0', 'c=1', 'd≠0']), ['a>0', 'b<0', 'c=1', 'd≠0'])
  assert.deepEqual(normalizeOptions(['abc<0', 'a-b+c>0', 'a+b+c>0']), ['abc<0', 'a-b+c>0', 'a+b+c>0'])
  assert.deepEqual(normalizeOptions(['a⃗ // c⃗']), ['a⃗ // c⃗'])
})

test('明确是选项标号的写法仍要剥掉（带括号 / 字母+分隔符）', () => {
  assert.deepEqual(
    normalizeOptions(['A. a>0', '（B）b<0', 'C、x=1', 'd: y=2', '(A)a']),
    ['a>0', 'b<0', 'x=1', 'y=2', 'a']
  )
})

test('空值与非数组容错', () => {
  assert.deepEqual(normalizeOptions(null), [])
  assert.deepEqual(normalizeOptions(['', '  ', 'A.']), [])
})
