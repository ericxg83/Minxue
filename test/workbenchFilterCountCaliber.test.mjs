/**
 * workbenchFilterCountCaliber.test.mjs — 批改中心筛选徽标口径回归测试（2026-09-15）
 *
 * 症状：GradeCenterWorkbench 来源 tab 徽标显示「学生作业 73 / 错题重练 27 / 全部 100」，
 * 但「状态=待处理」筛选下任务列表只有 4 条。老师以为任务丢了。
 *
 * 根因：sourceTabs 计数只按 source 统计全部状态的任务，而 visibleTasks 同时受
 * source + statusFilter 双重过滤 —— 两个数字口径不同。
 *
 * 锁定纪律：来源 tab 的计数徽标必须与任务列表共用同一个状态匹配口径
 * （matchesStatusFilter），保证「徽标数字 ≡ 点进去看到的列表行数」。
 * 禁止回退到「直接对 allTasks 按 source 计数」的旧写法。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const source = readFileSync(resolve(ROOT, 'src/workbench/views/GradeCenterWorkbench.vue'), 'utf8')

test('visibleTasks 与 sourceTabs 共用 matchesStatusFilter 口径', () => {
  assert.match(
    source,
    /const matchesStatusFilter = item => \{/,
    '缺少共享的状态匹配函数 matchesStatusFilter'
  )
  // 列表过滤必须走共享口径
  assert.match(
    source,
    /return sourceMatches && matchesStatusFilter\(item\)/,
    'visibleTasks 必须使用 matchesStatusFilter，不得内联状态判断'
  )
  // 徽标计数的作用域必须先过同一个状态口径
  assert.match(
    source,
    /allTasks\.value\.filter\(matchesStatusFilter\)/,
    'sourceTabs 计数必须先按 matchesStatusFilter 圈定范围，再按 source 分组'
  )
})

test('禁止回退：来源徽标不得直接对 allTasks 按 source 计数', () => {
  const violations = source.match(/count:\s*allTasks\.value\.filter\(/g) || []
  assert.deepEqual(
    violations,
    [],
    `发现 ${violations.length} 处徽标直接对全量任务计数（口径会脱离当前状态筛选）：\n` +
      '来源 tab 计数必须先经 matchesStatusFilter 圈定范围'
  )
})

test('matchesStatusFilter 覆盖全部 statusTabs 的 key', () => {
  // statusTabs 若新增 key，共享函数必须同步覆盖，否则列表与徽标会再次分叉
  const tabsBlock = source.match(/const statusTabs = \[[\s\S]*?\]/)?.[0] || ''
  const keys = [...tabsBlock.matchAll(/key:\s*'(\w+)'/g)].map(m => m[1])
  assert.ok(keys.includes('active') && keys.includes('issued') && keys.includes('failed') && keys.includes('completed'),
    `statusTabs 结构变化，请同步更新测试与 matchesStatusFilter：${keys.join(',')}`)

  // 'all'（状态=全部）走兜底 return true，其余每个 key 必须有显式分支
  for (const key of keys.filter(k => k !== 'all')) {
    assert.match(
      source,
      new RegExp(`statusFilter\\.value === '${key}'`),
      `matchesStatusFilter 未覆盖 statusTabs 的 '${key}' 分支`
    )
  }
  assert.match(
    source,
    /const matchesStatusFilter = item => \{[\s\S]*?return true\n\}/,
    'matchesStatusFilter 缺少「全部」兜底分支 return true'
  )
})
