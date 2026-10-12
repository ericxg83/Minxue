/**
 * 回归锁：上传临时任务的 blob URL 必须回收（P7，2026-10-12）
 *
 * 背景：`src/hooks/useUploadFlow.js` 的 tempTask 用 URL.createObjectURL 生成预览地址，
 * 任务一旦转成服务端正式记录（pages 被 taskResult.images 覆盖）、或用户重试时旧行被移除，
 * 这些 blob 就成了永远无人 revoke 的孤儿（每上传一份多页作业就泄漏 N 个 blob，长期累积内存）。
 *
 * 修复（P7）：创建时统一收集到 `tempTask.__blobUrls`，在【成功替换 pages 为服务端 images】
 * 与【重试移除旧行】两个时机一次性 revoke；失败保留预览不回收（用户要看图重试，
 * 重试路径里旧行移除时再回收）。
 *
 * 判据设计（防「假绿」，沿用 test/uploadDedupOrphanCleanup.test.mjs 的源码级锁模式）：
 *   - 两个 tempTask 创建点（uploadRetryPaperGroup / uploadViaBackend）必须先收集 __blobUrls，
 *     且 pages 构造里不得再散落裸 URL.createObjectURL；
 *   - 必须有 revokeTempBlobs 辅助函数（清单式回收）；
 *   - 成功替换分支（taskResult.images / updatedTask.images 存在时）必须调用 revokeTempBlobs；
 *   - 重试移除旧行前必须调用 revokeTempBlobs。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOOK = path.join(ROOT, 'src', 'hooks', 'useUploadFlow.js')
const src = fs.readFileSync(HOOK, 'utf-8')

/** 从 startMarker 起到下一个 startMarker 之间的切片（默认读到文件尾） */
const sectionOf = (startMarker, endMarker = null) => {
  const start = src.indexOf(startMarker)
  assert.ok(start >= 0, `找不到起点标记：${startMarker}`)
  const end = endMarker ? src.indexOf(endMarker, start) : src.length
  assert.ok(end > start, `找不到终点标记：${endMarker}`)
  return src.slice(start, end)
}

test('P7 回归锁：revokeTempBlobs 辅助函数存在（清单式回收）', () => {
  const fn = src.match(/const revokeTempBlobs = \(tempTask\) => \{[\s\S]*?tempTask\.__blobUrls = \[\]\n\s*\}/)
  assert.ok(fn, '必须存在 revokeTempBlobs（遍历 __blobUrls 并 revoke、清空清单）')
  assert.match(fn[0], /URL\.revokeObjectURL/, 'revokeTempBlobs 必须真正调用 revokeObjectURL')
})

test('P7 回归锁：uploadRetryPaperGroup 创建点收集 __blobUrls，pages 不得散落裸 createObjectURL', () => {
  const block = sectionOf('const uploadRetryPaperGroup', 'const uploadRegularHomework')
  assert.match(block, /const __blobUrls = files\.map\(file => URL\.createObjectURL\(file\)\)/, '必须先行收集 __blobUrls')
  const pagesSection = block.match(/pages: files\.map[\s\S]*?status: 'pending',/)?.[0] || ''
  assert.ok(!pagesSection.includes('URL.createObjectURL'), 'pages 构造里不得再散落裸 createObjectURL')
  assert.ok(pagesSection.includes('__blobUrls[index]'), 'pages 的 image_url 必须来自 __blobUrls[index]')
  assert.match(block, /isRetryPaper: true,\n\s*__blobUrls\n\s*\}/, 'tempTask 对象里必须含 __blobUrls 字段')
})

test('P7 回归锁：uploadRetryPaperGroup 成功且服务端返回 images 时 revoke', () => {
  const block = sectionOf('const uploadRetryPaperGroup', 'const uploadRegularHomework')
  assert.match(block, /revokeTempBlobs\(tempTask\)/, '成功路径必须回收临时 blob')
  const revokeIdx = block.indexOf('revokeTempBlobs(tempTask)')
  const imagesIdx = block.indexOf('updatedTask.images')
  assert.ok(revokeIdx > imagesIdx, 'revoke 必须位于 updatedTask.images 分支之后（images 存在才回收）')
})

