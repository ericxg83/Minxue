/**
 * 工作台「按钮点了没反应」锁（2026-10-04 第 92 轮）
 *
 * 与 `test/workbenchRouteTargets.test.mjs` 互补：那个查「跳到了不存在的路由」，
 * 这个查「模板里绑的处理函数在 script 里根本不存在」。
 *
 * 抓到的真家伙（第 92 轮修）：
 *   `ReviewWorkspace.vue` 重练卷「还不能复核」空态里的「查看错题池」按钮，
 *   绑的是 `goWrongBook`，而函数实际叫 `goToWrongBook`（同文件 136 行）。
 *   ⇒ 点了**完全没反应**，只在控制台留一条
 *     「Property "goWrongBook" was accessed during render but is not defined」告警。
 *
 * ⛔ 两个必须避开的误报源（第一版各踩过一次）：
 *   ① **模板边界**：JSDoc 用法示例里也有 `</template>`，直接 lastIndexOf 会把
 *      示例文字当成真模板（`WorkbenchDialog.vue` 因此误报 2 条）。
 *      ⇒ 先切掉 `<script>` 再在剩余部分里找模板。
 *   ② **`$emit` 与函数型 prop**：`@click="$emit('x')"` 是模板内建；
 *      `@click="onConfirm"` 里的 `onConfirm` 可能是 defineProps 声明的函数型 prop。
 *      ⇒ 两者都要认成「已定义」。
 *
 * 只读源码，不起浏览器。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 用空格替换注释（保留换行，行号才不会错） */
function stripComments(src) {
  return String(src)
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^([ \t]*)\/\/.*$/gm, (_m, indent) => indent)
}

/** 取真模板（下标与全文对齐）与 script 两段 */
function splitSFC(src) {
  // ⚠️ r167 修：旧版假定 `<template>` 一定写在 `<script>` 之前（只在前半段找模板），
  // 于是把 `<script setup>` 写在最前面的 SFC（components/diagnosis/*.vue 5 个）
  // 全部切不出模板 ⇒ 下面 `if (!template || !script) continue` 把它们**静默跳过**
  // —— 恰好是「点了没反应」这类锁最该覆盖的新组件（实测 57 个 SFC 只扫到 51 个）。
  // 改为：先在全文定位 script 段并遮成等长空格，再在剩余部分找模板。保留 r92 的教训
  // （JSDoc 用法示例里也有 `</template>`，必须先摘掉 script 才不会把示例当模板）。
  const s = src.search(/<script\b/)
  const sClose = s >= 0 ? src.indexOf('</script>', s) : -1
  const sEnd = sClose >= 0 ? sClose + '</script>'.length : -1
  const script = s >= 0 && sEnd > s ? src.slice(s, sEnd) : ''
  const masked = s >= 0 && sEnd > s ? src.slice(0, s) + ' '.repeat(sEnd - s) + src.slice(sEnd) : src
  const t = masked.indexOf('<template>')
  const tEnd = masked.lastIndexOf('</template>')
  const template = t >= 0 && tEnd > t ? ' '.repeat(t) + stripComments(src.slice(t, tEnd)) : ''
  return { template, script }
}

function definedNames(script) {
  const names = new Set()
  for (const m of script.matchAll(/\b(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  for (const m of script.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop().trim()
      if (n) names.add(n)
    }
  }
  for (const m of script.matchAll(/(?:const|let|var)\s*\{([^}]+)\}\s*=/g)) {
    for (const part of m[1].split(',')) {
      const n = part.split(':').pop().trim().replace(/=.*$/, '').trim()
      if (/^[A-Za-z_$][\w$]*$/.test(n)) names.add(n)
    }
  }
  for (const m of script.matchAll(/(?:const|let|var)\s*\[([^\]]+)\]\s*=/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim()
      if (/^[A-Za-z_$][\w$]*$/.test(n)) names.add(n)
    }
  }
  // 函数型 prop / emit 名也能直接绑 @click
  for (const m of script.matchAll(/defineProps\s*\(\s*\{([\s\S]*?)\}\s*\)/g)) {
    for (const p of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) names.add(p[1])
  }
  for (const m of script.matchAll(/defineEmits\s*\(\s*\[([\s\S]*?)\]\s*\)/g)) {
    for (const p of m[1].matchAll(/'([^']+)'/g)) names.add(p[1])
  }
  return names
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (name.endsWith('.vue')) out.push(full)
  }
  return out
}

const ALLOW = new Set(['true', 'false', 'null', 'undefined', 'Number', 'String', 'Boolean', 'Math', 'JSON'])

const HAS_TEMPLATE = /<template[\s>]/
const HAS_SCRIPT = /<script[\s>]/

