/**
 * 逐幅选项图（questions.option_images）回归锁 —— 2026-11-06 方案 B
 *
 * 背景：图形选项题此前只能把 A/B/C/D 四幅图压成一条 8.8:1 的扁长横带，
 * 复核页与原卷「四幅各自独立、带标号」的排版差别很大，老师无法逐幅放大判题。
 * 本测试锁住：① 数据形状守卫；② 迁移与注册；③ 前后端四格渲染契约。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { normalizeOptionImages } from '../src/utils/figureOptions.js'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

// ── ① 数据形状守卫（真实逻辑，非源码正则） ──────────────────────────────

test('normalizeOptionImages: 合法四幅图原样保留且顺序不变', () => {
  const urls = [
    'https://oss/a.png', 'https://oss/b.png',
    'https://oss/c.png', 'https://oss/d.png'
  ]
  assert.deepEqual(normalizeOptionImages(urls), urls)
})

test('normalizeOptionImages: 空/NULL/对象一律收成空数组，调用方退回整条横带', () => {
  for (const raw of [null, undefined, [], '', '{}', {}, 0, false]) {
    assert.deepEqual(normalizeOptionImages(raw), [], `raw=${JSON.stringify(raw)}`)
  }
})

test('normalizeOptionImages: 旧数据被写成 JSON 字符串也能读', () => {
  const urls = ['https://oss/a.png', 'https://oss/b.png']
  assert.deepEqual(normalizeOptionImages(JSON.stringify(urls)), urls)
  assert.deepEqual(normalizeOptionImages('not-json'), [])
})

test('normalizeOptionImages: 过滤空串/非 URL/非字符串，最多 8 幅', () => {
  const raw = ['https://oss/a.png', '', null, 42, '  https://oss/b.png  ', 'javascript:alert(1)']
  assert.deepEqual(normalizeOptionImages(raw), ['https://oss/a.png', 'https://oss/b.png'])
  const many = Array.from({ length: 20 }, (_, i) => `https://oss/${i}.png`)
  assert.equal(normalizeOptionImages(many).length, 8)
})

// ── ② 迁移与注册（列必须真的存在，否则读取链路静默返回 undefined） ──────

test('迁移 065: option_images jsonb 列定义与启动注册都在', () => {
  const mig = read('server/migrations/065_add_question_option_images.js')
  assert.match(mig, /ADD COLUMN IF NOT EXISTS option_images jsonb/)
  assert.match(mig, /DEFAULT '\[\]'::jsonb/)
  assert.match(mig, /information_schema\.columns/)
  const idx = read('server/index.js')
  assert.match(idx, /import \{ migrateQuestionOptionImages \} from '\.\/migrations\/065_add_question_option_images\.js'/)
  assert.match(idx, /\['migrateQuestionOptionImages', migrateQuestionOptionImages\]/)
})

test('读取链路是 SELECT q.* + ...q 展开，新列无需改 SELECT 即可到达复核页', () => {
  const idx = read('server/index.js')
  assert.match(idx, /SELECT q\.\*/)
  const api = read('src/services/apiService.js')
  assert.match(api, /\.\.\.q/)
  // 主表 UPDATE 不含 option_images ⇒ 编辑保存不会把逐幅图清成 NULL
  const putBlock = idx.slice(idx.indexOf("app.put('/api/questions/:id'"), idx.indexOf("app.put('/api/questions/:id'") + 9000)
  assert.doesNotMatch(putBlock, /SET[\s\S]{0,1200}option_images\s*=/)
})

// ── ③ 前端四格渲染契约 ──────────────────────────────────────────────

test('复核页: 四格独立渲染 + 单独放大 + 排版切换 + 存量横带兜底', () => {
  const vue = read('src/workbench/components/review/QuestionDetailPanel.vue')
  assert.match(vue, /normalizeOptionImages\(q\.value\?\.option_images\)/)
  assert.match(vue, /ops-option-figures/)
  assert.match(vue, /ops-option-figure__label/)
  assert.match(vue, /String\.fromCharCode\(65 \+ idx\)/)
  assert.match(vue, /:initial-index="optionViewerIndex"/)
  assert.match(vue, /:url-list="optionImages"/)
  assert.match(vue, /optionFigureLayout === 'row'/)
  // 存量题（无逐幅图）必须仍走原来的单图分支
  assert.match(vue, /v-else-if="displayType === 'tikz_code'"/)
  assert.match(vue, /查看整条原卷裁片/)
})

test('编辑页: 接收逐幅图并四格只读预览，不引入第二套写库白名单', () => {
  const edit = read('src/workbench/components/review/QuestionEditForm.vue')
  assert.match(edit, /optionImages: \{ type: Array/)
  assert.match(edit, /qef-option-figures/)
  const panel = read('src/workbench/components/review/QuestionDetailPanel.vue')
  assert.match(panel, /:option-images="optionImages"/)
})

test('四幅图题的判题口径不被改动：不猜答案、不改完整性闸', () => {
  const vue = read('src/workbench/components/review/QuestionDetailPanel.vue')
  // 四格只是展示层；isFigureOption 与完整性判据仍在共享 utils
  assert.match(vue, /FIGURE_OPTION_IMAGE_TYPE/)
  const shared = read('src/utils/figureOptions.js')
  assert.match(shared, /isFigureOptionQuestion/)
})
