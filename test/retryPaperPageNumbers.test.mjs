/**
 * 回归锁：错题重练卷 PDF 每页页脚必须有页码（`第 X 页 / 共 Y 页`）
 *
 * 需求（负责人 2026-10-15）：「不管何种原因生成的错题重练卷 pdf，加一个页码，
 * 比如『第1页/总5页』。」
 *
 * 为什么必须锁在这里 —— 重练卷 PDF 有**四条互不相通的出口**，任何一条漏掉，
 * 老师拿到的就是一份没页码的卷子（多页卷子讲评时对不上页）：
 *   ① 移动端错题本「生成重练」   → src/utils/wrongBookPdfExporter.js
 *   ② PC 错题中心「组卷导出」    → 同上（同一引擎）
 *   ③ 周报「错题再测卷」（合并进周报 PDF） → src/utils/weeklyReportGenerator.js
 *   ④ PC 错题中心「一键导出重练卷」→ server/services/wrongRetryPdfService.js
 *      ⛔ ④ 是**独立的后端路径**，不经过 ①②③ 的前端导出引擎 ——
 *      只在前端加页码，④ 就会静默漏掉。这条锁专门盯它。
 *
 * 判据设计（防「假绿」）：
 *   - ① 行为真跑：`withPageNumberOptions` / `buildPageNumberFooterTemplate` 是纯函数，
 *     直接喂参数断言结果，不用起 Chromium。
 *   - ② 模板硬约束：Chromium 的 header/footer 模板是独立文档片段，样式不内联 / 不写
 *     font-size / 不写 font-family（CJK）三者任一缺失，页码就会「不出现」或「变方框」。
 *     这些是踩过的坑，必须逐条锁住。
 *   - ③ 行为保持：关闭页码时 `page.pdf()` 选项**逐字不变**（周报、试卷库讲义、健康检查
 *     等其它出口共用同一渲染器，不许被顺手改掉分页行为）。
 *   - ④ 源码锁 fail-closed：走 test/sourceLockKit.mjs 的 anchoredSlice/anchoredRange，
 *     锚点被改名/删除时判红而不是静默通过。
 *   - ⑤ 反向自检：同一套「开启页码」判据喂旧实现（忽略页码开关）必须判红，
 *     并校验新旧输出确实不同 —— 避免判据自始至终碰巧相等。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { anchoredSlice, anchoredRange } from './sourceLockKit.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8')

const { withPageNumberOptions, buildPageNumberFooterTemplate } =
  await import('../server/services/examPdfRenderer.js')

const RENDERER = 'server/services/examPdfRenderer.js'
const ROUTE = 'server/routes/examPdf.js'
const FRONT_EXPORTER = 'src/utils/serverPdfExporter.js'
const WRONG_BOOK = 'src/utils/wrongBookPdfExporter.js'
const WEEKLY = 'src/utils/weeklyReportGenerator.js'
const RETRY_SVC = 'server/services/wrongRetryPdfService.js'

// ── ① 行为：开关语义 ────────────────────────────────────────────────────────

test('关闭页码：page.pdf() 选项逐字不变（其它出口不受影响）', () => {
  const base = { format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm' } }
  const out = withPageNumberOptions(base, false)
  assert.equal(out, base, '关闭时必须返回原对象，不得凭空注入 displayHeaderFooter')
  assert.ok(!('displayHeaderFooter' in out), '关闭时不得出现 displayHeaderFooter')
  assert.ok(!('footerTemplate' in out), '关闭时不得出现 footerTemplate')
})

test('开启页码：补 displayHeaderFooter + 空页眉 + 页码页脚', () => {
  const out = withPageNumberOptions({ format: 'A4' }, true)
  assert.equal(out.displayHeaderFooter, true)
  assert.equal(out.format, 'A4', '原有选项必须保留')
  // ⛔ 空 headerTemplate 必须给：否则 Chromium 会打它自带的「日期+标题+URL」页眉
  assert.equal(out.headerTemplate, '<div></div>', '必须显式给空页眉压掉 Chromium 默认页眉')
  assert.match(out.footerTemplate, /class="pageNumber"/)
  assert.match(out.footerTemplate, /class="totalPages"/)
})

test('调用方自带页脚模板时不被覆盖（尊重自定义）', () => {
  const custom = '<div class="mine">自定义页脚</div>'
  const out = withPageNumberOptions({ footerTemplate: custom }, true)
  assert.equal(out.footerTemplate, custom)
  assert.equal(out.displayHeaderFooter, true, '自带页脚也要开 displayHeaderFooter，否则模板不生效')
})

test('调用方已开 displayHeaderFooter 但没给页脚 → 补页码模板（不留 Chromium 默认页脚）', () => {
  const out = withPageNumberOptions({ displayHeaderFooter: true }, false)
  assert.equal(out.displayHeaderFooter, true)
  assert.match(out.footerTemplate, /class="totalPages"/, '不得留下 Chromium 自带的 "1/5" 英文页脚')
})

// ── ② 模板硬约束（踩过的坑，逐条锁） ─────────────────────────────────────────

test('页脚模板：页码占位符 + 中文文案', () => {
  const tpl = buildPageNumberFooterTemplate()
  assert.match(tpl, /第\s*<span class="pageNumber"><\/span>\s*页/, '必须是「第 X 页」')
  assert.match(tpl, /共\s*<span class="totalPages"><\/span>\s*页/, '必须是「共 Y 页」')
})

test('页脚模板：样式内联 + 显式字号 + CJK 字体兜底', () => {
  const tpl = buildPageNumberFooterTemplate()
  assert.match(tpl, /style="[^"]*font-size:\s*\d+px/, '必须显式写 font-size（模板默认字号≈0，不写就是一片空白）')
  assert.match(tpl, /style="[^"]*font-family:[^"]*(Microsoft YaHei|Noto Sans SC|PingFang SC)/,
    '必须自带 CJK font-family，否则「第/页/共」在无中文字形的容器里变方框')
  assert.ok(!/href=|<link|@import/.test(tpl), '模板是独立文档片段，不得依赖任何外部样式/资源')
})

// ── ③ 源码锁：四条出口都必须开页码 ──────────────────────────────────────────

test('渲染器：pageNumbers 参数被真正消费（不是死参数）', () => {
  const fails = []
  const src = read(RENDERER)
  const fn = anchoredRange(src, 'export function withPageNumberOptions(', 'export async function renderExamPDF(', RENDERER, fails)
  if (fn) {
    assert.match(fn, /displayHeaderFooter:\s*true/, '开关函数必须写 displayHeaderFooter:true')
    assert.match(fn, /footerTemplate:\s*pdfOptions\.footerTemplate\s*\|\|/, '必须提供页码页脚兜底')
  }
  const call = anchoredSlice(src, 'const mergedPdfOptions = withPageNumberOptions(', 120, RENDERER, fails)
  if (call) assert.match(call, /pageNumbers\)/, 'renderExamPDF 必须把 pageNumbers 传进开关函数（否则参数是死的）')
  assert.deepEqual(fails, [], fails.join('\n'))
})

test('路由：/api/exam-pdf 透传 pageNumbers', () => {
  const fails = []
  const src = read(ROUTE)
  const destructure = anchoredSlice(src, 'const { html, filename', 120, ROUTE, fails)
  if (destructure) assert.match(destructure, /pageNumbers/, '路由必须从 body 取 pageNumbers')
  const call = anchoredSlice(src, 'await renderExamPDF({ html, filename, pdfOptions', 80, ROUTE, fails)
  if (call) assert.match(call, /pageNumbers/, '路由必须把 pageNumbers 交给渲染器')
  assert.deepEqual(fails, [], fails.join('\n'))
})

test('前端导出引擎：exportServerPDF 把 pageNumbers 放进 POST body', () => {
  const fails = []
  const src = read(FRONT_EXPORTER)
  const sig = anchoredSlice(src, 'export async function exportServerPDF({', 400, FRONT_EXPORTER, fails)
  if (sig) assert.match(sig, /pageNumbers\s*=\s*false/, '默认关闭（讲义等非卷子出口不印页码）')
  const body = anchoredRange(src, 'body: JSON.stringify({', '}),', FRONT_EXPORTER, fails)
  if (body) assert.match(body, /pageNumbers:\s*pageNumbers === true/, 'body 必须带 pageNumbers')
  assert.deepEqual(fails, [], fails.join('\n'))
})

test('错题卷引擎：默认开页码，并透传给 exportServerPDF', () => {
  const fails = []
  const src = read(WRONG_BOOK)
  const sig = anchoredRange(src, 'export async function exportWrongBookPDF({', '}) {', WRONG_BOOK, fails)
  if (sig) assert.match(sig, /pageNumbers\s*=\s*true/, '错题重练卷默认必须开页码')
  const call = anchoredSlice(src, 'const result = await exportServerPDF({', 400, WRONG_BOOK, fails)
  if (call) assert.match(call, /pageNumbers,/, '必须把 pageNumbers 透传下去')
  assert.deepEqual(fails, [], fails.join('\n'))
})

test('周报：合并了错题再测卷 ⇒ 也要页码', () => {
  const fails = []
  const src = read(WEEKLY)
  const call = anchoredSlice(src, 'const result = await exportServerPDF({', 600, WEEKLY, fails)
  if (call) assert.match(call, /pageNumbers:\s*true/, '周报 PDF 含错题再测卷，必须印页码')
  assert.deepEqual(fails, [], fails.join('\n'))
})

test('⛔ PC 错题中心「一键导出」是独立后端路径，必须单独开页码', () => {
  const fails = []
  const src = read(RETRY_SVC)
  const call = anchoredSlice(src, 'const pdfBuffer = await renderExamPDF(', 120, RETRY_SVC, fails)
  if (call) {
    assert.match(call, /pageNumbers:\s*true/,
      '这条路径不经过前端导出引擎 —— 只改前端会让它静默漏掉页码')
  }
  assert.deepEqual(fails, [], fails.join('\n'))
})

// ── ④ 反向自检 ─────────────────────────────────────────────────────────────

test('反向自检：忽略页码开关的旧实现，在同样的判据下必判红', () => {
  // 旧实现（加页码之前）：pdfOptions 原样透传，pageNumbers 参数根本不存在
  const legacyPdfOptions = (pdfOptions) => ({ ...pdfOptions })
  const legacy = legacyPdfOptions({ format: 'A4' })

  assert.notEqual(legacy.displayHeaderFooter, true, '旧实现本来就没有页码开关')
  assert.ok(!legacy.footerTemplate, '旧实现没有页码页脚')
  // 新实现同一输入必须不同 —— 证明判据能区分新旧
  const fresh = withPageNumberOptions({ format: 'A4' }, true)
  assert.notDeepEqual(fresh, legacy, '新旧输出必须不同，否则判据是恒真的假锁')
})

test('反向自检：关闭分支的「逐字不变」判据不会误判成开启', () => {
  const base = { format: 'A4', margin: { top: '15mm' } }
  const off = withPageNumberOptions(base, false)
  const on = withPageNumberOptions(base, true)
  assert.notDeepEqual(off, on, '开/关必须产出不同结果，否则开关形同虚设')
  assert.ok(!('displayHeaderFooter' in off) && on.displayHeaderFooter === true)
})

// ── ⑤ 反向自检（源码锁）：把源码改坏，锁必须判红 ────────────────────────────

test('反向自检：合成坏样本 —— PC 一键导出被关掉页码，锁必须判红', () => {
  const broken = read(RETRY_SVC).replace('pageNumbers: true', 'pageNumbers: false')
  assert.ok(broken.includes('pageNumbers: false'), '合成样本没改坏，本测试无意义')
  const fails = []
  const seg = anchoredSlice(broken, 'const pdfBuffer = await renderExamPDF(', 120, '合成样本', fails)
  if (seg) assert.ok(!/pageNumbers:\s*true/.test(seg), '改坏后竟然判绿 —— 这把锁是摆设')
  assert.deepEqual(fails, [])
})

test('反向自检：合成坏样本 —— 错题卷默认值被改成 false，锁必须判红', () => {
  const broken = read(WRONG_BOOK).replace(/pageNumbers = true/, 'pageNumbers = false')
  assert.ok(broken.includes('pageNumbers = false'), '合成样本没改坏，本测试无意义')
  const fails = []
  const sig = anchoredSlice(broken, 'export async function exportWrongBookPDF({', 400, '合成样本', fails)
  if (sig) assert.ok(!/pageNumbers\s*=\s*true/.test(sig), '改坏后竟然判绿 —— 这把锁是摆设')
  assert.deepEqual(fails, [])
})
