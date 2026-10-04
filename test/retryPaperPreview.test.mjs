/**
 * 「专项重练卷预览」闭环锁（2026-10-05 第 142 轮）
 *
 * 起因（负责人验收原话）：诊断页说「49 道计算错误 → 发重练卷」，
 * r141 把它改成了跳学生档案页的错题清单 —— 负责人反馈「**也没有很顺手的页面，
 * 体验很差**」。理想是像移动端错题本那样：勾题 → 预览 → 我确定就好。
 *
 * ⛔ 这类缺陷前两代锁都抓不到，因为跳转目标全是**真实存在**的路由：
 *   「路由能解析」不等于「跳对了地方」，更不等于「跳过去就能把事做完」。
 *   本锁守的是**第三层**：动作的落点是否真能完成 CTA 承诺的那件事。
 *
 * 判据分两组：
 *   ① 组卷链路不许另造 —— 必须复用 PC 错题清单已在用的那三件套
 *      （createGeneratedExam / examNaming / exportWrongBookPDF + buildRetryTaskUrl）。
 *      同一件事出现第二份实现 = 将来口径必然分叉（实测组卷命名已因序号口径分叉过一次）。
 *   ② 勾选语义不许塌陷 —— 默认全选（老师看到的就是诊断页承诺的那 N 道）、
 *      可逐题取消、可清空、不可用的题（练习册自包含）必须排除且可见地说明。
 *
 * 反向自检全部内联合成坏样本（不依赖 git 旧树，历史修复合入 HEAD 后旧树会 0 红误报）。
 */
import { readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIALOG = 'src/workbench/components/diagnosis/RetryPaperPreviewDialog.vue'
const NEXT_ACTIONS = 'src/workbench/components/diagnosis/NextActions.vue'
const SCOPE = 'src/workbench/components/diagnosis/retryPaperScope.js'

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')
const strip = (src) => String(src)
  .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/^([ \t]*)\/\/.*$/gm, (_m, i) => i)

test('⛔ 专项重练卷预览弹窗必须存在，且是唯一的新出口（不许只有跳转）', () => {
  const next = strip(read(NEXT_ACTIONS))
  assert.ok(next.includes('RetryPaperPreviewDialog'), '动作清单没有挂重练卷预览弹窗')
  assert.match(next, /import RetryPaperPreviewDialog from '\.\/RetryPaperPreviewDialog\.vue'/,
    '弹窗组件没有相对引入（换目录就断链）')
  // 反向自检：只跳转不挂弹窗的旧版必须被判红
  const badSample = `import { computed } from 'vue'
    const wrongListPath = computed(() => \`/students/\${props.studentId}\`)
    function run(a) { router.push(wrongListPath.value) }`
  assert.ok(!badSample.includes('RetryPaperPreviewDialog'),
    '反向自检失效：只跳转的旧版样本没被抓住，本锁已退化为空锁')
})

test('⛔ 三条能组卷的动作都必须走 scope 就地预览，不许再跳档案页让老师自己重筛', () => {
  const next = strip(read(NEXT_ACTIONS))
  // 动作对象里必须带 scope（预筛条件），而不是只有 to
  const blocks = [...next.matchAll(/list\.push\(\{([\s\S]*?)\}\)/g)].map((m) => m[1])
  const paperActions = blocks.filter((b) => /id:\s*'(error-cause|repeat|basic)'/.test(b))
  assert.equal(paperActions.length, 3, `只抠出 ${paperActions.length} 条组卷动作，提取器疑似失效`)

  // 反向自检坏样本：三条动作都只有 to（= r141 的旧版）
  const legacy = blocks.map((b) => b.replace(/\bscope:[\s\S]*?\n/, '').replace(/\n\s*\n/g, '\n'))
  assert.ok(legacy.every((b) => !/\bscope:/.test(b)), '反向自检失效：剥掉 scope 后样本仍被判有 scope')

  for (const b of paperActions) {
    const id = (b.match(/id:\s*'([^']+)'/) || [])[1]
    assert.match(b, /\bscope:/, `动作 ${id} 没有 scope —— 点开不知道要筛哪一类`)
    assert.ok(!/cta:\s*'去错题清单'/.test(b), `动作 ${id} 的 CTA 还是「去错题清单」——那正是负责人说体验差的落点`)
  }
  // 三种预筛条件各就各位
  assert.match(next, /kind:\s*'error-cause'/, '缺按错因预筛')
  assert.match(next, /kind:\s*'repeat'/, '缺按反复错预筛')
  assert.match(next, /kind:\s*'basic'/, '缺按基本掌握预筛')
  // 跳转降级为次级出口（可留，但不能是主路径）
  assert.match(next, /nextlist__more/, '完整错题清单的次级出口不见了 —— 想看全部题时无路可走')
})

