/**
 * 回归锁：错题重练卷 PDF 的**每页页脚必须带学生名**（`学生：张三` + `第 X 页 / 共 Y 页`）
 *
 * 需求（负责人 2026-11-04）：「重练卷只有第一页有二维码和学生名，多页卷子拆开、
 * 或者多人卷子一起打印时会混，分不清哪张连着哪张 —— 做一个页脚，写上所属学生名。」
 *
 * 为什么必须用锁钉住：
 *   重练卷有**四条互不相通的 PDF 出口**（见 retryPaperPageNumbers.test.mjs 头注释），
 *   页脚标签走的是渲染器 → 路由 → 前端导出引擎 → 后端直出这条链，
 *   **任何一环把参数漏掉都不报错**，老师拿到的仍是一份只在第一页能认人的卷子。
 *
 * 判据设计：
 *   ① 行为真跑：buildPaperFooterLabel / buildPageNumberFooterTemplate / withPageNumberOptions
 *      都是纯函数，直接喂参数断言，不用起 Chromium。
 *   ② 模板硬约束：Chromium 页脚模板是收缩包裹容器 —— 没有 `width:100%` 时 flex 无处分配，
 *      页码会挤在名字后面（实测复现）；两栏都必须显式字号，否则字看不见。
 *   ③ 行为保持：pageNumbers=false（讲义等）即使传了名字也**逐字不变**。
 *   ④ 转义：学生名是外部数据，含 `& < > "` 时不得撕坏模板。
 *   ⑤ 源码锁 fail-closed + 反向自检（改坏必判红）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { anchoredSlice, anchoredRange } from './sourceLockKit.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8')

const {
  withPageNumberOptions,
  buildPageNumberFooterTemplate,
  buildPaperFooterLabel,
} = await import('../server/services/examPdfRenderer.js')

const RENDERER = 'server/services/examPdfRenderer.js'
const ROUTE = 'server/routes/examPdf.js'
const FRONT_EXPORTER = 'src/utils/serverPdfExporter.js'
const RETRY_SVC = 'server/services/wrongRetryPdfService.js'

// ── ① 标签口径 ──────────────────────────────────────────────────────────────

test('标签：有学生名就印「学生：姓名」', () => {
  assert.equal(buildPaperFooterLabel({ studentName: '张三' }), '学生：张三')
  assert.equal(buildPaperFooterLabel({ studentName: '  张三  ' }), '学生：张三', '首尾空白必须归一')
})

test('标签：⛔ 不拿卷名兜底（卷名在别的出口是机器文件名，不许糊上页脚）', () => {
  assert.equal(buildPaperFooterLabel({ studentName: '', title: '李四 - 错题重练' }), '',
    '只有卷名 ≠ 有学生名，宁可不印')
  assert.equal(buildPaperFooterLabel({ studentName: null }), '')
})

test('标签：没有学生名 ⇒ 空串（页脚回到只印页码的历史形态）', () => {
  assert.equal(buildPaperFooterLabel({}), '')
  assert.equal(buildPaperFooterLabel(), '')
  assert.equal(buildPaperFooterLabel({ studentName: '   ' }), '')
})

test('标签：长度封顶 + 空白归一（不允许把页码挤出去）', () => {
  const long = buildPaperFooterLabel({ studentName: '张'.repeat(80) })
  assert.ok(long.length <= 40, `标签必须封顶 40 字，实际 ${long.length}`)
  assert.match(buildPaperFooterLabel({ studentName: '张\n三' }), /^学生：张 三$/, '换行必须归一成空格')
})

// ── ② 模板：两栏 + 占位符 + 硬约束 ──────────────────────────────────────────

test('模板：左侧学生名 + 右侧页码占位符', () => {
  const tpl = buildPageNumberFooterTemplate('学生：张三')
  assert.match(tpl, /学生：张三/, '页脚必须印出学生名')
  assert.match(tpl, /第\s*<span class="pageNumber"><\/span>\s*页/, '必须是「第 X 页」')
  assert.match(tpl, /共\s*<span class="totalPages"><\/span>\s*页/, '必须是「共 Y 页」')
})

test('模板：带标签时必须 width:100% + flex 两端对齐（否则页码挤在名字后面）', () => {
  const tpl = buildPageNumberFooterTemplate('学生：张三')
  assert.match(tpl, /width:\s*100%/, 'Chromium 页脚容器是收缩包裹的，缺 width:100% 时 flex 无处分配')
  assert.match(tpl, /display:\s*flex/)
  assert.match(tpl, /justify-content:\s*space-between/)
})

test('模板：两栏都显式字号 + CJK 字体兜底（模板默认字号≈0、无中文字形）', () => {
  const tpl = buildPageNumberFooterTemplate('学生：张三')
  const sizes = [...tpl.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]))
  assert.ok(sizes.length >= 2, '学生名与页码各自都要显式 font-size')
  assert.ok(sizes.every((n) => n >= 10), `字号不得小于 10px，实际 ${sizes.join('/')}`)
  assert.match(tpl, /font-family:[^"]*(Microsoft YaHei|Noto Sans SC|PingFang SC)/,
    '必须自带 CJK font-family，否则「学生/第/页/共」变方框')
  assert.ok(!/href=|<link|@import/.test(tpl), '模板是独立文档片段，不得依赖外部资源')
})

test('模板：无标签时保持历史「居中只印页码」', () => {
  const tpl = buildPageNumberFooterTemplate('')
  assert.match(tpl, /text-align:\s*center/)
  assert.ok(!/display:\s*flex/.test(tpl), '没名字就不该切换成两栏布局（行为保持）')
})

// ── ③ 转义：学生名是外部数据 ────────────────────────────────────────────────

test('转义：学生名里的 & < > " 不得撕坏模板', () => {
  const tpl = buildPageNumberFooterTemplate('学生：<b>张三 & "李四"</b>')
  assert.ok(!tpl.includes('<b>'), '原始标签必须被转义，不能当 HTML 注入')
  assert.match(tpl, /&lt;b&gt;/)
  assert.match(tpl, /&amp;/)
  assert.match(tpl, /&quot;/)
  assert.match(tpl, /class="pageNumber"/, '转义后页码占位符必须还在')
})

// ── ④ 开关语义：只在出页脚时带上标签 ────────────────────────────────────────

test('开关：开启页码 + 有标签 ⇒ 页脚带学生名', () => {
  const out = withPageNumberOptions({ format: 'A4' }, true, '学生：张三')
  assert.equal(out.displayHeaderFooter, true)
  assert.match(out.footerTemplate, /学生：张三/)
})

test('开关：关闭页码（讲义）时传了标签也逐字不变', () => {
  const base = { format: 'A4', margin: { top: '12mm' } }
  const out = withPageNumberOptions(base, false, '学生：张三')
  assert.equal(out, base, '讲义/讲解版等出口不许被顺手印上学生名')
  assert.ok(!('footerTemplate' in out))
})

test('开关：调用方自带页脚模板时仍尊重自定义（不被标签覆盖）', () => {
  const custom = '<div class="mine">自定义页脚</div>'
  const out = withPageNumberOptions({ footerTemplate: custom }, true, '学生：张三')
  assert.equal(out.footerTemplate, custom)
})

// ── ⑤ 源码锁：四条出口的标签链 ──────────────────────────────────────────────

test('渲染器：footerLabel 被消费进页脚模板（不是死参数）', () => {
  const fails = []
  const src = read(RENDERER)
  const fn = anchoredRange(src, 'export function withPageNumberOptions(', 'export async function renderExamPDF(', RENDERER, fails)
  if (fn) {
    assert.match(fn, /buildPageNumberFooterTemplate\(footerLabel\)/, '必须把标签交给模板构造函数')
  }
  const call = anchoredSlice(src, 'const mergedPdfOptions = withPageNumberOptions(', 120, RENDERER, fails)
  if (call) assert.match(call, /footerLabel\)/, 'renderExamPDF 必须把 footerLabel 传进开关函数')
  const sig = anchoredSlice(src, 'export async function renderExamPDF({', 200, RENDERER, fails)
  if (sig) assert.match(sig, /footerLabel\s*=/, 'renderExamPDF 必须声明 footerLabel 参数')
  assert.deepEqual(fails, [], fails.join('\n'))
})

test('路由：/api/exam-pdf 收 footerStudentName 并转成页脚标签', () => {
  const fails = []
  const src = read(ROUTE)
  const destructure = anchoredSlice(src, 'const { html, filename', 200, ROUTE, fails)
  if (destructure) {
    assert.match(destructure, /footerStudentName/, '路由必须从 body 取 footerStudentName')
  }
  const build = anchoredSlice(src, 'const footerLabel = buildPaperFooterLabel(', 200, ROUTE, fails)
  if (build) {
    assert.match(build, /studentName:\s*typeof footerStudentName === 'string'/, '非字符串一律丢弃（不信任调用方）')
  }
  const call = anchoredSlice(src, 'await renderExamPDF({ html, filename, pdfOptions', 100, ROUTE, fails)
  if (call) assert.match(call, /footerLabel/, '路由必须把 footerLabel 交给渲染器')
  assert.deepEqual(fails, [], fails.join('\n'))
})

test('前端导出引擎：exportServerPDF 把学生名放进 POST body', () => {
  const fails = []
  const src = read(FRONT_EXPORTER)
  const body = anchoredRange(src, 'body: JSON.stringify({', '}),', FRONT_EXPORTER, fails)
  if (body) {
    assert.match(body, /footerStudentName:\s*studentName/, '必须把 studentName 作为页脚名传出')
  }
  assert.deepEqual(fails, [], fails.join('\n'))
})

test('⛔ PC 一键导出（后端直出）：必须自己构造并传 footerLabel', () => {
  const fails = []
  const src = read(RETRY_SVC)
  const build = anchoredSlice(src, 'const footerLabel = buildPaperFooterLabel(', 120, RETRY_SVC, fails)
  if (build) {
    assert.match(build, /studentName/, '这条路径不经过前端导出引擎，必须自己取学生名')
  }
  const call = anchoredSlice(src, 'const pdfBuffer = await renderExamPDF(', 120, RETRY_SVC, fails)
  if (call) {
    assert.match(call, /footerLabel/, '不传 footerLabel ⇒ 这条出口静默没有学生名')
  }
  assert.deepEqual(fails, [], fails.join('\n'))
})

// ── ⑥ 反向自检：改坏必判红 ────────────────────────────────────────────────

test('反向自检：后端直出漏传 footerLabel，锁必须判红', () => {
  const broken = read(RETRY_SVC)
    .replace('pageNumbers: true, footerLabel }', 'pageNumbers: true }')
  assert.ok(broken.includes('pageNumbers: true }'), '合成样本没改坏，本测试无意义')
  const fails = []
  const seg = anchoredSlice(broken, 'const pdfBuffer = await renderExamPDF(', 120, '合成样本', fails)
  if (seg) assert.ok(!/footerLabel/.test(seg), '改坏后竟然判绿 —— 这把锁是摆设')
  assert.deepEqual(fails, [])
})

test('反向自检：模板丢掉 width:100%，布局判据必须判红', () => {
  const tpl = buildPageNumberFooterTemplate('学生：张三')
  const broken = tpl.replace('width:100%;', '')
  assert.ok(!broken.includes('width:100%'), '合成样本没改坏，本测试无意义')
  assert.ok(!/width:\s*100%/.test(broken), '缺 width:100% 的实现不得被判绿')
})
