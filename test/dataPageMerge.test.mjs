/**
 * 数据页合并的回归锁（2026-10-04 第 91 轮）
 *
 * 背景：工作台的三个数据分析页里，负责人每天实际只打开「学习诊断」（`/weekly-report`）。
 * 第 89 轮提案、第 90 轮获授权后执行两档合并：
 *   ① 成长中心（`/growth`）下线 —— 它展示的每一块在学习诊断里都有对应物
 *      （周期趋势 / 成长对比 / 知识点诊断表 / 备课建议），**唯一例外是「家长成长卡」**；
 *   ② 错题中心（`/wrongbook`）下线 —— 清单并入学生档案页（组件自带的 embedded 模式，
 *      它的源码注释本来就写着「嵌在学生档案页的错题 tab 里」，只是从没接上）。
 *
 * ⛔ 本文件里最要紧的一条是**「家长成长卡不能丢」**：它是老师转发给家长的产出物
 *    （`GrowthCardButton`），成长中心下线时如果只删页面不搬它，等于删掉一条业务链路。
 *
 * ⛔ 第二条是「页面下线 ≠ 老书签 404」：两条路由必须留 redirect 兜底。
 *
 * ⛔ 第三条是「别再给死入口」：全仓不得再出现指向 /wrongbook 的硬跳转
 *    （错题中心里那排勾选框是死 UI，真正能组重练卷的入口在移动端错题本与学习诊断）。
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

const SIDEBAR_SRC = read('src/workbench/components/layout/AppSidebar.vue')
const ROUTER_SRC = read('src/workbench/router/index.js')
const HEADER_SRC = read('src/workbench/components/layout/AppHeader.vue')
const DIAG_SRC = read('src/workbench/views/WeeklyReportWorkbench.vue')
const STUDENT_SRC = read('src/workbench/views/StudentDetailWorkbench.vue')
const WRONGCENTER_SRC = read('src/workbench/views/WrongBookCenterRedesign.vue')
// 第 94 轮：RetryTasksWorkbench.vue 经审计确认为从未进过路由/侧栏的孤儿页，已删除，
// 原第 153 行「重练空态文案」测试随之摘除；其意图（禁指 /wrongbook）由下方全仓跳转锁覆盖。

/** 去掉注释，避免注释里提到的路径命中判据 */
function stripComments(src) {
  return String(src)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')
}

/** 递归列出 src/workbench 下所有代码文件 */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(vue|js|jsx)$/.test(name)) out.push(full)
  }
  return out
}

// ─────────────────── ① 「不能丢」的东西 ───────────────────

test('⛔ 家长成长卡必须搬到学习诊断（成长中心下线不能带走它）', () => {
  assert.ok(existsSync(join(ROOT, 'src/workbench/components/GrowthCardButton.vue')),
    'GrowthCardButton 组件本身被删了 —— 这是转发给家长的产出物，只能搬不能删')
  assert.match(DIAG_SRC, /import GrowthCardButton from '\.\.\/components\/GrowthCardButton\.vue'/,
    '学习诊断没有引入家长成长卡 ⇒ 成长中心下线后老师再也拿不到给家长的成长卡')
  assert.match(DIAG_SRC, /<GrowthCardButton[\s\S]{0,200}:student-id="selectedStudentId/,
    '成长卡没接到当前选中的学生上（点了会提示「请先选择学生」）')
  assert.match(DIAG_SRC, /<GrowthCardButton[\s\S]{0,200}:student-name="currentStudentName/,
    '成长卡缺学生姓名 ⇒ 卡片标题会是「同学」，导出的图片文件名也不对')
  // ⛔ GrowthCardButton 是「按钮 + 弹窗 + Teleport」多根节点组件，Vue 无法透传 class：
  //    直接把定位类挂在它身上会被静默丢弃（只在控制台留一条 Extraneous non-props attributes 告警），
  //    右对齐就永远不生效。定位类必须挂在外层元素上。
  assert.match(DIAG_SRC, /<span class="output-bar__growth">\s*<GrowthCardButton/,
    '成长卡的定位类要挂在外层 span 上（多根节点组件收不到 class）')
  assert.ok(!/<GrowthCardButton[^>]*\sclass=/.test(DIAG_SRC),
    '不能把 class 直接传给 GrowthCardButton：它是多根节点组件，class 会被丢弃')
})

test('学习诊断仍然保留自己的输出能力（不是把成长中心的东西搬过来换掉了）', () => {
  for (const label of ['生成本周报告', '生成本月报告', '生成讲义', '发重练卷']) {
    assert.ok(DIAG_SRC.includes(label), `学习诊断的输出条少了「${label}」`)
  }
})

