/**
 * 工作台「反人类交互」回归锁（2026-11-26 体验排查）
 *
 * 锁的全是「点了没反应 / 数字与落点不一致 / 深链不生效」这类会反复回归的坑，
 * 每条都对应一个已实测的缺陷，不做风格约束。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

test('顶栏「帮助中心」必须有可打开的落点（不得是无 handler 的死按钮）', () => {
  const src = read('src/workbench/components/layout/AppHeader.vue')
  const btn = src.match(/<button[^>]*aria-label="帮助中心"[^>]*>/)?.[0] || ''
  assert.ok(btn, '找不到帮助中心按钮')
  assert.match(btn, /@click/, '帮助中心按钮没有点击处理（点了毫无反应）')
  assert.match(src, /v-model="helpOpen"/, '帮助中心按钮没有对应浮层')
})

test('首页「待复核」不得退回未读通知数（pendingReview 语义不同）', () => {
  const src = read('src/workbench/views/DashboardWorkbench.vue')
  assert.doesNotMatch(
    src,
    /summary\.pendingReviewPapers\s*\?\?\s*notiStore\.summary\.pendingReview\b/,
    '待复核数退回 pendingReview 会让「首页 1 份 / 批改中心 7 份」事故复现'
  )
  assert.match(src, /pendingReviewPapers\s*\?\?\s*0/)
})

test('学生列表不得按学生逐个打接口（必须用 /api/students 的聚合列）', () => {
  // 去掉注释再查：注释里解释「为什么不能这么写」时会出现函数名，不能算违规。
  const src = read('src/workbench/views/StudentsWorkbench.vue')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  for (const banned of ['getTasksByStudent', 'getWrongQuestionsByStudent', 'getGeneratedExamsByStudent']) {
    assert.ok(!src.includes(banned), `学生列表又回到逐生请求（${banned}），20 人 = 60+ 请求`)
  }
  assert.match(src, /total_error_count/, '未掌握错题必须读服务端聚合列')
  assert.match(src, /pending_retry_count/, '待重练必须读服务端聚合列')
})

test('学生列表命中本机缓存后必须回源校准（缓存只能当首屏占位）', () => {
  // getStudents 的 TTL 是 1 小时；这一列的「作业记录 / 未掌握错题 / 待重练」
  // 批完卷子就会变。只读缓存 ⇒ 老师批完卷进列表看到的还是旧数字，
  // 与批改中心对不上（同「首页 1 份 / 批改中心 7 份」那一类问题）。
  const src = read('src/workbench/views/StudentsWorkbench.vue')
  const loader = src.slice(src.indexOf('const loadStudents'), src.indexOf('watch(() => route.query'))
  assert.match(loader, /const loadStudents = async \(\{ force = false \}/, 'loadStudents 必须支持 force（重新加载按钮要能跳过缓存）')
  assert.match(loader, /getStudents\(!force\)/, '首屏可以读缓存，但 force 时必须回源')
  assert.match(loader, /if \(!force && result\.fromCache\)/, '缓存命中后没有回源校准分支')
  assert.match(loader, /await getStudents\(false\)/, '校准必须强制回源（getStudents(false)）')
  // 模板里必须显式传参：@click="loadStudents" 会把 MouseEvent 当参数传入，force 判据会失效
  assert.match(src, /@click="loadStudents\(\{ force: true \}\)"/, '「重新加载」按钮没有强制回源')
  assert.doesNotMatch(src, /@click="loadStudents"|onMounted\(loadStudents\)/, 'loadStudents 被直接当事务回调（事件对象会被当成参数）')
})

test('学习诊断页必须消费 ?studentId= 深链（学生档案点过来要直接选中该生）', () => {
  const src = read('src/workbench/views/WeeklyReportWorkbench.vue')
  assert.match(src, /route\.query\.studentId/, '学习诊断页不读 studentId，深链会落在全班视图')
})

test('移动端首页「上次作业已批改」直接开结果页，不再只跳列表', () => {
  const dash = read('src/components/HomeDashboardV2.jsx')
  assert.match(dash, /onOpenReview/, '首页提醒卡没有结果页出口')
  const app = read('src/App.jsx')
  assert.match(app, /onOpenReview=\{/, 'App 没有把结果页出口传给首页')
})

test('批改中心任务列表必须分批渲染（否则上百条一次渲染会卡）', () => {
  const src = read('src/workbench/views/GradeCenterWorkbench.vue')
  assert.match(src, /displayedTasks/, '任务列表缺少分批渲染')
  assert.match(src, /v-for="task in displayedTasks"/, '任务行仍按 visibleTasks 全量渲染')
})

test('复核台两个自动开关必须持久化（关掉刷新后又弹回「开」＝设置没生效）', () => {
  const store = read('src/workbench/stores/reviewStore.js')
  const topBar = read('src/workbench/components/review/ReviewTopBar.vue')
  // 初始值必须读本机偏好，不能写死 ref(true)
  assert.match(store, /const autoAdvanceEnabled = ref\(readAutoAdvance\(\)\)/, '「判定后自动跳下一题」没读本机偏好')
  assert.match(store, /const autoNextPaperEnabled = ref\(readAutoNextPaper\(\)\)/, '「完成复核后自动接下一份」没读本机偏好')
  // 两个 setter 都要落盘，且都要被导出
  assert.match(store, /writeAutoAdvance\(autoAdvanceEnabled\.value\)/, 'setAutoAdvance 没落盘')
  assert.match(store, /writeAutoNextPaper\(autoNextPaperEnabled\.value\)/, 'setAutoNextPaper 没落盘')
  assert.match(store, /setAutoAdvance,/, 'setAutoAdvance 没导出（顶栏拿不到）')
  // 顶栏必须走 setter：直接改 ref 不会写 localStorage，这正是「设置像没生效」的成因
  assert.match(topBar, /store\.setAutoAdvance\(!store\.autoAdvanceEnabled\)/, '顶栏仍在直接改 autoAdvanceEnabled（刷新即失效）')
  assert.doesNotMatch(topBar, /store\.autoAdvanceEnabled\s*=/, '顶栏直接赋值会绕过持久化')
  assert.match(topBar, /store\.setAutoNextPaper\(!store\.autoNextPaperEnabled\)/, '顶栏没走 setAutoNextPaper')
})
