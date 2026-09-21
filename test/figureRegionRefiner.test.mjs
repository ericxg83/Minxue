/**
 * 配图收紧回归测试（2026-09-21 建立）。
 *
 * 锁两件事：
 *  ① **并集不得把刚削掉的图注/邻题文字再加回来** —— 2026-09-21 白板第2/4/5/6/7题事故：
 *     模型框偏到图形下方一带（图注「（第N题）」+ 下一题题干），收紧往上抓到图形带，
 *     随后 `union(收紧框, 模型框)` 把那段文字原样并回来 ⇒ 输出 = 图形 + 学生手写 + 图注 + 下一题文字。
 *  ② **2026-09-18 的"不砍图"保护仍成立** —— 并集后的再削边**绝不能削进墨迹已确认的 core**。
 *
 * 墨迹掩码是合成的，判据可逐条对照 `server/utils/figureRegionRefiner.js` 顶部常量推导：
 *   isTextBand：coverage > 0.14（0.3 铺点的"手写/文字"满足）或（最长横线 < 12% 且高度 < 5% 页高）
 *   isFigureBand：非文字带 且（高度 ≥ 5% 页高 或 最长横线 ≥ 35% 带宽）
 * 注意两个真实约束，写用例时必须满足，否则收不紧：
 *   · 搜索窗纵向只外扩 box.height × 0.8 ⇒ 模型框不能离图形太远
 *   · 输出高度不得超过 box.height × 2.0（MAX_GROWTH_H）⇒ 模型框别给得太扁
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { refineFigureRegion } from '../server/utils/figureRegionRefiner.js'

const W = 400
const H = 1000

const makeInk = () => new Uint8Array(W * H)

/** 画一个三角轮廓 + 底边：**每一行都有 ≥4 点墨**（矩形只有两条横线，行分带会被内部空白切断，
 *  变成两条"覆盖率高"的细带而被判成文字带 —— 这是合成数据的坑，不是判据的坑）。 */
function figureShape(ink, yTop, yBot, cx, halfW) {
  const h = yBot - yTop
  for (let y = yTop; y <= yBot; y++) {
    const t = (y - yTop) / h
    const dx = Math.round(halfW * t)
    for (const x of [cx - halfW + dx, cx - halfW + dx + 1, cx + halfW - dx, cx + halfW - dx - 1]) {
      if (x >= 0 && x < W) ink[y * W + x] = 1
    }
  }
  for (let x = cx - halfW; x <= cx + halfW; x++) ink[yBot * W + x] = 1
}

/** 铺一片密排笔画（1/3 覆盖率 ⇒ 按 isTextBand 判为文字/手写带） */
function denseBlock(ink, y0, y1, x0, x1) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) if ((x - x0) % 3 === 0) ink[y * W + x] = 1
  }
}

/** 铺一片【散碎】的手写笔画：互不相连的小短横/短竖（真实学生演算的形态，
 *  与密排印刷文字不同——后者在 8 邻域下会连成一整块）。 */
function handwritingStrokes(ink, y0, y1, x0, x1) {
  for (let y = y0; y + 5 <= y1; y += 9) {
    for (let x = x0; x + 4 <= x1; x += 8) {
      for (let i = 0; i < 4; i++) ink[(y + (i % 3)) * W + x + i] = 1
      if ((x + y) % 2 === 0) for (let i = 0; i < 3; i++) ink[(y + i) * W + x + 2] = 1
    }
  }
}

test('模型框落在图注/下一题文字上 → 收紧后不得把那段文字并回来', () => {
  const ink = makeInk()
  figureShape(ink, 300, 400, 200, 100)        // 图形带（高 101 ≥ 5% 页高）
  denseBlock(ink, 210, 250, 100, 300)  // 上方题干文字
  denseBlock(ink, 430, 470, 100, 300)  // 下方：图注「（第N题）」+ 下一题题干
  // 模型框整体偏到图形下方文字带（真实故障形态：Q5 实测 dTop +144、dBottom 0）
  const box = { x: 110, y: 400, width: 180, height: 150 }
  const out = refineFigureRegion(ink, W, H, box)
  assert.ok(out, '应当仍然收紧出图形框')
  assert.ok(out.y <= 300, `必须覆盖图形上沿（≤300），实得 ${out.y}`)
  assert.ok(out.y + out.height >= 400, `必须覆盖图形下沿（≥400），实得 ${out.y + out.height}`)
  assert.ok(
    out.y + out.height <= 429,
    `不得把下方图注/下一题文字（430~470）并回来，实得下沿=${out.y + out.height}`,
  )
})

