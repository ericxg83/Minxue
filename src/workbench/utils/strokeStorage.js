/**
 * 板书本机存储的清点工具（2026-10-03 第 89 轮）
 * ==============================================
 * 背景：板书按「题目稳定锚点」一条 localStorage 键**永久存在**，全仓没有任何清理逻辑
 * （`WeekendBoard` / `DrawingCanvas` 里零 `removeItem`）。5MB 配额迟早写满 —— 第 87 轮
 * 把体积瘦掉约一半（~55 题），写满时也已经不静默（页内提示去导出），但**没有回收手段**：
 * 老师只能清浏览器数据（会连其它本地缓存一起清掉）。
 *
 * 本轮补的入口是「把回收权交给老师」：能看到占了多少、都是哪些题、逐条或一次清掉。
 * 本模块只做**纯计算**（键 → 可读标签 / 体积 / 汇总），不碰 localStorage —— 存储对象由
 * 调用方注入，这样可以在 node 里用假 storage 直接测。
 *
 * ⛔ 两个前缀都要认：`wb_strokes_v2_` 是当前格式，`wb_strokes_` 是迁移期的旧格式
 *    （旧键仍占配额，必须也能被清）。判断顺序不能反 —— v2 键也以旧前缀开头。
 */

export const STROKES_KEY_PREFIX = 'wb_strokes_v2_'
export const LEGACY_STROKES_KEY_PREFIX = 'wb_strokes_'

/** 该 localStorage 键是不是一条板书（新旧两种格式都算） */
export function isStrokeKey(key) {
  const k = String(key || '')
  return k.startsWith(STROKES_KEY_PREFIX) || k.startsWith(LEGACY_STROKES_KEY_PREFIX)
}

/** 把 `ws:12|p45|n7|s:如图在三角形abc中…` 这类锚点翻成老师看得懂的一句话 */
export function labelFromAnchor(anchor) {
  const a = String(anchor || '')
  // 超长锚点在落盘时被截断成 `<前100字>~<fnv1a>`，展示时把哈希尾巴去掉
  const tilde = a.lastIndexOf('~')
  const head = tilde > 0 && a.length - tilde <= 9 ? a.slice(0, tilde) : a

  if (head.startsWith('ws:')) {
    // 练习册：ws:<worksheet_id>|p<页码>|n<题号>|s:<题干指纹>
    const m = head.match(/^ws:[^|]*\|p([^|]*)\|n([^|]*)\|s:(.*)$/)
    if (m) {
      const stem = m[3].replace(/\s+/g, '').slice(0, 18)
      return `练习册 第 ${m[1]} 页 第 ${m[2]} 题${stem ? ' · ' + stem : ''}`
    }
    return '练习册题 · ' + head.slice(0, 30)
  }
  if (head.startsWith('topic:')) {
    const stem = head.slice('topic:'.length).replace(/\s+/g, '').slice(0, 22)
    return `题干：${stem || '(空)'}`
  }
  if (head.startsWith('self:')) {
    return '题面未识别 · ' + head.slice(0, 28)
  }
  return head.slice(0, 34) || '(空锚点)'
}

/**
 * 一条键 → { key, label, bytes, legacy, strokeCount }
 *
 * ⛔ `strokeCount` 为什么必须有：`saveStrokes()` 在**每次切题**时都会写一次，
 *    没写过字的题也会留下一条 `'[]'`（约 15 B）。不过滤的话，这个列表会被
 *    「其实没写过字」的题灌满，老师看到的「已存 N 道题」全是假的。
 *    `null` = 内容不是合法笔迹数组（脏数据），**保留并展示** —— 它确实占着空间，
 *    得让老师能删掉；不能和「确定是空」混为一谈。
 *
 * @param {string} key
 * @param {string} rawValue 该键的原始字符串
 */
export function describeStrokeEntry(key, rawValue) {
  const k = String(key || '')
  const legacy = !k.startsWith(STROKES_KEY_PREFIX) && k.startsWith(LEGACY_STROKES_KEY_PREFIX)
  const anchor = legacy
    ? k.slice(LEGACY_STROKES_KEY_PREFIX.length)
    : k.slice(STROKES_KEY_PREFIX.length)
  const raw = String(rawValue ?? '')
  let strokeCount = null
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) strokeCount = parsed.length
  } catch { /* 脏数据：保持 null */ }
  return {
    key: k,
    // 旧格式是「时段+题序号」，没有题目信息，只能照原样给出来
    label: legacy ? `旧格式板书 · ${anchor.slice(0, 30)}` : labelFromAnchor(anchor),
    bytes: raw.length,
    legacy,
    strokeCount,
  }
}

/** localStorage 的键占多少字符（近似字节数；localStorage 按 UTF-16 计，这里只用于「谁占得多」的排序） */
function keyCost(key) {
  return String(key || '').length
}

/**
 * 清点全部板书键，按占用从大到小排序。
 * ⛔ 只列「真的写过字」的（`strokeCount !== 0`）：切题留下的 `'[]'` 空壳不列。
 * @param {{ key: (i:number)=>string, length:number, getItem:(k:string)=>string|null }} storage
 */
export function listStrokeEntries(storage) {
  if (!storage || typeof storage.key !== 'function' || typeof storage.getItem !== 'function') return []
  const out = []
  const n = Number(storage.length) || 0
  for (let i = 0; i < n; i += 1) {
    const k = storage.key(i)
    if (!k || !isStrokeKey(k)) continue
    const raw = storage.getItem(k)
    const entry = describeStrokeEntry(k, raw)
    if (entry.strokeCount === 0) continue
    entry.bytes += keyCost(k)
    out.push(entry)
  }
  return out.sort((a, b) => b.bytes - a.bytes)
}

/** 汇总：题数 + 总占用 */
export function summarizeStrokeEntries(entries) {
  const list = Array.isArray(entries) ? entries : []
  return {
    count: list.length,
    bytes: list.reduce((sum, e) => sum + (Number(e?.bytes) || 0), 0),
    legacyCount: list.filter((e) => e?.legacy).length,
  }
}

/** 人类可读体积：<1KB 显示 B，<1MB 显示 KB 一位小数，否则 MB 两位小数 */
export function formatBytes(bytes) {
  const n = Math.max(0, Number(bytes) || 0)
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}
