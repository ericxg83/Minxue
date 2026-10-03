/**
 * 「本机板书」清理入口的回归锁（2026-10-03 第 89 轮）
 *
 * 背景：板书按题目稳定锚点一条 localStorage 键**永久存在**，全仓没有任何回收逻辑
 * （`WeekendBoard` / `DrawingCanvas` 零 `removeItem`）。第 87 轮把体积瘦掉约一半
 * （写满点从 ~28 题推到 ~55 题），写满时也已经不静默（页内提示去导出），但**没有回收手段**：
 * 老师只能清浏览器数据 —— 那会连其它本地缓存一起清掉。
 *
 * 本轮补的是「把回收权交给老师」，两件事必须同时成立才算做完：
 *   ① 纯函数层：键 → 可读标签 / 体积 / 汇总，新旧两种前缀都要认（旧键仍占配额）。
 *   ② 接线层：**删掉的正好是当前这一题时，必须连板面一起清**。
 *      只删存储是假的 —— 屏幕上那份在内存里，离开这一题时 `saveStrokes()` 会原样写回同一个键。
 *      而且要先把防抖定时器掐掉，否则 300ms 内刚写的那一笔会把键又写回来。
 *
 * 无 jsdom，纯函数用假 storage 直测；接线层用源码级锁（顺序被改回去立刻红）。
 */
import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  STROKES_KEY_PREFIX,
  LEGACY_STROKES_KEY_PREFIX,
  isStrokeKey,
  labelFromAnchor,
  describeStrokeEntry,
  listStrokeEntries,
  summarizeStrokeEntries,
  formatBytes,
} from '../src/workbench/utils/strokeStorage.js'

const BOARD_SRC = readFileSync(
  new URL('../src/workbench/views/WeekendBoard.vue', import.meta.url), 'utf8')
const DIALOG_SRC = readFileSync(
  new URL('../src/workbench/components/BoardStorageDialog.vue', import.meta.url), 'utf8')

/** 假 localStorage：只实现 listStrokeEntries 用到的三个成员 */
function makeStorage(pairs) {
  const map = new Map(Object.entries(pairs || {}))
  return {
    get length() { return map.size },
    key: (i) => (i >= 0 && i < map.size ? Array.from(map.keys())[i] : null),
    getItem: (k) => (map.has(k) ? map.get(k) : null),
  }
}

/** 取出 `function <name>(...) { ... }` 的函数体（按大括号配平） */
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `找不到函数 ${name}`)
  const open = src.indexOf('{', start)
  assert.ok(open >= 0, `${name} 缺少函数体`)
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  assert.fail(`${name} 函数体没配平`)
}

/** 去掉整行注释，避免注释里的字样命中判据 */
function codeOf(body) {
  return body
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
    .join('\n')
}

// ─────────────────────────── ① 纯函数层 ───────────────────────────

test('isStrokeKey：新旧两种前缀都认，别的一律不认', () => {
  assert.equal(STROKES_KEY_PREFIX, 'wb_strokes_v2_')
  assert.equal(LEGACY_STROKES_KEY_PREFIX, 'wb_strokes_')
  assert.ok(isStrokeKey('wb_strokes_v2_ws:1|p2|n3|s:abc'))
  assert.ok(isStrokeKey('wb_strokes_初三_数学_20260901_20260907_q3'))
  // ⛔ 判断顺序不能反：v2 键也以旧前缀开头，先判旧前缀会把 v2 键误判成旧格式
  assert.ok(isStrokeKey('wb_strokes_v2_x'))
  assert.ok(!isStrokeKey('weekendBoard:payload'))
  assert.ok(!isStrokeKey('wb_marks_v1_x'))
  assert.ok(!isStrokeKey(''))
  assert.ok(!isStrokeKey(null))
})

test('labelFromAnchor：三种锚点都翻成老师看得懂的一句话', () => {
  assert.equal(
    labelFromAnchor('ws:12|p45|n7|s:如图在三角形abc中'),
    '练习册 第 45 页 第 7 题 · 如图在三角形abc中')
  assert.equal(labelFromAnchor('topic:计算 1+1 的值'), '题干：计算1+1的值')
  assert.equal(labelFromAnchor('self:abc123'), '题面未识别 · self:abc123')
  // 超长锚点落盘前被截成 `<前100字>~<fnv1a36>`，展示时哈希尾巴必须剥掉
  assert.equal(labelFromAnchor('ws:12|p45|n7|s:题干~1abc2def'), '练习册 第 45 页 第 7 题 · 题干')
  assert.equal(labelFromAnchor('topic:短~zzz'), '题干：短')
  assert.equal(labelFromAnchor(''), '(空锚点)')
})

