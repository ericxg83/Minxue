/**
 * 截图入题库「配图提取 + 来源」回归锁（2026-11-07）
 *
 * 事故：负责人看网课截了一张题（深黑板 + 白笔几何图 + 老师人像），入库后
 * 题目文字有了，配图却是**整张原始截图**——人像、黑背景、板书题干重影全在，
 * 与讲解版的白底干净裁片差一整档。根因两层：
 *   ① 主链路 analyzeCropFigure 的 isInk(v<200) 是「白底黑墨」判据，深底截图整页皆墨，
 *      判不出图形 ⇒ image_url 为空；
 *   ② parseClipImages 用「整张截图顶上」兜底 ⇒ 脏照片直接铺在题目下面。
 *
 * 本文件锁死：
 *   ① 图形框退化闸（整页框 / 非数值 / 无图 / 不可解析一律拒）；
 *   ② 连通域「主块 + 相邻字母保留、贴边人像块丢弃」的判据；
 *   ③ 深底反相 / 浅底不反相、块外一律纯白（人像与黑板渐变消失）；
 *   ④ 截图链路**不再**用整张截图兜底、前端「看原截图」仍可回看；
 *   ⑤ 来源字段前后端字段名逐字对齐 + URL 只认 http(s)。
 * 全部 fail-closed，并配反向自检。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseFigureBox, labelStrokes, pickFigureComponents, renderCleanFigure,
} from '../server/services/clipFigureClean.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8')
const SERVICE = 'server/services/paperBankService.js'
const ROUTES = 'server/routes/paperBank.js'
const VIEW = 'src/workbench/views/PaperBankWorkbench.vue'
const API = 'src/services/apiService.js'

const stripComments = (s) => String(s)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '')

/** 反向自检用：源码里是否还留着「整张截图顶上配图」的兜底代码 */
const hasWholeScreenshotFallback = (src) =>
  /if\s*\(!r\.image_url\s*&&\s*r\.page_image_url\)/.test(stripComments(src)) ||
  /imgFilled/.test(stripComments(src))

// ── ① 图形框退化闸 ────────────────────────────────────────────────────────

test('图形框：围栏 JSON 正常解析，坐标原样返回', () => {
  const r = parseFigureBox('```json\n{"has_figure":true,"box":{"x":201,"y":175,"width":346,"height":809}}\n```')
  assert.equal(r.hasFigure, true)
  assert.deepEqual(r.box, { x: 201, y: 175, width: 346, height: 809 })
})

test('图形框：模型说没图 / 不可解析 / 非数值 / 整页占位框 一律拒（fail closed）', () => {
  assert.equal(parseFigureBox('{"has_figure":false}').hasFigure, false)
  assert.equal(parseFigureBox('not json').reason, 'unparseable')
  assert.equal(parseFigureBox('{"has_figure":true,"box":{"x":"a","y":0,"width":300,"height":300}}').reason, 'non-numeric')
  assert.equal(parseFigureBox('{"has_figure":true,"box":{"x":0,"y":0,"width":1000,"height":1000}}').reason, 'box-size')
  assert.equal(parseFigureBox('{"has_figure":true,"box":{"x":0,"y":0,"width":950,"height":950}}').reason, 'full-page')
})

// ── ② 连通域与主块空间过滤 ────────────────────────────────────────────────

test('连通域：8 邻域连通块的数量、面积与包围盒', () => {
  const W = 20, H = 20
  const g = new Uint8Array(W * H) // 全 0 = 深底
  for (let y = 5; y <= 8; y++) for (let x = 5; x <= 8; x++) g[y * W + x] = 255
  g[15 * W + 15] = 255           // 孤立单点
  const { comps } = labelStrokes(g, W, H, v => v > 150)
  assert.equal(comps.length, 2)
  const block = comps.find(c => c.area === 16)
  assert.deepEqual([block.x0, block.y0, block.x1, block.y1], [5, 5, 8, 8])
  assert.equal(comps.find(c => c.area === 1).x0, 15)
})

test('主块过滤：保留图形主块与相邻顶点字母块，丢弃贴边的人像块与噪点', () => {
  const comps = [
    { id: 1, area: 5000, x0: 200, y0: 100, x1: 500, y1: 400 },  // 图形主块
    { id: 2, area: 150, x0: 210, y0: 420, x1: 230, y1: 440 },   // 顶点字母（图下方）
    { id: 3, area: 120, x0: 0, y0: 150, x1: 12, y1: 180 },      // 人像（贴左边界、远离图形）
    { id: 4, area: 5, x0: 250, y0: 200, x1: 252, y1: 202 },     // 噪点
  ]
  const picked = pickFigureComponents(comps, 600, 600)
  assert.ok(picked)
  assert.deepEqual(picked.keep.map(c => c.id).sort(), [1, 2])
  assert.deepEqual([picked.box.x0, picked.box.y1], [200, 440])
  // 主块占比过小 / 过大都要拒（全屏色块不是图）
  assert.equal(pickFigureComponents([{ id: 1, area: 10, x0: 10, y0: 10, x1: 200, y1: 200 }], 600, 600), null)
  assert.equal(pickFigureComponents([{ id: 1, area: 200000, x0: 10, y0: 10, x1: 500, y1: 500 }], 600, 600), null)
})

// ── ③ 白底化 + 笔迹掩膜 ───────────────────────────────────────────────────

