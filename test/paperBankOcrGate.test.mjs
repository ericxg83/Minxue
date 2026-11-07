/**
 * 一模卷「零错字」双模型闸回归锁（2026-11-06）
 *
 * 事故：嘉定 23(2)「AC·DF」→「AC²-DE²」、24(2)②「△PDE」→「△PBE」；
 *   全库双模型复核又在三套一模卷查出 80+ 处字母/数字误读。
 * 负责人裁决：「一模卷不允许错误，一次都不可以」⇒ 上传链路必须双模型交叉校验。
 *
 * 本文件锁死：
 *   ① 校对通道与终裁通道是两个不同供应商的强模型，⛔ 不许塞弱模型；
 *   ② 终裁**不看候选答案**（否则等于让犯错的人批卷），两份抄本一致才允许自动改；
 *   ③ 复核失败只降级、不阻塞解析；不一致只标记待人工核对；
 *   ④ 前后端字段名 ocr_review / ocr_review_summary 逐字对齐，页面有入口。
 * 全部 fail-closed，并配反向自检。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8')
const AI = 'server/config/ai.js'
const SERVICE = 'server/services/paperBankService.js'
const ROUTES = 'server/routes/paperBank.js'
const VIEW = 'src/workbench/views/PaperBankWorkbench.vue'

const stripComments = (s) => String(s)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '')

/** 取某个 export const 数组的定义体（到下一个 ]; 为止）。 */
const chainBody = (src, name) => {
  const a = src.indexOf(`export const ${name} = [`)
  if (a < 0) return ''
  const b = src.indexOf(']', a)
  return b < 0 ? '' : src.slice(a, b + 1)
}

function checkChains(src) {
  const bad = []
  const verify = chainBody(src, 'PAPER_BANK_OCR_VERIFY_CHAIN')
  const arbiter = chainBody(src, 'PAPER_BANK_OCR_ARBITER_CHAIN')
  if (!verify) bad.push('缺少 PAPER_BANK_OCR_VERIFY_CHAIN')
  if (!arbiter) bad.push('缺少 PAPER_BANK_OCR_ARBITER_CHAIN')
  if (verify && !/vendor:\s*'Bailian'[\s\S]*model:\s*'qwen3\.8-flash'[\s\S]*enable_thinking:\s*false/.test(verify)) {
    bad.push('校对通道必须是 Bailian qwen3.8-flash 且关思考')
  }
  if (arbiter && !/vendor:\s*'HuihuiyunGemini'[\s\S]*model:\s*'gemini-3\.8-flash'/.test(arbiter)) {
    bad.push('终裁通道必须是最强视觉 HuihuiyunGemini gemini-3.8-flash')
  }
  for (const [name, body] of [['verify', verify], ['arbiter', arbiter]]) {
    for (const weak of ['sensenova-6.8-flash-lite', 'agnes-2.0-flash', 'glm-4.6v-flash-free', 'gemini-3.1-flash-lite']) {
      if (body.includes(weak)) bad.push(`${name} 混入弱模型 ${weak}`)
    }
  }
  return bad
}

