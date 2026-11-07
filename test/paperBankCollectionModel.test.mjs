/**
 * 「题集 / 合集」模型回归锁（2026-11-07 负责人裁决）
 *
 * 旧模型（被否决）：截图统一进一个固定的「截图题库」卷（metadata.origin='screenshot'），
 *   与 PDF 解析出来的真卷并列 ⇒ 把「录入渠道」错当成「题目类别」。
 *   前端还给它加了「截图」标签 + 强制置顶，老师预设的系列/合集根本无处安放。
 *
 * 新模型：一套卷 / 一个预设合集 = 一个题集（resources 一行），是唯一归属；
 *   PDF 与截图都只是「往选中的题集加题」的动作，默认追加、绝不删已有题。
 *
 * 本文件锁死（全部静态，不连库）：
 *   ① 不再自动创建截图容器卷、不再写卷级 screenshot 分类；
 *   ② /clips 必须校验并使用目标题集；
 *   ③ PDF 默认 append，只有显式 replace 才走整卷重建；
 *   ④ 追加模式四个安全约束：页号接续 / 不清审计 / 跳过假清点 / 复核清单合并；
 *   ⑤ 前端不得再有「截图卷」这一分类；
 *   ⑥ 前后端参数逐字对齐（paperId / replace）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8')
const stripComments = (s) => String(s)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '')

const serviceSrc = stripComments(read('server/services/paperBankService.js'))
const routesSrc = stripComments(read('server/routes/paperBank.js'))
const viewSrc = stripComments(read('src/workbench/views/PaperBankWorkbench.vue'))
const apiSrc = stripComments(read('src/services/apiService.js'))

test('题集模型：截图不再自动创建「截图题库」卷', () => {
  assert.ok(!/getOrCreateClipLibrary/.test(serviceSrc), '服务层不得再自动建截图容器卷')
  assert.ok(!/CLIP_LIBRARY_NAME/.test(serviceSrc), '固定卷名常量必须删干净')
  assert.ok(!/getOrCreateClipLibrary/.test(routesSrc), '路由不得再隐式取/建容器卷')
  assert.ok(!/jsonb_build_object\('origin', 'screenshot'\)/.test(serviceSrc), '不得再写卷级 screenshot 分类')
})

test('题集模型：/clips 必须校验并使用目标题集', () => {
  assert.match(routesSrc, /req\.body\?\.paperId/, '目标题集必须来自请求参数')
  assert.match(routesSrc, /AND resource_type = 'exam'/, '目标必须是现存 exam 题集')
  assert.match(routesSrc, /error: '没有指定题集'/, '缺目标必须显式报错，不能静默建卷')
  assert.match(routesSrc, /resourceId: targetId/, '解析结果必须写进目标题集')
  assert.match(serviceSrc, /if \(!resourceId\) throw new Error\('没有指定目标题集/)
})

test('PDF 默认追加到题集，只有显式 replace 才重建', () => {
  assert.match(routesSrc, /String\(req\.body\?\.replace \?\? ''\) === '1'/)
  assert.match(routesSrc, /append: !replaceExisting/, '默认必须是追加')
  assert.match(serviceSrc, /append = false/, '服务层默认参数保持保守')
  assert.match(serviceSrc, /await appendPaperQuestions\(resourceId, rows\)/, '追加必须复用既有实现')
  assert.match(serviceSrc, /await replacePaperQuestions\(resourceId, rows\)/, '整卷重建入口仍要保留')
  assert.match(viewSrc, /重新解析/, '危险操作必须有显式勾选项')
})

test('追加模式：页号接续 / 不清审计 / 跳过假清点 / 复核清单合并', () => {
  assert.match(serviceSrc, /const pageNumber = basePage \+ idx \+ 1/, 'PDF 追加也须接续页号，否则来源索引串页')
  assert.match(serviceSrc, /if \(!append\) await resetParseAudit\(resourceId\)/, '追加不得清空既有题号清点')
  assert.match(serviceSrc, /if \(!append\) try \{/, '追加不得跑整卷清点（题号已平移，必然假告警）')
  assert.match(serviceSrc, /\[\.\.\.prev, \.\.\.ocrReview\]/, '追加不得覆盖前几批的双模型待核对清单')
})

test('前端：题集是唯一归属，PDF 与截图只是加题动作', () => {
  assert.ok(!/clipPaperId/.test(viewSrc), '不得再按「截图卷 id」判断题能删/能补来源')
  assert.ok(!/sortedPapers/.test(viewSrc), '不得再有截图卷置顶排序')
  assert.ok(!/origin === 'screenshot'/.test(viewSrc), '卷名旁不得再打「截图」分类标签')
  assert.match(viewSrc, /v-for="p in papers"/, '题集一律按后端顺序展示')
  assert.match(viewSrc, /新建题集/)
  assert.match(viewSrc, /截图加题/)
  assert.match(viewSrc, /PDF 加题/)
  assert.match(viewSrc, /clipTargetPaperId/, '截图弹窗必须有目标题集选择器')
})

test('参数逐字对齐：paperId / replace / 加题目标', () => {
  assert.match(apiSrc, /fd\.append\('paperId', paperId\)/)
  assert.match(apiSrc, /if \(replace\) fd\.append\('replace', '1'\)/)
  assert.match(viewSrc, /\{ replace: replaceExisting\.value \}/)
  assert.match(viewSrc, /clipTargetPaperId\.value,/, '截图上传必须把目标题集传下去')
})

test('反向自检：append 分支被写死成 replace 时必须判红', () => {
  // 只取 parsePaperResource 函数体：appendPaperQuestions 在截图链里还有一处合法调用，
  // 全文件做「不存在」断言会误判。
  const start = serviceSrc.indexOf('export async function parsePaperResource')
  const end = serviceSrc.indexOf('export async function', start + 10)
  const fn = serviceSrc.slice(start, end > 0 ? end : start + 20000)
  assert.ok(fn.length > 500, 'parsePaperResource 必须能定位到')
  assert.match(fn, /await appendPaperQuestions\(resourceId, rows\)/)
  const broken = fn.replace(
    /\? await appendPaperQuestions\(resourceId, rows\)/,
    '? await replacePaperQuestions(resourceId, rows)',
  )
  assert.ok(broken !== fn, '替换点必须命中')
  assert.ok(!/await appendPaperQuestions\(resourceId, rows\)/.test(broken))
})
