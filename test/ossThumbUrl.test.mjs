/**
 * ossThumbUrl 纯函数回归测试（2026-10-08）
 *
 * 背景：批改中心任务列表加「试卷首页小图」。真实上传图 0.4~1.3MB 一张，
 * 直接引原图会把列表拖垮 ⇒ 走阿里云 OSS 的 `?x-oss-process=image/resize,w_240`
 * 让 OSS 端出缩图（实测 1284KB → 15.0KB，见 src/utils/ossThumb.js 头部注释）。
 *
 * 本测试锁的是**判据边界**，不是「能不能拼出字符串」：
 * 拼错的代价分两档 ——
 *   ① 该缩的没缩（漏参数）⇒ 列表拉几十 MB；
 *   ② 不该缩的硬缩（给非 OSS 域名/PDF 加参数）⇒ 图直接加载失败，比 ① 更糟。
 * 两档都要挡住。
 *
 * ⛔ 反向自检：`src/utils/ossThumb.js` 是本次新增文件，改前不存在
 *   ⇒ 本测试在改前必然判红（import 失败）。无需另存旧版副本。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { ossThumbUrl, isOssHost, DEFAULT_THUMB_WIDTH } from '../src/utils/ossThumb.js'

/** 真实库里的上传图 URL 形状（取自 tasks.image_url，2026-10-08 实测）。 */
const REAL = 'https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/dcb70af2-9640-42df-bf9e-b4b918feb11b/20261002/549db8ac-c90e-4bae-afcf-cda2306c13b5.jpg'

test('真实 OSS 上传图 ⇒ 追加 OSS 图片处理参数（默认 240 宽）', () => {
  const out = ossThumbUrl(REAL)
  assert.equal(out, `${REAL}?x-oss-process=image/resize,w_240`)
  assert.equal(DEFAULT_THUMB_WIDTH, 240)
})

test('参数语法必须是 OSS 认得的 image/resize,w_N（写错等于没缩）', () => {
  assert.match(ossThumbUrl(REAL), /\?x-oss-process=image\/resize,w_\d+$/)
})

test('已带查询串的 URL 用 & 连接，不吞掉原参数', () => {
  const out = ossThumbUrl(`${REAL}?v=2`)
  assert.equal(out, `${REAL}?v=2&x-oss-process=image/resize,w_240`)
})

test('幂等：已带 x-oss-process 的 URL 原样返回，不叠第二层', () => {
  const once = ossThumbUrl(REAL)
  assert.equal(ossThumbUrl(once), once)
  assert.equal(ossThumbUrl(`${REAL}?x-oss-process=image/resize,w_100`), `${REAL}?x-oss-process=image/resize,w_100`)
})

test('自定义宽度生效', () => {
  assert.equal(ossThumbUrl(REAL, 480), `${REAL}?x-oss-process=image/resize,w_480`)
})

test('宽度非法时回落默认值（不产出 w_NaN 这种废参数）', () => {
  for (const bad of [0, -5, NaN, 'abc', null, undefined]) {
    assert.equal(ossThumbUrl(REAL, bad), `${REAL}?x-oss-process=image/resize,w_240`, `width=${String(bad)}`)
  }
})

test('非 OSS 域名原样返回 —— 不给别人的 CDN 硬加参数', () => {
  const other = 'https://cdn.example.com/images/a.jpg'
  assert.equal(ossThumbUrl(other), other)
  assert.equal(ossThumbUrl('https://images.unsplash.com/photo-1.jpg'), 'https://images.unsplash.com/photo-1.jpg')
})

test('近似域名不得命中（evil-aliyuncs.com / aliyuncs.com.evil.net）', () => {
  assert.equal(isOssHost('evil-aliyuncs.com'), false)
  assert.equal(isOssHost('aliyuncs.com.evil.net'), false)
  assert.equal(isOssHost('myaliyuncs.com'), false)
  assert.equal(isOssHost('minxue-app-oss.oss-cn-shanghai.aliyuncs.com'), true)
  const spoof = 'https://evil-aliyuncs.com/images/a.jpg'
  assert.equal(ossThumbUrl(spoof), spoof)
})

test('非图片扩展名原样返回（PDF 等经不起图片处理）', () => {
  const pdf = 'https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/pdfs/a.pdf'
  assert.equal(ossThumbUrl(pdf), pdf)
})

test('非 http(s) / 非法 / 空值不炸，原样返回或空串', () => {
  const blob = 'blob:http://localhost/abc'
  const data = 'data:image/png;base64,AAAA'
  assert.equal(ossThumbUrl(blob), blob)
  assert.equal(ossThumbUrl(data), data)
  assert.equal(ossThumbUrl('/images/local.jpg'), '/images/local.jpg')
  assert.equal(ossThumbUrl(''), '')
  assert.equal(ossThumbUrl('   '), '')
  assert.equal(ossThumbUrl(null), '')
  assert.equal(ossThumbUrl(undefined), '')
  assert.equal(ossThumbUrl(12345), '')
  assert.equal(ossThumbUrl({}), '')
})

test('hash 不被吞掉', () => {
  assert.equal(ossThumbUrl(`${REAL}#frag`), `${REAL}?x-oss-process=image/resize,w_240#frag`)
})
