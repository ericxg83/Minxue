import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

// 2026-09 用户报告：Qwen3-VL 把 `y = -1/3 x²`（分数 -1/3 后接自变量 x²）
// 错误识别成 `y = -1/(3x)²`（把分母 3 和自变量 x 合并成 3x）。
// 根因是 4 份 prompt 的【数学符号识别规范】都没约束"分数与紧邻自变量
// 字符的边界"。修复方式是在每份 prompt 末尾追加规则。
//
// 本测试不调 AI，只断言 prompt 字符串里含有新规则——
// 保证后续重构/格式化不会把这条规则意外弄丢。

const RULE_MARKER = '分数与紧邻自变量字符的边界'
const POSITIVE_EXAMPLE = 'y = -1/3 x² 表示 -(1/3)·x² = -x²/3'
const NEGATIVE_EXAMPLE = 'y = -1/(3x)²'
const GUARD_CLAUSE = '除非原题明确把分母用括号括起来'

test('server/config/ai.js 的 buildOCRPrompt 含分数边界规则', async () => {
  const { buildOCRPrompt } = await import(pathToFileURL(resolve(ROOT, 'server/config/ai.js')).href)
  const prompt = buildOCRPrompt()
  assert.ok(prompt.includes(RULE_MARKER), 'buildOCRPrompt 应包含"分数与紧邻自变量字符的边界"')
  assert.ok(prompt.includes(POSITIVE_EXAMPLE), '应包含正例 y = -1/3 x² = -x²/3')
  assert.ok(prompt.includes(NEGATIVE_EXAMPLE), '应包含反例 y = -1/(3x)²（作为错误示例）')
  assert.ok(prompt.includes(GUARD_CLAUSE), '应包含"除非原题明确把分母用括号括起来"的护栏')
})

test('server/worker.js 的 workbookPrompt 含分数边界规则', () => {
  const src = readFileSync(resolve(ROOT, 'server/worker.js'), 'utf8')
  // workbookPrompt 在 ~3533 行。2026-10-18（负责人裁决）：answerBankPrompt
  // （原 ~4273 行）随 processAnswerBankGrading（exam 答案库批改路线）整体
  // 删除 ⇒ 规则副本 2 → 1，幸存的一份必须完整（标记 + 正例 + 反例 + 护栏）。
  const matches = src.match(new RegExp(RULE_MARKER, 'g')) || []
  assert.ok(matches.length >= 1, `server/worker.js 应至少含 1 处"${RULE_MARKER}"，实际 ${matches.length} 处`)
  assert.ok(src.includes(POSITIVE_EXAMPLE), 'workbookPrompt 应含正例')
  assert.ok(src.includes(NEGATIVE_EXAMPLE), 'workbookPrompt 应含反例')
})

// r103：原第三条「src/config/ai.js 的 buildOCRPrompt（前端拍照路径）」已随前端直调 AI
// 整体删除而失效——学生拍照批改一直由服务端 worker 精简管线/通用管线完成，
// 上方两条服务端断言（server/config/ai.js + server/worker.js 双 prompt）是权威防线。

// 2026-10-22：整页英语语法专项（"8AU3 Exercise 5"）被模型返回 questions: []，
// 而 0 题会触发「单页重试 × 模型轮换 × 任务重投」的连锁重试（实测一页能烧一小时），
// 一个作业因此卡了一整天。修法是在 buildOCRPrompt 里补第 14 条硬规则：
// 英语题必须逐题输出，只有整页确实无题才允许空数组。
test('buildOCRPrompt 必须显式禁止英语页返回空 questions', async () => {
  const { buildOCRPrompt } = await import(pathToFileURL(resolve(ROOT, 'server/config/ai.js')).href)
  const prompt = buildOCRPrompt()
  assert.ok(prompt.includes('英语题必须逐题输出'), '缺少「英语题必须逐题输出」这条硬规则')
  assert.ok(prompt.includes('"questions": []'), '必须点名被禁的输出形态"questions": []')
  assert.ok(
    prompt.includes('只有整页确实一道题都没有'),
    '必须给出唯一允许空数组的例外（纯答案页/空白页/封面/目录），否则模型会拿它当万能借口'
  )
})