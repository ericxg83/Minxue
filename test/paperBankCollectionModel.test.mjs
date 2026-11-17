/**
 * 「题集 / 合集」模型回归锁（2026-11-07 负责人裁决，2026-11-17 迁移后修订）
 *
 * 旧模型（被否决）：截图统一进一个固定的「截图题库」卷（metadata.origin='screenshot'），
 *   与 PDF 解析出来的真卷并列 ⇒ 把「录入渠道」错当成「题目类别」。
 *   前端还给它加了「截图」标签 + 强制置顶，老师预设的系列/合集根本无处安放。
 *
 * 中间模型（11-07 起，11-17 再改）：一套卷 / 一个预设合集 = 一个题集（resources 一行），
 *   截图与 PDF 都往老师选中的题集里加。
 *
 * 现行模型（2026-11-17 负责人裁决）：「手工截图的一定是我认为的好题，不需要进试卷题库；
 *   试卷题库更多的是完整的一张 PDF 导入。」⇒ 截图入口整条迁到**好题甄选**，
 *   落进老师完全看不见的系统收件箱（metadata.kind='clip-inbox'），落库即自动入甄选；
 *   试卷题库只剩整卷 PDF。
 *
 * ⛔ 两条禁令在新模型下的精确含义（别按字面误判）：
 *   - 「不得静默建卷」= 不得每批截新建一个**老师可见的**伪分类卷；收件箱按 kind 幂等定位，是显式解析。
 *   - 「PDF 默认 append」不变。
 *
 * 本文件锁死（全部静态，不连库）：
 *   ① 试卷题库前端不得再出现截图入口 / 目标题集选择器；
 *   ② 截图缺 paperId 时必须解析收件箱，而不是报错或建伪分类卷；
 *   ③ 收件箱必须在 /papers 列表被过滤掉；
 *   ④ 截图落库必须自动写 curated_questions 引用；
 *   ⑤ PDF 默认 append，只有显式 replace 才走整卷重建；
 *   ⑥ 追加模式四个安全约束：页号接续 / 不清审计 / 跳过假清点 / 复核清单合并。
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
const curatedSrc = stripComments(read('src/workbench/views/CuratedQuestionsWorkbench.vue'))
const apiSrc = stripComments(read('src/services/apiService.js'))

test('题集模型：截图不再自动创建「截图题库」卷', () => {
  assert.ok(!/getOrCreateClipLibrary/.test(serviceSrc), '服务层不得再自动建截图容器卷')
  assert.ok(!/CLIP_LIBRARY_NAME/.test(serviceSrc), '固定卷名常量必须删干净')
  assert.ok(!/getOrCreateClipLibrary/.test(routesSrc), '路由不得再隐式取/建容器卷')
  assert.ok(!/jsonb_build_object\('origin', 'screenshot'\)/.test(serviceSrc), '不得再写卷级 screenshot 分类')
})

test('截图落点：缺 paperId 时解析系统收件箱，不是报错也不是建伪分类卷', () => {
  assert.match(serviceSrc, /export const CLIP_INBOX_KIND = 'clip-inbox'/, '收件箱必须有稳定 kind 标记')
  assert.match(serviceSrc, /metadata->>'kind' = \$1/, '收件箱必须按 kind 幂等定位')
  assert.match(serviceSrc, /export async function getClipInboxResourceId/, '定位收件箱必须独立成一个函数')
  assert.match(routesSrc, /targetId = await getClipInboxResourceId\(\)/, '缺 paperId 时路由必须去解析收件箱')
  assert.ok(!/error: '没有指定题集'/.test(routesSrc), '不得再要求老师先选题集')
  assert.match(routesSrc, /resourceId: targetId/, '解析结果必须写进解析出的容器')
})

test('收件箱：不进试卷题库列表，但数据仍在（不是删卷）', () => {
  assert.match(
    routesSrc,
    /COALESCE\(r\.metadata->>'kind', ''\) <> \$1/,
    '/papers 必须过滤收件箱（唯一过滤点，别处按 id 仍能取到）'
  )
  assert.ok(!/DELETE FROM resources WHERE resource_type = 'exam' AND metadata/.test(routesSrc), '收件箱不得被清理逻辑顺手删掉')
})

test('截图 = 好题：落库必须自动写甄选引用，且不复制题目内容', () => {
  const curatedService = stripComments(read('server/services/curatedQuestionService.js'))
  assert.match(serviceSrc, /await ensureCuratedRefs\(insertedIds\)/, '必须用真实插入行 id 写引用')
  assert.match(serviceSrc, /addCuratedRefsBulk\(\{ sourceType: 'resource_question'/, '必须走甄选服务的批量引用入口')
  assert.match(serviceSrc, /RETURNING id/, 'appendPaperQuestions 必须回传新行 id')
  // 反向自检：引用写入失败不能把「题没进甄选」说成成功
  assert.match(serviceSrc, /curatedAdded/, '结果必须回传写入了多少条甄选引用')
  // ⛔ 同一件事一个实现：甄选的 INSERT 只能出现在 curatedQuestionService
  assert.ok(!/INSERT INTO curated_questions/.test(serviceSrc),
    'paperBankService 不得自建第二份甄选写入实现')
  assert.match(curatedService, /export async function addCuratedRefsBulk/)
  assert.match(curatedService, /INSERT INTO curated_questions \(source_type, source_id\)/, '只写引用行')
  assert.match(curatedService, /ON CONFLICT \(source_type, source_id\) DO NOTHING/, '重复收藏必须幂等')
})

test('前端：试卷题库只剩整卷 PDF 入口', () => {
  assert.ok(!/截图加题/.test(viewSrc), '试卷题库不得再有截图加题入口')
  assert.ok(!/clipTargetPaperId/.test(viewSrc), '试卷题库不得再有「选目标题集」选择器')
  assert.ok(!/pb-clip-/.test(viewSrc), '截图弹窗的样式与结构应从试卷题库页删干净')
  assert.ok(!/clipPaperId/.test(viewSrc), '不得再按「截图卷 id」判断题能删/能补来源')
  assert.ok(!/sortedPapers/.test(viewSrc), '不得再有截图卷置顶排序')
  assert.ok(!/origin === 'screenshot'/.test(viewSrc), '卷名旁不得再打「截图」分类标签')
  assert.match(viewSrc, /<PaperBankTree/, '左侧导航改由文件夹树承担（2026-11-07）')
  assert.ok(!/v-for="p in papers"/.test(viewSrc), '主页面不得再平铺卷列表')
  assert.match(viewSrc, /新建题集/)
  assert.match(viewSrc, /PDF 加题/)
})

test('前端：截图入口在好题甄选，且弹窗不选分类/题集', () => {
  assert.match(curatedSrc, /截图收题/, '好题甄选必须有截图收题入口')
  assert.match(curatedSrc, /uploadPaperClips/, '必须复用试卷题库的截图上传链路')
  assert.match(curatedSrc, /getPaperClipStatus/, '识别是后台跑的，必须轮询真实结果')
  assert.ok(!/clipTargetPaperId/.test(curatedSrc), '甄选侧不得再出现「目标题集」概念')
  assert.ok(!/clipTargetChapter|clipTargetTag/.test(curatedSrc), '截图时不做分类（负责人 2026-11-17：先不选，事后打标签）')
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

test('参数逐字对齐：paperId / replace / 加题目标', () => {
  assert.match(apiSrc, /if \(paperId\) fd\.append\('paperId', paperId\)/, 'paperId 只在显式指定时才传（默认走收件箱）')
  assert.match(apiSrc, /if \(replace\) fd\.append\('replace', '1'\)/)
  assert.match(viewSrc, /\{ replace: replaceExisting\.value \}/)
  assert.match(curatedSrc, /uploadPaperClips\(/, '甄选侧必须调用同一个上传函数')
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
