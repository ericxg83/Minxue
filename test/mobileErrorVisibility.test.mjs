/**
 * 移动端「错误可见化 + 学生写操作禁重试」回归锁（2026-10-04 巡检循环，移动端赛道 lane-m01）
 *
 * 背景（本轮实测核实的四类缺陷，全部曾让老师「点了不知道发生了啥」）：
 *   1. StudentSwitcher 添加/编辑/删除学生失败只进 console——表单静默关闭，
 *      老师以为建好了实际上库里没有；删除失败时确认框卡死且本地列表与库分叉
 *      （先删本地、await 失败被 catch 吞、setShowDeleteConfirm(null) 永不执行）。
 *   2. ImageCropper 用原生 alert 报错——Android WebView 里形态不可控，
 *      仓内移动端统一用 antd-mobile Toast。
 *   3. WorksheetPicker 加载练习册失败被吞——列表空成「暂无已发布的练习册」，
 *      老师误以为真没练习册；设为默认失败无任何反馈。
 *   4. createStudent/updateStudent/deleteStudent 未传 retries=1——apiRequest 默认
 *      3 次尝试，而服务端 POST /students 是纯 INSERT 无去重，5xx/超时重放会造重复学生
 *      （与仓内「写操作不重试」既有约定相悖，见 updateWorksheetAnswer 同款注释）。
 *
 * 反向自检：harness 套在修复前旧文件（_r105q_old/）上必须判红，否则是空锁。
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { anchoredSlice, anchoredRange } from './sourceLockKit.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 提取 `export const <name> = ` 到下一个 `export const ` 之间的函数体。 */
function extractFn(src, name) {
  const start = src.indexOf(`export const ${name} =`)
  if (start < 0) return null
  const rest = src.slice(start + name.length + 20)
  const next = rest.indexOf('export const ')
  return next < 0 ? src.slice(start) : src.slice(start, start + name.length + 20 + next)
}

