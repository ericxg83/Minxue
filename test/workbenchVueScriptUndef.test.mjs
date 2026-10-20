/**
 * 回归锁：教师工作台 .vue 的 <script>/<script setup> 不得引用未声明标识符
 * （2026-10-20，r310，「页面出现异常（render function）」线上实证缺陷）
 *
 * ── 背景（真实故障）──
 * 负责人工作台弹红条：「页面出现异常（render function），部分内容可能未更新，请刷新页面」。
 * 这是 src/workbench/main.js 的全局 errorHandler 兜底提示，真因藏在控制台：
 *   [工作台异常] render function: ReferenceError: archiveLoading is not defined
 *     at ComputedRefImpl.fn (ReviewTopBar.vue:460)
 * 52d5559（2026-10-18 砍 exam 答案库路线）把「留底为答案库」整条功能删了，
 * `archiveLoading` ref 一并删除，但 `moreBusy = computed(() => retryLoading.value || archiveLoading.value)`
 * 漏改 ⇒ 顶栏「更多」按钮的 :disabled 绑定每次渲染都抛 ReferenceError
 * ⇒ 该组件 render 中断、顶栏不再更新，且**只在运行时炸**：
 *   - `npm run lint` 空转：eslint.config.js 明确未纳入 .vue（模板层是登记在案的 lint 盲区）
 *   - `npm run build` 照过：打包器不解析未声明的自由变量
 *   - 单测照过：没人渲染这个组件
 * 所以本轮不是「补一个 if」，而是把这条盲区中最致命的一条规则（no-undef）补上闸。
 *
 * ── 判据 ──
 * 1. src/workbench 下全部 .vue 的 script 块，用 eslint `no-undef` 校验，必须 0 命中；
 * 2. 反向自检：同一套 linter 配置对「删除后残留引用」的样例必须判红，
 *    防止探针因配置失效而变成空转闸（历史上 noBackup 开关就是这样空转的）。
 *
 * ── 已知边界（不假装覆盖）──
 * 只覆盖 script 层。模板里的表达式（{{ }}、:prop）不做静态检查——那需要
 * eslint-plugin-vue 的模板解析，属另一件事；本闸抓到的是本次事故的同一层。
 * 白名单 vueMacros 是编译器宏（defineProps 等），不是运行时依赖。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@vue/compiler-sfc'
import { Linter } from 'eslint'
import globals from 'globals'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const WORKBENCH = path.join(ROOT, 'src', 'workbench')

// Vue 编译器宏：由 @vue/compiler-sfc 在编译期消费，运行时不存在，故列为只读全局。
const VUE_MACROS = {
  defineProps: 'readonly',
  defineEmits: 'readonly',
  defineExpose: 'readonly',
  defineOptions: 'readonly',
  defineSlots: 'readonly',
  defineModel: 'readonly',
  withDefaults: 'readonly'
}

const LINT_CONFIG = {
  languageOptions: {
    ecmaVersion: 2023,
    sourceType: 'module',
    globals: { ...globals.browser, ...globals.node, ...VUE_MACROS }
  },
  rules: { 'no-undef': 'error' }
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

test('工作台 .vue 脚本层无未声明标识符（no-undef）', () => {
  const linter = new Linter()
  const files = collectVueFiles(WORKBENCH)
  assert.ok(files.length > 0, '没扫到任何 .vue，探针路径错了')

  const problems = []
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8')
    const { descriptor, errors } = parse(src, { filename: file })
    if (errors.length) {
      problems.push(`${path.relative(ROOT, file)}: SFC 解析失败 - ${errors[0].message}`)
      continue
    }
    const blocks = []
    if (descriptor.script) blocks.push({ code: descriptor.script.content, offset: descriptor.script.loc.start.line })
    if (descriptor.scriptSetup) blocks.push({ code: descriptor.scriptSetup.content, offset: descriptor.scriptSetup.loc.start.line })
    for (const block of blocks) {
      for (const m of linter.verify(block.code, LINT_CONFIG)) {
        const line = block.offset + m.line - 1
        problems.push(`${path.relative(ROOT, file)}:${line} ${m.message}`)
      }
    }
  }

  assert.deepEqual(problems, [], `工作台有 ${problems.length} 处脚本层未声明引用（运行时就是 render function 报错）：\n${problems.join('\n')}`)
})

test('反向自检：残留引用必须被判红（否则闸是空转的）', () => {
  const linter = new Linter()
  // 52d5559 删掉 archiveLoading 后漏改的那一行，就是本次事故原文
  const bad = [
    'const ref = (v) => ({ value: v })',
    'const computed = (fn) => fn()',
    'const retryLoading = ref(false)',
    'const moreBusy = computed(() => retryLoading.value || archiveLoading.value)',
    ''
  ].join('\n')
  const msgs = linter.verify(bad, LINT_CONFIG)
  assert.equal(msgs.length, 1, '样例应恰好命中 1 处')
  assert.match(msgs[0].message, /archiveLoading' is not defined/)
})