// ─────────────────── ② 页面真的下线了 ───────────────────

test('侧栏「教学工作」只剩 3 项，成长中心与错题中心都不在菜单里', () => {
  const group = SIDEBAR_SRC.slice(SIDEBAR_SRC.indexOf("label:'教学工作'"))
  const line = group.slice(0, group.indexOf(']'))
  assert.ok(!line.includes('/growth'), '侧栏还有成长中心入口')
  assert.ok(!line.includes('/wrongbook'), '侧栏还有错题中心入口')
  for (const keep of ['批改中心', '学习诊断', '学生管理']) {
    assert.ok(line.includes(keep), `侧栏教学工作少了「${keep}」`)
  }
  // 图标 import 也要跟着清：TrendCharts 已无使用者
  assert.ok(!/TrendCharts/.test(SIDEBAR_SRC), 'TrendCharts 图标已无使用者，应从 import 里去掉')
})

test('顶部面包屑不再认识错题中心', () => {
  assert.ok(!HEADER_SRC.includes("'/wrongbook'"), '面包屑表里还留着 /wrongbook')
})

test('下线页的文件与只被它引用的资产都已删除（不留孤儿）', () => {
  for (const gone of [
    'src/workbench/views/GrowthWorkbench.vue',
    'src/workbench/views/WrongBookWorkbench.vue',
    'src/workbench/stores/growthStore.js',
  ]) {
    assert.equal(existsSync(join(ROOT, gone)), false, `${gone} 应已删除（页面已下线，留着就是孤儿）`)
  }
  // 前端封装 getRecommendedTopics 的唯一调用方是成长中心
  const api = read('src/services/apiService.js')
  assert.ok(!/export const getRecommendedTopics/.test(api),
    'getRecommendedTopics 已无前端调用方，应随页删除（后端 /weakness/recommend 路由保留）')
})

test('⛔ 页面下线 ≠ 老书签 404：两条路由必须留 redirect 兜底', () => {
  assert.ok(!/import\('\.\.\/views\/GrowthWorkbench\.vue'\)/.test(ROUTER_SRC), '路由还在加载已删除的 GrowthWorkbench')
  assert.ok(!/import\('\.\.\/views\/WrongBookWorkbench\.vue'\)/.test(ROUTER_SRC), '路由还在加载已删除的 WrongBookWorkbench')
  const growth = ROUTER_SRC.slice(ROUTER_SRC.indexOf("path: '/growth'"), ROUTER_SRC.indexOf("path: '/growth'") + 160)
  assert.match(growth, /redirect:/, '/growth 必须留 redirect，否则老书签白屏')
  assert.match(growth, /\/weekly-report/, '/growth 应重定向到学习诊断')
  const wb = ROUTER_SRC.slice(ROUTER_SRC.indexOf("path: '/wrongbook'"), ROUTER_SRC.indexOf("path: '/wrongbook'") + 240)
  assert.match(wb, /redirect:/, '/wrongbook 必须留 redirect，否则老书签白屏')
  assert.match(wb, /studentId/, '/wrongbook?studentId=x 应落到那名学生的档案页，而不是丢掉学生上下文')
})

// ─────────────────── ③ 错题清单搬到了学生档案页 ───────────────────

test('错题清单以 embedded 形态嵌进学生档案页，并给了可滚动/可聚焦的锚点', () => {
  assert.match(STUDENT_SRC, /import WrongBookCenterRedesign from '\.\/WrongBookCenterRedesign\.vue'/,
    '学生档案页没有引入错题清单组件')
  assert.match(STUDENT_SRC, /<WrongBookCenterRedesign\s+embedded\s+:student-id="student\.id"/,
    '必须以 embedded + student-id 渲染（embedded 会隐藏组件自带的页头与学生切换器，学生上下文由父页给定）')
  assert.match(STUDENT_SRC, /id="student-wrong"/, '缺少 #student-wrong 锚点，页内 CTA 无处可跳')
  assert.match(STUDENT_SRC, /function scrollToWrong\(\)/, '缺少页内滚动函数')
  assert.match(STUDENT_SRC, /if \(target === '#wrong'\) return scrollToWrong\(\)/,
    '「下一步建议」的页内 CTA 必须走滚动而不是路由跳转')
  // 组件侧：嵌入时不能套两层 wb-page（会叠页边距）
  assert.match(WRONGCENTER_SRC, /:class="\['wrong-center', \{ 'wb-page': !embedded \}\]"/,
    '错题组件嵌入时应去掉外层 wb-page')
})