test('describeStrokeEntry：旧格式标 legacy、体积含键自身长度、能数出笔迹条数', () => {
  const modern = describeStrokeEntry('wb_strokes_v2_ws:12|p45|n7|s:abc', '[{},{}]')
  assert.equal(modern.legacy, false)
  assert.equal(modern.bytes, 7)
  assert.equal(modern.strokeCount, 2)
  assert.match(modern.label, /^练习册 第 45 页 第 7 题/)

  const legacy = describeStrokeEntry('wb_strokes_初三_数学_20260901_20260907_q3', '[{}]')
  assert.equal(legacy.legacy, true)
  assert.equal(legacy.strokeCount, 1)
  assert.match(legacy.label, /^旧格式板书 · /)

  // 脏数据（不是 JSON / 不是数组）→ strokeCount = null，必须与「确定是空」区分开
  assert.equal(describeStrokeEntry('wb_strokes_v2_x', 'not-json').strokeCount, null)
  assert.equal(describeStrokeEntry('wb_strokes_v2_x', '{"a":1}').strokeCount, null)
  assert.equal(describeStrokeEntry('wb_strokes_v2_x', '[]').strokeCount, 0)
})

test('listStrokeEntries：只收「真写过字」的板书键，按占用从大到小，bytes = 值长 + 键长', () => {
  const bigKey = `wb_strokes_v2_ws:1|p1|n1|s:${'甲'.repeat(40)}`
  const emptyKey = 'wb_strokes_v2_ws:1|p2|n2|s:没写过字的题'
  const dirtyKey = 'wb_strokes_v2_ws:1|p3|n3|s:脏数据'
  const storage = makeStorage({
    'weekendBoard:payload': 'x'.repeat(5000), // 不是板书，必须排除
    'wb_strokes_v2_ws:1|p1|n1|s:短': '[{}]',
    [bigKey]: JSON.stringify(Array.from({ length: 30 }, () => ({ points: [1] }))),
    'wb_strokes_初三_数学_20260901_20260907_q9': '[{}]',
    // ⛔ 切题时 saveStrokes() 会给「没写过字」的题留下 '[]' 空壳，不能灌进列表
    [emptyKey]: '[]',
    // 脏数据占着空间 → 必须留着让老师能删
    [dirtyKey]: 'not-json',
  })
  const entries = listStrokeEntries(storage)
  assert.equal(entries.length, 4, `非板书键 / 空壳键被算进来了：${entries.map((e) => e.key).join(' , ')}`)
  assert.ok(!entries.some((e) => e.key === emptyKey), "切题留下的 '[]' 空壳被列进来了")
  assert.ok(!entries.some((e) => e.key === 'weekendBoard:payload'), '非板书键被列进来了')
  assert.ok(entries.some((e) => e.key === dirtyKey), '脏数据没列出来 ⇒ 那部分空间永远删不掉')
  assert.equal(entries[0].key, bigKey, '占用最大的没排在前面')
  assert.deepEqual(entries.map((e) => e.bytes), [...entries.map((e) => e.bytes)].sort((a, b) => b - a))
  for (const e of entries) {
    const raw = storage.getItem(e.key)
    assert.equal(e.bytes, String(raw).length + e.key.length, '体积口径不一致')
  }
  // 旧格式也要能被清（否则永远腾不出那部分配额）
  assert.equal(entries.filter((e) => e.legacy).length, 1)
  // 畸形 storage 不能抛
  assert.deepEqual(listStrokeEntries(null), [])
  assert.deepEqual(listStrokeEntries({}), [])
})

test('summarizeStrokeEntries / formatBytes', () => {
  const s = summarizeStrokeEntries([
    { bytes: 100, legacy: false },
    { bytes: 200, legacy: true },
  ])
  assert.deepEqual(s, { count: 2, bytes: 300, legacyCount: 1 })
  assert.deepEqual(summarizeStrokeEntries(null), { count: 0, bytes: 0, legacyCount: 0 })

  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(1023), '1023 B')
  assert.equal(formatBytes(1024), '1.0 KB')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(1024 * 1024), '1.00 MB')
  assert.equal(formatBytes(-5), '0 B')
  assert.equal(formatBytes(null), '0 B')
})

/** 去掉 HTML 注释 / 块注释 / 整行行注释 —— 注释里提到 ElMessageBox 不算「用了它」 */
function stripComments(src) {
  return String(src)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')
}

const DIALOG_CODE = stripComments(DIALOG_SRC)

test('弹窗的文案不能承诺做不到的事（「屏幕上还留着」在父组件清了板面之后就是假的）', () => {
  assert.ok(!/屏幕上还留着/.test(DIALOG_CODE),
    '父组件收到 currentRemoved 后会连板面一起清，这句提示会与事实矛盾')
  assert.match(DIALOG_CODE, /一并清掉/, 'currentRemoved 的两条提示都要说明板面也清了')
  // 两条提示：单条删除 + 全部清空，各一处
  assert.equal((DIALOG_CODE.match(/一并清掉/g) || []).length, 2, '单条删除/全部清空各要有一条')
})

