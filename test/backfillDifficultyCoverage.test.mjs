import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const INDEX_SRC = readFileSync(resolve(ROOT, 'server/index.js'), 'utf8')
const TAGS_SRC = readFileSync(resolve(ROOT, 'server/backfillTags.js'), 'utf8')
const AI_SRC = readFileSync(resolve(ROOT, 'server/config/ai.js'), 'utf8')

/**
 * 难度回填覆盖 + 回填优先厂商（2026-09-18 修复，锁定）
 *
 * 背景事故：周末班课件出现「未判定」难度档。根因是定时回填 SQL
 *   `q.is_complete = TRUE AND (... q.difficulty IS NULL ...)`
 * 把「缺难度」也锁在完整题上 → 全库 287 条 difficulty IS NULL **100% 是
 * is_complete=false**（残题：选择题选项是图片/未抓到 → options=[] → 完整性闸判缺选项）
 * → 永远拿不到难度。
 *
 * 修法：难度回填不再受 is_complete 限制（难度只依赖题干）；标签回填仍只在完整题上做
 * （残题正文可能残缺，打标签会误导知识点关联）。同时给回填加「优先厂商」，避免常规
 * 降级链先空耗 ~20s 等 Gemini 超时 + 魔搭/SenseNova 429。
 */
test('难度回填不受 is_complete 限制（缺难度分支在完整题闸之外）', () => {
  // index.js：difficulty IS NULL 必须与 is_complete 分支同级（用 OR 连接），不能锁在里面
  assert.ok(
    INDEX_SRC.includes('const BACKFILL_WHERE = `('),
    'index.js BACKFILL_WHERE 必须重构为 (标签闸) OR (难度缺) 结构'
  )
  assert.ok(
    /\(q\.is_complete = TRUE AND \([\s\S]*?\)\)\s*\n\s*OR q\.difficulty IS NULL/.test(INDEX_SRC),
    'index.js：难度缺（q.difficulty IS NULL）必须用 OR 挂在 is_complete 闸之外'
  )
  assert.ok(
    !/q\.is_complete = TRUE\s*\n\s*AND \(\s*\n\s*q\.ai_tags IS NULL[\s\S]*?OR q\.difficulty IS NULL/.test(INDEX_SRC),
    'index.js：不得再出现「is_complete=TRUE AND (... OR difficulty IS NULL)」把难度锁死的旧写法'
  )
  // backfillTags.js（CLI）必须同构
  assert.ok(
    /\(q\.is_complete = TRUE AND \([\s\S]*?\)\)\s*\n\s*OR q\.difficulty IS NULL/.test(TAGS_SRC),
    'backfillTags.js CLI 必须与 index.js 同构（难度不受 is_complete 限制）'
  )
})

test('标签回填仍只在完整题上写（写入侧把关）', () => {
  assert.ok(
    INDEX_SRC.includes('const writeTags = hasTags && q.is_complete === true'),
    'index.js 写入侧必须用 writeTags 把关：标签只在 is_complete=TRUE 时写'
  )
  assert.ok(INDEX_SRC.includes('if (writeTags || hasDifficulty)'), 'index.js 更新闸必须是 (writeTags || hasDifficulty)')
  assert.ok(INDEX_SRC.includes('if (writeTags) {'), 'index.js 写标签必须走 writeTags 分支')
  assert.ok(TAGS_SRC.includes('const writeTags = hasTags && q.is_complete === true'), 'backfillTags.js 同样把关')
  // SELECT 必须带 is_complete 供写入侧判断
  assert.ok(
    INDEX_SRC.includes('q.question_type, q.is_complete'),
    'index.js 回填 SELECT 必须带 q.is_complete（否则无法把关）'
  )
})

test('回填可指定优先厂商，绕过慢的降级链', () => {
  // generateTag 传 preferredVendor
  assert.ok(
    TAGS_SRC.includes('preferredVendor: process.env.BACKFILL_TEXT_VENDOR'),
    'generateTag 必须把 BACKFILL_TEXT_VENDOR 作为 preferredVendor 传入'
  )
  // callTextCompletion 支持 preferredVendor 且优先直连
  assert.ok(
    AI_SRC.includes('preferredVendor') && AI_SRC.includes('const pv = BACKUP_CONFIG.VENDORS.find'),
    'callTextCompletion 必须支持 preferredVendor（按名查厂商后先直连）'
  )
})

test('备用厂商循环必须带 vendor.extraBody（Huihuiyun 否则 100% 失败）', () => {
  // 厂商循环里必须显式传 extraBody（sensenova-6.8-flash-lite 需要 reasoning_effort:'none'）
  assert.ok(
    /for \(const vendor of BACKUP_CONFIG\.VENDORS\) \{[\s\S]*?extraBody: vendor\.extraBody \|\| null/.test(AI_SRC),
    'callTextCompletion 备用厂商循环必须传 extraBody: vendor.extraBody || null'
  )
})
