/**
 * 定向重练卷 · 「定向」与「前置可选加入」的口径锁（2026-10-07 负责人拍板）
 *
 * 为什么要有这个文件：
 *   ① 按钮叫「生成定向重练卷」，但改动前前端只按 `wq.subject === point.subject` 过滤 ——
 *      组出来的是「该学科全部待重练错题」，跟按钮上那个考点没有关系。
 *      这种错**不会报错、不会白屏**，只会让老师拿到一张不对的卷子 —— 必须锁住。
 *   ② 前置考点只做「可选加入」：默认不勾（语义锁在 retryPaperScope.test.mjs），
 *      并确保进卷的每一道都是学生真实做错的题（红线：变式题/AI 生成题不进卷）。
 *
 * 本文件是**源码锁**：口径落在 SQL 与调用点上，没有可注入的纯函数。
 * 与 r215「元判据本身也要能被验红」同款 —— 关键片段缺失即红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
/** 去掉块注释与整行注释 —— 源码锁必须只看代码，注释里正当地写着历史来龙去脉 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
const svc = readFileSync(resolve(ROOT, 'server/services/weaknessService.js'), 'utf8')
const route = readFileSync(resolve(ROOT, 'server/routes/weakness.js'), 'utf8')
const view = readFileSync(resolve(ROOT, 'src/workbench/views/StudentDetailWorkbench.vue'), 'utf8')
const dialog = readFileSync(resolve(ROOT, 'src/workbench/components/diagnosis/RetryPaperPreviewDialog.vue'), 'utf8')

test('后端组卷查询：必须按考点含子考点展开（递归），不能只按学科过滤', () => {
  assert.match(svc, /export async function getRetryQuestionIdsByKp/, '定向组卷查询被删了')
  const block = svc.slice(svc.indexOf('export async function getRetryQuestionIdsByKp'), svc.indexOf('export async function getClassWeakness'))
  assert.match(block, /WITH RECURSIVE sub/, '考点没有递归展开 —— 子考点下的错题会被漏掉')
  assert.match(block, /JOIN sub s ON k\.parent_id = s\.id/, '子考点展开的父子关系写错了')
  assert.match(block, /s\.depth < 8/, '递归没有深度上限 —— 脏父子链会让查询不收敛')
  assert.doesNotMatch(block, /subject\s*=\s*\$/, '又回到按学科过滤的老口径了')
})

test('后端组卷查询：只用真实错题、排除已掌握、剔除无关联的自包含错题', () => {
  const block = svc.slice(svc.indexOf('export async function getRetryQuestionIdsByKp'), svc.indexOf('export async function getClassWeakness'))
  assert.match(block, /FROM \$\{TABLES\.WRONG_QUESTIONS\} wq/, '题源必须来自错题表（红线：不用变式题/AI 生成题）')
  assert.match(block, /wq\.question_id IS NOT NULL/, '没有 question_id 的自包含错题组不进卷，必须显式排除')
  assert.match(block, /<> 'mastered'/, '已完全掌握的题不该再进重练卷')
  assert.match(block, /TABLES\.QUESTION_KNOWLEDGE/, '必须经知识点关联挂载判归属，不能靠题面猜')
  assert.match(block, /new Set\(rows\.map/, '同一道题被记多条错题时要按 question_id 去重')
})

test('路由：retry-questions 必须挂在 /student/:studentId 之前（否则被它吃掉）', () => {
  const retryAt = route.indexOf("'/student/:studentId/retry-questions'")
  const baseAt = route.indexOf("'/student/:studentId'")
  assert.ok(retryAt !== -1, '定向组卷路由不存在')
  assert.ok(baseAt !== -1)
  assert.ok(retryAt < baseAt, '更具体的路径必须声明在前，否则 Express 先匹配到 /student/:studentId')
  assert.match(route, /UUID_RE/, 'kpIds/studentId 未做 uuid 校验 —— 非法值会让 PG 抛 22P02')
})

test('前端组卷：不得再按学科全量组卷，改走后端定向口径', () => {
  assert.match(view, /getRetryQuestionIdsByKp/, '前端没有调用定向组卷口径')
  // ⚠️ 只在**代码**里查，注释里正当地写着老口径的来龙去脉（本文件自己就会命中注释）
  assert.doesNotMatch(stripComments(view), /\.subject === point\.subject/, '按学科全量组卷的老口径又回来了（「定向」名不副实）')
})

test('前端：前置考点只在有可加题目时才弹确认框，且弹的是 r142 同一套弹窗', () => {
  assert.match(view, /RetryPaperPreviewDialog/, '没有复用 r142 的组卷弹窗（禁另写一份）')
  assert.match(view, /kind: 'weak-point'/, "scope 没传 kind:'weak-point'")
  assert.match(view, /prerequisiteQuestionIds/, '没把前置考点的题单交给弹窗')
  assert.match(view, /if \(preItems\.length\)/, '前置无可加题目时应保持一键组卷（弹空框会多一步）')
})

test('弹窗：前置提示块与「前置」标签与学习诊断页同一套视觉（accent-soft）', () => {
  assert.match(dialog, /rp-pre__label">建议先练/, '弹窗缺少「建议先练」提示块')
  assert.match(dialog, /isPrerequisite/, '前置行没有打标签 —— 老师分不清哪几道是前置考点')
  assert.match(dialog, /--wb-accent-soft/, '前置提示没沿用诊断页「建议先补」胶囊的配色')
})
