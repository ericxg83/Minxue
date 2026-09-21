/**
 * 几何配图裁剪编排回归测试（`server/utils/geometryCrop.js`）
 *
 * 背景：2026-09-21「练习册管线对齐日常管线」。此前 `processTask` 内联一份裁剪编排、
 * `processWorkbookGrading` 完全没采集配图 → `geometry_image_url` 恒空。抽成共享模块后，
 * 这里锁三件事：
 *   ① `denormalizeBbox` 的 width 按图宽 / height 按图高（混用会把非正方形页面上的框纵向拉长）；
 *   ② `cropImage` 的**调用契约**是位置参数 `(imageBuffer, bbox, studentId, questionId)`，
 *      与 worker.js 的 `cropAndUploadGeometryImage` 一致（曾因按对象解构传参而静默不裁）；
 *   ③ `cropped` / `missingRefs` 的语义：退化框（题干下方横条）只计入 missingRefs，不计 cropped。
 *
 * 全程不触网：`cropImage` 注入假实现。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cropGeometryFigures, denormalizeBbox } from '../server/utils/geometryCrop.js'

test('denormalizeBbox：width 按图宽、height 按图高，0-1000 → 像素', () => {
  // 1000x2000 的非正方形页面：x=500 → 500px；y=100 → 200px（不是 100px）
  assert.deepEqual(denormalizeBbox({ x: 500, y: 100, width: 200, height: 100 }, 1000, 2000), {
    x: 500, y: 200, width: 200, height: 200,
  })
  // 越界与非法值必须被 clamp 到 [0,1000]，不能让负坐标流出
  const c = denormalizeBbox({ x: -50, y: 2000, width: 1200, height: NaN }, 1000, 1000)
  assert.deepEqual(c, { x: 0, y: 1000, width: 1000, height: 0 })
  // 空输入原样返回，不得抛
  assert.equal(denormalizeBbox(null, 100, 100), null)
})

test('cropGeometryFigures：真引图有框 → 裁剪；漏框/退化框 → 只计 missingRefs', async () => {
  const pageBuf = Buffer.from('fakejpeg')
  const pageDims = new Map([[1, { w: 1000, h: 2000 }]])
  const calls = []
  // ⚠️ 契约：位置参数，与 worker.js 的 cropAndUploadGeometryImage 同签名
  const fakeCrop = async (imageBuffer, bbox, sid, questionId) => {
    calls.push({ sid, questionId, bbox, bufLen: imageBuffer?.length })
    return `https://oss.example/${sid}/${questionId}.jpg`
  }

  const questions = [
    // ① 引图 + 有效框 → 应裁
    { id: 'q1', question_number: 1, content: '如图，求 AB 的长', parent_stem: null,
      image_type: 'geometry', image_bbox: { x: 500, y: 100, width: 200, height: 100 },
      block_coordinates: { x: 100, y: 50, width: 800, height: 300 }, page_number: 1 },
    // ② 引图但没有框（OCR 漏返）→ missingRefs
    { id: 'q2', question_number: 2, content: '见图，求面积', parent_stem: null,
      image_type: 'geometry', image_bbox: null, block_coordinates: null, page_number: 1 },
    // ③ 不引图 → 完全忽略
    { id: 'q3', question_number: 3, content: '计算 1+1', parent_stem: null,
      image_type: 'none', image_bbox: null, block_coordinates: null, page_number: 1 },
    // ④ 引图但框是页面底部横条（退化框）→ missingRefs，绝不能裁出条状图当配图
    { id: 'q4', question_number: 4, content: '如图，求周长', parent_stem: null,
      image_type: 'geometry', image_bbox: { x: 0, y: 980, width: 1000, height: 20 },
      block_coordinates: null, page_number: 1 },
  ]

  const r = await cropGeometryFigures({
    questions,
    pageBuffers: new Map([[1, pageBuf]]),
    pageDims,
    cropImage: fakeCrop,
    studentId: 'stu-1',
    fallbackBuffer: pageBuf,
    fallbackPage: 1,
  })

  assert.equal(r.cropped, 1, '只有 q1 该被裁剪')
  assert.equal(r.missingRefs, 2, 'q2 漏框 + q4 退化框')
  assert.equal(calls.length, 1, '裁剪实现只应被调用一次')
  assert.equal(calls[0].questionId, 'q1')
  assert.equal(calls[0].sid, 'stu-1')
  assert.equal(calls[0].bufLen, pageBuf.length, '必须把页 buffer 原样传给裁剪实现')
  // 归一化框已降为像素：x 500/1000*1000=500，y 100/1000*2000=200
  assert.deepEqual(calls[0].bbox, { x: 500, y: 200, width: 200, height: 200 })
  // 就地写回配图 URL，供 createQuestions 落 geometry_image_url
  assert.equal(questions[0].geometry_image_url, 'https://oss.example/stu-1/q1.jpg')
  assert.ok(!questions[1].geometry_image_url, '漏框题不得留下配图')
})

test('cropGeometryFigures：多小问大题，引图词只在 parent_stem 时子题继承配图框', async () => {
  const pageBuf = Buffer.from('fakejpeg')
  // 真实数据形态：多小问大题拆行后，**每个小问都带同一份 parent_stem**，框只挂在某一个小问上。
  // 引图词（「如图」）只在 parent_stem 里，小问自身 content 无引图词 —— 靠 hasFigureReference
  // 读 parent_stem 才判得出引图，靠 inheritSharedStemFigures 才把框补给同组其余小问。
  const STEM = '如图，已知 AB=AC。'
  const questions = [
    { id: 'c1', question_number: 12, sub_no: '1', content: '(1) 求证 BD=CE。', parent_stem: STEM,
      image_type: 'geometry', image_bbox: { x: 100, y: 100, width: 300, height: 300 },
      block_coordinates: null, page_number: 1 },
    { id: 'c2', question_number: 12, sub_no: '2', content: '(2) 求 DE 的长。', parent_stem: STEM,
      image_type: null, image_bbox: null, block_coordinates: null, page_number: 1 },
  ]
  const got = []
  const r = await cropGeometryFigures({
    questions,
    pageBuffers: new Map([[1, pageBuf]]),
    pageDims: new Map([[1, { w: 1000, h: 1000 }]]),
    cropImage: async (_buf, bbox, _sid, qid) => { got.push(qid); return `u/${qid}.jpg` },
    studentId: 's',
    fallbackBuffer: pageBuf,
  })
  assert.equal(r.missingRefs, 0, '继承后不应再报缺图')
  assert.ok(got.includes('c2'), '小问必须继承同组母题配图框并参与裁剪')
  assert.equal(questions[1].geometry_image_url, 'u/c2.jpg', '小问配图须就地写回')
  assert.equal(r.cropped, 2, '同组两问都应拿到配图')
})

test('契约：worker.js 两条管线必须共用同一份 cropGeometryFigures，且传入真实签名', () => {
  const src = readFileSync(new URL('../server/worker.js', import.meta.url), 'utf8')
  assert.ok(src.includes("from './utils/geometryCrop.js'"), '必须 import 共享编排模块')
  // 调用点：日常管线 processTask + 练习册管线 processWorkbookGrading
  const calls = src.match(/cropGeometryFigures\(\{/g) || []
  assert.ok(calls.length >= 2, `日常与练习册两条管线都必须调用（当前 ${calls.length} 处）`)
  // 真实裁剪实现的签名必须是位置参数（曾因对象解构导致静默不裁）
  const m = src.match(/export async function cropAndUploadGeometryImage\(([^)]*)\)/)
  assert.ok(m, '找到 cropAndUploadGeometryImage')
  assert.equal(m[1].split(',').map(s => s.trim()).join(','),
    'imageBuffer,bbox,studentId,questionId', '裁剪实现签名不得改动')
})

test('契约：练习册 prompt 必须采集配图三字段（否则裁剪无输入）', () => {
  const src = readFileSync(new URL('../server/worker.js', import.meta.url), 'utf8')
  for (const field of ['image_type', 'image_bbox', 'has_figure']) {
    const n = (src.match(new RegExp(`"${field}"`, 'g')) || []).length
    assert.ok(n >= 2, `workbook 与 answerBank 两套 prompt 都要有 ${field}（当前 ${n} 处）`)
  }
})
