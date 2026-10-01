/**
 * 通用回归锁（2026-10-01，消化 09-29 巡检提名）：
 * 工作台全部 store 调用的 apiService 导出函数，必须已被导入。
 *
 * 背景：growthStore.js 曾调用 getQuestionsByIds 却漏写 import——代码不报错，
 * 直到某个学生恰好带 question_ids 才整页空白（ReferenceError → catch 清空全部数据）。
 * 本锁把该缺陷类从「单点盯防」升级为「全量扫描」：任何 store 再次出现
 * 调用未导入的 apiService 函数，测试即红。
 *
 * 规则（防误报）：
 *  1. 仅检查「以函数调用形式」使用（name( ）的导出符号；
 *  2. 同文件本地定义（const/let/var/function）视为已覆盖；
 *  3. import * as ns 形式的命名空间导入视为全覆盖；
 *  4. import { a as b } 取别名后按本地名检查。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const API_SRC = fs.readFileSync(path.join(ROOT, 'src/services/apiService.js'), 'utf8')
const STORES_DIR = path.join(ROOT, 'src/workbench/stores')

// ── 收集 apiService 的全部导出名 ──
const apiExports = new Set()
for (const m of API_SRC.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) apiExports.add(m[1])
for (const m of API_SRC.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)/g)) apiExports.add(m[1])
for (const m of API_SRC.matchAll(/export\s*\{([^}]*)\}/gs)) {
  for (const part of m[1].split(',')) {
    const name = part.trim().split(/\s+as\s+/).pop()?.trim()
    if (name && /^[A-Za-z_$][\w$]*$/.test(name)) apiExports.add(name)
  }
}

function importedNames(src, importPathPattern) {
  const names = new Set()
  for (const m of src.matchAll(new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*['"][^'"]*${importPathPattern}['"]`, 'g'))) {
    for (const part of m[1].split(',')) {
      const local = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (local) names.add(local)
    }
  }
  return names
}

test('workbench 全部 store：调用的 apiService 函数必须已导入（漏 import = 成长中心式整页空白）', () => {
  const failures = []
  const storeFiles = fs.readdirSync(STORES_DIR).filter(f => f.endsWith('.js') && f !== 'index.js')

  for (const file of storeFiles) {
    const src = fs.readFileSync(path.join(STORES_DIR, file), 'utf8')
    // 命名空间导入视为全覆盖
    if (/import\s*\*\s*as\s+\w+\s+from\s*['"][^'"]*apiService['"]/.test(src)) continue
    const imported = importedNames(src, 'apiService')
    // 同文件本地定义（含从其他模块导入的同名符号）不视为漏
    const locallyDefined = new Set()
    for (const m of src.matchAll(/(?:\bconst\b|\blet\b|\bvar\b|\bfunction\b)\s+([A-Za-z_$][\w$]*)/g)) locallyDefined.add(m[1])
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"][^'"][^'"]*['"]/g)) {
      for (const part of m[1].split(',')) {
        const local = part.trim().split(/\s+as\s+/).pop()?.trim()
        if (local) locallyDefined.add(local)
      }
    }
    // 解构绑定：const { a, b } = ...（含 await import('...') 动态导入的解构，questionStore 实测用此形态）
    for (const m of src.matchAll(/(?:\bconst\b|\blet\b|\bvar\b)\s*\{([^}]*)\}\s*=/g)) {
      for (const part of m[1].split(',')) {
        const local = part.trim().split(/\s*:\s*/).pop()?.trim().split(/\s*=\s*/)[0]?.trim()
        if (local && /^[A-Za-z_$][\w$]*$/.test(local)) locallyDefined.add(local)
      }
    }
    // 函数参数 / 箭头函数参数（依赖注入形态的本地绑定）
    const collectParams = (raw) => {
      for (const part of raw.split(',')) {
        const local = part.trim().replace(/\.\.\./, '').split(/\s*=\s*/)[0]?.trim()
        if (local && /^[A-Za-z_$][\w$]*$/.test(local)) locallyDefined.add(local)
      }
    }
    for (const m of src.matchAll(/function\s*[A-Za-z_$][\w$]*\s*\(([^()]*)\)/g)) collectParams(m[1])
    for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g)) collectParams(m[1])

    for (const name of apiExports) {
      if (imported.has(name) || locallyDefined.has(name)) continue
      const callRe = new RegExp(`(?<![\\w$.])${name}\\s*\\(`)
      if (callRe.test(src)) failures.push(`${file}：调用了 apiService.${name}() 但未导入 —— 该调用路径一旦触发即 ReferenceError 整页空白`)
    }
  }

  assert.deepEqual(
    failures,
    [],
    `\n发现 ${failures.length} 处「调用未导入」：\n${failures.map(f => `  - ${f}`).join('\n')}`
  )
})

test('apiService 导出符号解析健全性（防本锁静默失效）', () => {
  assert.ok(apiExports.size > 50, `apiService 应有大量导出，仅解析到 ${apiExports.size} 个，正则可能失配`)
  assert.ok(apiExports.has('getQuestionsByIds'), '关键符号 getQuestionsByIds 未被解析到')
})