test('labelFromAnchor：认不出的锚点必须原样给出，不能显示成空白', () => {
  assert.equal(labelFromAnchor('A1'), 'A1')
  assert.equal(labelFromAnchor('ws:12|p1|n1'), '练习册题 · ws:12|p1|n1')
})

// ─────────────────────── ② 接线层（源码级锁） ───────────────────────

test('弹窗必须留在组件内（:append-to-body="false"），否则原生全屏看不见', () => {
  assert.match(DIALOG_CODE, /:append-to-body="false"/,
    'el-dialog 挂到 body 上后，原生全屏只渲染全屏元素及其子树 ⇒ 弹窗被整块盖住')
  // 提示不能用 ElMessage / ElMessageBox：同样落在全屏元素外（原生全屏下看不见）
  assert.ok(!/ElMessage(Box)?\s*[.(]/.test(DIALOG_CODE), '弹窗里真的用了 ElMessage/ElMessageBox')
  assert.match(DIALOG_CODE, /class="bs-hint"/, '缺少页内提示条')
})

test('白板必须把弹窗接上，并把当前题的键传进去', () => {
  assert.match(BOARD_SRC, /import BoardStorageDialog from '\.\.\/components\/BoardStorageDialog\.vue'/,
    '没有引入本机板书弹窗')
  assert.match(BOARD_SRC, /<BoardStorageDialog[\s\S]*?v-model="showStorage"/, '弹窗没绑 v-model')
  assert.match(BOARD_SRC, /<BoardStorageDialog[\s\S]*?:current-key="strokesKey"/,
    '没把当前题的板书键传进去 ⇒ 删到当前题时给不出正确提示、也不会连板面一起清')
  assert.match(BOARD_SRC, /<BoardStorageDialog[\s\S]*?@deleted="onStrokesDeleted"/, '没接 deleted 事件')
  assert.match(BOARD_SRC, /const showStorage = ref\(false\)/, '缺少 showStorage 状态')
  assert.match(BOARD_SRC, /@click="openStorage"/, '顶栏没有打开入口')
  assert.match(BOARD_SRC, /<el-icon><FolderOpened \/><\/el-icon>本机板书/, '顶栏入口按钮不见了')
})

test('openStorage：打开弹窗前必须先落盘，否则列表数字漏掉刚写的那一笔', () => {
  const body = codeOf(extractFn(BOARD_SRC, 'openStorage'))
  const cancelIdx = body.indexOf('clearTimeout(saveTimer)')
  const saveIdx = body.indexOf('saveStrokes()')
  const openIdx = body.indexOf('showStorage.value = true')
  assert.ok(cancelIdx >= 0, '没掐防抖定时器（那一笔会在弹窗打开后才落盘，列表对不上）')
  assert.ok(saveIdx >= 0, '没落盘：弹窗里的「已存 N 道题」会漏掉刚写的这一题')
  assert.ok(openIdx >= 0, '没打开弹窗')
  assert.ok(cancelIdx < saveIdx && saveIdx < openIdx, '顺序必须是 掐定时器 → 落盘 → 打开')
})

test('存储写满的提示必须指向新入口（否则老师不知道去哪清）', () => {
  const body = codeOf(extractFn(BOARD_SRC, 'saveStrokes'))
  assert.match(body, /板书没能存到本机/, '配额满的告警文案被改掉了')
  assert.match(body, /本机板书/, '告警只说「去导出」，没告诉老师新加的清理入口在哪')
})

test('onStrokesDeleted：删到当前题时必须连板面一起清，且先掐防抖定时器', () => {
  const body = codeOf(extractFn(BOARD_SRC, 'onStrokesDeleted'))
  const guard = body.indexOf('payload?.currentRemoved')
  assert.ok(guard >= 0, '没有按 currentRemoved 分流')
  const cancelIdx = body.indexOf('clearTimeout(saveTimer)')
  const clearIdx = body.indexOf('currentStrokes.value = []')
  assert.ok(cancelIdx >= 0, '没掐掉防抖保存 ⇒ 300ms 内刚写的那一笔会把键又写回来')
  assert.ok(clearIdx >= 0, '只删了存储、没清板面 ⇒ 离开这一题时 saveStrokes() 原样写回，等于没删')
  assert.ok(cancelIdx < clearIdx, '必须先掐定时器再清板面，顺序反了仍可能被写回')
  assert.ok(body.indexOf('redoStack.value = []') >= 0, '重做链没清（会撤销出已经删掉的板书）')
  assert.ok(body.indexOf('showHint(') >= 0, '删完没给老师反馈')
  // 不能顺手把「已讲」标记也抹了：标记与板书是两件事
  assert.ok(!/noteStrokes/.test(body), 'onStrokesDeleted 不该碰讲题标记')
})