/** 找出「@事件 绑的名字在 script 里不存在」的地方 */
function collectDeadHandlers() {
  const out = []
  const gaps = []
  let scanned = 0
  for (const file of walk(join(ROOT, 'src/workbench'))) {
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/')
    const src = readFileSync(file, 'utf8')
    const { template, script } = splitSFC(src)
    // r167：源码里明明有 <template> / <script> 却切不出来 ⇒ 是解析缺口，必须报出来，
    // 不能让这个文件被静默跳过（旧版就是靠 `continue` 吞掉了 6 个 SFC）。
    if (HAS_TEMPLATE.test(src) && !template) gaps.push(`${rel}: 有 <template> 但切不出模板`)
    if (HAS_SCRIPT.test(src) && !script) gaps.push(`${rel}: 有 <script> 但切不出脚本段`)
    if (!template || !script) continue
    scanned += 1
    const names = definedNames(script)
    const lineOf = (idx) => src.slice(0, idx).split('\n').length
    for (const m of template.matchAll(/@[a-z][\w.-]*\s*=\s*"([^"]*)"/g)) {
      const expr = m[1].trim()
      const fn = /^([A-Za-z_$][\w$]*)\s*\(/.exec(expr)
      const bare = /^([A-Za-z_$][\w$]*)$/.exec(expr)
      const name = fn ? fn[1] : (bare ? bare[1] : null)
      if (!name) continue
      if (name.startsWith('$') || ALLOW.has(name)) continue // 模板内建 / 全局
      if (!names.has(name)) out.push({ file: rel, line: lineOf(m.index), name, expr: expr.slice(0, 80) })
    }
  }
  return { out, scanned, gaps }
}

test('⛔ 工作台模板里绑的处理函数必须在 script 里存在（防「按钮点了没反应」）', () => {
  const { out, scanned, gaps } = collectDeadHandlers()
  // r167：解析缺口必须为零——源码里有 <template>/<script> 却切不出来的文件会被静默跳过，
  // 等于这些组件完全没被检查（旧版就漏了 6 个）。
  assert.deepEqual(gaps, [], '存在无法解析的 SFC：它们会被静默跳过，等于没被检查')
  // 地板值 = 解析覆盖率下限（不是组件数量配额）：
  //   r137（负责人裁决）「我的讲义」两个 SFC 下线，工作台 SFC 52→50，地板曾从 >50 调到 >=45。
  //   ⚠️ r167 教训：地板定成 45 时，提取器**静默漏掉 6 个 SFC** 仍然判绿 ⇒ 地板必须贴着
  //   真实覆盖率。当前 57 个 .vue 中 FilterBar 无 <script>（纯展示）合法跳过 ⇒ 应扫到 56，
  //   地板取 55（留 1 个合法无脚本组件的余量）。调低它之前请先确认不是解析器又漏文件了。
  assert.ok(scanned >= 55, `只扫到 ${scanned} 个 SFC（应为 56 上下），解析器疑似又漏文件了`)
  assert.deepEqual(
    out.map((f) => `${f.file}:${f.line} ${f.name} ← @event="${f.expr}"`),
    [],
    '存在模板绑定了、但 script 里没有的处理函数：点下去不会有任何反应（只有一条 Vue 告警）'
  )
})

test('splitSFC 必须能解析「<script setup> 写在最前面」的 SFC（r167 回归锁）', () => {
  // 旧版只在前半段（<script> 之前）找模板，于是 script-first 的组件全被静默跳过。
  const src = [
    '<script setup>',
    'const goToWrongBook = () => {}',
    '</script>',
    '',
    '<template>',
    '  <button @click="goWrongBook">查看错题池</button>',
    '</template>',
  ].join('\n')
  const { template, script } = splitSFC(src)
  assert.ok(template.includes('@click="goWrongBook"'), 'script-first 的模板没被切出来（会被静默跳过）')
  assert.ok(script.includes('goToWrongBook'), 'script 段没被切出来')
  // JSDoc 里出现 </template> 时不得被当成真模板（r92 的教训，这里一并锁住）
  const withDoc = [
    '<script>',
    '/** 用法：<template>...</template> 示例 */',
    'const x = 1',
    '</script>',
    '<template><button @click="x" /></template>',
  ].join('\n')
  const r2 = splitSFC(withDoc)
  assert.ok(!r2.template.includes('用法：'), 'JSDoc 示例被当成真模板了')
  assert.ok(r2.template.includes('@click="x"'), '真模板没被切出来')
})

test('ReviewWorkspace 的「查看错题池」绑的是真实存在的函数名', () => {
  // 这条单列出来：它已经真实发生过一次（绑 goWrongBook，函数叫 goToWrongBook）
  const src = readFileSync(join(ROOT, 'src/workbench/components/review/ReviewWorkspace.vue'), 'utf8')
  const { template } = splitSFC(src)
  assert.ok(!/@click="goWrongBook"/.test(template), '又绑回不存在的 goWrongBook 了')
  assert.match(src, /const goToWrongBook\s*=/, 'goToWrongBook 函数本身没了，判据要跟着改')
  assert.match(template, /@click="goToWrongBook"/, '「查看错题池」应该绑 goToWrongBook')
})
