/**
 * 批改中心任务行「试卷小图」源码锁（2026-10-08）。
 * 判据清单、每条的理由、反向自检方法：见 test/workbenchTaskThumbKit.mjs 头部注释。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { collectTaskThumbFailures } from './workbenchTaskThumbKit.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const SRC = readFileSync(resolve(ROOT, 'src/workbench/views/GradeCenterWorkbench.vue'), 'utf8')

test('⛔ 批改中心任务行试卷小图：缩略图 / 懒加载 / 兜底 / 缓存依赖 全过', () => {
  const failures = collectTaskThumbFailures(SRC)
  assert.deepEqual(
    failures,
    [],
    `\n${failures.length} 处不符：\n` + failures.map((m) => `  - ${m}`).join('\n')
  )
})
