/**
 * 回归锁（2026-10-04）：错题「标记完全掌握」持久化失败必须回滚并如实提示。
 *
 * 缺陷（2026-10-04 巡检发现，wrongBookStore.js updateLifecycleStatus）：
 *   该函数是 fire-and-forget —— 本地立即把 lifecycle_status 改为 mastered，
 *   updateWrongQuestionStatus(...).catch() 只打日志不回滚，且无条件 return true。
 *   WrongBookCenterRedesign.vue 的 markMastered 据此总弹「已标记为完全掌握」。
 *   接口失败时：老师看到成功提示，库里没写成功 —— 前端/后端状态分叉，
 *   错题是长期学习数据（AGENTS.md 核心原则 2），此分叉直接污染掌握口径。
 *   同文件 batchUpdateStatus / deleteQuestion 均有回滚，唯独此函数漏了。
 *
 * 修复约定（与 batchUpdateStatus 纪律一致）：
 *   ① updateLifecycleStatus 内 prevLifecycle / prevStatus 声明在 try 之前；
 *   ② catch 内恢复 wq.lifecycle_status / wq.status，并 return false；
 *   ③ 函数内禁止 fire-and-forget 的 .catch( 持久化（必须 await）；
 *   ④ WrongBookCenterRedesign.vue 的 markMastered 按返回值分支：false 时提示保存失败。
 *
 * 另锁 setSummary 的筛选泄漏：切出「重复出错」档必须重置 errorCount，
 * 否则「待处理/已掌握」列表被残留的 errorCount=2-3 静默过滤，KPI 数量与列表行数对不上。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const STORE = path.join(ROOT, 'src/workbench/stores/wrongBookStore.js')
const VIEW = path.join(ROOT, 'src/workbench/views/WrongBookCenterRedesign.vue')
const storeSrc = fs.readFileSync(STORE, 'utf8')
const viewSrc = fs.readFileSync(VIEW, 'utf8')

test('生命周期更新：prev 快照必须声明在 try 之前（catch 回滚可读）', () => {
  const fnIdx = storeSrc.indexOf('const updateLifecycleStatus = async')
  assert.ok(fnIdx >= 0, '未找到 updateLifecycleStatus 函数定义')
  const tryIdx = storeSrc.indexOf('try {', fnIdx)
  assert.ok(tryIdx >= 0, '未找到 updateLifecycleStatus 内的 try 块')

  for (const decl of ['const prevLifecycle = wq.lifecycle_status', 'const prevStatus = wq.status']) {
    const declIdx = storeSrc.indexOf(decl, fnIdx)
    assert.ok(declIdx >= 0, `未找到快照声明: ${decl}`)
    assert.ok(
      declIdx < tryIdx,
      `${decl} 声明在 try 之后（偏移 ${declIdx} > ${tryIdx}），catch 回滚必抛 ReferenceError`
    )
  }
})

test('生命周期更新：catch 必须回滚旧状态并 return false（不得 fire-and-forget）', () => {
  const fnIdx = storeSrc.indexOf('const updateLifecycleStatus = async')
  const fnEnd = storeSrc.indexOf('// 删除错题', fnIdx)
  const fnBody = storeSrc.slice(fnIdx, fnEnd > 0 ? fnEnd : storeSrc.length)

  // 必须 await 持久化，而非 .catch( 吞掉后无条件成功
  assert.ok(!/\.catch\(/.test(fnBody), 'updateLifecycleStatus 内仍有 fire-and-forget 的 .catch(，持久化失败不会回滚')
  assert.ok(/await updateWrongQuestionStatus\(/.test(fnBody), '必须 await updateWrongQuestionStatus')
  assert.ok(/wq\.lifecycle_status = prevLifecycle/.test(fnBody), 'catch 内必须回滚 lifecycle_status')
  assert.ok(/wq\.status = prevStatus/.test(fnBody), 'catch 内必须回滚 status')
  // catch 分支返回 false：调用方（markMastered）据此提示失败
  assert.ok(/return false/.test(fnBody), '接口失败路径必须 return false')
  assert.ok(/return true/.test(fnBody), '成功路径必须 return true')
})

test('markMastered 必须按持久化结果分支提示（失败不得弹成功）', () => {
  const mIdx = viewSrc.indexOf('async function markMastered')
  assert.ok(mIdx >= 0, '未找到 markMastered')
  const seg = viewSrc.slice(mIdx, mIdx + 260)
  assert.ok(/const ok = await wrongBookStore\.updateLifecycleStatus/.test(seg), '必须接收持久化返回值')
  assert.ok(/if \(ok\)/.test(seg), '成功分支不存在')
  assert.ok(/else ElMessage\.error\(/.test(seg), '失败时未提示保存失败')
  assert.ok(!/updateLifecycleStatus\(item\.id, 'mastered'\); ElMessage\.success/.test(seg), '仍是无条件成功提示')
})

test('错题中心切档：切出「重复出错」必须重置 errorCount，残留筛选不得泄漏到其他档', () => {
  const sIdx = viewSrc.indexOf('function setSummary')
  assert.ok(sIdx >= 0, '未找到 setSummary')
  const seg = viewSrc.slice(sIdx, sIdx + 300)
  assert.ok(/if \(key === 'repeat'\) wrongBookStore\.setFilter\('errorCount', '2-3'\); else wrongBookStore\.setFilter\('errorCount', 'all'\)/.test(seg),
    '非 repeat 档未重置 errorCount=all —— 「待处理/已掌握」会被残留的 2-3 档静默过滤')
})