// 锁死「假重建中」修复 + 无资产行判错题补建（2026-10-09，玻璃管题案沉淀）：
// 玻璃管题（AI 未判定、不进错题本 → 按口径不重绘）却显示「几何图重建中...」——
// 根因一（前端）：getTikzStatus 兼容旧数据的推断分支把「无 tikz_status 字段 + 有裁片」
//   一律推断成 pending；裁片晚于 register 才生成的题根本没有资产行，永远不会有结果，
//   全库 46 题假重建中。
// 根因二（后端）：无资产行的题重绘管道从不覆盖，错题本补偿扫描（第 3 段）也只扫已有行；
//   全库 6 题判错题因此永久无法重绘。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ── 前端：推断分支不得再产生 pending ──

const displaySrc = readFileSync(join(root, 'src', 'utils', 'geometryDisplay.js'), 'utf8')
const inferBody = displaySrc.slice(
  displaySrc.indexOf('兼容旧数据：无 tikz_status 字段时按原有逻辑推断'),
  displaySrc.indexOf('export function getTikzStatusText'),
)

test('推断分支：有裁片但无 tikz_status 字段必须判 none（使用原图），禁止推断成 pending', () => {
  assert.doesNotMatch(inferBody, /return 'pending'/, '推断分支不得返回 pending——资产行缺失的题永远不会有结果，会永久转圈')
  assert.match(inferBody, /return 'none'/, '推断分支必须以 none 收尾（使用原图）')
})

test('推断分支：有 clean 产物必须判 done（resolveFigure 已能显示重绘图，标签区给切换按钮）', () => {
  assert.match(inferBody, /if \(question\.clean_geometry_image_url\) return 'done'/, 'clean PNG URL 存在即有产物可显示')
})

test('真实 pending 只能来自 API 带出的 tikz_status 字段（24h watchdog 覆盖面不变）', () => {
  const fnBody = displaySrc.slice(
    displaySrc.indexOf('export function getTikzStatus'),
    displaySrc.indexOf('兼容旧数据：无 tikz_status 字段时按原有逻辑推断'),
  )
  assert.match(fnBody, /if \(question\.tikz_status\)/, 'pending/processing 必须走带字段分支，享受 24h watchdog')
})

// ── 后端：无资产行判错题补建段 ──

const recoverySrc = readFileSync(join(root, 'server', 'pendingTaskRecovery.js'), 'utf8')
const scanBody = recoverySrc.slice(
  recoverySrc.indexOf('async scanGeometryAssets'),
  recoverySrc.indexOf('async scanOverdueGeometry'),
)

test('补建段必须存在且只针对「判错 + 有裁片 + 无资产行」的题', () => {
  assert.match(scanBody, /missingAssetRows/, '必须有补建段')
  assert.match(scanBody, /NOT EXISTS \(\s*SELECT 1 FROM \$\{TABLES\.QUESTION_ASSETS\} qa\s*WHERE qa\.question_id = q\.id AND qa\.asset_type = 'geometry_image'\s*\)/, '必须以无资产行为条件（天然幂等）')
  assert.match(scanBody, /JOIN \$\{TABLES\.WRONG_QUESTIONS\} w ON w\.question_id = q\.id/, '只补判错题（口径：只重绘会进错题本的题）')
  assert.match(scanBody, /q\.geometry_image_url IS NOT NULL/, '必须有裁片才补')
})

test('补建段必须复用 registerGeometryAssets（闸门 + 确定性通道继承），不得自建第二实现', () => {
  assert.match(scanBody, /registerGeometryAssets\(\{/, '必须复用 register（含配图闸门/数轴/函数图象确定性通道）')
  assert.doesNotMatch(scanBody, /createQuestionAsset\(/, '补建段不得直接建行（绕过闸门/确定性通道）')
})

test('补建段的 pending 产物必须入队（判错题当场重绘），且带 source 便于追溯', () => {
  assert.match(scanBody, /source: 'missing-asset-backfill'/, '入队必须带 source')
  assert.match(scanBody, /for \(const p of \(reg\.pending \|\| \[\]\)\)/, '必须消费 register 返回的 pending')
})

test('补建段必须限量（每轮 LIMIT 3），防止历史积压一次性烧穿视觉额度', () => {
  assert.match(scanBody, /LIMIT 3\n?\s*`/, '必须限量')
})
