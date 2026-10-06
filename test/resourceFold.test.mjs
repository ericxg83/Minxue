/**
 * 侧栏导航入口回归锁（2026-10-04 第 101 轮建立；2026-10-06 第 210 轮按负责人新裁决改写）
 *
 * 沿革（两次裁决方向相反，锁必须跟着**代码与最新裁决**走，不能锁死一条被推翻的旧决定）：
 *   - r101（2026-10-02 裁决②）：「试卷答案库 / 我的题型库」是低频入口，从侧栏顶级降到
 *     「练习册管理」下的二级缩进项（URL 不变）。当时的锁断言「必须是二级项」。
 *   - r16x（2026-10-06 裁决，commit f1abe5d）：「练习册本体 / 答案数据 / 考法素材」是三个
 *     不同对象，非父子关系 ⇒ 改回平级独立入口，仅按职责分组。**r101 的收纳不再适用。**
 *     ⇒ 旧锁「必须是二级项」随之失效（它是被推翻的旧决定），本文件同步改写。
 *
 * ⛔ 本锁守的是**改版不会让入口消失**，与「收纳还是平级」的层级无关。所以判据是：
 *   ① 8 个入口在侧栏里都存在，且都是**带 icon 的可点一级项**（缺 icon = 渲染成空白/告警）；
 *   ② 对应的 8 条路由都还在 router 里（改版 ≠ 下线）；
 *   ③ 不得出现「声明了 children 却没有渲染器」的孤儿子项（只删不接 = 入口静默消失）；
 *   ④ navGroups 用到的图标必须都 import 了（漏 import ⇒ `<component :is>` 拿到 undefined）。
 *   ⛔ 别为了让自己变绿去删判据 —— 它们守的是「入口仍可达」。
 *
 * 反向自检（内联合成样本，不依赖 git / 不依赖历史目录，见文件末尾三个 test）：
 *   把 r101 收纳版的形状喂进 collectFailures 必须判红；空源码必须判红（防「永远是空锁」）；
 *   把 r16x+2 的**多行格式化**形状喂进去必须判**绿**（防「一次纯格式化把锁打成假红」，2026-10-06 真实踩过）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { flatSource } from './sourceLockKit.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 侧栏应有的 8 个入口（label → path）。入口减少 = 老师少一条路，必须判红。 */
export const EXPECTED_ENTRIES = [
  ['工作台', '/'],
  ['批改中心', '/grade'],
  ['学习诊断', '/weekly-report'],
  ['学生管理', '/students'],
  ['练习册管理', '/worksheets'],
  ['试卷答案库', '/paper'],
  ['我的考法库', '/question-bank'],
  ['周末班课件', '/weekend-ppt'],
]

/**
 * 一级项：`{ label: 'X', path: 'Y', icon: Z }` —— 有 icon 才算可渲染的一级项。
 * ⚠️ `\s*` 容忍空白（r214）：同一份 navGroups 被格式化成多行后，旧写法
 * `/\{label:'([^']*)',path:'([^']*)'/` 一条都抽不到 ⇒ 8 个入口全判「缺失」= 假红。
 */
