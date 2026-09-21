// 回归测试：「备用视觉模型页」标记必须从 OCR 层透传到落库告警（2026-09-21 八上精练与拓展答案册）
//
// 事故背景：
//   callVisionCompletion 的每条成功返回路径都带 usedBackup / vendorName，但答案页 OCR 的
//   ocrExtractFromBuffer 只解构了 content ⇒「这一页是主力模型读的、还是降级到备用模型读的」
//   既不落库也不进告警。该册解析时魔搭余额耗尽、降级模型读出 34 条凭空编造的答案
//   （把数学页编成整套「道德与法治」答案，还合成了伪单元「试卷(十四)期末测试卷」），
//   而幻觉自建单元、题号从 1 重排 ⇒ 题号连续性校验**零告警**，只能靠事后与离线基准做
//   键集 diff 才挖出来（代价是老师拿到的参考答案张冠李戴）。
//
// 本测试锁定四件事：
//   ① buildBackupModelWarning 行为正确（排序、去重、折叠、稳定短语）；
//   ② 该文案**不得命中发布闸门 RISK_WARNING_RE**：命中即 blocking → 发布被 409 拦下，
//      把"提示复核"变成"挡住流程"（这条告警是软提示，不构成拒绝发布的理由）；
//   ③ 该文案**不得含 "OCR 识别失败"**：nightParseService 以 `parse_warning LIKE '%OCR 识别失败%'`
//      筛选夜间自动补跑对象，含该词会让**已成功**的册子被误判去重跑；
//   ④ 三条 OCR 路径（单趟 PDF / 分批 PDF / 图片）都必须把收集器接上，且 OCR 层必须解构
//      usedBackup/vendorName —— 防止重演"只有单趟路径有告警"的历史缺口。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildBackupModelWarning } from '../server/routes/worksheets.js'
import { RISK_WARNING_RE } from '../server/services/worksheetPublishRiskService.js'

const SRC = fs.readFileSync(new URL('../server/routes/worksheets.js', import.meta.url), 'utf8')

test('buildBackupModelWarning：无兜底页必须返回 null（不制造空告警）', () => {
  assert.equal(buildBackupModelWarning(undefined), null)
  assert.equal(buildBackupModelWarning([]), null)
  assert.equal(buildBackupModelWarning([{ vendor: 'X' }]), null, '缺 page 的脏数据不得生成文案')
  assert.equal(buildBackupModelWarning('not-array'), null)
})

test('buildBackupModelWarning：按页号排序 + 去重 + 带稳定短语与可执行建议', () => {
  const w = buildBackupModelWarning([
    { page: 7, vendor: 'HuihuiyunGemini' },
    { page: 3, vendor: 'HuihuiyunGemini' },
    { page: 3, vendor: 'HuihuiyunGemini' }, // 同页重复记录
  ])
  assert.ok(w, '必须出文案')
  assert.ok(w.includes('第 3、7 页'), `页号必须升序且去重，实际：${w}`)
  // 稳定短语供 SQL 排查：parse_warning LIKE '%备用视觉模型%'
  assert.ok(w.includes('备用视觉模型'), '必须含稳定短语「备用视觉模型」供全库排查')
  assert.ok(w.includes('需人工复核'), '必须明确标出「需人工复核」')
  assert.ok(w.includes('HuihuiyunGemini'), '应带上实际通道名，便于定位降级去向')
  assert.ok(/复核.*答案|对照.*PDF/.test(w), '必须给出可执行的复核动作')
})

test('buildBackupModelWarning：超过 12 页时必须折叠，不得把 warning 撑成整页清单', () => {
  const list = Array.from({ length: 20 }, (_, i) => ({ page: i + 1, vendor: 'V' }))
  const w = buildBackupModelWarning(list)
  assert.ok(w.includes('第 1、2、3、4、5、6、7、8、9、10、11、12 等 20 页'), `折叠格式不符：${w}`)
})

