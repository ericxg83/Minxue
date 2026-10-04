/**
 * 白板默认笔宽 = 3.5 回归锁（2026-10-04 第 98 轮，负责人裁决⑤）
 *
 * 背景：r85 遗留 —— 默认笔宽 penSize=3 不在三档预设（2/3.5/6）里，
 * 工具栏粗细档没有任何高亮，老师不知道当前用的哪档。
 * 负责人 2026-10-04 拍板：改默认 3.5（落在「中」档，工具栏正常高亮）。
 *
 * 反向自检：collectFailures 套在旧版（penSize = ref(3)）上必须判红，见 _r98_old/。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

export function collectFailures(WB_SRC, DC_SRC) {
  const fails = []
  const bad = (msg, cond) => { if (!cond) fails.push(msg) }
  bad('WeekendBoard 默认笔宽必须是 3.5（penSize = ref(3.5)）', /const\s+penSize\s*=\s*ref\(3\.5\)/.test(WB_SRC))
  bad('不得回退成默认 3（ref(3) 且非 3.5 的写法）', !/const\s+penSize\s*=\s*ref\(3\)\s*$/.test(WB_SRC))
  bad('三档预设必须包含 3.5（value: 3.5）', /value:\s*3\.5/.test(WB_SRC))
  bad('DrawingCanvas 的 size 默认必须同步 3.5', /defineModel\('size',\s*\{\s*type:\s*Number,\s*default:\s*3\.5\s*\}\)/.test(DC_SRC))
  return fails
}

const WB_SRC = read('src/workbench/views/WeekendBoard.vue')
const DC_SRC = read('src/workbench/components/DrawingCanvas.vue')

test('⛔ 白板默认笔宽 = 3.5（三档预设「中」档高亮）', () => {
  const failures = collectFailures(WB_SRC, DC_SRC)
  assert.deepEqual(failures, [], `\n${failures.length} 处不符：\n` + failures.map((m) => `  - ${m}`).join('\n'))
})
