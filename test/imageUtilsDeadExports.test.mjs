// 回归锁：src/utils/imageUtils.js 不得重新引入零调用方死导出。
//
// 背景：fileToBase64 / compressImage（独立 base64 版）自 2026-10-04 死导出扫描
// 即被标记为零调用方，但当时只写进报告、未删除。r358 实际删除，补锁防回潮。
// 反向自检（不依赖 git，规避 Windows EBUSY）：合成「重新引入死导出」的源码样本，
// 断言同一把判据会判红，证明负向锁不是空锁。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = join(__dirname, '..', 'src', 'utils', 'imageUtils.js')
const source = readFileSync(SRC, 'utf8')

// 导出声明匹配：export const/function/let/var/async function <name>
function hasExport (src, name) {
  return new RegExp(`export\\s+(?:const|function|let|var|async\\s+function)\\s+${name}\\b`).test(src)
}

// 正式锁用的判据：死导出不得存在，否则抛错
function assertNoDeadExport (src, name) {
  if (hasExport(src, name)) {
    throw new Error(`死导出 ${name} 不得作为导出存在于 imageUtils.js`)
  }
}

// 零调用方死导出（已删除，不得回潮）
const DEAD = ['fileToBase64', 'compressImage']

test('imageUtils 已删除零调用方死导出 fileToBase64 / compressImage', () => {
  for (const name of DEAD) {
    assertNoDeadExport(source, name)
  }
})

test('imageUtils 仍导出被 useUploadFlow.js 使用的函数（正向护栏）', () => {
  for (const name of ['compressImageForUpload', 'compressImagesForUpload', 'describeUploadFailure']) {
    assert.equal(hasExport(source, name), true, `被调用方使用的 ${name} 不应被误删`)
  }
})

test('反向自检：重新引入死导出时同一把判据判红（非空锁）', () => {
  const revived = source +
    '\nexport const fileToBase64 = (f) => f\n' +
    'export const compressImage = (f, w = 1, h = 1, q = 1) => f\n'
  // 先确认合成样本确实重新包含了死导出（自检样本本身构造正确）
  for (const name of DEAD) {
    assert.equal(hasExport(revived, name), true, `合成样本应重新包含 ${name}（自检样本构造错误）`)
  }
  // 用与正式锁完全相同的判据套在「复活样本」上，必须判红
  for (const name of DEAD) {
    assert.throws(
      () => assertNoDeadExport(revived, name),
      /死导出/,
      `复活 ${name} 时正式锁必须判红`
    )
  }
})