function checkService(src) {
  const bad = []
  const s = stripComments(src)
  if (!/export async function crossCheckPageOcr\(/.test(s)) bad.push('缺少 crossCheckPageOcr')
  if (!/await crossCheckPageOcr\(\{ imageDataURL, rows, pageNumber, logger \}\)/.test(s)) bad.push('主 OCR 之后没有调用双模型复核')
  // 终裁不得看到候选答案：userText 只带 ask（不含 printed_text）
  if (!/userText: '待抄录位置：\\n' \+ JSON\.stringify\(ask\)/.test(s)) bad.push('终裁输入必须只有待抄录位置，不能带候选 printed_text')
  if (!/norm\(t\.printed_text\) === norm\(d\.printed_text\)/.test(s)) bad.push('两份抄本一致才允许自动改')
  if (!/if \(!hit\) continue/.test(s)) bad.push('锚点不在原文时必须跳过（禁止整段覆盖）')
  if (!/skipped: true/.test(s)) bad.push('复核失败必须只降级、不阻塞解析')
  if (!/jsonb_build_object\('ocrReview', \$2::jsonb, 'ocrReviewSummary', \$3::jsonb\)/.test(s)) bad.push('复核结果未落到 resources.metadata')
  if (!/ocrReview: cross\.review/.test(s)) bad.push('单页复核结果未回传 parsePaperResource')
  // ⛔ 闸是质量敏感路径：两条链必须 noBackup: true。
  //   否则供应商配额打爆时会静默轮换到备份弱视觉模型，弱模型做逐字挑错会自己编差异，
  //   比不校对更坏（2026-09-09 练习册答案页就是被静默降级搞错的）。
  const gated = (s.match(/vendorChain: PAPER_BANK_OCR_(?:VERIFY|ARBITER)_CHAIN,[\s\S]{0,300}?noBackup: true/g) || []).length
  if (gated < 2) bad.push('两条闸都必须 noBackup: true（禁止静默降级到弱视觉模型）')
  return bad
}

function checkContract(routesSrc, viewSrc) {
  const bad = []
  const r = stripComments(routesSrc)
  const v = stripComments(viewSrc)
  for (const f of ['ocr_review', 'ocr_review_summary']) {
    if (!r.includes(`${f}:`)) bad.push(`后端 papers 接口须返回 ${f}`)
    // ⛔ 不能用 includes('p.ocr_review')：p.ocr_review_summary 会把它混过去（字段名漏改也不报错）
    // 2026-11-07：左侧改成文件夹树后，选中项变量叫 activePaper；字段名口径不变。
    if (!new RegExp(`\\b(?:p|activePaper)\\.${f}\\b`).test(v)) bad.push(`前端须读 ${f}`)
  }
  if (!/openOcrReview\((?:p|activePaper)\)/.test(v)) bad.push('缺少待核对清单入口')
  if (!/showReviewDialog/.test(v)) bad.push('缺少待核对弹窗')
  if (!/questionSourceUrl\(\{ resource_id: reviewDialog\.paper\?\.id, page_no: it\.page_no \}\)/.test(v)) {
    bad.push('待核对项必须能按页码打开原卷')
  }
  return bad
}

test('★ 双模型通道：校对 Bailian + 终裁 Gemini，绝无弱模型', () => {
  assert.deepEqual(checkChains(read(AI)), [], AI)
})

test('★ 终裁独立抄录、两本一致才自动改、失败不阻塞、结果落库', () => {
  assert.deepEqual(checkService(read(SERVICE)), [], SERVICE)
})

test('★ 前后端字段名对齐且页面有待核对入口', () => {
  assert.deepEqual(checkContract(read(ROUTES), read(VIEW)), [], ROUTES + ' / ' + VIEW)
})

test('反向自检：写坏的版本喂给同一检查函数必须判红', () => {
  const ai = read(AI)
  const svc = read(SERVICE)
  const view = read(VIEW)
  const routes = read(ROUTES)

  // 只改终裁链本身（GENERAL_OCR_VENDOR_CHAIN 里也有同名模型，全局 replace 会打错地方）
  const weakAi = ai.replace(
    /export const PAPER_BANK_OCR_ARBITER_CHAIN = \[[\s\S]*?\]/,
    "export const PAPER_BANK_OCR_ARBITER_CHAIN = [\n  { vendor: 'SenseNova', model: 'sensenova-6.8-flash-lite' },\n]"
  )
  assert.notEqual(weakAi, ai, '反向自检必须真的改写到了终裁链')
  assert.ok(checkChains(weakAi).length > 0, '终裁换成弱模型必须判红')
  assert.ok(checkChains(ai.replace('export const PAPER_BANK_OCR_ARBITER_CHAIN = [', '// removed\nconst X = [')).length > 0,
    '删掉终裁通道必须判红')

  // 把候选答案泄露给终裁 = 让犯错的人批卷
  assert.ok(checkService(svc.replace("userText: '待抄录位置：\\n' + JSON.stringify(ask)", "userText: JSON.stringify(diffs)")).length > 0)
  assert.ok(checkService(svc.replace('norm(t.printed_text) === norm(d.printed_text)', 'true')).length > 0,
    '绕过一致性判据必须判红')
  assert.ok(checkService(svc.replace('await crossCheckPageOcr({ imageDataURL, rows, pageNumber, logger })', 'const cross = { review: [], checked: 0, corrected: 0, skipped: false }')).length > 0)
  assert.ok(checkService(svc.replace(/noBackup: true/g, 'noBackup: false')).length > 0,
    '允许闸静默降级到弱模型必须判红')

  // 2026-11-07：树改版后页面里同时存在旧的 p.ocr_review（弹窗函数内）和
  // activePaper.ocr_review（详情面板），两处都写坏才能真正验证检查函数敏感。
  const renamedView = view
    .replace(/\bp\.ocr_review\b/g, 'p.ocrReview')
    .replace(/\bactivePaper\.ocr_review\b/g, 'activePaper.ocrReview')
  assert.ok(checkContract(routes, renamedView).length > 0, '字段名不一致必须判红')
  assert.ok(checkContract(routes.replace('ocr_review:', 'ocrReview:'), view).length > 0, '后端改名必须判红')
})
