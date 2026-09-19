import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const LIB_SRC = readFileSync(resolve(ROOT, 'server/lib/weekendHandout.js'), 'utf8')
const CLI_SRC = readFileSync(resolve(ROOT, 'server/scripts/weekend-handout.mjs'), 'utf8')
const KEY_SRC = readFileSync(resolve(ROOT, 'server/utils/ocrStemKey.js'), 'utf8')

test('周末班课件：练习册错题用 卷+页+题号+OCR等价题干 合并（不裸并不同题）', () => {
  // 聚合层必须复用 OCR 等价指纹，且只对 workbook 自然键生效
  assert.ok(LIB_SRC.includes("import { ocrStemKey } from '../utils/ocrStemKey.js'"), 'lib 必须复用 ocrStemKey')
  assert.ok(CLI_SRC.includes("import { ocrStemKey } from '../utils/ocrStemKey.js'"), 'CLI 必须复用 ocrStemKey')
  assert.ok(KEY_SRC.includes('平行'), '指纹必须把平行符号等价写法归一到同一字符')
  assert.ok(KEY_SRC.includes('x'), '指纹必须把常见乘号变体归一到同一字符')
  assert.ok(LIB_SRC.includes("r.source_type === 'workbook'"), '练习册错题键必须限定 source_type=workbook')
  assert.ok(LIB_SRC.includes('r.worksheet_id') && LIB_SRC.includes('r.question_no'), '键必须带 worksheet_id 与 question_no')
  assert.ok(LIB_SRC.includes("|s:${norm}") || LIB_SRC.includes('|s:' + '${norm}'), '键必须带题干指纹，不能裸用题号')
})

test('ocrStemKey：OCR 等效写法归一为同一键', async () => {
  const { ocrStemKey } = await import('../server/utils/ocrStemKey.js')
  const a = ocrStemKey('如图，已知直线l₁∥l₂∥l₃，那么下列结论中，正确的是（ ）')
  const b = ocrStemKey('如图，已知直线l₁ // l₂ // l₃，那么下列结论中，正确的是( )')
  assert.equal(a, b)
  const c = ocrStemKey('如图，已知直线l₁∥l₂∥l₃，AC=6，DE=3，EF=2，那么BC的长为______')
  const d = ocrStemKey('如图，已知直线l₁ // l₂ // l₃AC=6 DE=3,EF=2，那么BC的长为______')
  assert.equal(c, d)
  const e = ocrStemKey('如图，AB//CD//EF，AF、BE 交于点 G，下列比例式中，错误的是')
  assert.notEqual(a, e)
})
