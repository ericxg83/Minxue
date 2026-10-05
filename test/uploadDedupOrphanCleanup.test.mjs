/**
 * 回归锁：上传去重分支的孤儿文件清理，失败必须打日志（r157，2026-10-05）
 *
 * 背景：`server/index.js` 的上传接口撞到 UNIQUE 23505（并发同图上传，
 * 前置查询都返回空、INSERT 撞唯一索引）时，会复用已有任务并清掉本次刚上传的
 * 那份孤儿文件——**文件删不掉就永远挂在存储上**，免费实例约 1GB 额度，
 * 满了直接上传失败，而磁盘告警里又看不到任何线索。
 *
 * ⛔ 这里曾经是 `catch (e) { /* ignore *​/ }`（r157 修），失败**完全静默**：
 *    日志里一条都没有，只能靠猜。同一文件里另一处（真正的 DB 写失败分支）
 *    早就写了 `console.error('  OSS 清理失败:', ...)`——两处口径不一致。
 *
 * 判据设计（防「假绿」）：
 *   - 只锁**这一行**（按 `Upload Dedup` + `deleteFile` 定位），不用整文件 occurrence 计数
 *     ——历史踩过 occurrence 数写错导致的假通过。
 *   - 判据同时要求「必须出现 console.error」与「不得是空 catch」，两条缺一判红。
 *   - **反向自检**：内联合成旧的那一行喂同一套判据必须判红；
 *     并且断言新旧两行确实不同，避免判据自始至终碰巧相等。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const INDEX_JS = path.join(ROOT, 'server', 'index.js')

/** 从源码里取出「上传去重孤儿文件清理」那一行（只取这一行） */
function findDedupCleanupLine(src) {
  return src
    .split('\n')
    .filter((l) => l.includes('Upload Dedup') && l.includes('deleteFile'))
}

/** 空 catch（静默吞错）的形态 */
const SILENT_CATCH = /catch\s*\(\s*\w+\s*\)\s*\{\s*\/\*[^]*?\*\/\s*\}/

/** 判据：这一行必须打日志，且不能是空 catch */
function judge(line) {
  return {
    hasLog: /console\.(error|warn)/.test(line),
    notSilent: !SILENT_CATCH.test(line),
  }
}

test('回归锁文件存在且能定位到上传去重的清理行', () => {
  const src = fs.readFileSync(INDEX_JS, 'utf-8')
  const lines = findDedupCleanupLine(src)
  assert.equal(lines.length, 1, `期望唯一一行上传去重清理代码，实际 ${lines.length} 行`)
})

test('上传去重分支清理孤儿文件失败会打日志（不是静默吞错）', () => {
  const src = fs.readFileSync(INDEX_JS, 'utf-8')
  const lines = findDedupCleanupLine(src)
  const { hasLog, notSilent } = judge(lines[0])
  assert.ok(hasLog, `清理行必须打日志，实际行：${lines[0].trim()}`)
  assert.ok(notSilent, `清理行不得是空 catch（静默吞错），实际行：${lines[0].trim()}`)
})

test('反向自检：内联合成旧写法（空 catch）在同一套判据下必判红', () => {
  // r157 之前的那一行的等价写法（注释里的 U+200B 不会被真实源码匹配到，换掉）
  const oldLine =
    "                try { const urlObj = new URL(img.image_url); const ossPath = urlObj.pathname.replace(/^\\//, ''); await deleteFile(ossPath) } catch (e) { /* ignore */ }"
  const { hasLog, notSilent } = judge(oldLine)
  assert.equal(hasLog, false, '旧写法没有日志，判据应当判定 hasLog=false')
  assert.equal(notSilent, false, '旧写法是空 catch，判据应当判定 notSilent=false')
})

test('反向自检：新旧两行确实不同（判据不是自始至终碰巧相等）', () => {
  const src = fs.readFileSync(INDEX_JS, 'utf-8')
  const newLine = findDedupCleanupLine(src)[0]
  const oldLine =
    "                try { const urlObj = new URL(img.image_url); const ossPath = urlObj.pathname.replace(/^\\//, ''); await deleteFile(ossPath) } catch (e) { /* ignore */ }"
  assert.notEqual(newLine, oldLine, '新旧写法相同 ⇒ 这个回归锁等于没设')
  assert.notEqual(
    JSON.stringify(judge(newLine)),
    JSON.stringify(judge(oldLine)),
    '新旧判据结果相同 ⇒ 判据没有区分力'
  )
})

test('全文件口径一致：server/index.js 内不得再有静默吞错的 OSS 清理 catch', () => {
  const src = fs.readFileSync(INDEX_JS, 'utf-8')
  const silentLines = src.split('\n').filter((l) => l.includes('deleteFile') && SILENT_CATCH.test(l))
  assert.deepEqual(silentLines, [], `以下行仍在静默吞掉 OSS 清理失败：\n${silentLines.join('\n')}`)
})
