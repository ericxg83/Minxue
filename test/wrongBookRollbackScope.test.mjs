/**
 * 回归锁（2026-09-30）：错题批量掌握状态失败后的回滚必须真正可执行。
 *
 * 缺陷（2026-09-29 巡检发现，wrongBookStore.js batchUpdateStatus）：
 *   previousStates 在 try{} 块内以 const 声明，catch{} 无法访问该块级作用域。
 *   接口失败进入 catch 后，回滚语句自身抛 ReferenceError → 乐观更新永不回退，
 *   前端显示「已掌握」而库里没写成功——直接污染错题长期数据（AGENTS.md 核心原则 2）。
 *
 * 修复约定：previousStates 的声明必须位于 batchUpdateStatus 的 try 之前。
 * 本用例先于修复编写、修复前为红；行为级更强的 mock 接口失败断言
 * （test/workbenchStoreImports.test.mjs 同批提名）留待测试补强夜升级。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const STORE = path.resolve(import.meta.dirname, '../src/workbench/stores/wrongBookStore.js')
const src = fs.readFileSync(STORE, 'utf8')

test('错题批量回滚：previousStates 必须声明在 batchUpdateStatus 的 try 之前', () => {
  const fnIdx = src.indexOf('const batchUpdateStatus = async')
  assert.ok(fnIdx >= 0, '未找到 batchUpdateStatus 函数定义')
  const tryIdx = src.indexOf('try {', fnIdx)
  assert.ok(tryIdx >= 0, '未找到 batchUpdateStatus 内的 try 块')
  const declIdx = src.indexOf('const previousStates = new Map()', fnIdx)
  assert.ok(declIdx >= 0, '未找到 previousStates 声明')
  assert.ok(
    declIdx < tryIdx,
    `previousStates 声明在 try 之后（偏移 ${declIdx} > ${tryIdx}），catch 内回滚必抛 ReferenceError，乐观更新永不回退`
  )
})