/** 给一个组件源码判断「每个 catch 都有 Toast 反馈」。 */
function catchesWithoutToast(src) {
  const fails = []
  const re = /\bcatch\s*[({]/g
  let m
  while ((m = re.exec(src))) {
    const seg = src.slice(m.index, m.index + 400)
    if (!seg.includes('Toast.show')) fails.push(src.slice(m.index, m.index + 60).split('\n')[0])
  }
  return fails
}

/** JSX 源码里扫描 button 嵌 button（线性深度扫描，自闭合标签不计入深度）。 */
function hasButtonInButton(src) {
  const re = /<\/?button(?=[\s/>])/g
  let depth = 0
  let m
  while ((m = re.exec(src))) {
    const tag = m[0]
    if (tag.startsWith('</')) { depth = Math.max(0, depth - 1); continue }
    if (depth >= 1) return true
    const tail = src.slice(m.index + tag.length, m.index + tag.length + 2000)
    const close = tail.indexOf('>')
    const selfClose = close >= 0 && tail[close - 1] === '/'
    if (!selfClose) depth += 1
  }
  return false
}

/** 对一组「修复前」文件复用同一套判据，返回违规清单（供反向自检）。 */
export function collectFailures(dir) {
  const file = (rel) => {
    const p = join(dir, rel)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }
  const fails = []

  const sw = file(join('components', 'StudentSwitcher', 'index.jsx'))
  if (sw !== null) {
    for (const line of catchesWithoutToast(sw)) fails.push(`StudentSwitcher: catch 无 Toast 反馈 → ${line}`)
    if (!sw.includes("from 'antd-mobile'")) fails.push('StudentSwitcher: 未引入 antd-mobile Toast')
    const h0 = sw.indexOf('const handleDelete')
    const hd = h0 < 0 ? '' : sw.slice(h0, h0 + 900)
    const iDel = hd.indexOf('await deleteStudent')
    const iLocal = hd.indexOf('setStudents(')
    if (iDel < 0 || iLocal < 0 || iDel > iLocal) {
      fails.push('StudentSwitcher: 删除必须「先服务端成功、后动本地」（setStudents 不得在 await deleteStudent 之前）')
    }
    // r109q：确认弹窗的删除键必须有防连点态（DELETE 重发有副作用风险）
    if (!sw.includes('setDeleting') || !/disabled=\{deleting\}/.test(sw)) {
      fails.push('StudentSwitcher: 删除确认键必须防连点（deleting 态 + disabled）')
    }
  }

  const crop = file(join('components', 'ImageCropper', 'index.jsx'))
  if (crop !== null) {
    if (/[^.\w]alert\(/.test(crop)) fails.push('ImageCropper: 禁止原生 alert（移动端统一 antd-mobile Toast）')
    if (!crop.includes("from 'antd-mobile'")) fails.push('ImageCropper: 未引入 antd-mobile Toast')
  }

  const ws = file(join('components', 'WorksheetPicker', 'index.jsx'))
  if (ws !== null) {
    const lw = anchoredRange(ws, 'const loadWorksheets', 'const loadDefault', 'WorksheetPicker: 加载练习册失败必须 Toast', fails)
    if (lw !== null && !lw.includes('Toast.show')) fails.push('WorksheetPicker: 加载练习册失败必须 Toast')
    const s0 = ws.indexOf('const handleSetDefault')
    const sd = s0 < 0 ? '' : ws.slice(s0, s0 + 500)
    if (!sd.includes('Toast.show')) fails.push('WorksheetPicker: 设为默认失败必须 Toast')
    // r107q：列表行曾把「设为默认」星标 button 包在整行 button 里（HTML 非法）
    if (hasButtonInButton(ws)) fails.push('WorksheetPicker: 禁止 button 嵌 button（外层改用 div[role=button]）')
  }

  // r107q：App 初始化链与通知面板的失败不得伪装成正常空态
  const app = file('App.jsx')
  if (app !== null) {
    const iGet = app.indexOf('console.error(\'获取学生数据失败:\', err)')
    if (iGet < 0) fails.push('App.jsx: 学生名单失败锚点不在（改动前请先同步本锁）')
    else if (!app.slice(iGet, iGet + 400).includes('Toast.show')) fails.push('App.jsx: 冷启动拉不到学生名单必须 Toast（空首页不得误导为「没学生」）')
    const initSeg = anchoredSlice(app, "console.error('初始化失败:', error)", 300, 'App.jsx: 初始化失败必须 Toast', fails)
    if (initSeg !== null && !initSeg.includes('Toast.show')) fails.push('App.jsx: 初始化失败必须 Toast')
  }

  const np = file(join('components', 'NotificationsPanel.jsx'))
  if (np !== null) {
    if (!np.includes('setLoadError')) fails.push('NotificationsPanel: 加载失败必须有错误态（不得渲染成「暂无新通知」误导）')
    if (!np.includes('通知加载失败') || !np.includes('重试')) fails.push('NotificationsPanel: 错误态必须带可见文案与重试入口')
  }

  // r108q：周报页与错题本分页的失败不得伪装成「暂无数据」
  const wr = file(join('pages', 'WeeklyReport', 'index.jsx'))
  if (wr !== null) {
    if (!wr.includes('setSummaryError')) fails.push('WeeklyReport: 加载失败必须有错误态（周报是转发家长的输出物，不得误导为「本周没数据」）')
    if (!wr.includes('学习数据加载失败')) fails.push('WeeklyReport: 错误态必须带可见文案与重试')
  }

  if (app !== null) {
    // ⚠️ r167：以下 4 条原先是 `if (lm >= 0 && !app.slice(...))` —— 锚点被改名时
    // 短路成「不报错」，锁静默失效（改坏代码的那次重构顺手关掉了锁）。统一改走
    // anchoredSlice（锚点不在 ⇒ 记一条失败）。
    const LM_LABEL = 'App.jsx: 错题 loadMore 失败必须 Toast（静默失败会让老师以为「就这些题」）'
    const lmSeg = anchoredSlice(app, "console.error('加载更多错题失败:', error)", 300, LM_LABEL, fails)
    if (lmSeg !== null && !lmSeg.includes('Toast.show')) fails.push(LM_LABEL)

    const WB_LABEL = 'App.jsx: 首页无缓存时错题本加载失败必须 Toast'
    const wbSeg = anchoredSlice(app, "console.error('加载错题失败:', error)", 400, WB_LABEL, fails)
    if (wbSeg !== null && !wbSeg.includes('Toast.show')) fails.push(WB_LABEL)

    // r110q：作业列表无缓存时加载失败也必须 Toast（与错题本同口径，不得停在「暂无任务」）
    const LT_LABEL = 'App.jsx: 无缓存时作业列表加载失败必须 Toast'
    const ltSeg = anchoredSlice(app, "console.error('加载任务失败:', error)", 400, LT_LABEL, fails)
    if (ltSeg !== null && !ltSeg.includes('Toast.show')) fails.push(LT_LABEL)

    // r111q：试卷首次加载且无缓存时失败也必须 Toast（轮询失败不弹，防噪）
    const LE_LABEL = 'App.jsx: 无缓存首次加载试卷失败必须 Toast'
    const leSeg = anchoredSlice(app, "console.error('加载试卷失败:', error)", 400, LE_LABEL, fails)
    if (leSeg !== null && !leSeg.includes('Toast.show')) fails.push(LE_LABEL)

    // r112q（提案⑱-2）：错题本两个加载函数落地前必须校验当前学生，防串数据
    const GUARD = 'useStudentStore.getState().currentStudent?.id !== studentId'
    const WB_FN_LABEL = 'App.jsx: loadWrongBookData 缺「切换学生竞态」守卫（⑱-2）'
    const wbFn = anchoredRange(app, 'const loadWrongBookData', 'const loadMoreWrongQuestions', WB_FN_LABEL, fails)
    if (wbFn !== null && !wbFn.includes(GUARD)) fails.push(WB_FN_LABEL)

    const LM_FN_LABEL = 'App.jsx: loadMoreWrongQuestions 缺「切换学生竞态」守卫（⑱-2）'
    const lmFn = anchoredRange(app, 'const loadMoreWrongQuestions', '// Exam: Load generated exams', LM_FN_LABEL, fails)
    if (lmFn !== null && !lmFn.includes(GUARD)) fails.push(LM_FN_LABEL)
  }

  const api = file(join('services', 'apiService.js'))
  if (api !== null) {
    for (const fn of ['createStudent', 'updateStudent', 'deleteStudent']) {
      const body = extractFn(api, fn)
      if (body === null) { fails.push(`apiService: ${fn} 不见了`); continue }
      if (!/apiRequest\([^]*?\}\s*,\s*1\)/.test(body) && !/, 1\)/.test(body)) {
        fails.push(`apiService: ${fn} 写操作必须传 retries=1（默认 3 次会重放 INSERT/PUT/DELETE）`)
      }
    }
  }

  return fails
}

test('⛔ 移动端错误可见化 + 学生写操作禁重试（当前树必须零违规）', () => {
  const failures = collectFailures(join(ROOT, 'src'))
  assert.deepEqual(
    failures,
    [],
    `\n发现 ${failures.length} 处违规：\n` + failures.map((f) => `  - ${f}`).join('\n')
  )
})

test('锁健全性：判据套合成坏样本必须判红（防空锁，不依赖 git 状态）', () => {
  // 早期用 _r105q_old（每轮从 HEAD 重导）做反向自检；但历史修复已合入 HEAD 后，
  // HEAD 对所有旧规则都已合规→旧树 0 红，阈值会误报。改为内联构造一份「全坏」
  // 合成树，永远能触发全部判据，永久证明探测器非空锁。
  const base = join(ROOT, '_r113q_baddir', 'src')
  const put = (rel, content) => {
    const p = join(base, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content, 'utf8')
  }
  put(join('components', 'StudentSwitcher', 'index.jsx'),
    `const handleDelete = async () => { setStudents(x); await deleteStudent(id); }
     const loadStudents = async () => { try {} catch (error) { console.error('加载学生列表失败:', error) } }
     const isFormValid = 1`)
  put(join('components', 'ImageCropper', 'index.jsx'),
    `} catch (error) { alert('裁剪失败，请重试') }`)
  put(join('components', 'WorksheetPicker', 'index.jsx'),
    `const loadWorksheets = async () => { try {} catch (e) { console.error('加载练习册失败:', e) } }
     const handleSetDefault = async () => { try {} catch (e) { console.error('设置默认失败:', e) } }
     <button className="row"><button onClick={star}>star</button></button>`)
  put(join('components', 'NotificationsPanel.jsx'), `const load = () => { try {} catch (e) { console.error('加载通知失败:', e) } }`)
  put(join('pages', 'WeeklyReport', 'index.jsx'), `const loadSummary = async () => { try {} catch (err) { console.warn('加载周报告失败:', err) } }`)
  put(join('services', 'apiService.js'),
    `export const createStudent = async (d) => { const data = await apiRequest('/students', { method: 'POST', body: b })\n}
     export const updateStudent = async (i, d) => { const data = await apiRequest('/x', { method: 'PUT' })\n}
     export const deleteStudent = async (i) => { await apiRequest('/x', { method: 'DELETE' })\n}`)
  put('App.jsx',
    `const a = getStudents(false).catch(err => { console.error('获取学生数据失败:', err) })
     const b = () => { try {} catch (error) { console.error('初始化失败:', error) } }
     const c = () => { try {} catch (error) { console.error('加载任务失败:', error) } }
     const d = () => { try {} catch (error) { console.error('加载错题失败:', error) } }
     const e2 = () => { try {} catch (error) { console.error('加载更多错题失败:', error) } }
     const f = () => { try {} catch (error) { console.error('加载试卷失败:', error) } }`)

  const probe = collectFailures(base)
  // 合成树故意踩遍全部判据，实际命中应 ≥14（学生 3catch+antd+删除顺序+防连点
  // =6，裁图 2，练习册 Toast×2+按钮嵌套=3，通知 2，周报 2，App 名单/初始化/任务/错题/loadMore/试卷=6，
  // api 3）；阈值留较大余量防某条判据微调后仍非空锁
  assert.ok(probe.length >= 14, `判据套合成坏样本应报 ≥14 处，实际 ${probe.length} —— 锁可能是空锁`)
})
