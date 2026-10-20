/**
 * WorksheetPicker 自动存默认失败必须有可见反馈（r318，A 级顺手化）
 *
 * 缺陷：handleSelect 首次选练习册时「自动保存为默认」是 fire-and-forget 且静默吞错
 * （`.catch(() => {})`），而同文件 handleSetDefault 对同一个保存操作是有 Toast 反馈的。
 * UI 暗示「如果没有默认，自动保存为默认」——保存失败则默认悄悄不生效、下次还得重选，
 * 且老师完全无感知。属巡检第③层「失败有反馈」。
 *
 * 修复：自动存默认保留 fire-and-forget，但 .catch 内补 Toast 反馈（与 handleSetDefault 同口径）。
 * 锁：源码级 fail-closed（anchoredRange），反向自检内联坏样本，不调 git（Windows EBUSY）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { anchoredRange } from './sourceLockKit.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(resolve(__dirname, '../src/components/WorksheetPicker/index.jsx'), 'utf8')

/** 唯一判据实现：返回失败条目数组（空 = 通过）。真实源码与合成坏样本共用，避免锁与代码分叉。 */
function collectWorksheetPickerFails(src) {
  const fails = []
  const body = anchoredRange(src, 'const handleSelect =', 'const handleSetDefault =', 'handleSelect 函数体', fails)
  if (body === null) return fails
  // 自动存默认分支必须存在（被删/改名时 fail-closed）
  if (!body.includes('upsertStudentWorksheetSetting(currentStudent.id, subject, worksheet.id)')) {
    fails.push('handleSelect 内未找到「自动存为默认」调用')
  }
  // 该分支的 .catch 不得是静默空函数（失败无反馈）
  if (body.includes('.catch(() => {})')) {
    fails.push('handleSelect 自动存默认的 .catch 仍是静默空函数，失败无反馈')
  }
  // 必须有反馈（Toast）
  if (!body.includes('Toast.show') && !body.includes('Toast.fail')) {
    fails.push('handleSelect 自动存默认缺少失败反馈（Toast）')
  }
  return fails
}

test('WorksheetPicker 自动存默认失败有可见反馈（真实源码）', () => {
  const fails = collectWorksheetPickerFails(SRC)
  assert.equal(fails.length, 0, fails.join(' | '))
})

test('反向自检：静默空 catch 坏样本必须判红（非空锁）', () => {
  const broken = `
const handleSelect = (worksheet) => {
  onSelect({ worksheetId: worksheet.id, worksheetName: worksheet.name })
  if (currentStudent && subject && !defaultId) {
    upsertStudentWorksheetSetting(currentStudent.id, subject, worksheet.id).catch(() => {})
  }
  onClose()
}
const handleSetDefault = async (id) => {}
`
  const fails = collectWorksheetPickerFails(broken)
  assert.ok(fails.length >= 1, '静默空 catch 坏样本应判红，但判据放行了')
  assert.ok(fails.some(f => f.includes('静默空函数')), '应点名「静默空函数」这层缺陷')
})
