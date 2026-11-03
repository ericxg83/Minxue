// 回归锁：页面印刷装订竖线清除（2026-11-03 嘉定一模「每张裁片多了一条线」）
// 根因：真卷 PDF 版面带贯穿大半页的细装订竖线（嘉定 6 页 x≈0.758、纵跨 85%+ 页高），
//       题目 bbox 横向覆盖全幅 ⇒ 每张裁片都带这条线。2026-11-02 徐汇 24 同源问题
//       当时人工按题修，本次收口为管线级：paperBankService#cropQuestionImage 裁剪前
//       统一调 stripPageRulingLines（唯一裁剪出口，唯一实现）。
// 锁三件事：
//   1. findRulingLineRanges 判据（长规线命中；短笔画/宽色块/散布文字列不命中）
//   2. stripPageRulingLines 真的擦线且不碰内容（sharp 集成）
//   3. cropQuestionImage 接线不许拆（源码断言，同 answerOcrGuard 惯例）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
// ⛔ 只用 server 侧 sharp 副本（0.35.4）：本仓根目录另装了 sharp 0.33.5（两份 libvips），
// 同进程混用会炸（2026-11-03 实测）。测试造图/读像素也必须走这份。
import sharp from '../server/node_modules/sharp/dist/index.mjs'
import {
  findRulingLineRanges,
  stripPageRulingLines,
} from '../server/services/pageRulingClean.js'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

/** 造一张合成页：W×H 白底。竖线 x0..x1、行 y0..y1；再加几个短文字块。 */
function buildGrayPage(W, H, line, blocks = []) {
  const g = new Uint8Array(W * H).fill(255)
  const fill = (x0, y0, x1, y1, v = 40) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) g[y * W + x] = v
    }
  }
  if (line) fill(line.x0, line.y0, line.x1, line.y1)
  for (const b of blocks) fill(b.x0, b.y0, b.x1, b.y1)
  return g
}

test('判据：贯穿 85% 页高的 2px 实心竖线命中（嘉定指纹）', () => {
  const W = 400, H = 600
  const line = { x0: 300, x1: 301, y0: 40, y1: 550 } // 511/600 = 85%
  const blocks = [
    { x0: 20, y0: 60, x1: 120, y1: 72 },
    { x0: 320, y0: 100, x1: 380, y1: 112 },
  ]
  const ranges = findRulingLineRanges(buildGrayPage(W, H, line, blocks), W, H)
  assert.equal(ranges.length, 1, '只命中装订线本身')
  assert.equal(ranges[0].x0, 300)
  assert.equal(ranges[0].x1, 301)
  assert.equal(ranges[0].y0, 40)
  assert.equal(ranges[0].y1, 550)
})

test('判据：浅灰副线（灰度 205、1px、纵跨 85%）也命中——嘉定双装订线二轮教训', () => {
  const W = 400, H = 600
  const g = buildGrayPage(W, H, null)
  // 浅灰 1px 线：灰度 205（<220 但 >160），纵跨 85% 页高
  for (let y = 45; y <= 555; y++) g[y * W + 260] = 205
  const ranges = findRulingLineRanges(g, W, H)
  assert.equal(ranges.length, 1, '浅灰副线必须命中')
  assert.equal(ranges[0].x0, 260)
  assert.equal(ranges[0].x1, 260)
})

test('判据：几何图短竖笔画（15% 页高）不命中', () => {
  const W = 400, H = 600
  const blocks = [{ x0: 100, y0: 200, x1: 101, y1: 290 }]
  assert.deepEqual(findRulingLineRanges(buildGrayPage(W, H, null, blocks), W, H), [])
})

test('判据：宽色块（20px、纵跨 80%）不命中——宽度超上限', () => {
  const W = 400, H = 600
  const blocks = [{ x0: 150, y0: 50, x1: 170, y1: 530 }]
  assert.deepEqual(findRulingLineRanges(buildGrayPage(W, H, null, blocks), W, H), [])
})

test('判据：散布文字列（累计墨迹够多但断续）不命中——实心率不足', () => {
  const W = 400, H = 600
  const g = buildGrayPage(W, H, null)
  // 在 x=200 同一列上铺 25 段 10px 高的短块：累计 250 行 ≥ 40%H，但每段之间断开
  for (let i = 0; i < 25; i++) {
    const y0 = 20 + i * 24
    for (let y = y0; y < y0 + 10; y++) {
      g[y * W + 200] = 40
      g[y * W + 201] = 40
    }
  }
  assert.deepEqual(findRulingLineRanges(g, W, H), [])
})

test('集成：stripPageRulingLines 擦掉线、不碰文字块（sharp 真图）', async () => {
  const W = 300, H = 400
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="white"/>
    <rect x="226" y="20" width="2" height="360" fill="black"/>
    <rect x="30" y="60" width="80" height="10" fill="black"/>
    <rect x="30" y="200" width="60" height="10" fill="black"/>
  </svg>`
  const page = await sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toBuffer()
  const stripped = await stripPageRulingLines(page)
  assert.notEqual(stripped, page, '命中装订线时应返回清除后的新 Buffer')

  const { data, info } = await sharp(stripped).grayscale().raw().toBuffer({ resolveWithObject: true })
  assert.equal(info.width, W)
  // 原线区（x=226..227 ±2 → 224..229，y=20..380）应全白
  for (let x = 224; x <= 229; x++) {
    for (let y = 20; y <= 380; y += 7) {
      assert.ok(data[y * info.width + x] >= 200, `(${x},${y}) 应已变白`)
    }
  }
  // 文字块中心仍应是黑的
  const t1 = await sharp(stripped).grayscale().raw().toBuffer()
  assert.ok(t1[65 * W + 70] < 100, '第一个文字块应保留')
  assert.ok(t1[205 * W + 60] < 100, '第二个文字块应保留')
})

test('集成：无规线的页原样返回（同一 Buffer，不重编码）', async () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
    <rect width="200" height="200" fill="white"/>
    <rect x="30" y="60" width="80" height="10" fill="black"/>
  </svg>`
  const page = await sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toBuffer()
  const out = await stripPageRulingLines(page)
  assert.equal(out, page, '无线页面必须原样返回，不得重编码')
})

test('接线：cropQuestionImage 必须先剥规线再裁（唯一裁剪出口不许拆）', () => {
  const src = read('server/services/paperBankService.js')
  assert.ok(
    src.includes("import { stripPageRulingLines } from './pageRulingClean.js'"),
    'paperBankService 必须引入 stripPageRulingLines'
  )
  const fn = src.slice(src.indexOf('export async function cropQuestionImage'))
  assert.ok(
    /const page = await stripPageRulingLines\(pageBuffer\)/.test(fn),
    'cropQuestionImage 裁剪前必须调 stripPageRulingLines'
  )
  assert.ok(
    /sharp\(page\)\.extract\(/.test(fn),
    'extract 必须作用于剥线后的 page，而不是原始 pageBuffer'
  )
})
