// 回归测试：单题改归属（2026-11-08）
//
// 事故背景（负责人当场报障）：截图收题时点错了题集 —— 一道「D 为 BC 中点」的题
// 本该在「平行+角平分线」，却进了「做平行造相似」。此前系统**完全没有**单题移动能力，
// 唯一出路是删了重收，也就是拿已经校对过的题干/难度/标签去换一次新的 OCR 风险。
//
// 这个功能会直接改动 resource_id（题目的唯一归属），踩错一处就是「题挂错卷」，
// 比丢一道题更难被发现（题还在，只是在别人的卷子里）。因此这里锁死四条：
//   ① 一道题 = 同一 (原题集, 题号) 的所有小问行，必须整组搬，题号共号；
//   ② 目标题号只能接续到末尾，绝不沿用原题号（否则会挂上目标题集同号题的官方答案）；
//   ③ page_no 必须清空、来源改按**题目 id** 存（按页码存会串到目标题集同一页的别的素材）；
//   ④ 撤销遇到原位置被占用时必须显式跳过 —— 不能靠 catch 唯一键冲突（PG 事务会整体 abort）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { planQuestionMove } from '../server/services/paperBankService.js'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')
const SERVICE = 'server/services/paperBankService.js'
const ROUTE = 'server/routes/paperBank.js'
const VIEW = 'src/workbench/views/PaperBankWorkbench.vue'
const PICKER = 'src/workbench/components/paperBank/MoveQuestionPicker.vue'

test('整组小问共用一个新题号，且目标题号从 max+1 接续（不沿用原题号）', () => {
  const rows = [
    { id: 'a1', resource_id: 'R1', question_no: 5, sub_no: '1' },
    { id: 'a2', resource_id: 'R1', question_no: 5, sub_no: '2' },
    { id: 'b1', resource_id: 'R1', question_no: 2, sub_no: '' },
  ]
  const plan = planQuestionMove(rows, 7)
  const byId = new Map(plan.assignments.map(a => [a.id, a.questionNo]))
  // 原题号小的先搬（2 在 5 前面），且都从 8 起
  assert.equal(byId.get('b1'), 8, '原题号小的应该先拿到新题号')
  assert.equal(byId.get('a1'), 9, '整组小问共用题号')
  assert.equal(byId.get('a2'), 9, '同组第二个小问必须与第一个同号')
  assert.equal(plan.lastNo, 9)
  assert.equal(plan.groupCount, 2, '两行小问算一道题，不能算两道')
  // 反例守卫：任何一行都不许保留原题号
  for (const a of plan.assignments) assert.ok(a.questionNo > 7, '新题号必须落在目标题集末尾之后')
})

test('目标题集为空时从 1 开始；跨题集混选时按各自原题号升序搬', () => {
  const plan = planQuestionMove([
    { id: 'x', resource_id: 'R2', question_no: 9, sub_no: '' },
    { id: 'y', resource_id: 'R1', question_no: 3, sub_no: '' },
  ], 0)
  assert.deepEqual(plan.assignments.map(a => a.id), ['y', 'x'])
  assert.deepEqual(plan.assignments.map(a => a.questionNo), [1, 2])
})

test('移动必须清空 page_no 且把来源写进 movedSources（按题目 id，不按页码）', () => {
  const src = read(SERVICE)
  const fn = src.slice(src.indexOf('export async function movePaperQuestions'))
  const body = fn.slice(0, fn.indexOf('export async function restoreQuestionPlacements'))
  assert.match(body, /SET\s+resource_id\s*=\s*\$2,\s*question_no\s*=\s*\$3,\s*unit_id\s*=\s*NULL,\s*page_no\s*=\s*NULL/s,
    '移动必须同时清空 page_no —— 它指向原题集的第几页，留着会让「看原卷（第 N 页）」跳到目标卷的错页')
  assert.match(body, /movedSources\[a\.id\]\s*=/, '来源必须按题目 id 存进 movedSources')
  assert.match(body, /jsonb_set\(\s*COALESCE\(metadata, '\{\}'::jsonb\),\s*'\{movedSources\}'/,
    '来源要落到目标题集的 metadata.movedSources')
})

test('读取侧 clip_source / clip_source_note 必须有 movedSources 兜底，且透出 moved_in', () => {
  const src = read(SERVICE)
  const cols = src.slice(src.indexOf('const RQ_READ_COLS'), src.indexOf('/** 单份卷子的题目'))
  assert.match(cols, /metadata->'movedSources'->\(rq\.id::text\)->>'source'/, 'clip_source 缺 movedSources 兜底 ⇒ 移动后来源凭空消失')
  assert.match(cols, /metadata->'movedSources'->\(rq\.id::text\)->>'note'/, 'clip_source_note 缺兜底 ⇒ 时间点备注丢失')
  assert.match(cols, /AS moved_in/, '缺 moved_in 标记 ⇒ 页面会给移动过的题渲染「看原卷」，指向目标题集的原卷（错卷）')
  // 反例守卫：moved_in 不能用 `?` 操作符（与 ?| 有歧义，且 node-pg 生态里容易被误当占位符）
  assert.equal(/movedSources'\s*\)\s*\?/.test(cols), false, 'moved_in 请用 jsonb_exists()，不要用 ? 操作符')
})

test('撤销时先显式查占用再更新 —— 不能 catch 唯一键冲突（PG 事务会 abort）', () => {
  const src = read(SERVICE)
  const fn = src.slice(src.indexOf('export async function restoreQuestionPlacements'))
  assert.match(fn, /const conflict = await client\.query\(/, '必须显式查原位置是否被占用')
  assert.match(fn, /if \(conflict\.rows\.length\) \{ skipped\.push\(it\.id\); continue \}/,
    '占用时跳过该行并计入 skipped，不能覆盖别的题')
  // 反例守卫：catch 里继续跑其它行是无效的（25P02 current transaction is aborted）
  assert.equal(/catch \(e\) \{\s*skipped\.push/.test(fn), false,
    'catch 里只记录不重试是可以的，但不要把它当成「跳过冲突」的主手段')
})

test('路由与前端都只有一个移动实现，且撤销快照由服务端返回', () => {
  const route = read(ROUTE)
  assert.match(route, /router\.post\('\/questions\/move'/, '缺移动端点')
  assert.match(route, /router\.post\('\/questions\/restore'/, '缺撤销端点')
  // 来源编辑在移动后也要能用（page_no 已为 NULL，走 movedSources 分支）
  const srcRoute = route.slice(route.indexOf("router.put('/questions/:id/source'"))
  assert.match(srcRoute.slice(0, 2200), /rows\[0\]\.page_no == null[\s\S]{0,400}movedSources/,
    '移动过的题没有 page_no，改来源必须走 movedSources 分支，否则老师一改就吃 400')

  const view = read(VIEW)
  assert.match(view, /movePaperBankQuestions\(\[q\.id\], paper\.id\)/, '页面必须调统一的移动接口')
  assert.match(view, /restorePaperBankQuestions\(u\.items\)/, '撤销必须回传服务端给的 undo 快照')
  assert.match(view, /if \(q\.moved_in\) return ''/, '移动过的题不能显示「看原卷」——原卷文件在原题集')
  const picker = read(PICKER)
  assert.match(picker, /p\.id === props\.currentPaperId/, '选择器必须标出并禁用当前题集')
})
