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

test('server/worker.js 的 workbookPrompt 和 answerBankPrompt 各含一份规则', () => {
  const src = readFileSync(resolve(ROOT, 'server/worker.js'), 'utf8')
  // workbookPrompt 在 ~3533 行，answerBankPrompt 在 ~4273 行。
  // 两份 prompt 独立，因此规则字符串应至少出现 2 次。
  const matches = src.match(new RegExp(RULE_MARKER, 'g')) || []
  assert.ok(matches.length >= 2, `server/worker.js 应至少含 2 处"${RULE_MARKER}"，实际 ${matches.length} 处`)
  assert.ok(src.includes(POSITIVE_EXAMPLE), 'workbookPrompt/answerBankPrompt 应含正例')
  assert.ok(src.includes(NEGATIVE_EXAMPLE), 'workbookPrompt/answerBankPrompt 应含反例')
})

test('src/config/ai.js 的 buildOCRPrompt 含分数边界规则（前端拍照路径）', () => {
  // src/config/ai.js 用了 import.meta.env（Vite 专属），不能直接 import，
  // 但作为静态字符串源文件，可读文件+正则验证。
  const src = readFileSync(resolve(ROOT, 'src/config/ai.js'), 'utf8')
  // buildOCRPrompt 是客户端识别入口，必须有这条规则；学生拍照走的是它。
  assert.ok(src.includes(RULE_MARKER), 'src/config/ai.js 应包含"分数与紧邻自变量字符的边界"')
  assert.ok(src.includes(POSITIVE_EXAMPLE), '客户端 prompt 应含正例')
  assert.ok(src.includes(NEGATIVE_EXAMPLE), '客户端 prompt 应含反例')
  // 客户端之前完全没【数学符号识别规范】一节，规则必须落在 buildOCRPrompt
  // 模板字符串内（而不是另一个 prompt 函数）。
  const ocrPromptBlock = src.match(/export const buildOCRPrompt[\s\S]*?(?=\nexport const build)/)
  assert.ok(ocrPromptBlock, '应能定位到 buildOCRPrompt 模板字符串块')
  assert.ok(ocrPromptBlock[0].includes(RULE_MARKER), '规则必须在 buildOCRPrompt 内，不在别的 prompt')
})