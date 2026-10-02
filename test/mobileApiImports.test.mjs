/**
 * 移动端导入锁（2026-10-02）：src/（除 workbench，另有三锁专管）范围内，
 * 凡调用 apiService 导出函数而未导入的文件即红——与 workbenchStoreImports 同源缺陷类
 * （growthStore 式 ReferenceError 整页空白）在移动端的镜像覆盖。
 *
 * 规则（防误报，与工作台锁一致）：
 *  1. 仅检查「函数调用形式」使用的导出符号；
 *  2. 本地声明 / 解构绑定 / 函数参数 / 从其他模块导入的同名符号均视为已覆盖；
 *  3. import * as ns 命名空间导入视为全覆盖；
 *  4. 只扫 .js/.jsx，跳过 workbench 子树。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC_DIR = path.join(ROOT, 'src')
const API_SRC = fs.readFileSync(path.join(ROOT, 'src/services/apiService.js'), 'utf8')

const apiExports = new Set()
for (const m of API_SRC.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) apiExports.add(m[1])
for (const m of API_SRC.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)/g)) apiExports.add(m[1])
for (const m of API_SRC.matchAll(/export\s*\{([^}]*)\}/gs)) {
  for (const part of m[1].split(',')) {
    const name = part.trim().split(/\s+as\s+/).pop()?.trim()
    if (name && /^[A-Za-z_$][\w$]*$/.test(name)) apiExports.add(name)
  }
}

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
  // 类方法链上的解构（如 const { a } = this.props）已被上面解构规则覆盖
}

function collectFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'workbench') continue // 工作台另有三锁专管
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectFiles(full))
    else if (/\.(js|jsx)$/.test(entry.name) && !/\.bak/.test(entry.name)) out.push(full)
  }
  return out
}

test('移动端（src/ 非 workbench）：调用的 apiService 函数必须已导入', () => {
  const failures = []
  for (const file of collectFiles(SRC_DIR)) {
    const src = fs.readFileSync(file, 'utf8')
    if (/import\s*\*\s*as\s+\w+\s+from\s*['"][^'"]*apiService['"]/.test(src)) continue
    const imported = new Set()
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*apiService['"]/g)) {
      for (const part of m[1].split(',')) {
        const local = part.trim().split(/\s+as\s+/).pop()?.trim()
        if (local) imported.add(local)
      }
    }
    const locallyDefined = new Set()
    collectLocalNames(src, locallyDefined)
    for (const name of apiExports) {
      if (imported.has(name) || locallyDefined.has(name)) continue
      const callRe = new RegExp(`(?<![\\w$.])${name}\\s*\\(`)
      if (callRe.test(src)) {
        failures.push(`${path.relative(ROOT, file)}：调用了 apiService.${name}() 但未导入`)
      }
    }
  }
  assert.deepEqual(
    failures,
    [],
    `\n发现 ${failures.length} 处「调用未导入」：\n${failures.map(f => `  - ${f}`).join('\n')}`
  )
})

test('锁健壮性：apiService 导出解析量与关键符号', () => {
  assert.ok(apiExports.size > 50, `apiService 应有大量导出，仅解析到 ${apiExports.size} 个`)
})
