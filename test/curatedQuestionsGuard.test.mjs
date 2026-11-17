/**
 * 回归锁：好题甄选（curated questions）边界与契约（2026-11-17）
 *
 * 背景：新增「好题甄选」跨来源收藏功能。评审定稿三条硬边界：
 *   1. 只存「引用 + 标签」，绝不复制题干/选项/答案/配图（否则触碰试卷题库零错字铁律）；
 *   2. 不回写任何题目表 / 错题表 / 掌握度（收藏是纯旁路动作）；
 *   3. 自动打标只用客观数据，判不了就留空，不猜。
 *
 * 本锁为源码级（与 jsonbEmptyStringGuard 同风格），防止后续改动把这三条边界改坏。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.env.GUARD_ROOT
  ? path.resolve(process.env.GUARD_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const MIGRATION = read('server/migrations/067_curated_questions.js')
const SERVICE = read('server/services/curatedQuestionService.js')
const ROUTE = read('server/routes/curatedQuestions.js')
const INDEX = read('server/index.js')

test('迁移表只含引用+标签字段，无题目内容副本列', () => {
  // 必须有引用两列 + 标签
  assert.match(MIGRATION, /source_type TEXT NOT NULL/)
  assert.match(MIGRATION, /source_id UUID NOT NULL/)
  assert.match(MIGRATION, /tags TEXT\[\]/)
  // 唯一约束防重复收藏
  assert.match(MIGRATION, /UNIQUE \(source_type, source_id\)/)
  // ⛔ 不得有题干/答案/配图等副本列
  for (const banned of ['content TEXT', 'answer TEXT', 'options JSONB', 'image_url TEXT']) {
    assert.ok(!MIGRATION.includes(banned), `迁移表不得含题目内容副本列: ${banned}`)
  }
  // 来源白名单只有两值
  assert.match(MIGRATION, /CHECK \(source_type IN \('question', 'resource_question'\)\)/)
})

test('service 只写 curated_questions，不写题目表 / 错题表 / 掌握度', () => {
  const writes = [...SERVICE.matchAll(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+(\w+)/gi)].map(m => m[1].toLowerCase())
  const allowed = new Set(['curated_questions'])
  for (const table of writes) {
    assert.ok(allowed.has(table), `service 不得写 ${table}（只允许 curated_questions）`)
  }
  // 明确不得出现的写目标
  for (const banned of ['questions', 'wrong_questions', 'question_knowledge', 'knowledge_mastery']) {
    assert.ok(!new RegExp(`(?:INSERT INTO|UPDATE|DELETE FROM)\\s+${banned}\\b`, 'i').test(SERVICE),
      `service 不得写 ${banned}`)
  }
})

test('列表接口实时 JOIN 原表取题目内容（不读表内副本）', () => {
  assert.match(SERVICE, /JOIN questions q ON q\.id = cq\.source_id/)
  assert.match(SERVICE, /JOIN resource_questions rq ON rq\.id = cq\.source_id/)
  // 源题被删时跳过，不留幽灵
  assert.match(SERVICE, /q\.deleted_at IS NULL/)
})

test('自动打标只用客观数据，判不了留空', () => {
  // 错题：难度>=4 / 错次>=2
  assert.match(SERVICE, /difficulty >= 4/)
  assert.match(SERVICE, /maxEc >= 2/)
  // 试卷题：继承原表 tags，不猜
  assert.match(SERVICE, /SELECT tags FROM resource_questions/)
})

test('路由已挂载到 index.js（import + app.use + 迁移注册）', () => {
  assert.match(INDEX, /import curatedQuestionsRouter from '\.\/routes\/curatedQuestions\.js'/)
  assert.match(INDEX, /app\.use\('\/api\/curated-questions', curatedQuestionsRouter\)/)
  assert.match(INDEX, /import \{ migrateCuratedQuestions \}/)
  assert.match(INDEX, /\['migrateCuratedQuestions', migrateCuratedQuestions\]/)
})

test('路由提供收藏/取消/列表/状态查询四接口', () => {
  assert.match(ROUTE, /router\.get\('\/'/)
  assert.match(ROUTE, /router\.post\('\/'/)
  assert.match(ROUTE, /router\.delete\('\/'/)
  assert.match(ROUTE, /router\.post\('\/status\/query'/)
  // 状态查询走批量，避免 N+1
  assert.match(ROUTE, /sourceIds = ANY\(\$2::uuid\[\]\)|getCuratedStatus/)
})

// ── 章节维度（2026-11-17）──────────────────────────────────────────
test('章节字段是数组且只存教材目录节点id引用，不复制章节名', () => {
  const MIG = read('server/migrations/068_curated_chapter_ids.js')
  assert.match(MIG, /chapter_ids TEXT\[\]/)
  assert.match(MIG, /ADD COLUMN IF NOT EXISTS/)
  // 不得有章节名副本列
  assert.ok(!/chapter_name TEXT/.test(MIG), '不得存章节名副本')
  // service 返回 chapterIds 且按命中任一筛选
  assert.match(SERVICE, /chapterIds: r\.chapter_ids \|\| \[\]/)
  assert.match(SERVICE, /filters\.chapterIds\.some/)
})

test('AI章节归类只挂目录内真实id，且有关键词硬门槛防广撒网', () => {
  const TAG = read('server/services/chapterTaggingService.js')
  // 只从静态教材目录取候选
  assert.match(TAG, /from '\.\.\/config\/textbookCatalog\.js'/)
  assert.match(TAG, /export function buildChapterCandidates/)
  // 编造id被丢弃
  assert.match(TAG, /valid\.has\(id\)/)
  // 高频误挂章节有关键词硬门槛（二次函数/锐角三角比等）
  assert.match(TAG, /CHAPTER_KEYWORD_GATE/)
  assert.match(TAG, /applyKeywordGate/)
})

test('AI章节路由只写chapter_ids，不碰题目表', () => {
  assert.match(ROUTE, /router\.post\('\/auto-chapter'/)
  assert.match(ROUTE, /setCuratedChapters\(updates\)/)
  // force 重挂能力
  assert.match(ROUTE, /force === true/)
})
