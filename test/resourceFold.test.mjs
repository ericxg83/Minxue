/**
 * 数据页第 3 档收纳回归锁（2026-10-04 第 101 轮，负责人裁决②）
 *
 * 背景：负责人 2026-10-02 裁决「试卷答案库 / 我的题型库是非常低频入口」并授权收纳；
 * r101 执行：两入口从侧栏顶级降到「练习册管理」下的二级缩进项（URL 不变，
 * 收完仍从侧栏一键可达 —— 「收完从哪进」的答案就是侧栏练习册管理处）。
 *
 * 反向自检：collectFailures 套在 r100 旧侧栏（顶级扁平项）上必须判红，见 _r101_old/。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function collectFailures(src) {
  const fails = []
  const bad = (msg, cond) => { if (!cond) fails.push(msg) }
  // 二级入口存在（children 形态）
  bad('试卷答案库必须是练习册管理的二级项（children 内 path:/paper）',
    /children:\[[^\]]*\{label:'试卷答案库',path:'\/paper'\}/.test(src))
  bad('试卷答案库不得再是顶级导航项（顶级项应有 icon，二级项没有）',
    !/\{label:'试卷答案库',path:'\/paper',icon:/.test(src))
  // ── 2026-10-05 r142：负责人裁决「我的题型库」改名「我的考法库」（题型=形式，考法=这道题在考哪套动作）。
  //    判据不是放宽，是**换词继续守同一条约束**：入口仍必须是练习册管理的二级项、仍不得是顶级项。
  //    ⛔ 别为了让自己变绿去删这两条 —— 它们守的是「收纳后仍可达」，跟名字无关。
  //    旧文案「我的题型库」已随侧边栏改名失效，本锁同步跟进（改的是断言里的字符串，不是判据）。
  for (const label of ['我的考法库']) {
    bad(`${label}必须是练习册管理的二级项（children 内 path:/question-bank）`,
      new RegExp(`children:\\[[^\\]]*\\{label:'${label}',path:'/question-bank'\\}`).test(src))
    bad(`${label}不得再是顶级导航项（顶级项带 icon，二级项不带）`,
      !new RegExp(`\\{label:'${label}',path:'/question-bank',icon:`).test(src))
  }
  // 渲染层必须真渲染二级项（模板里有 nav-sublink 循环）
  bad('模板必须渲染二级入口（nav-sublink 循环缺失 = 只删不接）',
    /v-for="child in item\.children\|\|/.test(src))
  // 路由仍在（页面没删，URL 不变）
  return fails
}

const ROUTER = readFileSync(join(ROOT, 'src/workbench/router/index.js'), 'utf8')
const SIDEBAR = readFileSync(join(ROOT, 'src/workbench/components/layout/AppSidebar.vue'), 'utf8')

test('⛔ 侧栏第 3 档收纳：低频入口降二级、仍可达、路由不删', () => {
  const failures = collectFailures(SIDEBAR)
  assert.ok(ROUTER.includes("path: '/paper'"), '/paper 路由不得删除（收纳 ≠ 下线）')
  assert.ok(ROUTER.includes("path: '/question-bank'"), '/question-bank 路由不得删除')
  assert.deepEqual(
    failures,
    [],
    `\n${failures.length} 处不符：\n` + failures.map((m) => `  - ${m}`).join('\n')
  )
})