test('⛔ 弹窗内必须复用既有组卷与出纸管线，不许另写一份', () => {
  const code = strip(read(DIALOG))
  for (const [re, why] of [
    [/createGeneratedExam/, '组卷接口'],
    [/buildExamBaseName/, '卷名基名口径（当天序号必须基于全量列表算，见 examNaming.js）'],
    [/buildExamNameWithSeq/, '卷名序号口径'],
    [/exportWrongBookPDF/, 'PDF 导出引擎（服务端矢量 PDF + 二维码）'],
    [/buildRetryTaskUrl/, '二维码入口 URL（须与移动端同源）']
  ]) {
    assert.match(code, re, `弹窗没有走${why}——另写一份必然口径分叉`)
  }
  // 反向自检：自造卷名 + 自己 fetch 的坏样本
  const badSample = `const name = '重练卷-' + Date.now()
    await fetch('/api/generated-exams', { method: 'POST' })`
  assert.ok(!/exportWrongBookPDF/.test(badSample) && !/buildExamNameWithSeq/.test(badSample),
    '反向自检失效：自造卷名的样本没被抓住')
})

test('⛔ 勾选语义：默认全选 + 可逐题取消 + 可清空（移动端那套手感不许塌）', () => {
  const code = strip(read(DIALOG))
  const scopeSrc = strip(read(SCOPE))
  // 打开即全选：按 scope 预筛后把所有命中项放进 selectedKeys
  //（r142 起这段语义在 retryPaperScope.pickDefaults 里，行为由 retryPaperScope.test.mjs 真跑验证）
  assert.match(code, /selectedKeys\.value = pickDefaults\(/,
    '打开弹窗没有默认全选 —— 老师点开还要再点一次全选，等于多一步')
  assert.match(scopeSrc, /export function pickDefaults[\s\S]*?filter\(\(it\) => inScope\(it, scope\)\)\.map\(\(it\) => it\.key\)/,
    'pickDefaults 必须返回全部命中项的 key —— 少一个就少一道默认勾选')
  assert.match(code, /function toggleAll/, '缺「全选 / 取消全选」')
  assert.match(code, /function toggleOne/, '缺逐题勾选')
  assert.match(code, /清空/, '缺「清空」')
  // 反向自检：清空后不恢复的坏样本
  const badSample = `function toggleAll(e) { selectedKeys.value = [] }
    function toggleOne(key) {}`
  assert.ok(!/pickDefaults/.test(badSample),
    '反向自检失效：不默认全选的样本没被抓住')
})

test('⛔ 练习册自包含错题（question_id 为空）必须排除且对老师可见，不能静默吞掉', () => {
  const code = strip(read(DIALOG))
  // r142：这层判定已提到 retryPaperScope.toExamQuestionIds（单一实现，可真跑验证）
  assert.match(strip(read(SCOPE)), /export function toExamQuestionIds[\s\S]*?filter\(\(it\) => it\?\.questionId\)/,
    '统一排除实现丢了 —— question_id 为空的题会被组进卷')
  assert.match(code, /const examIds = computed\([\s\S]*?toExamQuestionIds\(selectedItems\.value\)\.questionIds/,
    '提交用的题单没有走统一排除')
  assert.match(code, /droppedCount/, '没有统计被排除的题数')
  assert.match(code, /练习册自包含/, '排除后没有对老师说明 —— 老师会以为 49 道全组进去了')
})

test('⛔ 界面上的每个数字都得是「真能组进卷的数」，不许拿勾选数冒充（r142 实测踩到）', () => {
  // 实测：毛辰绮「计算错误」命中 49 道，其中 8 道是练习册自包含错题（question_id 为空），
  // 实际只能组出 41 道。若按钮写「生成重练卷（49）」而卷面只有 41，就是口径失真 ——
  // 与「诊断页说 49、卷里只有 41」同一类病，且老师更难察觉（按钮是他自己点的）。
  const code = strip(read(DIALOG))
  // 单一来源：可组卷题单由 toExamQuestionIds 产出，界面数字一律引用它
  assert.match(code, /const examIds = computed\(\(\) => toExamQuestionIds\(selectedItems\.value\)\.questionIds\)/,
    '没有「可组卷题单」这个唯一来源 —— 界面数字会各算各的')
  assert.match(code, /生成重练卷<template v-if="examIds\.length">（{{ examIds\.length }}）/,
    '确认按钮必须显示可组卷数，而不是勾选数')
  // 反向自检：拿勾选数冒充的坏样本
  const badSample = `<el-button>生成重练卷（{{ selectedItems.length }}）</el-button>`
  assert.ok(!/examIds\.length/.test(badSample), '反向自检失效：勾选数冒充的样本没被抓住')
})

test('⛔ 命中数与可组卷数不一致时必须显式说明（不许静默少几道）', () => {
  const code = strip(read(DIALOG))
  assert.match(code, /droppedCount/, '没有统计被排除的题数')
  assert.match(code, /已自动排除/, '排除后没有对老师说明 —— 会以为命中的题全都组进去了')
  // 排除口径必须落在 toExamQuestionIds 上（唯一实现）
  assert.match(code, /const droppedCount = computed\(\(\) => toExamQuestionIds\(scopedItems\.value\)\.dropped\)/,
    '排除数没有走统一口径')
})

test('⛔ 弹窗的错误与加载态不许伪装成「没有错题」（静默失败整类缺陷）', () => {  const code = strip(read(DIALOG))
  assert.match(code, /loadError/, '没有错误态 —— 读取失败会渲染成「没有符合条件的错题」')
  assert.match(code, /错题读取失败/, '读取失败没有可见文案')
  assert.match(code, /loading/, '没有加载态')
  // 反向自检：只 catch 不提示的坏样本
  const badSample = `catch (e) { console.warn(e) }
    const list = []`
  assert.ok(!/loadError/.test(badSample), '反向自检失效：静默 catch 的样本没被抓住')
})

test('⛔ 组卷失败必须上抛提示；PDF 失败不回滚组卷但要说清（口径与错题清单一致）', () => {
  const code = strip(read(DIALOG))
  assert.match(code, /ElMessage\.error\(error\.message/, '组卷失败没有提示 —— 界面会说成功而库里没写')
  assert.match(code, /PDF 生成失败/, 'PDF 失败没有提示')
  // PDF 失败不许把整段 catch 成「组卷失败」（卷其实已建好）
  const pdfCatch = code.slice(code.indexOf('exportWrongBookPDF'))
  assert.ok(pdfCatch.includes('catch'), 'PDF 调用没有独立 catch —— 会把已建好的卷误报成失败')
})

test('⛔ 父组件必须把学生上下文与回调接住（prop 声明了但没传 = 落不到人身上）', () => {
  const caller = strip(read('src/workbench/views/WeeklyReportWorkbench.vue'))
  assert.match(caller, /:student-id="selectedStudentId"/, '没传 studentId')
  assert.match(caller, /:student-name="currentStudentName/, '没传 studentName —— 卷面标题与 PDF 文件名会退化成「学生」')
  assert.match(caller, /@exam-created="onRetryExamCreated"/, '没接 exam-created —— 组完卷本页状态不刷新')
  assert.match(caller, /function onRetryExamCreated/, '声明了回调但没有实现')
})
