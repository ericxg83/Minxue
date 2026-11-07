/**
 * 截图来源自动识别回归锁（2026-11-07 三轮）
 *
 * 负责人需求：「我截图的时候，故意把网址和时间卡点都截图到，他自己帮我填写好？」
 * ⇒ 从地址栏读 URL、从播放器进度条读当前时间，自动填进来源两项。
 *
 * 本文件锁死三条最容易出错的口径：
 *   ① **题目里的比例不是时间**：BD:CD = 1:2、AE = 2/3 AD 这类数字绝不能被当成播放时间；
 *   ② **读不清 / 格式不对的 URL 不写**：写错一个字符就是 404，宁可不填（fail closed）；
 *   ③ **手填优先**：识别结果只填空缺，绝不覆盖老师已经填过的任一项。
 * 另锁「只在手填有空缺时才调视觉」的额度闸，以及前后端接通。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDetectedSource, mergeClipSources } from '../server/services/clipSourceDetect.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8')
const SERVICE = 'server/services/paperBankService.js'
const VIEW = 'src/workbench/views/PaperBankWorkbench.vue'
const DETECT = 'server/services/clipSourceDetect.js'

// ── ① 正常识别 ────────────────────────────────────────────────────────────

test('识别：地址栏 URL + 进度条时间 + 标题 一起读出来', () => {
  const r = parseDetectedSource(JSON.stringify({
    url: 'https://www.bilibili.com/video/BV1GJ411x7h7?p=3',
    timestamp: '12:35',
    title: '某某老师 第3讲',
  }))
  assert.equal(r.url, 'https://www.bilibili.com/video/BV1GJ411x7h7?p=3')
  assert.equal(r.note, '12:35 某某老师 第3讲')
})

test('识别：```json 围栏、1:02:35、进度条「当前 / 总长」只取前者', () => {
  const fenced = parseDetectedSource('```json\n{"url":"https://youtu.be/abc","timestamp":"1:02:35","title":""}\n```')
  assert.equal(fenced.url, 'https://youtu.be/abc')
  assert.equal(fenced.note, '1:02:35')
  const pair = parseDetectedSource('{"url":"","timestamp":"12:35 / 45:20","title":""}')
  assert.equal(pair.note, '12:35')
})

// ── ② 误判与脏数据闸 ─────────────────────────────────────────────────────

test('误判闸：题目里的比例 1:2 / 12分35秒 一律不收（fail closed）', () => {
  assert.equal(parseDetectedSource('{"url":"","timestamp":"1:2","title":""}'), null)
  assert.equal(parseDetectedSource('{"url":"","timestamp":"12分35秒","title":""}'), null)
  assert.equal(parseDetectedSource('{"url":"","timestamp":"2/3","title":""}'), null)
})

test('URL 闸：缺协议 / 危险协议 / 带中文空格 / 截断 一律丢弃，不给错链接', () => {
  assert.equal(parseDetectedSource('{"url":"javascript:alert(1)","timestamp":"","title":""}'), null)
  assert.equal(parseDetectedSource('{"url":"www.bilibili.com/video/BV1xx","timestamp":"","title":""}'), null)
  assert.equal(parseDetectedSource('{"url":"https://bili bili.com/x","timestamp":"","title":""}'), null)
  assert.equal(parseDetectedSource('{"url":"https://","timestamp":"","title":""}'), null)
  // URL 被丢弃但时间点可信 ⇒ 仍可只填时间点
  const onlyTime = parseDetectedSource('{"url":"https://","timestamp":"12:35","title":""}')
  assert.equal(onlyTime.url, '')
  assert.equal(onlyTime.note, '12:35')
})

test('识别：地址栏自带 ?t=755 且模型没给时间 ⇒ 自动补成 12:35', () => {
  const r = parseDetectedSource('{"url":"https://www.bilibili.com/video/BV1xx?t=755","timestamp":"","title":""}')
  assert.equal(r.note, '12:35')
})

test('识别：画面里没有地址栏/进度条、返回不可解析 ⇒ null（不阻塞收题）', () => {
  assert.equal(parseDetectedSource('{"url":"","timestamp":"","title":""}'), null)
  assert.equal(parseDetectedSource('读不清'), null)
  assert.equal(parseDetectedSource(''), null)
  assert.equal(parseDetectedSource(null), null)
})

// ── ③ 手填优先：唯一合并实现 ─────────────────────────────────────────────

test('合并：手填的两项都不被识别结果覆盖', () => {
  const r = mergeClipSources(
    ['https://mine.example.com/v'],
    ['08:10 我自己写的备注'],
    [{ url: 'https://auto.example.com/v', note: '12:35 自动识别' }],
  )
  assert.deepEqual(r.sources, ['https://mine.example.com/v'])
  assert.deepEqual(r.notes, ['08:10 我自己写的备注'])
  assert.equal(r.autoFilled, 0)
})

test('合并：只填空缺；老师填了备注就只自动补 URL', () => {
  const r = mergeClipSources(
    ['', 'https://b.com/2'],
    ['我自己写的备注', ''],
    [
      { url: 'https://a.com/1', note: '12:35 某某老师' },
      { url: 'https://auto.com/2', note: '45:20' },
    ],
  )
  assert.deepEqual(r.sources, ['https://a.com/1', 'https://b.com/2'])
  assert.deepEqual(r.notes, ['我自己写的备注', '45:20'])
  assert.equal(r.autoFilled, 2)
})

test('合并：没有识别结果时原样返回，不清空不串位', () => {
  const r = mergeClipSources(['', 'https://b.com'], ['', '第3讲'], [null, null])
  assert.deepEqual(r.sources, ['', 'https://b.com'])
  assert.deepEqual(r.notes, ['', '第3讲'])
  assert.equal(r.autoFilled, 0)
})

// ── ④ 前后端接通 ─────────────────────────────────────────────────────────

const serviceSrc = read(SERVICE)
const viewSrc = read(VIEW)
const detectSrc = read(DETECT)

test('接通：只在手填有空缺时调视觉，识别结果经唯一合并实现回填', () => {
  assert.match(serviceSrc, /import \{ detectClipSource, mergeClipSources \} from '\.\/clipSourceDetect\.js'/)
  assert.match(serviceSrc, /needUrl \|\| needNote/, '手填两项都齐时不许再烧一次模型')
  assert.match(serviceSrc, /detectedSource = await detectClipSource\(buf, \{ logger \}\)/)
  assert.match(serviceSrc, /mergeClipSources\(sourceList, noteList, pageResults\.map/)
  assert.match(serviceSrc, /mergedSources\.sources\.forEach/)
  assert.match(serviceSrc, /mergedSources\.notes\.forEach/)
  assert.match(serviceSrc, /autoSources: mergedSources\.autoFilled/)
  assert.match(detectSrc, /PAPER_CLIP_AUTO_SOURCE/, '要有整条关闭的额度开关')
  assert.match(viewSrc, /系统会自动读出网址和时间卡点填好/, '上传弹窗要告诉老师可以不用手填')
})
