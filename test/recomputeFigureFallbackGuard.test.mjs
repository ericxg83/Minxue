// 回归测试：「AI 重解析」带图题的两条护栏（2026-10-30）
//
// 事故背景（q=32c286f1，老师对「AI 计算中 178s…」白等 210s 后 503）：
//   ① 数轴配图仅 433×93，被下载闸拒收 ⇒ 引擎内「回退纯文字求解」；但 index.js 的
//      hasFigure 分支只传了 imageUrl/visionVendorChain/timeoutMs，**没传
//      vendorOverride/modelOverride/strictPrimary** ⇒ 文字回退丢掉「严格单通道」纪律，
//      改跑默认引擎全链（kimi-k3 → glm-5.2 → Bailian → Huihuiyun，每级最长 150s），
//      多级串行必然撞穿 DEADLINE_MS=210s 总兜底（设计不变量：单级/两级串行 < 总兜底）。
//   ② 题干明示引图的题（数轴/如图…），图不可用时纯文字必然回「待人工补充」——
//      与缺配图预判闸同口径（2026-09-24 用户定调：缺图就别解析，别浪费 token 和时间），
//      应当场快速失败，而不是烧 150s 文字链再被 503 强杀。
//
// 本测试锁定：
//   A. worker.js：figureRequired 题的下载失败必须在「回退纯文字」之前快速抛
//      FIGURE_UNUSABLE；外层 catch 短路该错误为 source='figure-unusable'（不进网络重试）。
//   B. index.js：hasFigure 分支必须把 vendorOverride/modelOverride/strictPrimary
//      透传给引擎（回退纯文字时保持严格单通道），并处理 figure-unusable 给 400 可行动文案。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

function fnBody(src, startMarker, opts = {}) {
  const start = src.indexOf(startMarker)
  assert.ok(start > 0, `未找到起点标记：${startMarker}`)
  const end = opts.endMarker ? src.indexOf(opts.endMarker, start) : src.indexOf('\n}\n', start)
  return src.slice(start, end > 0 ? end : src.length)
}

test('worker.js: figureRequired 题下载失败 → 快速抛 FIGURE_UNUSABLE，先于「回退纯文字」', () => {
  const body = fnBody(read('server/worker.js'), 'export const generateAnswerForQuestion')
  const catchIdx = body.indexOf('配图下载失败，本题回退纯文字求解')
  assert.ok(catchIdx > 0, '未找到下载失败的回退分支')
  // figureRequired 检查必须出现在回退置空（imageDataURL = null）之前
  const requiredIdx = body.indexOf('if (opts.figureRequired)')
  assert.ok(requiredIdx > 0 && requiredIdx < catchIdx,
    'figureRequired 快速失败闸必须在回退纯文字之前；放后面等于没做，老师仍会白等 150s+')
  const errThrow = body.slice(requiredIdx, catchIdx)
  assert.ok(errThrow.includes("err.code = 'FIGURE_UNUSABLE'"), '快速失败必须带 FIGURE_UNUSABLE 错误码')
})

test('worker.js: 外层 catch 短路 FIGURE_UNUSABLE → source=figure-unusable，不进网络重试', () => {
  const body = fnBody(read('server/worker.js'), 'export const generateAnswerForQuestion')
  const catchStart = body.indexOf("  } catch (error) {")
  assert.ok(catchStart > 0, '未找到外层 catch')
  const outer = body.slice(catchStart)
  const shortIdx = outer.indexOf("error.code === 'FIGURE_UNUSABLE'")
  assert.ok(shortIdx > 0, '外层 catch 必须先短路 FIGURE_UNUSABLE')
  const short = outer.slice(shortIdx, shortIdx + 400)
  assert.ok(short.includes("source: 'figure-unusable'"), '短路返回必须带 source=figure-unusable')
  assert.ok(short.includes('figureError'), '短路返回必须带 figureError 供前端文案使用')
  // 短路必须在 isNetworkError 重试逻辑之前
  const retryIdx = outer.indexOf('const isNetworkError')
  assert.ok(retryIdx > shortIdx, 'FIGURE_UNUSABLE 短路必须先于网络重试判定（它不是网络错，绝不重试）')
})

test('index.js: hasFigure 分支必须透传 vendorOverride/modelOverride/strictPrimary', () => {
  const body = fnBody(
    read('server/index.js'),
    "app.post('/api/questions/:id/recompute-answer'",
    { endMarker: "app.get('/api/questions/:id/recompute-answer/status'" }
  )
  const hasFigureIdx = body.indexOf('hasFigure ? {')
  assert.ok(hasFigureIdx > 0, '未找到 hasFigure 引擎调用分支')
  const branch = body.slice(hasFigureIdx, body.indexOf("} : {", hasFigureIdx))
  for (const field of ['vendorOverride: ch.vendor', 'modelOverride: ch.model', 'strictPrimary: true']) {
    assert.ok(branch.includes(field),
      `hasFigure 分支缺少 ${field}：图下载失败回退纯文字时会丢「严格单通道」纪律，` +
      '跑默认引擎全链（每级最长 150s）必然撞穿 210s 总兜底（2026-10-30 q=32c286f1 实测）')
  }
  assert.ok(branch.includes('figureRequired'), 'hasFigure 分支必须传 figureRequired（题干引图时图不可用应快速失败）')
})

test('index.js: figure-unusable 必须落为 400 可行动文案，且先于通用 503', () => {
  const body = fnBody(
    read('server/index.js'),
    "app.post('/api/questions/:id/recompute-answer'",
    { endMarker: "app.get('/api/questions/:id/recompute-answer/status'" }
  )
  const unusableIdx = body.indexOf("error: 'figure-unusable'")
  assert.ok(unusableIdx > 0, '未处理 figure-unusable：老师会对无图可读的题反复点按钮白等')
  // res.status(400) 在响应对象里位于 error: 键之前，窗口向前扩 200 字符
  const resp = body.slice(Math.max(0, unusableIdx - 200), unusableIdx + 500)
  assert.ok(resp.includes('status(400)'), 'figure-unusable 应为 400（参数性问题，不是服务端忙）')
  assert.ok(resp.includes('请重新补'), '文案必须给可行动动作（重新补图/人工填写）')
  // 顺序：figure-unusable 分支必须出现在通用 503（primary-model-unavailable）之前
  const genericIdx = body.indexOf("error: 'primary-model-unavailable'")
  assert.ok(genericIdx > unusableIdx, 'figure-unusable 必须先于通用 503 判定，否则会被兜底文案吞掉')
})
