/**
 * 回归锁：卷面**选项**必须行内排版，不得被「独立公式」启发式升级成 $$ 块级。
 *
 * 事故（负责人 2026-11-04 截图反馈）：
 *   学生陆晨曦的重练卷第 1 题，选项是纯数字 17 / 15 / 7 / 1。
 *   卷面上「A.」停在第一行左侧，而 17 掉到第二行**居中**（KaTeX displayMode），
 *   四个选项各自悬空、行距被 `.katex-display{margin:1em 0}` 撑大，卷面直接散架。
 *   同一份卷子里选项带中文的题（hasRealText）显示正常 —— 这正是「部分题目正常」的来源。
 *
 * 根因：
 *   renderContent / renderMath 的「独立公式」判定是 `唯一数学片段 && 无文本`。
 *   纯数字选项恰好满足该判据（splitToSegments 把 "17" 识别为数学片段），
 *   于是被判成「这是一条独立的公式」，输出 $$17$$ ⇒ 块级居中。
 *   但「整段只有公式」≠「这是独立公式」，还要看它**出现在哪个位置**。
 *   选项、表格单元格这类「必然是行内项」的位置必须走 renderContentInline（forceInline）。
 *
 * 判据（每条都配反向自检，把坏版本喂进去必须判红）：
 *   ① 服务端 wrongRetryPdfService 渲染的选项片段里不得出现 katex-display；
 *   ② 前端 pdfGenerator（打印预览 / 重练卷 PDF）选项行必须调用 renderContentInline；
 *   ③ 同一份数据里「答案行 / 独立公式」仍保留块级（不许一刀切删掉 standalone）；
 *   ④ 反向自检：renderContent('17') 确实产出 $$（坑真实存在，锁不会空转）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8')

const { renderContent, renderContentInline } = await import('../src/utils/mathText.js')
const { buildExamHTML } = await import('../server/services/wrongRetryPdfService.js')

const PG = 'src/utils/pdfGenerator.js'
const RETRY_SVC = 'server/services/wrongRetryPdfService.js'

/** 一条最小的纯数字选项题（与事故题同形） */
const NUMERIC_CHOICE = {
  id: 'regression-numeric-choice',
  question_type: 'choice',
  content: '下列各数中，是梅森素数的是（ ）',
  options: ['17', '15', '7', '1'],
  answer: 'C',
}

/** 取卷面里第一个选项块（`<div class="opts ...">` 到收尾 `</div>`） */
const extractOptsBlock = (html) => {
  const start = html.indexOf('<div class="opts')
  assert.ok(start >= 0, '卷面必须渲染出选项块（找不到 = 判据失效，fail-closed）')
  const end = html.indexOf('</div>', start)
  assert.ok(end > start, '选项块必须有收尾标签')
  return html.slice(start, end)
}

test('① 服务端重练卷：纯数字选项必须行内渲染（不得出现 katex-display）', () => {
  const html = buildExamHTML({ title: '锁', studentName: '锁', questions: [NUMERIC_CHOICE], qrSvg: '' })
  const opts = extractOptsBlock(html)

  assert.ok(opts.includes('class="opt"'), '选项块里必须有 .opt 片段')
  assert.ok(!opts.includes('katex-display'), `选项被渲染成块级居中：\n${opts.slice(0, 500)}`)

  // 四个选项各自「A. 内容」同行：标号后紧跟 KaTeX 行内 span，中间不得插块级元素
  for (const letter of ['A.', 'B.', 'C.', 'D.']) {
    assert.ok(opts.includes(`>${letter} <span class="katex"`), `${letter} 后必须紧跟行内公式，实际：${opts.match(new RegExp(`>${letter.replace('.', '\\.')}[^<]*<[^>]*>`))?.[0] || '未找到'}`)
  }
})

test('② 前端 PDF / 打印预览：选项行必须走 renderContentInline', () => {
  const src = read(PG)
  const fails = []

  // fail-closed：找不到选项渲染循环直接判红，别让锁空转
  if (!/opts\.forEach\(\(opt, i\) => \{/.test(src)) fails.push('pdfGenerator.js 里找不到选项渲染循环（判据失效）')
  if (!/renderContentInline\(opt\)/.test(src)) fails.push('选项必须调用 renderContentInline(opt)')
  if (/class="opt">\$\{String\.fromCharCode\(65 \+ i\)\}\. \$\{renderContent\(opt\)\}/.test(src)) {
    fails.push('选项仍在用 renderContent(opt)（会升级成 $$ 块级）')
  }

  assert.deepEqual(fails, [])
})

test('③ 反向自检：renderContent 对纯数字确实产出块级 $$（坑真实存在）', () => {
  const bad = renderContent('17')
  assert.ok(bad.includes('$$'), `renderContent('17') 应产出 $$（实际 ${bad}）—— 否则本锁的判据不成立`)

  const good = renderContentInline('17')
  assert.ok(!good.includes('$$'), `renderContentInline('17') 不得产出 $$（实际 ${good}）`)
  assert.ok(good.includes('$17$'), `renderContentInline('17') 应产出 $17$（实际 ${good}）`)
})

test('④ 行为保持：答案/独立公式仍用块级（不许一刀切删掉 standalone）', () => {
  // 题干整段只有一个公式时，仍按原口径居中（这是文档排版意图，不是本 bug）
  const html = buildExamHTML({
    title: '锁',
    studentName: '锁',
    questions: [{ ...NUMERIC_CHOICE, content: 'x^{2}', options: [] }],
    qrSvg: '',
  })
  const body = html.slice(html.indexOf('<body'))
  assert.ok(body.includes('katex-display'), '题干纯公式仍应块级渲染（standalone 口径未被误删）')
})