test('P7 回归锁：uploadViaBackend 创建点收集 __blobUrls，pages 不得散落裸 createObjectURL', () => {
  // 截到 uploadViaBackend 结束（下一个顶层 const 之前：retryTempUpload 是前面一个，直接到文件尾找特征）
  const start = src.indexOf('const uploadViaBackend')
  assert.ok(start >= 0, '找不到 const uploadViaBackend')
  // uploadViaBackend 是文件内最后一个函数（后面是删除注释与 return），取到 return 前
  const tail = src.slice(start, src.indexOf('return {', start))
  assert.match(tail, /const __blobUrls = files\.map\(file => URL\.createObjectURL\(file\)\)/, '必须先行收集 __blobUrls')
  const pagesSection = tail.match(/pages: files\.map[\s\S]*?status: 'pending',/)?.[0] || ''
  assert.ok(!pagesSection.includes('URL.createObjectURL'), 'pages 构造里不得再散落裸 createObjectURL')
  assert.ok(pagesSection.includes('__blobUrls[index]'), 'pages 的 image_url 必须来自 __blobUrls[index]')
  assert.match(tail, /__blobUrls,/, 'tempTask 对象里必须含 __blobUrls 字段')
})

test('P7 回归锁：uploadViaBackend 成功且服务端返回 images 时 revoke', () => {
  const start = src.indexOf('const uploadViaBackend')
  const tail = src.slice(start, src.indexOf('return {', start))
  assert.match(tail, /revokeTempBlobs\(tempTask\)/, 'uploadViaBackend 成功路径必须回收临时 blob')
  const revokeIdx = tail.indexOf('revokeTempBlobs(tempTask)')
  const imagesIdx = tail.indexOf('taskResult.images')
  assert.ok(revokeIdx > imagesIdx, 'revoke 必须位于 taskResult.images 分支之后（images 存在才回收）')
})

test('P7 回归锁：重试移除旧行前 revoke', () => {
  const block = sectionOf('const retryTempUpload', 'const uploadViaBackend')
  assert.match(block, /revokeTempBlobs\(old\)/, '移除旧行前必须回收旧行 blob')
  const revokeIdx = block.indexOf('revokeTempBlobs(old)')
  // 注意：retryTempUpload 开头的「原图片已丢失」分支也有一个不带 revoke 的 filter，
  // 必须用 lastIndexOf 定位「带 revoke 的那个 setTasks(prev => …)」后面的 filter。
  const filterIdx = block.lastIndexOf('prev.filter(t => t.id !== taskId)')
  assert.ok(revokeIdx > 0 && filterIdx > revokeIdx, '先 revoke 旧行再 filter 移除')
})

// ── P7 补齐（2026-10-12 R18）：移动端删除任务路径同样必须回收临时 blob ──
// App.jsx handleDeleteTask 删 temp-* 任务或删正式任务成功后的本地移除，都要先 revoke。
const APP_JSX = path.join(ROOT, 'src', 'App.jsx')
const appSrc = fs.readFileSync(APP_JSX, 'utf-8')

test('P7 回归锁：App.jsx 存在 revokeTaskBlobs 辅助函数', () => {
  const fn = appSrc.match(/const revokeTaskBlobs = \(task\) => \{[\s\S]*?task\.__blobUrls = \[\]\n\}/)
  assert.ok(fn, '必须存在 revokeTaskBlobs（遍历 __blobUrls 并 revoke、清空清单）')
  assert.match(fn[0], /URL\.revokeObjectURL/, 'revokeTaskBlobs 必须真正调用 revokeObjectURL')
})

test('P7 回归锁：handleDeleteTask 两个删除分支都先 revoke 再 filter', () => {
  // temp 分支：find + revokeTaskBlobs + filter 在同一 setTasks 回调内
  const tempBranch = appSrc.slice(appSrc.indexOf("taskId.startsWith('temp-')"), appSrc.indexOf('删除成功', appSrc.indexOf("taskId.startsWith('temp-')")))
  assert.match(tempBranch, /revokeTaskBlobs\(old\)/, 'temp 分支移除前必须回收 blob')
  // 正式任务分支：删除成功后也 revoke
  const realBranch = appSrc.slice(appSrc.indexOf('await deleteTask(taskId)'), appSrc.indexOf('catch (error)', appSrc.indexOf('await deleteTask(taskId)')))
  assert.match(realBranch, /revokeTaskBlobs\(old\)/, '正式任务删除成功后的本地移除也必须回收 blob')
  // 结构约束：必须是「先 find/revoke 后 filter」的顺序
  const revokeIdx = tempBranch.indexOf('revokeTaskBlobs(old)')
  const filterIdx = tempBranch.indexOf('.filter(t => t.id !== taskId)')
  assert.ok(revokeIdx > 0 && filterIdx > revokeIdx, 'temp 分支先 revoke 再 filter')
})
