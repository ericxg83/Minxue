/**
 * 配图收紧（figureRegionRefiner）回归测试 —— 2026-09-20 初版，r268 纳入套件。
 *
 * 来历：本文件是 2026-09-20 配图收紧上线时的草稿锁，误提交进 b93c594 后一直放在
 *   server/tests/ 下，**从未被任何入口执行过**（npm test / patrol / nightlyAudit 三处
 *   口径都不含它）—— 2026-10-06 r215 实测它 18 过 1 红，登记为 backlog 提案 ㊱。
 *   r268 关闭 ㊱：接入 package.json / scripts/testFileList.mjs / testSuiteCoverageKit，
 *   并把唯一一条过期期望（case f，09-21 修正前的旧行为）按现行产品规则改写。
 * ⚠️ 端到端的权威锁是 test/figureRegionRefiner.test.mjs（node:test 写法，随套件全量跑）；
 *   本文件保留为纯函数（projectionBands / isTextBand / buildInkMask / denoiseInkMask 等）
 *   与早期合成版面的补充覆盖 —— 这些检查在权威锁里没有，删掉它们等于白放 15 条断言。
 */
import {
  projectionBands, isTextBand, isFigureBand, refineFigureRegion,
  buildInkMask, denoiseInkMask
} from '../utils/figureRegionRefiner.js'

let pass = 0
let fail = 0
const check = (name, got, expect) => {
  const g = JSON.stringify(got), e = JSON.stringify(expect)
  if (g === e) { pass++; console.log(`✅ ${name}`) }
  else { fail++; console.log(`❌ ${name}\n   期望 ${e}\n   实际 ${g}`) }
}
const ok = (name, cond) => { if (cond) { pass++; console.log(`✅ ${name}`) } else { fail++; console.log(`❌ ${name}`) } }

// ── 投影分带 ──
check('分带：空白够宽才切断', projectionBands([0, 5, 5, 0, 0, 0, 0, 5, 5, 0], 2, 2), [{ start: 1, end: 2 }, { start: 7, end: 8 }])
check('分带：空白不够宽不切断', projectionBands([0, 5, 5, 0, 5, 5, 0], 2, 2), [{ start: 1, end: 5 }])
check('分带：低于阈值的行不算内容', projectionBands([1, 1, 1], 2, 2), [])

// ── 带体检（数值取自线上样本实测）──
const PAGE_H = 2133
const band = (height, width, coverage, runRatio) =>
  ({ height, width, coverage, maxRunH: Math.round(width * runRatio), x0: 0, x1: width - 1 })
ok('题干文字行判为文字（覆盖 19.9%）', isTextBand(band(36, 1017, 0.199, 0.03), PAGE_H))
ok('图注"第N题图"判为文字（覆盖 22.5%）', isTextBand(band(24, 291, 0.225, 0.08), PAGE_H))
ok('印刷淡的图注也判为文字（覆盖 10%、无长横线）', isTextBand(band(33, 552, 0.10, 0.05), PAGE_H))
ok('学生手写行判为文字', isTextBand(band(35, 435, 0.104, 0.06), PAGE_H))
ok('几何配图判为图形（高 182、覆盖 5.9%）', isFigureBand(band(182, 577, 0.059, 0.47), PAGE_H))
ok('稀疏大图判为图形（覆盖 3.2%）', isFigureBand(band(179, 529, 0.032, 0.63), PAGE_H))
ok('数轴这类扁图形靠长横线救回（高 37、横线 39%）', isFigureBand(band(37, 633, 0.121, 0.39), PAGE_H))
ok('分数线/下划线不算图形（高 7）', !isFigureBand(band(7, 681, 0.308, 0.56), PAGE_H))
ok('两行数学式不算图形（覆盖 19.3%）', !isFigureBand(band(42, 1037, 0.193, 0.03), PAGE_H))

// ── 端到端：合成"三张配图并排 + 图下图注 + 下方题干"的版式 ──
// 页面 400x600；配图行 y 200..280，三张图 x 20..120 / 150..250 / 280..380；
// 图注在 y 292..300（密排），题干在 y 330..340（密排，整幅宽）。
const W = 400, H = 600
const ink = new Uint8Array(W * H)
const put = (x, y) => { if (x >= 0 && x < W && y >= 0 && y < H) ink[y * W + x] = 1 }
const hline = (x0, x1, y) => { for (let x = x0; x <= x1; x++) { put(x, y); put(x, y + 1) } }
const vline = (x, y0, y1) => { for (let y = y0; y <= y1; y++) { put(x, y); put(x + 1, y) } }
const dense = (x0, x1, y0, y1) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if ((x + y) % 3 !== 0) put(x, y)
}
for (const [x0, x1] of [[20, 120], [150, 250], [280, 380]]) {
  hline(x0, x1, 278)          // 底边
  vline(x0, 200, 278)         // 左边
  for (let i = 0; i <= 78; i++) put(x0 + i, 278 - i) // 斜边
  dense(x0 + 30, x0 + 70, 292, 300) // 图注"第N题图"
}
dense(20, 380, 330, 340)      // 下方题干整行

