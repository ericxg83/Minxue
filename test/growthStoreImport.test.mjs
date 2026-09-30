/**
 * 回归锁（2026-09-30，出生即绿）：成长中心数据加载的依赖完整性。
 *
 * 背景：growthStore.js 曾在 loadData 里调用 getQuestionsByIds 却漏写 import，
 * 学生一有带 question_ids 的任务就整页空白（ReferenceError → catch 清空全部数据）。
 * 该缺陷于 2026-09-29 当日由并行会话修复，本用例作为防复发锁存在。
 * 通用版「遍历所有 store 做导入完整性静态检查」已提名，留待测试补强夜实现。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const storeSrc = fs.readFileSync(path.join(ROOT, 'src/workbench/stores/growthStore.js'), 'utf8')
const apiSrc = fs.readFileSync(path.join(ROOT, 'src/services/apiService.js'), 'utf8')

test('growthStore：loadData 用到的 getQuestionsByIds 必须在 import 列表中', () => {
  const m = storeSrc.match(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*apiService['"]/)
  assert.ok(m, '未找到 growthStore 对 apiService 的具名导入')
  const names = m[1].split(',').map(s => s.trim()).filter(Boolean)
  assert.ok(
    names.includes('getQuestionsByIds'),
    `growthStore 的 apiService 导入缺少 getQuestionsByIds（当前只有：${names.join(', ')}）——loadData 第 60 行调用它会抛 ReferenceError 并清空整页数据`
  )
})

test('apiService：getQuestionsByIds 必须仍然存在（防改名/防删除）', () => {
  assert.match(apiSrc, /\bgetQuestionsByIds\b/, 'apiService.js 中已找不到 getQuestionsByIds，growthStore 的调用将悬空')
})
