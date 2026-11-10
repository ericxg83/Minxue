// 回归锁：试卷题库配图「高清优先」（2026-11-03 负责人定调：不追求矢量，要高清无锯齿）
// 背景演变：
//   11-02 引进几何矢量重绘（vec_url 优先）；11-03 两天内连续画错（嘉定 23 F→H、徐汇 25 面板错位），
//   负责人拍板「一模卷是讲课用的，我不追求矢量，我要的是高清；上传的是高质量 PDF，图本身高清」。
// 落地方向：
//   1. 解析时双档渲染：OCR 用 2x（省 token），裁片/整页图用 4x（≈288dpi）+ JPEG q92；
//   2. 裁片走唯一出口 cropQuestionImage（裁前剥装订线），全仓没有第二处 re-encode；
//   3. vec_url 附着停用——列表/讲解版/组篮全部回退高清裁片（历史 SVG 仅归档）。
// ⛔ 2026-11-10 更正：11-03 记的「canvas.toBuffer jpeg 质量是 0~1」是**错的**。
//    实测同一份松江 PDF 4x 渲染：quality=0.92/0.85/1 都只有 84KB（被当成最低质量），
//    quality=92 → 579KB；其他三套一模卷 11-03 存量重渲染页图 432~558KB 正是 92 的产物。
//    11-09 导入的松江卷传了 0.92 ⇒ 整卷配图从源头压糊，负责人四次报障。
//    ⇒ 两处 92（canvas 渲染 / sharp 裁片）口径都是 0~100 整数，本文件锁死。
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
  assert.ok(/CROP_RENDER_QUALITY = 92\b/.test(src), '高清页 JPEG 质量必须是整数 92（canvas 口径 0~100）')
  assert.ok(!/CROP_RENDER_QUALITY = 0\./.test(src), '⛔ 禁止 0~1 小数：0.92 会把整卷页图压成 84KB（松江一模事故）')
  assert.ok(/cropPageBuffer = null/.test(src), 'parsePageToQuestions 必须接受独立的高清页参数')
  assert.ok(/const hiPage = cropPageBuffer \|\| pageBuffer/.test(src), '高清页缺失时允许退回解析页（降级不阻塞）')
  // 消费点必须全部用 hiPage：整页图上传 / 题目裁片。
  // ⚠️ 2026-11-06 改为「一页只裁一次」：小问配图共享不再重复 cropQuestionImage，
  //   而是复用同一次高清裁片的像素判图 —— 所以只有 1 处调用，
  //   但**绝不允许**出现从 2x 解析页裁剪的调用。
  assert.equal(
    (src.match(/cropQuestionImage\(hiPage, /g) || []).length,
    1,
    '题目裁片必须从高清页裁，且一页只裁一次'
  )
  assert.equal(
    (src.match(/await cropQuestionImage\(pageBuffer/g) || []).length,
    0,
    '绝不允许从 2x 解析页裁片（函数定义 cropQuestionImage(pageBuffer, box) 不算调用）'
  )
  assert.ok(/const fig = await analyzeCropFigure\(cropped\)/.test(src), '判图必须复用同一次高清裁片')
  assert.ok(/if \(fig\.band\) figBands\.set\(i, fig\.band\)/.test(src), '图形带必须留底给小问共享复用')
  assert.ok(/uploadImage\(hiPage, `paper-p\$\{pageNumber\}/.test(src), 'page_image_url 必须存高清页（供后续重裁）')
  assert.ok(/scale: CROP_RENDER_SCALE/.test(src), 'parsePaperResource 必须真的渲染 4x 页')
})

test('裁片 JPEG 质量必须是 92（82 在 4x 细节上有块状伪影）', () => {
  const src = read('server/services/paperBankService.js')
  const m = src.match(/export async function cropQuestionImage[\s\S]*?\.jpeg\(\{ quality: (\d+) \}\)/)
  assert.ok(m, 'cropQuestionImage 找不到 jpeg 质量设置')
  assert.equal(m[1], '92')
})

test('存量矢量继续生效，但不再生产新矢量（2026-11-03 终局口径）', () => {
  // 负责人 10:26 定：此场景不需要矢量；已做的不删（钱已花），以后按高清标准。
  const route = read('server/routes/paperBank.js')
  assert.ok(/attachVecUrls/.test(route), '存量 vec_url 附着必须保留，否则已验证的 3 张白花')
  assert.ok(/headObjectExists/.test(route), 'vec 产物靠 OSS HEAD 探测')
  assert.ok(/vec_url \|\|/.test(read('src/utils/lecturePdf.js')), '讲解版必须保留裁片兜底')
  assert.ok(/vec_url \|\|/.test(read('src/workbench/views/PaperBankWorkbench.vue')), '列表行内图必须保留裁片兜底')

  // 生产端默认拒跑（防新卷流程/顺手一跑白烧额度）
  const script = read('server/scripts/vectorize-paper-bank-figures.mjs')
  assert.ok(/if \(!args\.includes\('--legacy'\)\)/.test(script), '矢量脚本必须默认退出，仅 --legacy 可运行')
  assert.ok(/已停止（2026-11-03 10:26/.test(script) || /已停止（2026-11-03/.test(script), '脚本头部必须写明停用决定')
})

test('矢量画错的硬闸不得被删（字母误读判据）', () => {
  assert.ok(/硬规则 3\.5：字母误读判据/.test(read('server/utils/geometryContentGate.js')))
})
