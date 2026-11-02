// 小问组配图共享回归锁（2026-11-02）
// 背景：切段以「题号行上沿」为界，「题干→小问→图块在最后」版式的图整段落进
// 最后一个下问的切段，其余小问只切到自己的一行文字条（徐汇一模 25(1)(2) 实测）。
// 锁两个纯函数：planSubrowFigureAssignments（谁把图给谁）+ extractFigureBandFromCrop（图形带抠取）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {
  planSubrowFigureAssignments,
  extractFigureBandFromCrop,
  FIG_MIN_NORM_H,
} from '../server/services/paperFigureAssign.js'

const row = (id, questionNo, subNo, h, pageNo = 1) => ({
  id,
  page_no: pageNo,
  question_no: questionNo,
  sub_no: subNo,
  bbox: h == null ? null : { x: 60, y: 500, width: 900, height: h },
})

test('混合小问组：文字条行从带图行拿图（徐汇 25(1)(2)(3) 模式）', () => {
  const rows = [row('a', 25, '1', 20), row('b', 25, '2', 20), row('c', 25, '3', 130)]
  const plans = planSubrowFigureAssignments(rows)
  assert.equal(plans.length, 2)
  for (const p of plans) {
    assert.equal(p.sourceIdx, 2)
    assert.ok([0, 1].includes(p.targetIdx))
  }
})

test('整组都是文字条（图丢失）→ 不规划，宁可不出图', () => {
  const rows = [row('a', 21, '1', 20), row('b', 21, '2', 22)]
  assert.deepEqual(planSubrowFigureAssignments(rows), [])
})

test('整组都带图 → 无需共享', () => {
  const rows = [row('a', 21, '1', 120), row('b', 21, '2', 90)]
  assert.deepEqual(planSubrowFigureAssignments(rows), [])
})

test('带图的中等行不被当 target，只补文字条行', () => {
  const rows = [row('a', 23, '1', 20), row('b', 23, '2', 90), row('c', 23, '3', 290)]
  const plans = planSubrowFigureAssignments(rows)
  assert.equal(plans.length, 1)
  assert.equal(plans[0].targetIdx, 0)
  assert.equal(plans[0].sourceIdx, 2)
})

test('两个高度接近的中等行互不相给（防把邻行文字条当图）', () => {
  const rows = [row('a', 22, '1', 62), row('b', 22, '2', 40)]
  assert.deepEqual(planSubrowFigureAssignments(rows), [])
})

test('无 bbox 的行（切段失败）也作为 target 补图', () => {
  const rows = [row('a', 19, '1', null), row('b', 19, '2', 220)]
  const plans = planSubrowFigureAssignments(rows)
  assert.equal(plans.length, 1)
  assert.equal(plans[0].targetIdx, 0)
  assert.equal(plans[0].sourceIdx, 1)
})

test('不同题号/不同页/整题行（无小问号）不跨组共享', () => {
  const rows = [
    row('a', 25, '1', 20),      // 页1 q25：整组文字条，无源 → 不出计划
    row('b', 25, '2', 20),
    row('c', 26, '1', 130),     // 页1 q26：单成员组 → 不出计划
    row('d', 25, '1', 20, 2),   // 页2 q25：只有这里能配对
    row('e', 25, '2', 130, 2),
    row('f', 25, '', 130),      // 整题行不进组
  ]
  const plans = planSubrowFigureAssignments(rows)
  assert.equal(plans.length, 1)
  assert.equal(plans[0].targetIdx, 3)
  assert.equal(plans[0].sourceIdx, 4)
})

test('阈值常量语义：低于它算文字条、达到它才算带图行', () => {
  assert.equal(FIG_MIN_NORM_H >= 50, true)
})

// ── extractFigureBandFromCrop：合成图锁行为 ──

const makeCrop = async (bands) => {
  // bands: [{top, bottom}] 黑条（模拟文字行/图形），白底 400 宽
  const h = 300
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="${h}">`,
    '<rect width="400" height="300" fill="white"/>',
    ...bands.map(b => `<rect x="20" y="${b.top}" width="360" height="${b.bottom - b.top}" fill="black"/>`),
    '</svg>',
  ].join('')
  return sharp(Buffer.from(svg)).jpeg().toBuffer()
}

test('文字行 + 大图：抠掉文字行，只留图形带', async () => {
  const crop = await makeCrop([{ top: 20, bottom: 50 }, { top: 90, bottom: 240 }])
  const band = await extractFigureBandFromCrop(crop)
  assert.ok(band, '应抠出图形带')
  const meta = await sharp(band).metadata()
  // 图形带 = 90..240 → 高约 150
  assert.ok(meta.height >= 135 && meta.height <= 160, `带高 ${meta.height} 应约 150`)
})

test('纯文字裁片（无大带）→ null，调用方整张兜底', async () => {
  const crop = await makeCrop([{ top: 20, bottom: 50 }, { top: 70, bottom: 100 }, { top: 120, bottom: 150 }])
  assert.equal(await extractFigureBandFromCrop(crop), null)
})

test('纯图形裁片（单一大带）→ 返回该带', async () => {
  const crop = await makeCrop([{ top: 30, bottom: 260 }])
  const band = await extractFigureBandFromCrop(crop)
  assert.ok(band, '单一大带应返回')
  const meta = await sharp(band).metadata()
  assert.ok(meta.height >= 200 && meta.height <= 240, `带高 ${meta.height} 应约 230`)
})

test('过小裁片 → null', async () => {
  const tiny = await sharp({ create: { width: 100, height: 30, channels: 3, background: 'white' } }).jpeg().toBuffer()
  assert.equal(await extractFigureBandFromCrop(tiny), null)
})
