/**
 * Vue 模板层静态锁（2026-10-01，首扫）：
 * 工作台 71 个 .vue 的 <template> 此前完全不在任何检查闸内（缺 eslint-plugin-vue），
 * 2026-07-21 的「模板调用 script 里不存在的函数」事故同形态缺陷至今抓不到。
 *
 * 本锁采用窄规则控制误报：只检查模板表达式中的「裸标识符(」调用形态
 * （事件处理器、插值内函数调用）——这正是事故形态；v-for 局部变量、
 * 属性链访问（a.b()）不在检查范围，避免噪声淹没信号。
 * 白名单：JS 全局、$ 开头（$emit/$event 等 Vue 实例成员）、script 中的全部绑定
 * （导入/声明/解构/函数参数）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const WB_DIR = path.join(ROOT, 'src/workbench')

const JS_GLOBALS = new Set([
  'Math', 'Date', 'JSON', 'Number', 'String', 'Boolean', 'Array', 'Object',
  'console', 'window', 'document', 'localStorage', 'sessionStorage', 'navigator',
  'location', 'isNaN', 'parseInt', 'parseFloat', 'encodeURIComponent',
  'decodeURIComponent', 'setTimeout', 'setInterval', 'clearTimeout',
  'clearInterval', 'Promise', 'Set', 'Map', 'Error', 'alert', 'confirm',
  'history', 'requestAnimationFrame', 'Intl', 'URL', 'URLSearchParams',
  'FormData', 'Blob', 'File', 'FileReader', 'btoa', 'atob', 'structuredClone',
  'crypto', 'performance', 'RegExp', 'Symbol'
])

function collectLocalNames(src, names) {
  for (const m of src.matchAll(/import\s+(?:([A-Za-z_$][\w$]*)\s*,\s*)?(?:\{([^}]*)\}\s*)?from\s*['"][^'"]+['"]/g)) {
    if (m[1]) names.add(m[1])
    if (m[2]) for (const part of m[2].split(',')) {
      const local = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (local && /^[A-Za-z_$][\w$]*$/.test(local)) names.add(local)
    }
  }
  for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s*['"]/g)) names.add(m[1])
  for (const m of src.matchAll(/(?:\bconst\b|\blet\b|\bvar\b|\bfunction\b)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  for (const m of src.matchAll(/(?:\bconst\b|\blet\b|\bvar\b)\s*\{([^}]*)\}\s*=/gs)) {
    for (const part of m[1].split(',')) {
      const seg = part.split(':').pop()?.trim().split(/\s*=\s*/)[0]?.trim()
      if (seg && /^[A-Za-z_$][\w$]*$/.test(seg)) names.add(seg)
    }
  }
  const collectParams = (raw) => {
    for (const part of raw.split(',')) {
      const local = part.trim().replace(/\.\.\./, '').split(/\s*=\s*/)[0]?.trim()
      if (local && /^[A-Za-z_$][\w$]*$/.test(local)) names.add(local)
    }
  }
  for (const m of src.matchAll(/function\s*[A-Za-z_$][\w$]*\s*\(([^()]*)\)/g)) collectParams(m[1])
  for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g)) collectParams(m[1])
}

function collectVueFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectVueFiles(full))
    else if (entry.name.endsWith('.vue')) out.push(full)
  }
  return out
}

test('workbench 全部 .vue：模板中调用的函数必须在 script 中有绑定', () => {
  const failures = []
  for (const file of collectVueFiles(WB_DIR)) {
    const src = fs.readFileSync(file, 'utf8')
    const scriptMatch = src.match(/<script[^>]*>([\s\S]*?)<\/script>/)
    const templateMatch = src.match(/<template[^>]*>([\s\S]*)<\/template>/)
    if (!scriptMatch || !templateMatch) continue
    const bindings = new Set()
    collectLocalNames(scriptMatch[1], bindings)
    const template = templateMatch[1]

    const exprs = []
    for (const m of template.matchAll(/\{\{([\s\S]*?)\}\}/g)) exprs.push(m[1])
    for (const m of template.matchAll(/(?:v-[\w:[\].-]+|:[\w.-]+|@[\w.]+)\s*=\s*"([^"]*)"/g)) exprs.push(m[1])

    const KEYWORDS = new Set(['in', 'of', 'typeof', 'instanceof', 'new', 'delete', 'void', 'await', 'catch'])
    const rel = path.relative(ROOT, file)
    for (const expr of exprs) {
      // 剥掉字符串字面量（'var(--x)'、`translateY(...)` 等 CSS/文本内容不是 JS 调用）
      const clean = expr.replace(/`[^`]*`/g, "''").replace(/'[^']*'/g, "''").replace(/\/\/[^\n]*/g, '')
      for (const m of clean.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) {
        const id = m[1]
        if (bindings.has(id) || JS_GLOBALS.has(id) || KEYWORDS.has(id) || id.startsWith('$')) continue
        failures.push(`${rel}：模板调用了 script 中不存在的「${id}()」——表达式：${expr.trim().slice(0, 80)}`)
      }
    }
  }
  assert.deepEqual(
    failures,
    [],
    `\n发现 ${failures.length} 处模板引用未定义函数：\n${failures.map(f => `  - ${f}`).join('\n')}`
  )
})
