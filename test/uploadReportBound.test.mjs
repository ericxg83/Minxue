/**
 * 回归锁：上传报告日志必须有界（R48，2026-10-12）
 *
 * 背景：`server/services/uploadReportLogger.js` 的模块级 Map `uploadReports`
 * 每次上传 set 一份完整报告（含全部文件尝试明细），此前 `clearUploadReports`
 * 定义了却无任何调用方 —— 常驻进程里 Map 无界增长，长期运行内存累积。
 *
 * 修复（R48）：`createUploadReport` set 后淘汰最旧一份，Map 保持 ≤ MAX_UPLOAD_REPORTS。
 *
 * 判据设计：源码级锁定 ——
 *   1. 必须存在 MAX_UPLOAD_REPORTS 上限常量；
 *   2. createUploadReport 的 set 之后必须有过限淘汰（delete 最旧）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = fs.readFileSync(path.join(ROOT, 'server', 'services', 'uploadReportLogger.js'), 'utf-8')

test('R48 回归锁：上传报告 Map 必须有界上限常量', () => {
  assert.match(SRC, /const MAX_UPLOAD_REPORTS = 100/, '必须存在报告上限常量')
})

test('R48 回归锁：createUploadReport set 后必须淘汰最旧', () => {
  const block = SRC.slice(SRC.indexOf('uploadReports.set(report.id, report)'), SRC.indexOf('return report'))
  assert.match(block, /uploadReports\.size > MAX_UPLOAD_REPORTS/, '必须有过限判断')
  assert.match(block, /uploadReports\.delete\(oldestKey\)/, '必须删除最旧一份')
  assert.match(block, /uploadReports\.keys\(\)\.next\(\)\.value/, '最旧按插入序取（Map 迭代序）')
})