for (const [name, box, expect] of [
  ['取中间那张图（不含图注/题干/隔壁图）', { x: 150, y: 195, width: 100, height: 90 }, { x0: 150, x1: 251, y0: 200, y1: 280 }],
  ['取最左那张图', { x: 20, y: 195, width: 100, height: 90 }, { x0: 20, x1: 121, y0: 200, y1: 280 }],
]) {
  const r = refineFigureRegion(ink, W, H, box)
  if (!r) { fail++; console.log(`❌ ${name}: 返回 null`); continue }
  const inRange = (v, lo, hi) => v >= lo && v <= hi
  const good = inRange(r.x, expect.x0 - 6, expect.x0 + 6)
    && inRange(r.x + r.width, expect.x1 - 6, expect.x1 + 8)
    && inRange(r.y, expect.y0 - 6, expect.y0 + 6)
    && inRange(r.y + r.height, expect.y1 - 6, expect.y1 + 8)
  if (good) { pass++; console.log(`✅ ${name} → ${JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height })}`) }
  else { fail++; console.log(`❌ ${name}: 实际 ${JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height })}，期望约 x ${expect.x0}..${expect.x1} y ${expect.y0}..${expect.y1}`) }
}

// ── 模型框偏大跨到隔壁（2026-09-18 事故 + 2026-09-21 修正，r268 按现行规则改写）──
// 2026-09-18 白板第9题事故定的初衷：收紧不得把模型框已覆盖的真图砍掉
//   （数值转换器流程图被砍剩 22% 面积）⇒ 收紧结果与模型框求并集。
// 2026-09-21 白板第2/4/5/6/7题事故后修正：并集【之后】必须再让一次边 ——
//   模型框整体偏到图形下方一带（图注「（第N题）」+ 下一题题干）时，不得把那段文字并回来
//   （完整规则见维护中的锁 test/figureRegionRefiner.test.mjs「模型框落在图注/下一题文字上
//   → 收紧后不得把那段文字并回来」，该锁自 2026-09-21 起随 npm test 全量运行）。
// ⇒ 本文件 2026-09-20 建时断言「输出覆盖模型框完整范围（含图注带 292..300）」，
//   那是 09-21 修正前的旧行为，已被废除；r268 关闭 backlog ㊱ 时按现行产品规则改写：
//   · 窄模型框（45% 页宽 < 62% 满宽阈值）→ 水平仍与模型框求并集（130..310 完整保留）；
//   · 纵向收紧到图形带（200..279 墨迹），图注带（292..300）不得并回来。
//   ⛔ 若哪天并集保护被改回"无条件覆盖模型框"，本条与上面那条维护锁会一起判红。
{
  // f) 模型框偏大跨到隔壁：水平保住模型框，纵向只认图形带
  const r = refineFigureRegion(ink, W, H, { x: 130, y: 190, width: 180, height: 110 })
  if (!r) { fail++; console.log(`❌ 大框跨到隔壁: 返回 null`) }
  else {
    const inRange = (v, lo, hi) => v >= lo && v <= hi
    const got = { x: r.x, y: r.y, w: r.width, h: r.height }
    ok(`大框跨到隔壁：水平保住窄模型框（130..310）→ ${JSON.stringify(got)}`,
      inRange(r.x, 128, 130) && inRange(r.x + r.width, 310, 312))
    ok('大框跨到隔壁：纵向收紧到图形带（覆盖 200..279 墨迹）',
      inRange(r.y, 198, 202) && inRange(r.y + r.height, 277, 281))
    ok('大框跨到隔壁：图注带（292..300）不得被并回来（2026-09-21 规则）',
      r.y + r.height <= 291)
  }
}

// 纯文字区域（模型把题干当配图）→ 必须拒绝，宁可不给配图
const textOnly = new Uint8Array(W * H)
for (let i = 0; i < 4; i++) {
  for (let y = 100 + i * 20; y <= 110 + i * 20; y++) {
    for (let x = 20; x <= 380; x++) if ((x + y) % 3 !== 0) textOnly[y * W + x] = 1
  }
}
ok('纯文字区域拒绝出图', refineFigureRegion(textOnly, W, H, { x: 20, y: 100, width: 360, height: 80 }) === null)
ok('空掩码不抛异常且拒绝出图', refineFigureRegion(new Uint8Array(W * H), W, H, { x: 10, y: 10, width: 50, height: 50 }) === null)

// ── 掩码工具 ──
const gray = new Uint8Array([250, 250, 250, 200, 250, 250, 250, 250, 250])
const bg = new Uint8Array(9).fill(250)
check('墨迹掩码按局部背景阈值', Array.from(buildInkMask(gray, bg, 3, 3)), [0, 0, 0, 0, 0, 0, 0, 0, 0].map((_, i) => (i === 3 ? 1 : 0)))
const speck = new Uint8Array(9)
speck[4] = 1
check('孤立墨点被当噪点抹掉', Array.from(denoiseInkMask(speck, 3, 3)), new Array(9).fill(0))

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
