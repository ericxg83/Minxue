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
/**
 * r152 修复（真缺陷，实测）：本文件原先把正则写成**普通模板字面量**，
 * 而模板字面量会吃掉反斜杠 —— `\s` 变 `s`、`\w` 变 `w`、`\(` 变 `(`，
 * 于是 `new RegExp(\`…\s*${fn}\(\`)` 生成的模式是 `…s*useXxxStore(`，
 * 括号永不闭合 ⇒ 第一个 store 就抛 `SyntaxError: Invalid regular expression: … Unterminated group`。
 * 实测：`node scripts/auditStoreContract.mjs` 直接崩、一条结果都出不来（该脚本自 a7ace3e
 * 首次提交起就是坏的，因为恒退 0 而没人发现）。修法：改用 `String.raw` 保住反斜杠，
 * 插值部分另行转义。**任何把变量插进 RegExp 的地方都必须这样写。**
 */
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
    for (const im of src.matchAll(new RegExp(String.raw`(?:const|let|var)\s+(\w*[Ss]tore\w*)\s*=\s*${escapeRe(fn)}\(`, 'g'))) {
      const varName = im[1]
      // 直接属性读: varName.field
      // ⛔ 排除集里必须带上 `/` 与引号：否则 `import { useDemoStore } from '../stores/demoStore.js'`
      //    这行里的 `demoStore.js` 会被当成「读未暴露字段 .js」误报（实测踩到）。
      for (const pm of src.matchAll(new RegExp(String.raw`(?<![\w$./'"])${escapeRe(varName)}\.(\w+)`, 'g'))) {
        const field = pm[1]
        if (!st.keys.has(field) && !['$id','$onAction','$patch','$reset','$subscribe','loadData','setCurrentStudent'].includes(field)) {
          // 方法/字段都不在导出里
          findings.push(`${rel} → ${storeFile} 读未暴露字段 .${field}`)
        }
      }
      // 解构: const { a, b } = varName 或 storeToRefs(varName)
      for (const dm of src.matchAll(new RegExp(String.raw`(?:const|let)\s*\{([^}]*)\}\s*=\s*(?:storeToRefs\()?\s*${escapeRe(varName)}`, 'g'))) {
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
// r152：审计工具必须「有发现即非零退出」。旧版只打印条数、恒退 0 ⇒ 一旦被串进 `&&` /
// 自动化（或未来接进常驻巡检）就是假绿：明明扫出「读未暴露字段」的哑弹也算通过。
process.exit(findings.length === 0 ? 0 : 1)
