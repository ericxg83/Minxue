/**
 * 回归锁：jsonb 列禁止与 '' 直接比较（2026-10-15 r288，Neon 迁移实证缺陷族）
 *
 * 背景：老 Neon 库（ep-late-sun）的 questions.ai_tags 是 **text**（早年手工加列，
 * 与 database/neon_schema.sql / database/schema.sql 的 JSONB 权威定义不一致）。
 * 2026-10-15 12:22 老库出网流量超额（5.52/5GB）被官方停机，午间迁移到新库
 * （ep-wandering-queen，按权威 schema 建成，ai_tags/manual_tags 均为 jsonb）。
 * `q.ai_tags = ''` 这类比较在 text 列合法，在 jsonb 列上**计划期即抛 22P02
 * "invalid input syntax for type json"**，整条 SQL 500。
 *
 * 生产实证（10-15 14:0x curl minxue-api.onrender.com，commit 17c8e17 无本次修复）：
 *   GET /api/wrong-questions/student/:id → 500（移动端错题本列表）
 *   GET /api/weekly-report/:studentId   → 500（周报/学习诊断知识点诊断）
 * 本地同库探针对照：旧写法 22P02，`::text = ''` 写法 OK（test 注释留档）。
 *
 * 修法：比较一律走 `::text`（text 与 jsonb 两种列类型下都合法），只改比较形式、
 * 不改语义（空值→'[]'、非空→原值）。
 *
 * 判据：源码级锁定（与 adminAuthGuard / wrongCountIncrementGuard 同风格）——
 *   1. 五个修复点必须使用 ::text 比较；
 *   2. 全仓三文件不得再出现 jsonb 列与 '' 的裸比较（含 options/images/bbox 等，防复发）。
 *
 * 反向自检：GUARD_ROOT 指向含 HEAD 旧版的目录时，断言 1/2 必须判红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.env.GUARD_ROOT
  ? path.resolve(process.env.GUARD_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const FILES = [
  'server/index.js',
  'server/routes/weeklyReport.js',
  'server/backfillTags.js',
]

// 已知/可疑的 jsonb 列（questions 表 + 通用 JSONB 列）
const JSONB_COLS = [
  'ai_tags', 'manual_tags', 'options', 'images',
  'block_coordinates', 'text_bbox', 'image_bbox', 'ai_self_check_issues',
]

test('五个修复点必须使用 ::text 与空串比较', () => {
  const idx = read('server/index.js')
  const wr = read('server/routes/weeklyReport.js')
  const bt = read('server/backfillTags.js')
  // 错题本列表（index.js 两处 CASE）
  assert.match(idx, /ai_tags::text = ''/, '错题本列表 ai_tags 必须 ::text 比较')
  assert.match(idx, /manual_tags::text = ''/, '错题本列表 manual_tags 必须 ::text 比较')
  // BACKFILL_WHERE（标签回填筛选）
  assert.match(idx, /q\.ai_tags::text = ''/, 'BACKFILL_WHERE 必须 ::text 比较')
  // 周报知识点诊断
  assert.match(wr, /q\.ai_tags::text != ''/, 'weeklyReport 必须 ::text 比较')
  // 离线回填脚本
  assert.match(bt, /q\.ai_tags::text = ''/, 'backfillTags.js 必须 ::text 比较')
})

test('三文件不得再出现 jsonb 列与空串的裸比较（text 列时代的写法）', () => {
  const bad = []
  for (const f of FILES) {
    const src = read(f)
    for (const col of JSONB_COLS) {
      // 裸比较：列名后紧跟 = / != 与 ''（中间不允许 ::text 之类的转换）
      const re = new RegExp(`\\b${col}\\s*(?:!=|=)\\s*''`, 'g')
      for (const m of src.match(re) || []) {
        const line = src.slice(0, src.indexOf(m)).split('\n').length
        bad.push(`${f}:${line} ${m}`)
      }
    }
  }
  assert.deepEqual(bad, [], `jsonb 列裸比较空串（新库上 22P02 整句 500）: ${bad.join(' / ')}`)
})