test('模型框贴着图形（2026-09-18 保护）→ 不得削进图形本体', () => {
  const ink = makeInk()
  figureShape(ink, 300, 400, 200, 100)
  denseBlock(ink, 500, 540, 100, 300)
  const box = { x: 115, y: 310, width: 170, height: 80 }  // 完全落在图形带内部
  const out = refineFigureRegion(ink, W, H, box)
  assert.ok(out, '应当收紧成功')
  assert.ok(out.y <= 300, `上沿不得切进图形（应 ≤300），实得 ${out.y}`)
  assert.ok(out.y + out.height >= 400, `下沿不得切进图形（应 ≥400），实得 ${out.y + out.height}`)
})

test('图形上方有学生手写 → 手写带（覆盖率过高＝文字带）应被削掉', () => {
  const ink = makeInk()
  denseBlock(ink, 200, 280, 100, 300)  // 学生手写/演算
  figureShape(ink, 320, 420, 200, 100)        // 图形
  const box = { x: 110, y: 210, width: 180, height: 120 }  // 模型框把手写一起圈进来
  const out = refineFigureRegion(ink, W, H, box)
  assert.ok(out, '应当收紧成功')
  assert.ok(out.y + out.height >= 420, `必须覆盖图形下沿（≥420），实得 ${out.y + out.height}`)
  assert.ok(out.y >= 281, `不得保留上方手写（200~280），实得上沿 ${out.y}`)
})

test('图形左侧有学生手写演算 → 不得并进配图（2026-09-21 第5题 078d57ac）', () => {
  const ink = makeInk()
  figureShape(ink, 400, 500, 250, 50)          // 图形：x 200~300（一条连通轮廓）
  handwritingStrokes(ink, 400, 490, 130, 196)  // 左侧散碎手写演算（与图形相邻、同一纵向范围）
  const box = { x: 140, y: 400, width: 170, height: 140 }  // 模型框被手写拖宽到左侧
  const out = refineFigureRegion(ink, W, H, box)
  assert.ok(out, '应当收紧成功')
  // 手写演算铺在 130~196，图形左沿 200。最大域外扩 15%（≈15px）后左沿应落在 ~185，
  // 即至少把 130~184 的手写演算全部削掉。
  assert.ok(out.x >= 180, `不得把左侧手写（130~196）并进来，实得左沿 ${out.x}`)
  assert.ok(out.x + out.width >= 300, `必须覆盖图形右沿（≥300），实得 ${out.x + out.width}`)
  assert.ok(out.y <= 400 && out.y + out.height >= 500, '必须覆盖图形上下沿')
})

test('干净的图形（连通域很少）→ 连通域去手写必须保持沉默，不得裁剪', () => {
  const ink = makeInk()
  figureShape(ink, 400, 500, 250, 50)          // 图形本体
  // 四个顶点字母（A/B/C/D 之类的小标注）：连通域总数仍然 < 12
  for (const [x, y] of [[195, 505], [300, 505], [295, 393], [246, 445]]) {
    for (let i = 0; i < 4; i++) { ink[y * W + x + i] = 1; ink[(y + 1) * W + x + i] = 1 }
  }
  const box = { x: 140, y: 390, width: 180, height: 130 }
  const out = refineFigureRegion(ink, W, H, box)
  assert.ok(out, '应当收紧成功')
  assert.ok(out.x <= 200, `不得削掉图形左沿（≤200），实得 ${out.x}`)
  assert.ok(out.x + out.width >= 300, `不得削掉图形右沿（≥300），实得 ${out.x + out.width}`)
  assert.ok(out.y <= 400 && out.y + out.height >= 500, `不得削掉图形上下沿，实得 y=${out.y} h=${out.height}`)
})
