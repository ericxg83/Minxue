/**
 * 截图来源「链接 + 时间点」回归锁（2026-11-07 二轮）
 *
 * 负责人追问：「来源能填链接，但我这道题是某个视频的**第几分钟**，我怎么表述？」
 * ⇒ 一个输入框装不下「链接 + 第几分钟」，于是拆成两项：
 *   clip_source = 链接（或纯文字说明），clip_source_note = 时间点 / 备注。
 * 时间点除了显示，还要能把 B站 / YouTube 链接直接跳到那一秒。
 *
 * 本文件锁死：
 *   ① 时间点解析（12:35 / 1:02:35 / 12分35秒 / 第3分钟 / 735秒）与「读不出返回 null」；
 *   ② URL 安全判据只认 http(s)，javascript: 之类绝不变成可点链接；
 *   ③ 只有确认支持 t= 的视频站才追加参数，已有 t=/start= 的链接原样返回；
 *   ④ 前后端字段名 clip_source_note / clipNotes / notes 逐字对齐，口径只在 utils 一处。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { isSourceUrl, parseTimestampSeconds, sourceHref } from '../src/workbench/utils/clipSource.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8')
const SERVICE = 'server/services/paperBankService.js'
const ROUTES = 'server/routes/paperBank.js'
const VIEW = 'src/workbench/views/PaperBankWorkbench.vue'
const API = 'src/services/apiService.js'
const UTILS = 'src/workbench/utils/clipSource.js'

// ── ① 时间点解析 ──────────────────────────────────────────────────────────

test('时间点：常见写法都能换成秒', () => {
  assert.equal(parseTimestampSeconds('12:35 讲到辅助线'), 12 * 60 + 35)
  assert.equal(parseTimestampSeconds('1:02:35'), 3755)
  assert.equal(parseTimestampSeconds('12分35秒'), 755)
  assert.equal(parseTimestampSeconds('12分'), 720)
  assert.equal(parseTimestampSeconds('第3分钟'), 180)
  assert.equal(parseTimestampSeconds('735秒'), 735)
})

test('时间点：纯说明文字读不出就返回 null（不猜、不拼错参数）', () => {
  assert.equal(parseTimestampSeconds('B站 · 某某老师 第3讲'), null)
  assert.equal(parseTimestampSeconds(''), null)
  assert.equal(parseTimestampSeconds(null), null)
})

// ── ② URL 安全判据 ───────────────────────────────────────────────────────

test('URL：只认 http(s)，危险协议与手写文字一律当纯文本', () => {
  assert.equal(isSourceUrl('https://www.bilibili.com/video/BV1xx'), true)
  assert.equal(isSourceUrl('http://example.com/a?b=1'), true)
  assert.equal(isSourceUrl('javascript:alert(1)'), false)
  assert.equal(isSourceUrl('data:text/html,x'), false)
  assert.equal(isSourceUrl('B站 某某老师 第3讲'), false)
  assert.equal(isSourceUrl(''), false)
})

// ── ③ 视频跳转 ───────────────────────────────────────────────────────────

test('跳转：B站 / YouTube 链接按时间点追加 t=<秒>', () => {
  const b = sourceHref('https://www.bilibili.com/video/BV1xx', '12:35 讲到辅助线')
  assert.match(b, /[?&]t=755($|&)/)
  const y = sourceHref('https://youtu.be/abc', '第3分钟')
  assert.match(y, /[?&]t=180($|&)/)
  const withQuery = sourceHref('https://www.bilibili.com/video/BV1xx?p=2', '12:35')
  assert.match(withQuery, /p=2/)
  assert.match(withQuery, /[?&]t=755($|&)/)
})

test('跳转：已有定位参数 / 普通网页 / 非 http(s) / 无时间点 ⇒ 原样返回', () => {
  assert.equal(sourceHref('https://youtu.be/abc?t=30', '12:35'), 'https://youtu.be/abc?t=30')
  assert.equal(sourceHref('https://youtu.be/abc?start=30', '12:35'), 'https://youtu.be/abc?start=30')
  assert.equal(sourceHref('https://example.com/page', '12:35'), 'https://example.com/page')
  assert.equal(sourceHref('javascript:alert(1)', '12:35'), 'javascript:alert(1)')
  assert.equal(sourceHref('https://www.bilibili.com/video/BV1xx', '第3讲'), 'https://www.bilibili.com/video/BV1xx')
})

// ── ④ 前后端契约 ─────────────────────────────────────────────────────────

const serviceSrc = read(SERVICE)
const routesSrc = read(ROUTES)
const viewSrc = read(VIEW)
const apiSrc = read(API)
const utilsSrc = read(UTILS)

test('字段名：clip_source_note / clipNotes / notes 前后端逐字对齐', () => {
  assert.match(serviceSrc, /AS clip_source_note/)
  assert.match(serviceSrc, /metadata->'clipNotes'->>\(rq\.page_no::text\)/)
  assert.match(serviceSrc, /jsonb_build_object\('clipNotes'/)
  assert.match(serviceSrc, /COALESCE\(metadata->'clipNotes', '\{\}'::jsonb\) \|\| \$2::jsonb/)
  assert.match(routesSrc, /ARRAY\['clipNotes', \$2::text\]/)
  assert.match(routesSrc, /hasNote/, '旧调用只带 source 时不得把已存的时间点清空')
  assert.match(apiSrc, /fd\.append\('notes', JSON\.stringify\(notes\)\)/)
  assert.match(apiSrc, /updatePaperClipSource = \(id, source, note = ''\)/)
  assert.match(viewSrc, /clipFiles\.value\.map\(f => f\.note \|\| ''\)/)
  assert.match(viewSrc, /q\.clip_source_note/)
  assert.match(viewSrc, /updatePaperClipSource\(q\.id, val, note\)/)
})

test('口径收敛：URL 判据与跳转只在 workbench/utils 一份，页面不再自己写', () => {
  assert.match(utilsSrc, /export const isSourceUrl/)
  assert.match(utilsSrc, /export function sourceHref/)
  assert.match(viewSrc, /import \{ isSourceUrl, sourceHref \} from '\.\.\/utils\/clipSource\.js'/)
  assert.ok(!/const isSourceUrl = \(s\) =>/.test(viewSrc), '⛔ 页面不许再写一份 URL 判据')
  assert.match(viewSrc, /:href="sourceHref\(q\.clip_source, q\.clip_source_note\)"/)
  assert.match(viewSrc, /v-if="isSourceUrl\(q\.clip_source\)"/)
})

test('交互：上传弹窗每项两个输入框，题目行编辑态也是两个', () => {
  assert.match(viewSrc, /v-model="f\.note"/)
  assert.match(viewSrc, /v-model="f\.source"/)
  assert.match(viewSrc, /v-model="sourceDraftUrl"/)
  assert.match(viewSrc, /v-model="sourceDraftNote"/)
  assert.match(viewSrc, /!q\.clip_source && !q\.clip_source_note && sourceEditingId !== q\.id/,
    '只有备注没链接时也不能再冒出「补来源」')
})
