/**
 * 「无可重绘的几何结构」闸门回归测试（2026-09-26 建立）。
 *
 * 背景：`getGeometryDisplayUrl` 里那道闸门原写在优先级 0（紧跟 manual_override），
 * 无条件 return none。它的原意是「服务端在**裁剪原图**上判不出几何结构 ⇒ 这张裁片不可信，
 * 别把错东西端给用户」，但实际拦的是「**DSL 重绘通道**判不出可重绘结构」——数轴、统计图、
 * 流程图、折纸示意本来就不在 DSL 图元范畴内，判不出来是通道能力边界，不是裁片有问题。
 *
 * 线上实测（229 道引图错题）：该闸门一刀切挡住 14 道，其中 11 道裁片目检完全可用
 * （数轴 / A₀ 折纸 / 加密流程图 / 3×3 格点图 / △ABC…），3 道裁到了学生手写、已重新定位修好。
 * 因此把闸门下移到「原始裁片回退之前」（优先级 6）：
 *   · 上游 1~5 的独立产物（clean_geometry_svg / clean_geometry_image_url）不再被吞掉；
 *   · 只剩原始裁片的题**照旧挡住**（闸门不得整体删除）。
 *
 * 本文件锁定这两个方向。题干与字段形态取自线上真实行（`_diag_fig_none14_gate.mjs` 输出）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { getGeometryDisplayUrl } from '../src/utils/geometryDisplay.js'

// 线上真实值：question_assets.last_error 原文（ef27a135 等 14 条同一批）
const NON_REDRAW_ERR = '无可重绘的几何结构（数轴/实物/统计图），已回退裁剪原图'
// 其他 'none' 原因（派生点未解）—— 不得被本闸误伤，应照旧展示裁片
const OTHER_ERR = 'Vision 重建超过最大重试 (3),已回退裁剪原图。最后一次错误: 派生点未被约束确定'

const CLEAN_URL = 'https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/x/20260926/abc.png'
const RAW_URL = 'https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/x/geometry_y_z.png'
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">'
  + '<line x1="0" y1="0" x2="10" y2="10"/></svg>'

// ── 方向一：上游产物不得被吞（这是本次修复的目的） ──

test('有矢量化 clean URL + 判「无可重绘」→ 展示 clean（修复前被闸门吞掉）', () => {
  const r = getGeometryDisplayUrl({
    tikz_status: 'none',
    asset_last_error: NON_REDRAW_ERR,
    clean_geometry_image_url: CLEAN_URL,
    geometry_image_url: RAW_URL,
  })
  assert.equal(r.type, 'clean')
  assert.equal(r.url, CLEAN_URL)
})

test('有 clean SVG + 判「无可重绘」→ 展示 svg_code', () => {
  const r = getGeometryDisplayUrl({
    tikz_status: 'none',
    asset_last_error: NON_REDRAW_ERR,
    clean_geometry_svg: SVG,
    geometry_image_url: RAW_URL,
  })
  assert.equal(r.type, 'svg_code')
  assert.equal(r.url, SVG)
})

// ── 方向二：只剩原始裁片时必须照旧挡住（闸门不得整体删除） ──

test('只剩原始裁片 + 判「无可重绘」→ none（闸门保留）', () => {
  const r = getGeometryDisplayUrl({
    tikz_status: 'none',
    asset_last_error: NON_REDRAW_ERR,
    clean_geometry_svg: null,
    clean_geometry_image_url: null,
    geometry_image_url: RAW_URL,
  })
  assert.equal(r.type, 'none')
  assert.equal(r.url, null)
})

test('既无 clean 产物也无裁片 → none', () => {
  const r = getGeometryDisplayUrl({
    tikz_status: 'none', asset_last_error: NON_REDRAW_ERR,
    geometry_image_url: null,
  })
  assert.equal(r.type, 'none')
})

test('clean_geometry_image_url 是空串（非 null）也算没有产物 → none', () => {
  const r = getGeometryDisplayUrl({
    tikz_status: 'none', asset_last_error: NON_REDRAW_ERR,
    clean_geometry_image_url: '', geometry_image_url: RAW_URL,
  })
  assert.equal(r.type, 'none')
})

// ── 边界：其他 'none' 原因不得被本闸误伤 ──

test('其他失败原因（派生点未解）+ 裁片 → 照旧展示 raw（行为不变）', () => {
  const r = getGeometryDisplayUrl({
    tikz_status: 'none', asset_last_error: OTHER_ERR, geometry_image_url: RAW_URL,
  })
  assert.equal(r.type, 'raw')
  assert.equal(r.url, RAW_URL)
})

test('无 tikz_status / 无 last_error → 照旧展示 raw（旧数据兼容）', () => {
  for (const q of [
    { geometry_image_url: RAW_URL },
    { tikz_status: 'none', geometry_image_url: RAW_URL },
    { tikz_status: 'none', asset_last_error: null, geometry_image_url: RAW_URL },
  ]) {
    assert.equal(getGeometryDisplayUrl(q).type, 'raw', JSON.stringify(q))
  }
})

test('tikz_status 非 none 时本闸不生效 → 展示 raw', () => {
  const r = getGeometryDisplayUrl({
    tikz_status: 'failed', asset_last_error: NON_REDRAW_ERR, geometry_image_url: RAW_URL,
  })
  assert.equal(r.type, 'raw')
})

// ── 与既有闸门的相对优先级（下移后不得越过 manual_override / 残图判据） ──

test('manual_override 仍优先于一切（含本闸）', () => {
  const r = getGeometryDisplayUrl({
    geometry_manual_override: true,
    geometry_image_url: RAW_URL,
    clean_geometry_image_url: CLEAN_URL,
    tikz_status: 'none', asset_last_error: NON_REDRAW_ERR,
  })
  assert.equal(r.type, 'raw')
  assert.equal(r.url, RAW_URL)
})

test('画残的 SVG 仍被跳过，落到 clean URL（不因下移而放行残图）', () => {
  const degenerate = '<svg xmlns="http://www.w3.org/2000/svg">'
    + '<g stroke="#111" fill="none"></g><circle cx="1" cy="1" r="2.4"/></svg>'
  const r = getGeometryDisplayUrl({
    tikz_status: 'none', asset_last_error: NON_REDRAW_ERR,
    clean_geometry_svg: degenerate, clean_geometry_image_url: CLEAN_URL,
    geometry_image_url: RAW_URL,
  })
  assert.equal(r.type, 'clean')
  assert.equal(r.url, CLEAN_URL)
})