const TOP_ITEM_RE = /\{\s*label:\s*'([^']*)'\s*,\s*path:\s*'([^']*)'\s*,\s*icon:\s*([A-Za-z_$][\w$]*)/g
/** 二级项声明：`children:[...]`（方括号内容不嵌套，够用）。同样容忍空白。 */
const CHILDREN_RE = /children:\s*\[([^\]]*)\]/g
/** 图标导入行。 */
const ICON_IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*'@element-plus\/icons-vue'/

function collectAll(re, src) {
  const out = []
  let m
  re.lastIndex = 0
  while ((m = re.exec(src))) out.push(m)
  return out
}

/**
 * 扫一份侧栏源码，返回不符项清单。纯函数，便于反向自检喂合成样本。
 * @returns {string[]}
 */
export function collectFailures(src) {
  const fails = []
  const bad = (msg, cond) => { if (!cond) fails.push(msg) }

  const topItems = collectAll(TOP_ITEM_RE, src).map((m) => ({ label: m[1], path: m[2], icon: m[3] }))
  // 子项内容压掉空白再比 —— 比较用的字面量 `path:'/paper'` 是紧凑写法，
  // 若源码被格式化成 `path: '/paper'` 就会漏判（r214）。
  const childBlocks = collectAll(CHILDREN_RE, src).map((m) => flatSource(m[1])).join('|')

  // ① 每个入口都必须是一级项（有 label + path + icon），且 path 必须与期望一致
  for (const [label, path] of EXPECTED_ENTRIES) {
    const exact = topItems.some((it) => it.label === label && it.path === path)
    bad(`侧栏缺少「${label}」一级入口（应为 {label:'${label}',path:'${path}',icon:...}）`, exact)
  }

  // ② 入口总数不得减少（≥8；新增不拦，减少必拦）
  bad(`侧栏一级入口数不得少于 ${EXPECTED_ENTRIES.length}（当前 ${topItems.length}）`,
    topItems.length >= EXPECTED_ENTRIES.length)

  // ③ r16x 裁决：试卷答案库 / 我的考法库不再作为子项收纳（平级独立入口）
  bad('试卷答案库不得再作为子项收纳（r16x 已改为平级独立入口）', !childBlocks.includes("path:'/paper'"))
  bad('我的考法库不得再作为子项收纳（r16x 已改为平级独立入口）', !childBlocks.includes("path:'/question-bank'"))

  // ④ 声明了 children 就必须有渲染器 —— 只删不接 = 入口静默消失
  const declaresChildren = /children:\[/.test(src)
  const rendersChildren = /v-for="child in item\.children\|\|/.test(src)
  bad('声明了 children 却没有渲染二级入口（只删不接 = 入口静默消失）', !declaresChildren || rendersChildren)

  // ⑤ 用到的图标必须都 import 了（漏 import ⇒ <component :is> 拿到 undefined，渲染空白）
  const importMatch = src.match(ICON_IMPORT_RE)
  const imported = importMatch ? importMatch[1].split(',').map((s) => s.trim()).filter(Boolean) : []
  for (const it of topItems) {
    bad(`「${it.label}」用了 icon:${it.icon} 但未从 @element-plus/icons-vue 导入`,
      imported.includes(it.icon))
  }

  return fails
}

const ROUTER = readFileSync(join(ROOT, 'src/workbench/router/index.js'), 'utf8')
const SIDEBAR = readFileSync(join(ROOT, 'src/workbench/components/layout/AppSidebar.vue'), 'utf8')

test('⛔ 侧栏入口：8 个入口全可达、路由不删、无「只声明不渲染」的孤儿子项', () => {
  const failures = collectFailures(SIDEBAR)
  // 路由仍在（页面没删，URL 不变）—— 改版/收纳都不得把路由一起删掉
  for (const [, path] of EXPECTED_ENTRIES) {
    assert.ok(
      ROUTER.includes(`path: '${path}'`),
      `${path} 路由不得删除（改版 ≠ 下线）`
    )
  }
  assert.deepEqual(
    failures,
    [],
    `\n${failures.length} 处不符：\n` + failures.map((m) => `  - ${m}`).join('\n')
  )
})

// ───────────────────── 反向自检（合成样本，不依赖 git） ─────────────────────

/** r101 收纳版的形状：两个入口塞进「练习册管理」的 children，且没有各自的一级 icon。 */
const FOLDED_SAMPLE = `<template><nav><section v-for="group in navGroups" :key="group.label"><template v-for="item in group.items" :key="item.path"><button type="button" @click="go(item.path)"><el-icon><component :is="item.icon" /></el-icon><span>{{ item.label }}</span></button><button v-for="child in item.children||[]" :key="child.path" type="button" class="nav-sublink" @click="go(child.path)"><span>{{ child.label }}</span></button></template></section></nav></template>
<script setup>
import {HomeFilled,Notebook} from '@element-plus/icons-vue'
const navGroups=[{label:'',items:[{label:'工作台',path:'/',icon:HomeFilled}]},{label:'教学资源',items:[{label:'练习册管理',path:'/worksheets',icon:Notebook,children:[{label:'试卷答案库',path:'/paper'},{label:'我的考法库',path:'/question-bank'}]}]}]
</script>`

test('锁健全性：r101 收纳版形状必须判红（本锁不是空锁）', () => {
  const failures = collectFailures(FOLDED_SAMPLE)
  assert.ok(failures.length >= 3, `收纳版形状应报 ≥3 处，实际 ${failures.length}`)
  assert.ok(failures.some((m) => m.includes('试卷答案库') && m.includes('不得再作为子项收纳')),
    '未检出「试卷答案库被塞进 children」')
  assert.ok(failures.some((m) => m.includes('我的考法库') && m.includes('一级入口')),
    '未检出「我的考法库不再是一级入口」')
})

test('锁健全性：空源码必须判红（防「永远是空锁」）', () => {
  const failures = collectFailures('<template></template>')
  assert.ok(failures.length >= EXPECTED_ENTRIES.length,
    `空源码应报 ≥${EXPECTED_ENTRIES.length} 处，实际 ${failures.length}`)
})

/**
 * r16x+2（`2a5ab25` 侧栏深色母版）把同一份 navGroups 从单行拆成多行后的**真实形状**。
 * 语义与紧凑版逐字相同 ⇒ 本锁必须判**绿**。
 * 2026-10-06 实测：这次纯格式化曾让 3 把侧栏锁同时判红（假红）。
 */
const PRETTY_SAMPLE = `<template>
  <aside class="app-sidebar">
    <nav aria-label="主导航">
      <section v-for="group in navGroups" :key="group.label" class="nav-group">
        <button v-for="item in group.items" :key="item.path" type="button" @click="go(item.path)">
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </button>
      </section>
    </nav>
  </aside>
</template>
<script setup>
import { Collection, DataAnalysis, DocumentChecked, Files, HomeFilled, Notebook, Tickets, User } from '@element-plus/icons-vue'
const navGroups = [
  { label: '', items: [{ label: '工作台', path: '/', icon: HomeFilled }] },
  {
    label: '教学工作',
    items: [
      { label: '批改中心', path: '/grade', icon: DocumentChecked },
      { label: '学习诊断', path: '/weekly-report', icon: DataAnalysis },
      { label: '学生管理', path: '/students', icon: User }
    ]
  },
  {
    label: '教学资源',
    items: [
      { label: '练习册管理', path: '/worksheets', icon: Notebook },
      { label: '试卷答案库', path: '/paper', icon: Tickets },
      { label: '我的考法库', path: '/question-bank', icon: Collection },
      { label: '周末班课件', path: '/weekend-ppt', icon: Files }
    ]
  }
]
</script>`

test('锁健全性：多行格式化后的同一份 navGroups 必须判绿 —— 锁盯语义不盯缩进', () => {
  assert.deepEqual(
    collectFailures(PRETTY_SAMPLE),
    [],
    '一次纯格式化把入口锁打成假红（2026-10-06 真实踩过：2a5ab25 只改缩进，3 把锁同红）'
  )
})

/**
 * 行为级守卫（r214）：把**真实** AppSidebar.vue 的空白打乱（`{` / `,` / `:` 后补换行缩进，
 * 等价于一次 prettier 格式化），结论必须与原文一致。
 * 比「扫 test/ 找坏写法」的文本规则可靠 —— 文本规则区分不了「同一个字符串字面量」与
 * 「相邻两个字面量」，会误报 `includes('difficulty:')` 这类无关写法。
 */
test('锁健全性：真实 AppSidebar 被打乱空白后结论不变 —— 锁盯语义不盯缩进', () => {
  const mangled = SIDEBAR
    .replace(/\{/g, '{\n      ')
    .replace(/,/g, ',\n      ')
    .replace(/:/g, ': ')
  assert.notEqual(mangled, SIDEBAR, '空白打乱没生效，本测试会退化成空锁')
  assert.deepEqual(
    collectFailures(mangled),
    collectFailures(SIDEBAR),
    '一次纯格式化改变了入口锁的结论 —— 锁对空白敏感（2026-10-06 真实踩过）'
  )
})
