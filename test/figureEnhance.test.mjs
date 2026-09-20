import { test } from 'node:test'
import assert from 'node:assert'
import sharp from 'sharp'
import { enhanceFigureBuffer } from '../server/services/figureEnhanceService.js'

// 构造测试图：白底 + 左侧黑框 + 右上灰块（模拟阴影填充，必须保留灰阶）
function makeTestImage({ grayFill = false } = {}) {
  const w = 400, h = 300
  const raw = Buffer.alloc(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 255
      if (x < 100 && y > 50 && y < 250) v = 20          // 左侧黑框（线条）
      if (grayFill && x > 150 && x < 350 && y > 60 && y < 240) v = 160  // 灰块（填充区）
      raw[y * w + x] = v
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer()
}

test('增强输出保留内容包围盒（不把图裁没）', async () => {
  const src = await makeTestImage()
  const out = await enhanceFigureBuffer(src)
  const m0 = await sharp(src).metadata()
  const m1 = await sharp(out).metadata()
  // 黑框在 y=50..250，trim 后高度不应 < 200（即不能裁崩）
  assert.ok(m1.height >= 190, `内容被过度裁剪: ${m0.height} -> ${m1.height}`)
  assert.ok(m1.width >= 90, `宽度被过度裁剪: ${m0.width} -> ${m1.width}`)
  assert.strictEqual(m0.width, 400)
  assert.strictEqual(m0.height, 300)
})

test('灰块分区：增强后仍保留中间灰度（不做全局二值化）', async () => {
  const src = await makeTestImage({ grayFill: true })
  const out = await enhanceFigureBuffer(src)
  const s = await sharp(out).grayscale().stats()
  const { data, info } = await sharp(out).grayscale().raw().toBuffer({ resolveWithObject: true })
  // 统计灰阶是否仍有大量中间值（增强不该把 160 灰块全推成 0 或 255）
  let midCount = 0
  for (let i = 0; i < data.length; i++) if (data[i] >= 40 && data[i] <= 215) midCount += 1
  const midRatio = midCount / (info.width * info.height)
  // 灰块面积 ≈ 200*180/400/300 = 30%+，增强后中间灰占比不应低于 10%（不允许全局二值化硬切）
  assert.ok(midRatio > 0.10, `中间灰占比过低=${(midRatio * 100).toFixed(1)}%，疑似全局二值化损坏填充区`)
  assert.ok(s.channels[0].mean > 0 && s.channels[0].mean < 255)
})

test('异常输入：空 buffer 不崩溃、返回原 buffer', async () => {
  const garbage = Buffer.from('not an image')
  const out = await enhanceFigureBuffer(garbage)
  assert.deepStrictEqual(out, garbage)
})

test('minShortEdge 超分兜底：小图短边放大到目标值', async () => {
  const w = 120, h = 80
  const raw = Buffer.alloc(w * h)
  for (let i = 0; i < w * h; i++) raw[i] = 255
  for (let y = 0; y < h; y++) { raw[y * w + 10] = 0; raw[y * w + w - 11] = 0 }
  for (let x = 0; x < w; x++) { raw[x] = 0; raw[(h - 1) * w + x] = 0 }
  const src = await sharp(raw, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer()
  const out = await enhanceFigureBuffer(src, { minShortEdge: 300 })
  const m = await sharp(out).metadata()
  assert.ok(m.height >= 300, `短边未放大: ${m.height}`)
})