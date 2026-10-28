/**
 * 试卷缓存键一致性锁（A 级死代码清理回归）
 *
 * 背景：试卷列表真实缓存键是 `generated_exams_cache_v2_${studentId}`（generatedExamsCacheKey），
 * 由 getGeneratedExamsByStudent 写入/读取；失效走 invalidateCache('generated', id) /
 * clearStudentCaches / createGeneratedExam。
 * 旧代码里 invalidateCache 的 keyMap 还有一条 `exams: exams_cache_${studentId}`，而
 * exams_cache_ 是 v2 迁移前的 orphan 键——从不被写入、从不被读取，且全仓没有任何
 * invalidateCache('exams', …) 调用方。这条分支是陷阱：未来若有人调 invalidateCache('exams', id)
 * 会清掉 orphan 键而漏清真实试卷缓存，造成试卷列表静默陈旧。
 * 本锁守两条不变量，并带反向自检（内联合成坏样本，不调 git，规避 Windows EBUSY）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(__dirname, '../src/services/apiService.js')
const src = readFileSync(SRC, 'utf8')

// 抽取 invalidateCache 内 keyMap 对象字面量（匹配最外层花括号）
function extractKeyMap (source) {
  const startIdx = source.indexOf('export const invalidateCache')
  assert.ok(startIdx >= 0, 'invalidateCache 必须存在')
  const mapStart = source.indexOf('const keyMap = {', startIdx)
  assert.ok(mapStart >= 0, 'keyMap 对象字面量必须存在')
  let depth = 0
  let i = mapStart
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') { depth--; if (depth === 0) break }
  }
  return source.slice(mapStart, i + 1)
}

test('invalidateCache 不得含失效的 exams 旧键分支（exams_cache_ 是 orphan，清它不会清真实试卷缓存）', () => {
  const km = extractKeyMap(src)
  assert.ok(
    !/exams:\s*`exams_cache_/.test(km),
    'invalidateCache 仍含失效的 exams_cache_ 旧键分支：这是陷阱，会静默不清真实试卷缓存（generated_exams_cache_v2_）'
  )
})

test('invalidateCache 的 generated 分支仍指向真实试卷缓存键（删旧键不得误伤真实失效路径）', () => {
  const km = extractKeyMap(src)
  assert.ok(
    /generated:\s*generatedExamsCacheKey\(/.test(km),
    'generated 分支必须仍指向 generatedExamsCacheKey（真实试卷缓存失效路径不能断）'
  )
})

test('反向自检：合成的 exams 旧键分支必须被第一条判据抓住（证锁非空）', () => {
  // 内联合成坏样本：在 keyMap 开头注入一条 exams 旧键分支
  const bad = src.replace(
    'const keyMap = {',
    "const keyMap = {\n    exams: `exams_cache_${studentId}`,"
  )
  const km = extractKeyMap(bad)
  assert.ok(
    /exams:\s*`exams_cache_/.test(km),
    '反向自检失效：合成旧键分支未被判据识别（锁形同虚设）'
  )
  // 且第一条判据对坏样本应当判红（这里直接验证其否定式为 false）
  assert.ok(
    /exams:\s*`exams_cache_/.test(km),
    '反向自检：第一条判据对坏样本必须判红'
  )
})