/** 造一张 600×600 的深底板书：矩形线框（主块）+ 字母块 + 贴边人像块 */
function syntheticBoard(dark) {
  const W = 600, H = 600
  const g = new Uint8Array(W * H).fill(dark ? 20 : 240)
  const ink = dark ? 240 : 20
  const dot = (x, y) => { if (x >= 0 && x < W && y >= 0 && y < H) g[y * W + x] = ink }
  const rect = (x0, y0, x1, y1, t = 3) => {
    for (let x = x0; x <= x1; x++) for (let k = 0; k < t; k++) { dot(x, y0 + k); dot(x, y1 - k) }
    for (let y = y0; y <= y1; y++) for (let k = 0; k < t; k++) { dot(x0 + k, y); dot(x1 - k, y) }
  }
  rect(200, 150, 500, 450)                       // 图形主块（细线，连通）
  for (let y = 470; y < 485; y++) for (let x = 250; x < 265; x++) dot(x, y) // 顶点字母块
  for (let y = 200; y < 230; y++) for (let x = 0; x < 20; x++) dot(x, y)    // 人像块
  return { g, W, H }
}

for (const darkBoard of [true, false]) {
  test(`白底化：${darkBoard ? '深底板书反相' : '浅底印刷不反相'}，笔迹保留、人像块与背景涂白`, () => {
    const { g, W, H } = syntheticBoard(darkBoard)
    const { labels, comps } = labelStrokes(g, W, H, darkBoard ? v => v > 150 : v => v < 150)
    const person = comps.find(c => c.x0 === 0 && c.y0 === 200)
    assert.ok(person, '合成图里应该有人像块')
    const picked = pickFigureComponents(comps, W, H)
    assert.ok(picked)
    assert.equal(picked.keep.some(c => c.id === person.id), false, '人像块必须被空间过滤丢掉')
    const clean = renderCleanFigure(g, W, H, labels, picked, darkBoard)
    assert.ok(clean, '质量闸应放行')
    const at = (x, y) => clean.out[y * W + x]
    assert.ok(at(200, 200) < 100, '图形线条必须变成深墨迹')
    assert.equal(at(10, 210), 255, '人像块所在区域必须被涂白')
    assert.equal(at(550, 550), 255, '空背景必须纯白')
    assert.ok(clean.whiteFrac > 0.9, `白底占比应 >90%，实得 ${clean.whiteFrac}`)
  })
}

// ── ④ 截图链路不再用整张截图兜底 ──────────────────────────────────────────

const serviceSrc = read(SERVICE)
const viewSrc = read(VIEW)
const routesSrc = read(ROUTES)
const apiSrc = read(API)

test('反向自检：源码锁确实能抓到「整张截图顶上」的旧兜底', () => {
  assert.equal(hasWholeScreenshotFallback('if (!r.image_url && r.page_image_url) { r.image_url = r.page_image_url }'), true)
  assert.equal(hasWholeScreenshotFallback('let imgFilled = 0'), true)
  assert.equal(hasWholeScreenshotFallback('// 注释里提到整张截图顶上不算'), false)
})

test('截图入库接了配图净化，且撤掉整张截图兜底', () => {
  const code = stripComments(serviceSrc)
  assert.ok(!hasWholeScreenshotFallback(serviceSrc), '⛔ 不许再用整张截图顶 image_url')
  assert.match(code, /extractClipFigure\(buf,\s*\{ logger \}\)/)
  assert.match(code, /row\.image_url = r\.figureUrl/)
  assert.match(code, /page_image_url: url/, 'OCR 全空时原截图仍要留档')
  assert.match(code, /image_url: pageResults\[idx\]\?\.figureUrl \|\| url/)
  assert.match(viewSrc, /q\.image_url \|\| q\.page_image_url/, '提不出配图时原截图仍要能点开')
})

// ── ⑤ 来源字段前后端契约 ──────────────────────────────────────────────────

test('来源：后端按 page_no 存/读 clipSources，字段名 clip_source 逐字对齐', () => {
  assert.match(serviceSrc, /AS clip_source/)
  assert.match(serviceSrc, /metadata->'clipSources'->>\(rq\.page_no::text\)/)
  assert.match(serviceSrc, /jsonb_build_object\('clipSources'/)
  assert.match(serviceSrc, /COALESCE\(metadata->'clipSources', '\{\}'::jsonb\) \|\| \$2::jsonb/, '多批来源必须合并不覆盖')
  assert.match(routesSrc, /router\.put\('\/questions\/:id\/source'/)
  assert.match(routesSrc, /ARRAY\['clipSources', \$2::text\]/)
  assert.match(routesSrc, /origin !== 'screenshot'/, '只准截图题库改来源')
})

test('来源：上传时按图片顺序带上来源，改来源走同一条 API，URL 只认 http(s)', () => {
  assert.match(apiSrc, /fd\.append\('sources', JSON\.stringify\(sources\)\)/)
  assert.match(apiSrc, /updatePaperClipSource = \(id, source\)/)
  assert.match(viewSrc, /uploadPaperClips\(/)
  assert.match(viewSrc, /clipFiles\.value\.map\(f => f\.source \|\| ''\)/)
  assert.match(viewSrc, /updatePaperClipSource\(q\.id, val\)/)
  assert.ok(
    viewSrc.includes('const isSourceUrl = (s) => /^https?:\\/\\//i.test('),
    'URL 判据必须严格只认 http(s)，javascript: 之类不得变成可点链接'
  )
  // 危险协议不得渲染成链接：链接分支必须走 isSourceUrl
  assert.match(viewSrc, /v-if="isSourceUrl\(q\.clip_source\)"/)
})
