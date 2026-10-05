/**
 * r152 回归锁：`scripts/auditStoreContract.mjs`（store 契约审计）必须**真能跑、真能检出**。
 *
 * 真缺陷（实测取证）：该脚本自 a7ace3e（2026-10-02）首次提交起就是**坏的** ——
 * 它把正则写在**普通模板字面量**里，而模板字面量会吃掉反斜杠（`\s`→`s`、`\w`→`w`、`\(`→`(`），
 * 于是 `new RegExp(\`…\s*${fn}\(\`)` 生成 `…s*useXxxStore(`，括号永不闭合：
 *   SyntaxError: Invalid regular expression: /…s*useXxxStore(/g: Unterminated group
 * 第一个 store 就抛错 ⇒ **一条结果都出不来**。加上它又恒退 0，没人发现
 * （提交信息写「首轮 0 哑弹」，实际是跑在轮内的另一份内联版本上，转正时把转义弄丢了）。
 * 同一个坑还让「解构」那条正则丢了 `?`（只认 storeToRefs 形式），以及
 * `varName.field` 的前瞻排除漏了 `/` ⇒ `'../stores/demoStore.js'` 被误报成「读未暴露字段 .js」。
 *
 * 修法：三处正则改 `String.raw` + 插值转义；解构那条补回可选的 `(?:storeToRefs\()?`；
 * 前瞻排除集补上 `/` 与引号。**任何把变量插进 RegExp 的地方都必须这样写。**
 *
 * 本锁是**行为锁**（真跑脚本 + 合成坏样本），因为这条缺陷的本质是「工具静默失效」，
 * 源码 grep 抓不住。纯文件系统扫描、无浏览器，约 0.3s，可安全进常驻套件。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'scripts/auditStoreContract.mjs')
// 夹具放 tmp/（已 gitignore；本机 safe-delete 对目录 fail-closed，故不尝试清理，与仓内惯例一致）
const FIXTURE = join(ROOT, 'tmp', '_r152_audit_fixture')

/** 造一棵最小工作台树：一个 store + 一个 view */
function writeFixture(viewSrc) {
  const base = join(FIXTURE, 'src', 'workbench')
  mkdirSync(join(base, 'stores'), { recursive: true })
  mkdirSync(join(base, 'views'), { recursive: true })
  mkdirSync(join(base, 'components'), { recursive: true })
  writeFileSync(join(base, 'stores', 'demoStore.js'), [
    "import { defineStore } from 'pinia'",
    "export const useDemoStore = defineStore('demo', () => {",
    '  const exposed = 1',
    '  return {',
    '    exposed',
    '  }',
    '})',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(join(base, 'views', 'Demo.vue'), viewSrc, 'utf8')
}

/** 真跑审计脚本（cwd 指向夹具树），返回退出码与输出 */
function runAudit() {
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: FIXTURE, encoding: 'utf8' })
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
}

// ─────────────────────────── ① 干净样本：必须跑通且 0 处 ───────────────────────────

test('干净样本：审计必须正常跑完、报 0 处、退 0（证明工具没崩、也没「永远报脏」）', () => {
  writeFixture([
    '<script setup>',
    "import { useDemoStore } from '../stores/demoStore.js'",
    'const demoStore = useDemoStore()',
    'console.log(demoStore.exposed)',
    '</script>',
    '',
  ].join('\n'))
  const { code, out } = runAudit()
  assert.doesNotMatch(out, /SyntaxError|Invalid regular expression/, '审计脚本不得抛正则错误（修复前的崩溃点）')
  assert.match(out, /共 0 处/, `干净样本应报 0 处，实际输出：\n${out}`)
  assert.equal(code, 0, '干净样本必须退 0')
})

// ─────────────────────────── ② 坏样本：必须真检出（防「静默 0 处」） ───────────────────────────

test('坏样本：读未暴露字段 + 解构未暴露字段都必须被检出，且退非 0', () => {
  writeFixture([
    '<script setup>',
    "import { useDemoStore } from '../stores/demoStore.js'",
    'const demoStore = useDemoStore()',
    'console.log(demoStore.notExposed)',
    'const { missingField } = storeToRefs(demoStore)',
    '</script>',
    '',
  ].join('\n'))
  const { code, out } = runAudit()
  assert.match(out, /读未暴露字段 \.notExposed/, `必须检出直接属性读，实际输出：\n${out}`)
  assert.match(out, /解构未暴露字段 missingField/, `必须检出解构（含非 storeToRefs 形式），实际输出：\n${out}`)
  assert.match(out, /共 2 处/, `坏样本应恰好 2 处，实际输出：\n${out}`)
  assert.notEqual(code, 0, '有发现必须退非 0')
})

test('坏样本：import 路径里的 `demoStore.js` 不得被误报成「读未暴露字段 .js」', () => {
  writeFixture([
    '<script setup>',
    "import { useDemoStore } from '../stores/demoStore.js'",
    'const demoStore = useDemoStore()',
    'console.log(demoStore.notExposed)',
    '</script>',
    '',
  ].join('\n'))
  const { out } = runAudit()
  assert.doesNotMatch(out, /读未暴露字段 \.js/, `import 路径不得被当成属性读，实际输出：\n${out}`)
  assert.match(out, /共 1 处/, `应只剩 1 处真发现，实际输出：\n${out}`)
})

// ─────────────────────────── ③ 反向自检（纯逻辑，不依赖 git） ───────────────────────────

test('反向自检：修复前的普通模板字面量写法必然抛错（证明这条锁不是空锁）', () => {
  const fn = 'useDemoStore'
  // 修复前的写法：普通模板字面量吃掉反斜杠 ⇒ 括号不闭合
  // （下面那行的 `\s`/`\w`/`\(` 是**故意**写成会被吃掉的样子的，不能按 lint 建议删掉，
  //   否则就复现不出 bug —— 当年 ESLint 也是拿这同一条 no-useless-escape 在报原文件。）
  assert.throws(
    // eslint-disable-next-line no-useless-escape -- 故意保留「被吃掉的转义」以复现修复前行为
    () => new RegExp(`(?:const|let|var)\s+(\w*[Ss]tore\w*)\s*=\s*${fn}\(`, 'g'),
    /Unterminated group/,
    '修复前的写法必须抛 Unterminated group（否则说明我们对根因的判断是错的）'
  )
  // 修复后的写法：String.raw 保住反斜杠
  assert.doesNotThrow(() => new RegExp(String.raw`(?:const|let|var)\s+(\w*[Ss]tore\w*)\s*=\s*${fn}\(`, 'g'))
})

test('反向自检：宽松的前瞻排除会把 import 路径误报（修复前的误报行为）', () => {
  const varName = 'demoStore'
  const importLine = "import { useDemoStore } from '../stores/demoStore.js'"
  const loose = new RegExp(String.raw`(?<![\w$.])${varName}\.(\w+)`, 'g')
  assert.ok([...importLine.matchAll(loose)].length > 0, '宽松写法确实会误报（这是修复前的行为）')
  const tight = new RegExp(String.raw`(?<![\w$./'"])${varName}\.(\w+)`, 'g')
  assert.equal([...importLine.matchAll(tight)].length, 0, '收紧排除集后不得误报')
})
