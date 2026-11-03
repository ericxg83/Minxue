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
  // bands: [{top, bottom, x?, w?}] 黑条（模拟文字行/图形），白底 400 宽
  const h = 300
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="${h}">`,
    '<rect width="400" height="300" fill="white"/>',
    ...bands.map(b => {
      const x = b.x ?? 20
      const w = b.w ?? 360
      return `<rect x="${x}" y="${b.top}" width="${w}" height="${b.bottom - b.top}" fill="black"/>`
    }),
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

// ── 真实卷面形态锁（2026-11-03 嘉定 24 实测校准）──
// 真卷是整页宽裁片，页面左右有留白：文字行只占 38%~70% 宽，图形占 12%~45%。
// 用「>=75% 整幅」当文字判据会把文字全判成图形，把两行小问文字裹进配图。

test('真实页面留白：文字只占 66% 宽也判为文字，只留窄图', async () => {
  const crop = await makeCrop([
    { top: 20, bottom: 50, x: 68, w: 264 },   // 文字行 66% 宽
    { top: 80, bottom: 110, x: 68, w: 264 },  // 文字行 66% 宽
    { top: 140, bottom: 270, x: 156, w: 88 }, // 图形 22% 宽、130px 高
  ])
  const band = await extractFigureBandFromCrop(crop)
  assert.ok(band, '应抠出图形带')
  const meta = await sharp(band).metadata()
  assert.ok(meta.height < 150, `两行文字应被切掉，带高 ${meta.height} 不应接近整张 300`)
  assert.ok(meta.height >= 120, `图形带高 ${meta.height} 应约 130+`)
})

test('两行文字紧贴（<8px 行距）合并成高块，仍按文字切掉', async () => {
  const crop = await makeCrop([
    { top: 20, bottom: 50, x: 68, w: 264 },
    { top: 54, bottom: 84, x: 68, w: 264 },   // 与上一行仅隔 4px，会合并成 66px 高块
    { top: 120, bottom: 270, x: 156, w: 88 },
  ])
  const band = await extractFigureBandFromCrop(crop)
  assert.ok(band, '应抠出图形带')
  const meta = await sharp(band).metadata()
  assert.ok(meta.height <= 165, `合并文字块应被切掉，带高 ${meta.height}`)
  assert.ok(meta.height >= 125, `图形带高 ${meta.height}`)
})

// ── 横向裁紧（2026-11-03 负责人报障：配图「居中且太小」）──
// 真卷裁片是整页宽横条（实测 2144px），图形常只占其中 12%~45%。
// 不横向裁紧 ⇒ 缩到 50% 页宽后图形仅约 15mm，且被左侧空白推到中部（看着像居中）。

test('横向裁紧：窄图必须裁到图形墨迹范围，不再保留整页宽空白', async () => {
  const crop = await makeCrop([
    { top: 20, bottom: 50, x: 68, w: 264 },    // 文字行（本裁片最宽带）
    { top: 90, bottom: 270, x: 300, w: 44 },   // 图形仅 11% 宽、且靠右（模拟真卷留白）
  ])
  const band = await extractFigureBandFromCrop(crop)
  assert.ok(band, '应抠出图形带')
  const meta = await sharp(band).metadata()
  assert.ok(meta.width <= 120, `必须横向裁紧到图形附近，实宽 ${meta.width}（原幅 400）`)
  assert.ok(meta.width >= 44, `图形本身 44px 必须完整保留，实宽 ${meta.width}`)
})

test('横向裁紧：图形本身占满整幅时保持原宽（不得裁掉内容）', async () => {
  const crop = await makeCrop([{ top: 30, bottom: 260, x: 10, w: 380 }])
  const band = await extractFigureBandFromCrop(crop)
  assert.ok(band, '应抠出图形带')
  const meta = await sharp(band).metadata()
  assert.ok(meta.width >= 370, `满幅图形不得被裁窄，实宽 ${meta.width}`)
})

// ── 底部标注补回（2026-11-03 负责人报障：图下 C/B/F、A/C、图1/图2 被切）──

test('底部标注补回：被判为文字带的图注仍按「横向落在图幅内」收回', async () => {
  const crop = await makeCrop([
    { top: 60, bottom: 200, x: 120, w: 120 },   // 图形（本裁片最宽带 120）
    { top: 210, bottom: 226, x: 130, w: 100 },  // 图注：跨度 100 ≥ 0.5×120 ⇒ 会被判成文字带
  ])
  const band = await extractFigureBandFromCrop(crop)
  assert.ok(band, '应抠出图形带')
  const meta = await sharp(band).metadata()
  assert.ok(
    meta.height >= 160,
    `底部图注必须补回（应含 60..226，约 172px），实际带高 ${meta.height}`
  )
})

test('底部不相干文字仍被切掉：图注闸只认「落在图幅内」', async () => {
  const crop = await makeCrop([
    { top: 60, bottom: 200, x: 120, w: 120 },   // 图形
    { top: 210, bottom: 226, x: 6, w: 380 },    // 整行正文（横向明显超出图幅）
  ])
  const band = await extractFigureBandFromCrop(crop)
  assert.ok(band, '应抠出图形带')
  const meta = await sharp(band).metadata()
  assert.ok(meta.height <= 160, `整行正文不得并进配图，实高 ${meta.height}`)
})
