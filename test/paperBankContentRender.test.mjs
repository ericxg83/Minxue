/**
 * 试卷题库内容渲染回归锁（2026-10-21）
 *
 * 背景：负责人截图反馈「页面里有很多奇怪的符号」。根因是两层：
 *   ① 题库列表用纯文本插值，题干里的 LaTeX（`$y=ax^2+bx+c(a\neq0)$`）原样上屏；
 *   ② 卷面上的「对应关系表」被 OCR 写成 markdown 管道表存进 parent_stem，
 *      纯文本渲染后就是满屏 `| x | ... |` 和 `|---|---|`。
 *
 * 本文件锁的判据（每条都配反向自检，把坏版本喂进去必须判红）：
 *   ① 只有「含 | 的表头 + 紧跟分隔行」才算表格 —— 绝对值 `$|\vec{a}|=3$` 绝不能误伤；
 *   ② 表格单元格里的数学必须**行内**（`$x$` 而非 `$$x$$`，否则表格里一格一个巨型字母）；
 *   ③ 不含表格的文本，渲染输出必须与加表格能力之前**逐字相同**（58 条真实题库原文验过）；
 *   ④ 页面与 PDF 共用 renderContent 这一条口径，且 PDF 侧样式表必须带 .md-table
 *      （否则「页面有表格、印出来还是一堆竖线」）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import {
  renderContent,
  splitMarkdownTables,
  splitMarkdownTableCells,
} from '../src/utils/mathText.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8')

// 真实数据（resource_questions 里第 20 题(1) 的 parent_stem 原文，含 \n）
const REAL_TABLE = '二次函数$y=ax^2+bx+c(a\\neq0)$中，函数值$y$与自变量$x$之间的部分对应关系如下表所示。\n'
  + '| x | ... | 0 | 1 | 2 | 3 | ... |\n'
  + '|---|---|---|---|---|---|---|\n'
  + '| y | ... | -3 | 0 | 1 | 0 | ... |'

// ─────────────────────────────────────────────────────────────
// ① 表格判据
// ─────────────────────────────────────────────────────────────

test('★ 真实卷面表格：切成 [文本块, 表格块]，表头 7 列、表体 1 行 7 格', () => {
  const blocks = splitMarkdownTables(REAL_TABLE)
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].type, 'text')
  assert.equal(blocks[1].type, 'table')
  assert.deepEqual(blocks[1].header, ['x', '...', '0', '1', '2', '3', '...'])
  assert.equal(blocks[1].rows.length, 1)
  assert.deepEqual(blocks[1].rows[0], ['y', '...', '-3', '0', '1', '0', '...'])
})

test('★ 绝对值里的竖线不是表格（题库第 9 题正文就是 $|\\vec{a}|=3$）', () => {
  assert.equal(splitMarkdownTables('已知 $|\\vec{a}|=3$，求 $\\vec{a}$').length, 1)
  assert.equal(splitMarkdownTableCells('| x | 0 |').length, 2, '切格本身要能识别两端竖线')
  // 有竖线但没有分隔行 → 不是表格
  assert.equal(splitMarkdownTables('A | B 这种正文竖线\n第二行').length, 1)
})

test('反向自检：缺分隔行 / 只有一行 / 空串 都不许判成表格', () => {
  assert.equal(splitMarkdownTables('| a | b |\n| 1 | 2 |').some(b => b.type === 'table'), false)
  assert.equal(splitMarkdownTables('| a | b |').some(b => b.type === 'table'), false)
  assert.deepEqual(splitMarkdownTables(''), [{ type: 'text', text: '' }])
  assert.equal(splitMarkdownTables(null).length, 1)
})

// ─────────────────────────────────────────────────────────────
// ② 渲染产物
// ─────────────────────────────────────────────────────────────

test('★ 表格渲染成 <table class="md-table">，且不再有裸分隔行', () => {
  const html = renderContent(REAL_TABLE)
  assert.ok(html.includes('<table class="md-table">'), '必须输出表格标签')
  assert.ok(html.includes('<thead>') && html.includes('<tbody>'), '要有表头与表体')
  assert.ok(!/\|\s*-{2,}/.test(html), '不得残留 markdown 分隔行（老师看到的就是这堆符号）')
  assert.ok(!html.includes('| x |'), '不得残留管道表原文')
  // 题干文字必须还在（表格替换不能吃掉引导句）
  assert.ok(html.includes('部分对应关系如下表所示'), '引导句不得丢失')
})

test('★ 单元格里的数学必须行内（$x$ 而不是 $$x$$）', () => {
  const html = renderContent(REAL_TABLE)
  assert.ok(html.includes('<th>$x$</th>'), '表头 x 应为行内公式')
  assert.ok(html.includes('<td>$-3$</td>'), '单元格 -3 应为行内公式')
  assert.ok(!html.includes('$$'), '表格里不得出现独立公式定界符')
})

test('★ 不含表格的文本输出必须与旧实现逐字相同（58 条真实原文已比对）', () => {
  // 黄金样本：旧实现的输出，改表格功能后不得漂移一个字符
  assert.equal(
    renderContent('已知 $|\\vec{a}|=3$，求 $\\vec{a}$'),
    '已知 $|\\vec{a}|=3$，求 $\\vec{a}$'
  )
  assert.equal(renderContent('下列各组线段的长度中,成比例的是'), '下列各组线段的长度中,成比例的是')
  // 独立公式判定不受影响：整段只有一个数学表达式仍是 $$
  assert.equal(renderContent('x^2+1'), '$$x^{2}+1$$')
  // 空值
  assert.equal(renderContent(''), '')
  assert.equal(renderContent(null), '')
})

test('反向自检：少了分隔行就绝不出表格（判据必须靠分隔行，不能只看竖线）', () => {
  const noSep = '| x | ... | 0 |\n| y | ... | 1 |'
  assert.ok(!renderContent(noSep).includes('md-table'), '缺分隔行不得渲染成表格')
  // 正向：补上分隔行后必须出表格
  assert.ok(renderContent('| x | 0 |\n|---|---|\n| y | 1 |').includes('md-table'))
})

// ─────────────────────────────────────────────────────────────
// ③ 两条渲染链路必须同口径（页面 / PDF）
// ─────────────────────────────────────────────────────────────

test('★ PDF 样式表必须带 .md-table（否则页面有表格、印出来还是竖线）', () => {
  // 源码锁：pdfGenerator.js 无扩展名 import katexCssWithFonts，Node ESM 直接 import 会报
  // ERR_MODULE_NOT_FOUND，所以这里锁源码而不是跑函数（判据一样硬）。
  const src = read('src/utils/pdfGenerator.js')
  const fails = []
  const start = src.indexOf('export function buildPaperCSS(')
  const seg = src.slice(start, start + 8000)
  if (!seg.includes('.md-table')) fails.push('buildPaperCSS 必须定义 .md-table')
  if (!/\.md-table th/.test(seg)) fails.push('表头要有样式')
  if (!seg.includes('border-collapse')) fails.push('表格必须合并边框（默认双线很难看）')
  assert.deepEqual(fails, [])
})

test('★ 页面走 MathRender → renderContent，PDF 走 buildPaperBody → renderContent（同一条口径）', () => {
  const mr = read('src/workbench/components/MathRender.vue')
  assert.ok(/from '\.\.\/\.\.\/utils\/mathText'/.test(mr), 'MathRender 必须复用 utils/mathText')
  assert.ok(mr.includes('renderContent'), 'MathRender 必须调用 renderContent')
  // v-html 内容拿不到 scoped 属性，表格样式必须用 :deep()
  assert.ok(/:deep\(\.md-table\)/.test(mr), 'MathRender 的表格样式必须用 :deep()（v-html 不吃 scoped）')

  const pg = read('src/utils/pdfGenerator.js')
  assert.ok(pg.includes('renderContent'), 'PDF 版式必须调用同一条 renderContent')
})

test('反向自检：scoped 里裸写 .md-table 会永远不匹配（v-html 无 data-v 属性）', () => {
  const bare = '<style scoped>.md-table { border-collapse: collapse; }</style>'
  assert.ok(!/:deep\(\.md-table\)/.test(bare), '裸 .md-table 应被判为不合格')
})
