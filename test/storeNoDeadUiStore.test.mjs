/**
 * 契约锁（2026-10-04）：`src/store/index.js` 不得再引入死掉的 `useUIStore`。
 *
 * 背景：`useUIStore`（loading / toast / 旧的 currentPage）在路由改成 URL hash 之后就成了残骸 ——
 * 全 `src/`（含 .js/.jsx/.vue）**零引用**，它的 `showToast`/`hideToast`/`setLoading` 也无人调用。
 * 更糟的是它注释自称「loading/toast 为瞬态，不持久化」，而 `persist` 没写 `partialize`
 * ⇒ 实际把整个 store 写进了 sessionStorage（键 `minxue-ui`）：注释与行为自相矛盾，
 * 还可能把 `loading: true` 这类瞬态还原出来。
 *
 * 处置：归档到 `D:\Minxue_Archive\auto-20261004\src-store-useUIStore.js.txt` 后删除（2026-10-04）。
 * 本锁防的是「哪天又把它加回来」—— 真需要全局 UI 状态，请先想清楚持久化边界再新增。
 *
 * 反向自检：把本判据套在删除前的旧版源码上必须判红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
export const STORE_SRC = fs.readFileSync(path.join(ROOT, 'src/store/index.js'), 'utf8')

export function collectFailures(src = STORE_SRC) {
  const fails = []
  if (/export const useUIStore\s*=/.test(src)) {
    fails.push('useUIStore 又被加回来了（该 store 全仓零引用，已归档删除）')
  }
  if (/from 'zustand\/middleware'/.test(src)) {
    fails.push('又引入了 zustand/middleware（本文件已无任何 persist 用法）')
  }
  if (/\bpersist\s*\(/.test(src)) {
    fails.push('又出现了 persist( —— 本 store 不做持久化，若确需请先写清 partialize 边界')
  }
  return fails
}

test('契约：src/store/index.js 不得再引入已删除的 useUIStore / persist', () => {
  const fails = collectFailures()
  assert.deepEqual(fails, [], fails.join('；'))
})

test('契约：其余四个 store 仍在（删的是死代码，不是删功能）', () => {
  for (const name of ['useStudentStore', 'useTaskStore', 'useWrongQuestionStore', 'useExamStore']) {
    assert.ok(STORE_SRC.includes(`export const ${name} = create(`), `${name} 必须保留`)
  }
})
