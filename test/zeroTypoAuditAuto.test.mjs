/**
 * 零错字审计「自动跑」回归锁（2026-11-09）
 *
 * 背景：负责人死规定「一模卷零错字」，且明确「自动跑！手动跑风险太大」——
 *   依赖人记得手动跑 = 一定会漏。所以审计必须挂在解析链路上自动触发。
 *
 * 本文件锁死：
 *   ① 解析成功即自动入队；服务重启能把 running/queued 接回来；
 *   ② 只有「≥2 个通道一致 + 无人支持原值 + 通道间无分歧」才允许自动改库；
 *   ③ 通道必须是 ≥3 个不同厂商的强视觉模型，⛔ 不许混弱模型；
 *   ④ 审计状态落 resources.metadata.zeroTypoAudit，前后端字段名 zero_typo 逐字对齐；
 *   ⑤ 判据只有一份实现（服务），CLI 只准调用、不准复制一套。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeMath, diffTokens, buildTargets } from '../server/services/zeroTypoAuditService.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8')
const SERVICE = 'server/services/zeroTypoAuditService.js'
const ROUTES = 'server/routes/paperBank.js'
const INDEX = 'server/index.js'
const VIEW = 'src/workbench/views/PaperBankWorkbench.vue'
const CLI = 'scripts/ops/zero_typo_audit.mjs'

const stripComments = (s) => String(s)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '')

const sources = () => ({
  routes: stripComments(read(ROUTES)),
  index: stripComments(read(INDEX)),
  view: stripComments(read(VIEW)),
  cli: stripComments(read(CLI)),
})

function checkAutoWiring(src = sources()) {
  const bad = []
  // ① 解析成功必须自动入队（⛔ 不能只在文档里写「记得手动跑」）
  if (!/parsePaperResource\(\{[\s\S]{0,200}?\.then\([\s\S]{0,700}?queueZeroTypoAudit\(/.test(src.routes)) {
    bad.push('解析成功后必须自动 queueZeroTypoAudit')
  }
  if (!/queueZeroTypoAudit\(\{ resourceId, pages, reason: 'auto' \}\)/.test(src.routes)) {
    bad.push('自动入队必须带 pages（追加批次只审新页）')
  }
  // ② 重启续跑：running/queued 必须接回来，否则卷子永远转圈
  if (!/resumeInterruptedAudits/.test(src.index)) bad.push('启动时必须调用 resumeInterruptedAudits')
  // ③ 前端必须显示审计状态，字段名与后端 zero_typo 对齐
  if (!/zero_typo:/.test(src.routes)) bad.push('papers 接口须返回 zero_typo')
  if (!/\b(?:p|activePaper)\.zero_typo\b/.test(src.view)) bad.push('前端须读 zero_typo')
  if (!/zeroTypoBadge\(activePaper\)/.test(src.view)) bad.push('页面必须有零错字审计状态徽标')
  // ④ 判据只有一份：CLI 不许自带 diff/normalize 实现
  if (/function diffTokens|function normalizeMath/.test(src.cli)) bad.push('CLI 不许复制一套比对实现')
  if (!/from '\.\.\/\.\.\/server\/services\/zeroTypoAuditService\.js'/.test(src.cli)) bad.push('CLI 必须调用同一份服务')
  return bad
}

function checkJudgement(serviceSrc) {
  const bad = []
  const s = stripComments(serviceSrc)
  // 准入判据：两票 + 总通道≥2 + 无分歧（isMultiVote），自动改库另需跨厂商（isCrossVendor）
  if (!/const isMultiVote = \(f\) => !f\.isMissing && f\.votes\.length >= 2 && f\.totalChannels >= 2 && !f\.conflictParts\?\.length/.test(s)) {
    bad.push('多票判据必须同时满足：≥2 票 / 总通道≥2 / 无分歧')
  }
  if (!/const isCrossVendor = \(f\) => isMultiVote\(f\) && f\.vendorVotes\.length >= 2/.test(s)) {
    bad.push('自动改库必须额外要求 ≥2 个不同厂商（同厂两档不算独立证人）')
  }
  if (!/t1\.items\.filter\(isCrossVendor\)/.test(s)) bad.push('第一轮自动修正必须走跨厂商判据')
  if (!/t2\.items\.filter\(isMultiVote\)/.test(s)) bad.push('闭环复核必须把同厂商两票也算未清零')
  if (!/if \(at == null\) continue/.test(s)) bad.push('定位不到唯一位置时必须跳过（禁止整段覆盖）')
  if (!/AND \$\{plan\.field\} = \$3/.test(s)) {
    bad.push('改库必须带乐观锁（老师正在编辑时不许覆盖）')
  }
  // 通道：≥3 个、跨厂商、无弱模型
  const start = s.indexOf('const CHANNELS = [')
  const end = start < 0 ? -1 : s.indexOf('\n]', start)
  const chBlock = start < 0 || end < 0 ? '' : s.slice(start, end + 2)
  const vendors = new Set([...chBlock.matchAll(/vendor:\s*'([^']+)'/g)].map(m => m[1]))
  if (vendors.size < 2) bad.push('三个盲抄通道必须跨厂商（同厂不算独立证人）')
  if ((chBlock.match(/vendor:\s*'/g) || []).length < 3) bad.push('盲抄通道至少三条')
  for (const weak of ['sensenova-6.8-flash-lite', 'agnes-2.0-flash', 'glm-4.6v-flash-free', 'gemini-3.1-flash-lite']) {
    if (chBlock.includes(weak)) bad.push(`零错字审计混入弱模型 ${weak}`)
  }
  if (!/noBackup: true/.test(s)) bad.push('盲抄必须 noBackup: true（禁止静默降级到弱视觉）')
  // 状态必须落库，且 failed 不能吞掉错误原因
  if (!/jsonb_build_object\('zeroTypoAudit'/.test(s)) bad.push('审计状态必须落 resources.metadata.zeroTypoAudit')
  if (!/status: 'failed', error: msg/.test(s)) bad.push('审计失败必须把原因写进库（不能只打日志）')
  return bad
}

test('★ 零错字审计自动挂在解析链路上（不依赖人手动跑）', () => {
  assert.deepEqual(checkAutoWiring(), [])
})

test('★ 审计判据：两票以上才改库、跨厂商强视觉、状态落库', () => {
  assert.deepEqual(checkJudgement(read(SERVICE)), [])
})

test('词元比对：数字替换、凭空多出的字母、中文错字都必须抓到', () => {
  // 「36→60」逐字符 LCS 会拆成删/留/插而漏掉，词元级必须识别为一次替换
  const hits = diffTokens('周长为36米', '周长为60米')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].dbPart, '36')
  assert.equal(hits[0].modelPart, '60')

  // 松江 q1 实际错法：库里凭空多出 Rt
  const rt = diffTokens('在Rt△ABC中', '在△ABC中')
  assert.ok(rt.some(h => h.dbPart === 'Rt' && h.modelPart === ''))

  // 中文错字（腰和底上的高 → 腰和腰上的高）不能被漏掉
  const cjk = diffTokens('腰和底上的高', '腰和腰上的高')
  assert.ok(cjk.some(h => h.dbPart === '底' && h.modelPart === '腰'))
})

test('归一化：Unicode 上下标必须折成 ASCII，否则词元对齐整体错位', () => {
  assert.equal(normalizeMath('y₁ 与 y₂'), 'y1与y2')
  assert.equal(normalizeMath('\\frac{a}{b}=\\sqrt{3}'), '(a)/(b)=√(3)')
  assert.equal(normalizeMath('∠ADC＝１２０°'), '∠ADC=120°')
})

test('抄录目标：每行正文都要审，parent_stem 必须单独切题干带', () => {
  const rows = [
    { id: 'a', page_no: 1, question_no: 1, sub_no: '', content: '第1题', parent_stem: null, bbox: { x: 10, y: 100, width: 800, height: 50 }, page_image_url: 'u' },
    { id: 'b', page_no: 1, question_no: 2, sub_no: '(1)', content: '小问1', parent_stem: '公共题干', bbox: { x: 10, y: 400, width: 800, height: 50 }, page_image_url: 'u' },
    { id: 'c', page_no: 1, question_no: 2, sub_no: '(2)', content: '小问2', parent_stem: '公共题干', bbox: { x: 10, y: 470, width: 800, height: 50 }, page_image_url: 'u' },
  ]
  const targets = buildTargets(rows, null)
  assert.equal(targets.filter(t => t.kind === 'row').length, 3)
  const stem = targets.find(t => t.kind === 'stem')
  assert.ok(stem, '题干必须单独成为抄录目标（parent_stem 不在任何行 bbox 里）')
  assert.equal(stem.expect, '公共题干')
  assert.ok(stem.bbox.y < 400 && stem.bbox.height > 20, '题干带必须覆盖公共题干那一行')

  // 追加批次只审新页
  assert.equal(buildTargets(rows, [2]).length, 0)
})

test('反向自检：删自动入队 / 放宽两票闸 / 允许静默降级 都必须判红', () => {
  const base = sources()
  const service = read(SERVICE)

  const noAuto = { ...base, routes: base.routes.replace(/queueZeroTypoAudit\(\{ resourceId, pages, reason: 'auto' \}\)/g, 'void 0') }
  assert.ok(checkAutoWiring(noAuto).length > 0, '删掉自动入队必须判红')

  const noResume = { ...base, index: base.index.replace(/resumeInterruptedAudits/g, 'void 0') }
  assert.ok(checkAutoWiring(noResume).length > 0, '删掉重启续跑必须判红')

  const renamedField = {
    ...base,
    view: base.view
      .replace(/\bactivePaper\.zero_typo\b/g, 'activePaper.zeroTypo')
      .replace(/\bp\.zero_typo\b/g, 'p.zeroTypo'),
  }
  assert.ok(checkAutoWiring(renamedField).length > 0, '前后端字段名不一致必须判红')

  const cliCopy = { ...base, cli: base.cli + '\nfunction diffTokens() {}\n' }
  assert.ok(checkAutoWiring(cliCopy).length > 0, 'CLI 复制一套比对实现必须判红')

  assert.ok(
    checkJudgement(service.replace('f.votes.length >= 2 && f.totalChannels >= 2', 'f.votes.length >= 1 && f.totalChannels >= 2'))
      .length > 0,
    '单票就改库必须判红'
  )
  assert.ok(
    checkJudgement(service.replace('isMultiVote(f) && f.vendorVotes.length >= 2', 'isMultiVote(f)'))
      .length > 0,
    '同厂两档一致就自动改库必须判红'
  )
  assert.ok(
    checkJudgement(service.replace('noBackup: true', 'noBackup: false')).length > 0,
    '允许静默降级到弱视觉必须判红'
  )
})
