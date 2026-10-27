/**
 * 「死导出 getExamsByStudent 不得复活」回归锁（2026-10-27 日常巡查 r344）
 *
 * ── 背景 ──
 * `getExamsByStudent`（原 apiService.js:313）对每个已完成任务逐一调 `getQuestionsByTask`，
 * 形成 N+1 前端请求瀑布。但 2026-10-04 死导出扫描已确认它**全仓零调用方**——
 * 真实「试卷」加载器是 `getGeneratedExamsByStudent`（单端点 /generated-exams/student/:id，无 N+1）。
 * 即该 N+1 从不触达任何用户路径，是个潜伏的坏样板（未来有人误接线就会踩）。
 * r344 已删除该函数。本锁防止它被误复原，并防止误删到活加载器。
 *
 * ── 本锁两层 ──
 *   ① 死导出必须已删除：`apiService.js` 不得再出现 `getExamsByStudent` 这个导出（含整词）。
 *   ② 活加载器必须仍在：`getGeneratedExamsByStudent` 仍导出（别删错函数）。
 *
 * ── 反向自检 ──
 * 把「含死导出」的合成源码喂给同一把判据，必须判红；且活加载器判据不得误匹配死导出名
 * —— 证明不是空锁、且两把判据互不串。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const API_SRC = readFileSync(resolve(ROOT, 'src/services/apiService.js'), 'utf8')

const DEAD_EXPORT_RE = /export\s+(?:const|function|async\s+function|let|var)\s+getExamsByStudent\b/
const LIVE_LOADER_RE = /export\s+(?:const|function|async\s+function)\s+getGeneratedExamsByStudent\b/

test('getExamsByStudent 死导出已删除', () => {
  assert.equal(DEAD_EXPORT_RE.test(API_SRC), false,
    'apiService.js 不应再导出 getExamsByStudent（r344 已删）')
  // 整词也不得残留（无注释/无调用方引用）
  assert.equal(API_SRC.includes('getExamsByStudent'), false,
    'apiService.js 不应再出现 getExamsByStudent 这个符号')
})

test('getGeneratedExamsByStudent 活加载器仍在', () => {
  assert.equal(LIVE_LOADER_RE.test(API_SRC), true,
    '误删：真实的试卷加载器 getGeneratedExamsByStudent 必须仍在')
})

test('反向自检：含死导出的合成源码必须被判红（锁非空）+ 两判据不串', () => {
  // 模拟回归：有人在 apiService.js 里重新加回了死导出
  const regressed = API_SRC + '\nexport const getExamsByStudent = async (studentId) => ({})\n'
  // 修复前（旧树）就会让主断言失败 —— 这里直接验证判据能识别回归写法
  assert.equal(DEAD_EXPORT_RE.test(regressed), true,
    '判据应能在含死导出的源码上判红，否则主锁是空锁')
  // 活加载器判据只应匹配 getGeneratedExamsByStudent，绝不被死导出名污染
  const onlyDead = 'export const getExamsByStudent = async () => ({})'
  assert.equal(LIVE_LOADER_RE.test(onlyDead), false,
    '活加载器判据不得误匹配死导出名 getExamsByStudent')
})