test('⛔ 错题勾选框必须有真消费者（r102 接回「生成重练卷」后的新口径）', () => {
  const code = stripComments(WRONGCENTER_SRC)
  assert.ok(!code.includes('全选本页'),
    '「全选本页」仍应删除 —— 低频且放大误选面（r102 只接回了勾选+按钮的最小链路）')
  // r91 曾删光勾选框（当时勾了没有任何事情发生）。r102 负责人裁决①接回按钮后，
  // 勾选框恢复是合法的，但**必须带真消费者**：每行勾选绑定 toggleSelection，
  // 且「生成重练卷」按钮必须真调 createRetry（组卷 + 移动端导出引擎）。
  assert.match(code, /wrongBookStore\.toggleSelection\(item\)/,
    '勾选框回来了但没绑定 toggleSelection —— 又是死 UI')
  assert.match(code, /@click="createRetry"/, '「生成重练卷」按钮必须接到 createRetry')
  assert.ok(!/createRetryFor/.test(code),
    'createRetryFor 应已删除（单题组卷场景被「勾一道+按钮」覆盖，不留死函数）')
  // 但真正有用的两个动作必须留着
  assert.match(code, /markMastered/, '「标记完全掌握」是错题中心独有的动作，不能一起删掉')
  assert.match(code, /removeQuestion/, '「移除」是错题中心独有的动作，不能一起删掉')
})

test('⛔ 「生成重练卷」必须直接接移动端的重练卷模块（不许重新造轮子）', () => {
  const code = stripComments(WRONGCENTER_SRC)
  // 移动端模块 = 统一导出引擎 exportWrongBookPDF（PrintPreview 同款管线：组卷 + 服务端
  // Chromium PDF + /retry-task 二维码）。PC 侧组卷后必须调它，而不是自己实现 PDF。
  assert.match(code, /exportWrongBookPDF\(/, 'createRetry 必须调用移动端同一导出引擎 exportWrongBookPDF')
  assert.match(code, /buildRetryTaskUrl\(exam\.id\)/, '二维码入口必须用共享口径 buildRetryTaskUrl（与移动端同源）')
  const exporter = readFileSync(join(ROOT, 'src/pages/PrintPreview/index.jsx'), 'utf8')
  assert.match(exporter, /import \{ buildRetryTaskUrl \} from '\.\.\/\.\.\/utils\/retryTaskUrl'/,
    '移动端 PrintPreview 应引用共享的 buildRetryTaskUrl（两端同源，不许各自维护）')
})

test('学生档案页「最近重练」空态指向本页就能做到的入口', () => {
  const code = stripComments(STUDENT_SRC)
  assert.ok(!code.includes('去「错题本」勾选题目'),
    '「最近重练」空态让老师去错题本勾选题目，但勾选框已作为死 UI 删除，这条引导现在做不到')
  // r110（负责人批准对齐）：错题清单已并入本页且有真「生成重练卷」按钮，
  // 空态应优先指本页能力，而不是让老师跳去学习诊断
  assert.ok(code.includes('生成重练卷'), '空态应指向本页错题清单的「生成重练卷」按钮')
  assert.ok(!code.includes('生成再测卷'), '入口统一叫「重练卷」，不得再出现「生成再测卷」旧说法')
})

// ─────────────────── ④ 全仓不再有指向 /wrongbook 的硬跳转 ───────────────────

test('⛔ 全仓（除路由 redirect 定义外）不得再出现指向 /wrongbook 的跳转', () => {
  const offenders = []
  for (const file of walk(join(ROOT, 'src', 'workbench'))) {
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/')
    if (rel === 'src/workbench/router/index.js') continue // redirect 定义本身，允许
    const code = stripComments(readFileSync(file, 'utf8'))
    if (/\/wrongbook/.test(code)) offenders.push(rel)
  }
  assert.deepEqual(offenders, [], `以下文件还在硬跳 /wrongbook：${offenders.join(', ')}`)
})

test('全仓（除路由 redirect 定义外）不得再出现指向 /growth 的跳转', () => {
  const offenders = []
  for (const file of walk(join(ROOT, 'src', 'workbench'))) {
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/')
    if (rel === 'src/workbench/router/index.js') continue
    const code = stripComments(readFileSync(file, 'utf8'))
    if (/\/growth/.test(code)) offenders.push(rel)
  }
  assert.deepEqual(offenders, [], `以下文件还在硬跳 /growth：${offenders.join(', ')}`)
})
