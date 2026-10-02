import fs from 'node:fs'
import path from 'node:path'
const ROOT = process.cwd()
const storesDir = path.join(ROOT, 'src/workbench/stores')
const viewsDirs = [path.join(ROOT, 'src/workbench/views'), path.join(ROOT, 'src/workbench/components')]

// 1. 每个 store 的导出键（setup return 块的顶层键）
function returnKeys(src) {
  const m = src.match(/\n\s*return\s*\{([\s\S]*?)\n\s*\}\s*\n?\}\)?\s*$/)
  if (!m) return new Set()
  const keys = new Set()
  for (const part of m[1].split(',')) {
    const k = part.trim().split(':')[0].trim()
    if (/^[A-Za-z_$][\w$]*$/.test(k)) keys.add(k)
  }
  return keys
}
const stores = {}
for (const f of fs.readdirSync(storesDir).filter(f => f.endsWith('.js') && f !== 'index.js')) {
  const src = fs.readFileSync(path.join(storesDir, f), 'utf8')
  const nameMatch = src.match(/defineStore\('([\w-]+)'/)
  stores[f] = { piniaId: nameMatch ? nameMatch[1] : f, keys: returnKeys(src), varNames: new Set() }
  // useXxxStore 函数名
  const fn = src.match(/export const (use\w+Store) =/)?.[1]
  if (fn) stores[f].fn = fn
}
// store 变量名 → store 文件（通过 useXxxStore 导入）
function walk(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(full))
    else if (/\.(vue|js)$/.test(e.name)) out.push(full)
  }
  return out
}
const findings = []
for (const file of [...walk(viewsDirs[0]), ...walk(viewsDirs[1])]) {
  const src = fs.readFileSync(file, 'utf8')
  const rel = path.relative(ROOT, file)
  // 该文件用到的 store：import { useXxxStore } from stores/xxx
  const usedStores = new Map()
  for (const m of src.matchAll(/import\s*\{\s*([\w$]+)\s*\}\s*from\s*'[^']*stores\/([\w-]+)\.js'/g)) {
    usedStores.set(m[1], m[2] + '.js')
  }
  for (const [fn, storeFile] of usedStores) {
    const st = stores[storeFile]
    if (!st) continue
    // 找实例变量名: const xxxStore = fn()
    for (const im of src.matchAll(new RegExp(`(?:const|let|var)\s+(\w*[Ss]tore\w*)\s*=\s*${fn}\(`, 'g'))) {
      const varName = im[1]
      // 直接属性读: varName.field
      for (const pm of src.matchAll(new RegExp(`(?<![\w$.])${varName}\.(\w+)`, 'g'))) {
        const field = pm[1]
        if (!st.keys.has(field) && !['$id','$onAction','$patch','$reset','$subscribe','loadData','setCurrentStudent'].includes(field)) {
          // 方法/字段都不在导出里
          findings.push(`${rel} → ${storeFile} 读未暴露字段 .${field}`)
        }
      }
      // 解构: const { a, b } = varName 或 storeToRefs(varName)
      for (const dm of src.matchAll(new RegExp(`(?:const|let)\s*\{([^}]*)\}\s*=\s*(?:storeToRefs\()\s*${varName}`, 'g'))) {
        for (const part of dm[1].split(',')) {
          const field = part.trim().split(':')[0].trim()
          if (field && !st.keys.has(field)) findings.push(`${rel} → ${storeFile} 解构未暴露字段 ${field}`)
        }
      }
    }
  }
}
console.log(findings.length ? findings.join('\n') : '（未发现同类哑弹）')
console.log('共', findings.length, '处')