test('⚠️ 该文案不得命中发布闸门信号词（否则发布被 409 拦下）', () => {
  const cases = [
    buildBackupModelWarning([{ page: 42, vendor: 'HuihuiyunGemini' }]),
    buildBackupModelWarning(Array.from({ length: 30 }, (_, i) => ({ page: i + 1 }))),
    buildBackupModelWarning([{ page: 1, vendor: null }]),
  ]
  for (const w of cases) {
    assert.ok(w && !RISK_WARNING_RE.test(w), `备用模型告警不得触发 blocking 正则，实际命中：${w}`)
  }
})

test('⚠️ 该文案不得含「OCR 识别失败」（否则已成功的册子被夜间补跑误判重跑）', () => {
  const w = buildBackupModelWarning(Array.from({ length: 30 }, (_, i) => ({ page: i + 1 })))
  assert.ok(!/OCR\s*识别失败/.test(w), `不得含夜间补跑判据信号词，实际：${w}`)
})

test('源码级：OCR 层必须解构 usedBackup/vendorName 并回传收集器', () => {
  const buf = SRC.slice(SRC.indexOf('async function ocrExtractFromBuffer'), SRC.indexOf('async function ocrExtractRawText'))
  assert.ok(buf.includes('const { content, usedBackup, vendorName } = await callVisionCompletion({'),
    'ocrExtractFromBuffer 必须解构 usedBackup/vendorName（否则标记再次丢失）')
  assert.ok(buf.includes('noteBackupModel(backupPages, pageIndex + 1, usedBackup, vendorName)'),
    'ocrExtractFromBuffer 必须把标记交给收集器')
  const raw = SRC.slice(SRC.indexOf('async function ocrExtractRawText'), SRC.indexOf('router.get(\'/:id/pdf\''))
  assert.ok(raw.includes('noteBackupModel(backupPages, pageNumber, usedBackup, vendorName)'),
    'ocrExtractRawText（图片路径）同样必须记录')
})

test('源码级：重试换回主力模型时必须撤销该页标记（不得留假告警）', () => {
  const fn = SRC.slice(SRC.indexOf('function noteBackupModel('), SRC.indexOf('export function buildBackupModelWarning'))
  assert.ok(fn.includes('splice(idx, 1)'), 'usedBackup=false 时应撤销同页记录')
  assert.ok(/if \(usedBackup\)/.test(fn), '必须按 usedBackup 分流记录/撤销')
})

test('源码级：单趟 / 分批 / 图片三条路径都必须接上收集器', () => {
  assert.ok(SRC.includes('ocrExtractFromBuffer(img, i, ocrFailedPages, ocrBackupPages)'), '单趟 PDF 路径必须传收集器')
  assert.ok(SRC.includes('ocrPageWithRetry(img, startPage + i, ocrFailedPages, backupPages)'), '分批路径必须逐页透传')
  assert.ok(SRC.includes('processOcrBatch(fileBuffer, start, end, carryState, lowConfidence, ocrFailedPages, ocrBackupPages)'),
    '分批路径必须在 batch 调用处接上同一份收集器（跨批累积）')
  assert.ok(SRC.includes("ocrExtractSafe(f.buffer.toString('base64'), i, ocrFailedPages, ocrBackupPages)"), '图片路径必须传收集器')
})

test('源码级：两条落库路径都必须把备用模型告警写进 parse_warning', () => {
  const calls = SRC.match(/buildBackupModelWarning\(ocrBackupPages\)/g) || []
  assert.ok(calls.length >= 2, `分批与单趟(processOcrResults)路径都要调用，实际 ${calls.length} 处`)
  assert.ok(SRC.includes('if (backupWarning) warnings.push(backupWarning)'), '分批路径应 push 进 warnings')
  assert.ok(SRC.includes('const backupWarning = parsedAnswers.length > 0 ? buildBackupModelWarning(ocrBackupPages) : null'),
    '单趟路径应在有答案时才提示（0 条答案的告警已说明问题）')
})
