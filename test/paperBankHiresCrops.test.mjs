// 回归锁：试卷题库配图「高清优先」（2026-11-03 负责人定调：不追求矢量，要高清无锯齿）
// 背景演变：
//   11-02 引进几何矢量重绘（vec_url 优先）；11-03 两天内连续画错（嘉定 23 F→H、徐汇 25 面板错位），
//   负责人拍板「一模卷是讲课用的，我不追求矢量，我要的是高清；上传的是高质量 PDF，图本身高清」。
// 落地方向：
//   1. 解析时双档渲染：OCR 用 2x（省 token），裁片/整页图用 4x（≈288dpi）+ JPEG q92；
//   2. 裁片走唯一出口 cropQuestionImage（裁前剥装订线），全仓没有第二处 re-encode；
//   3. vec_url 附着停用——列表/讲解版/组篮全部回退高清裁片（历史 SVG 仅归档）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

test('解析页 2x 只喂 OCR，裁片/整页图必须走 4x 高清页', () => {
  const src = read('server/services/paperBankService.js')
  assert.ok(/const CROP_RENDER_SCALE = 4/.test(src), '裁片渲染倍率必须是 4x')
  assert.ok(/CROP_RENDER_MAX_EDGE = 4096/.test(src), 'maxEdge 必须抬到 4096，否则 4x 被 2048 压回 2.4x')
  assert.ok(/CROP_RENDER_QUALITY = 0\.92/.test(src), '高清页 JPEG 质量 0.92（canvas 口径 0~1）')
  assert.ok(/cropPageBuffer = null/.test(src), 'parsePageToQuestions 必须接受独立的高清页参数')
  assert.ok(/const hiPage = cropPageBuffer \|\| pageBuffer/.test(src), '高清页缺失时允许退回解析页（降级不阻塞）')
  // 三个消费点必须全部用 hiPage：整页图上传 / 题目裁片 / 小问图形带源裁片
  assert.equal(
    (src.match(/cropQuestionImage\(hiPage, /g) || []).length,
    2,
    '题目裁片与小问图形带都必须从高清页裁'
  )
  assert.ok(/uploadImage\(hiPage, `paper-p\$\{pageNumber\}/.test(src), 'page_image_url 必须存高清页（供后续重裁）')
  assert.ok(/scale: CROP_RENDER_SCALE/.test(src), 'parsePaperResource 必须真的渲染 4x 页')
})

test('裁片 JPEG 质量必须是 92（82 在 4x 细节上有块状伪影）', () => {
  const src = read('server/services/paperBankService.js')
  const m = src.match(/export async function cropQuestionImage[\s\S]*?\.jpeg\(\{ quality: (\d+) \}\)/)
  assert.ok(m, 'cropQuestionImage 找不到 jpeg 质量设置')
  assert.equal(m[1], '92')
})

test('矢量优先 + 高清裁片兜底：vec_url 附着在位，前端逐处回落裁片', () => {
  // 2026-11-03 09:50 负责人二次定调：「能矢量就矢量，矢量做不到就高清」。
  const src = read('server/routes/paperBank.js')
  assert.ok(/attachVecUrls/.test(src), 'paperBank 路由必须附着 vec_url（矢量优先）')
  assert.ok(/headObjectExists/.test(src), 'vec 产物靠 OSS HEAD 探测，缺了矢量永远不生效')
  assert.ok(/vec_url \|\|/.test(read('src/utils/lecturePdf.js')), '讲解版必须保留裁片兜底')
  assert.ok(/vec_url \|\|/.test(read('src/workbench/views/PaperBankWorkbench.vue')), '列表行内图必须保留裁片兜底')
  // 矢量画错的硬闸：content gate 的字母误读判据必须在位（嘉定 23 F→H 事故）
  assert.ok(/硬规则 3\.5：字母误读判据/.test(read('server/utils/geometryContentGate.js')), '字母误读硬闸不得被删')
})
