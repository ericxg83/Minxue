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
  const scriptStart = src.search(/<script\b/)
  const head = scriptStart >= 0 ? src.slice(0, scriptStart) : src
  const t = head.indexOf('<template>')
  const tEnd = head.lastIndexOf('</template>')
  const template = t >= 0 && tEnd > t ? ' '.repeat(t) + stripComments(head.slice(t, tEnd)) : ''
  const s = src.indexOf('<script')
  const sEnd = src.lastIndexOf('</script>')
  return { template, script: s >= 0 && sEnd > s ? src.slice(s, sEnd) : '' }
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

/** 找出「@事件 绑的名字在 script 里不存在」的地方 */
function collectDeadHandlers() {
  const out = []
  let scanned = 0
  for (const file of walk(join(ROOT, 'src/workbench'))) {
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/')
    const src = readFileSync(file, 'utf8')
    const { template, script } = splitSFC(src)
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
  return { out, scanned }
}

test('⛔ 工作台模板里绑的处理函数必须在 script 里存在（防「按钮点了没反应」）', () => {
  const { out, scanned } = collectDeadHandlers()
  // 地板值只防「提取器整体失效」，不是组件数量配额：
  // r137（负责人裁决）「我的讲义」两个 SFC（HandoutList / HandoutPreview）下线，
  // 工作台 SFC 从 52 降到 50；地板随之从 >50 调为 >=45（仍远高于半途失效的常见读数）。
  assert.ok(scanned >= 45, `只扫到 ${scanned} 个 SFC，提取器疑似失效`)
  assert.deepEqual(
    out.map((f) => `${f.file}:${f.line} ${f.name} ← @event="${f.expr}"`),
    [],
    '存在模板绑定了、但 script 里没有的处理函数：点下去不会有任何反应（只有一条 Vue 告警）'
  )
})

test('ReviewWorkspace 的「查看错题池」绑的是真实存在的函数名', () => {
  // 这条单列出来：它已经真实发生过一次（绑 goWrongBook，函数叫 goToWrongBook）
  const src = readFileSync(join(ROOT, 'src/workbench/components/review/ReviewWorkspace.vue'), 'utf8')
  const { template } = splitSFC(src)
  assert.ok(!/@click="goWrongBook"/.test(template), '又绑回不存在的 goWrongBook 了')
  assert.match(src, /const goToWrongBook\s*=/, 'goToWrongBook 函数本身没了，判据要跟着改')
  assert.match(template, /@click="goToWrongBook"/, '「查看错题池」应该绑 goToWrongBook')
})
