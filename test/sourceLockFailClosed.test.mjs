/**
 * 源码级回归锁的「元判据」：禁止会静默失效（fail-open）的写法（r167）
 *
 * 背景（本仓真实踩过）：
 *   源码锁最省事的写法是「先找锚点，再断言」：
 *     const i = src.indexOf('xxx')
 *     if (i >= 0 && !src.slice(i, i + 300).includes('Y')) fails.push('...')
 *   锚点 'xxx' 一旦被改名 / 移动 / 删除，i 就是 -1，`i >= 0 &&` 短路 ⇒ **不报错**。
 *   结果是：**把代码改坏的那次重构，会顺手把盯着它的锁一起关掉**，
 *   门禁「看着是绿的，其实什么都没查」——比假红危险得多（假红至少会被人发现）。
 *
 *   同类还有切片窗口两端都来自 indexOf 的写法：
 *     const fn = src.slice(src.indexOf(a), src.indexOf(b))
 *     if (fn.length > 0 && !fn.includes(GUARD)) fails.push('...')
 *   a / b 任一缺失时 fn 为空串或一段无意义文本 ⇒ 同样静默通过。
 *
 * 判据：test/ 下任何 *.test.mjs 里，凡是「indexOf 派生变量被用作短路守卫」
 * （`X >= 0 && ...slice(...)` 或 slice 派生变量的 `X.length > 0 &&`），
 * 必须同时存在「锚点不在就记失败」的分支（`if (X < 0)` 且其邻域内有
 * fails.push / assert / throw）。否则判红。
 *
 * 正确写法：用 `test/sourceLockKit.mjs` 的 `anchoredSlice` / `anchoredRange`，
 * 锚点缺失时它们会自己往 fails 里记一条。
 *
 * 反向自检：`test/fixtures/failOpenLockSample.txt` 是一份故意写坏的合成样本，
 * 探测器必须能报出 ≥2 条（证明判据不是空锁）。样本放 fixtures 而不是内联，
 * 是为了让本文件自己也能被扫（本文件正文里不许出现坏写法，注释里的说明会被剔除）。
 *
 * ⚠️ 另一类失效（「一次纯格式化把锁打成假红」，2026-10-06 `2a5ab25` 侧栏深色母版真实踩过：
 *   navGroups 从单行拆成多行，语义一字未改，却让 3 把侧栏锁同红）**不在这里扫**——
 *   试过写成文本规则（拦「紧凑配置字面量 `键:'值'`」），但正则无法可靠区分「同一个字符串字面量」
 *   与「相邻两个字面量」，实测对 `includes('difficulty:')` 等无关写法大量误报（误报本身就是假红）。
 *   ⇒ 改用**行为级**守卫：见 `test/resourceFold.test.mjs` 末尾的「打乱空白后结论不变」测试。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TEST_DIR = join(ROOT, 'test')

/** 剔掉注释：整行 `//` 与块注释。注释里会引用坏写法当反面教材（r148 已踩过这个坑）。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

/** `const x = <expr>.indexOf(...)` / `.lastIndexOf(...)` —— 会返回 -1 的锚点变量 */
const ANCHOR_DERIVED = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=[^\n]*\.(?:indexOf|lastIndexOf)\(/g
/** `const x = <expr>.slice(<...>.indexOf(...), ...)` —— 窗口边界来自锚点的切片变量 */
const SLICE_OF_ANCHOR = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=[^\n]*\.slice\([^\n]*\.(?:indexOf|lastIndexOf)\(/g

function collect(re, src) {
  const out = new Set()
  let m
  re.lastIndex = 0
  while ((m = re.exec(src))) out.add(m[1])
  return out
}

/**
 * 该变量有没有「锚点不在 ⇒ 记失败」的兜底分支。
 * ⚠️ 必须限定成 **if 语句**里的 `X < 0`：三元兜底 `const seg = X < 0 ? '' : ...`
 * 不是失败分支（它正是 fail-open 的一半），早先版本用裸 `\bX\s*<\s*0\b` 匹配，
 * 会把三元里的 `X < 0` 误认成兜底 ⇒ 规则C 永远不触发（元判据自己踩了坑）。
 */
function hasAnchorMissFailure(body, id) {
  const lines = body.split('\n')
  const re = new RegExp(`\\bif\\s*\\([^\\n]*\\b${id}\\s*<\\s*0\\b`)
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue
    const near = lines.slice(i, i + 4).join('\n')
    if (/fails?\.push\(|failures\.push\(|gaps\.push\(|assert\.|throw /.test(near)) return true
  }
  return false
}

/**
 * 扫一份源码，返回 fail-open 违规清单。纯函数，便于反向自检喂合成样本。
 * @returns {string[]} 形如 `L12 [规则A] i = ...`
 */
export function scanFailOpen(src, filename = '(inline)') {
  const body = stripComments(src)
  const violations = []
  const anchors = collect(ANCHOR_DERIVED, body)
  const slices = collect(SLICE_OF_ANCHOR, body)
  const lines = body.split('\n')

  for (const id of anchors) {
    // 规则 A：`if (X >= 0 && !<...>.slice(...))` —— 锚点缺失即短路
    const guardA = new RegExp(`\\b${id}\\s*>=\\s*0\\s*&&`)
    // 规则 B：切片变量的 `X.length > 0 &&` —— 锚点缺失即切出空串
    const guardB = new RegExp(`\\b${id}\\.length\\s*>\\s*0\\s*&&`)
    // 规则 C：X 在别处有「缺失即取中性值」的三元兜底（`X < 0 ? '' : ...`），
    // 却又用 `if (X >= 0 && ...)` 守卫断言 —— 锚点缺失时切出空串 + 守卫短路，双保险失效。
    // 例：const seg = bi < 0 ? '' : page.slice(bi, bi + 400)
    //     if (bi >= 0 && !seg.includes('!hasReportData')) fails.push(...)
    const ternaryFallback = new RegExp(`\\b${id}\\s*<\\s*0\\s*\\?`)
    lines.forEach((line, n) => {
      const isA = guardA.test(line) && line.includes('.slice(')
      const isB = slices.has(id) && guardB.test(line)
      const isC = guardA.test(line) && ternaryFallback.test(body)
      if (!isA && !isB && !isC) return
      if (hasAnchorMissFailure(body, id)) return
      violations.push(
        `${filename}:${n + 1} [${isA ? '规则A' : isB ? '规则B' : '规则C'}] ${id} 被用作短路守卫但无「锚点不在即失败」兜底` +
          ` —— 锚点一改，锁就静默失效`
      )
    })
  }

  return violations
}

// ─────────────────────────── ① 当前树必须零违规 ───────────────────────────

test('⛔ 源码锁不得静默失效：test/ 全量零违规', () => {
  const files = readdirSync(TEST_DIR)
    .filter((f) => f.endsWith('.test.mjs'))
    .sort()
  assert.ok(files.length > 100, `扫到的测试文件太少（${files.length}），判据可能失效`)

  const violations = []
  for (const f of files) {
    violations.push(...scanFailOpen(readFileSync(join(TEST_DIR, f), 'utf8'), f))
  }
  assert.deepEqual(
    violations,
    [],
    `\n发现 ${violations.length} 处会静默失效的源码锁：\n` +
      violations.map((v) => `  - ${v}`).join('\n') +
      `\n改用 test/sourceLockKit.mjs 的 anchoredSlice / anchoredRange。`
  )
})

// ─────────────────────────── ② 反向自检：探测器非空锁 ───────────────────────────

test('锁健全性：判据套故意写坏的合成样本必须判红', () => {
  const sample = readFileSync(join(TEST_DIR, 'fixtures', 'failOpenLockSample.txt'), 'utf8')
  const hits = scanFailOpen(sample, 'fixtures/failOpenLockSample.txt')
  // 样本里三处坏写法（规则A / 规则B / 规则C 各一处）都必须被抓到
  assert.ok(hits.length >= 3, `合成坏样本应报 ≥3 处，实际 ${hits.length} —— 元判据可能是空锁`)
  assert.ok(hits.some((h) => h.includes('规则A')), '规则A（X >= 0 && ...slice）未被检出')
  assert.ok(hits.some((h) => h.includes('规则B')), '规则B（slice 变量的 .length > 0 &&）未被检出')
  assert.ok(hits.some((h) => h.includes('规则C')), '规则C（X < 0 ? 空串兜底 + X >= 0 && 守卫）未被检出')
})

test('锁健全性：正确的 anchoredSlice 写法不得被误报', () => {
  const good = [
    "import { anchoredSlice } from './sourceLockKit.mjs'",
    "const seg = anchoredSlice(app, \"console.error('初始化失败:', error)\", 300, LABEL, fails)",
    'if (seg !== null && !seg.includes(\'Toast.show\')) fails.push(LABEL)',
    // 非锚点变量的短路守卫不该被误伤（坐标 / 日志位置等）
    'const logIdx = body.lastIndexOf("console.log")',
    'if (logIdx >= 0 && exitIdx >= 0 && exitIdx < logIdx) fails.push("截断")',
  ].join('\n')
  assert.deepEqual(scanFailOpen(good, '(good)'), [], '正确写法被误报')
})
