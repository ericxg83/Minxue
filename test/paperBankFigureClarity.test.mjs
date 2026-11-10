/**
 * 试卷题库「配图必须清晰」回归锁（2026-11-09 二次报障沉淀）。
 *
 * 事故链：老师报「2026 上海松江一模卷配图都是模糊的」。上午只修了列表行
 * `thumbUrl(q.image_url)` → 直连原图（commit 423e6c1），但**没 push**，线上仍带
 * `?x-oss-process=image/resize,w_480`；同时该卷裁片仅 300~900px，2x 屏下放大发虚。
 * ⇒ 两层都要锁：① 显示层不许再套缩略图；② 讲解版/组卷也直连原图。
 *
 * 判据用源码静态锁 + 反向自检（把修好的版本写坏喂同一函数必须判红），
 * 不依赖数据库/网络，可在任何环境跑。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8')
const stripComments = (s) => String(s)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/<!--[\s\S]*?-->/g, '')

const VIEW = 'src/workbench/views/PaperBankWorkbench.vue'
const LECTURE = 'src/utils/lecturePdf.js'
const COMPOSE = 'src/utils/composePaperPdf.js'

/** @returns {string[]} 违规列表，空数组 = 通过 */
function figureClarityViolations(viewSrc, lectureSrc, composeSrc) {
  const bad = []
  const figTag = viewSrc.match(/<img[^>]*class="pb-row__figure"[^>]*>/)
  if (!figTag) return ['找不到 .pb-row__figure 的 img 标签（锚点丢失，fail-closed）']
  const tag = figTag[0]
  if (!/:src="q\.vec_url \|\| q\.image_url"/.test(tag)) {
    bad.push('列表配图必须直连 q.vec_url || q.image_url（原图/矢量），不得经过任何缩略函数')
  }
  if (/thumbUrl|ossThumbUrl|x-oss-process|resize,w_/.test(tag)) {
    bad.push('列表配图标签里出现缩略图调用')
  }
  // 整份视图里不允许出现把配图交给 ossThumbUrl 的 import 或调用
  if (/import\s*\{[^}]*ossThumbUrl[^}]*\}/.test(viewSrc)) {
    bad.push('PaperBankWorkbench 不得再 import ossThumbUrl')
  }
  for (const [name, src] of [['讲解版', lectureSrc], ['组卷', composeSrc]]) {
    if (!src) continue
    const imgLines = src.split('\n').filter(l => /<img[^>]*src=/.test(l))
    const thumbed = imgLines.filter(l => /ossThumbUrl|x-oss-process|resize,w_/.test(l))
    if (thumbed.length) bad.push(`${name} PDF 的配图不得走 OSS 缩略`)
  }
  return bad
}

test('★ 试卷题库配图：列表 / 讲解版 / 组卷一律直连原图，不得套 480 缩略', () => {
  const violations = figureClarityViolations(
    stripComments(read(VIEW)), stripComments(read(LECTURE)), stripComments(read(COMPOSE)))
  assert.deepEqual(violations, [], violations.join('；'))
})

test('★ 讲解版配图矢量优先、原图兜底（高清裁片是打印清晰度的下限）', () => {
  const s = stripComments(read(LECTURE))
  assert.match(s, /it\.vec_url \|\| it\.image_url/, '讲解版优先矢量、缺了回落高清裁片')
  assert.match(s, /lec-img/, '讲解版配图容器必须存在')
})

test('反向自检：把直连原图改回 thumbUrl(480) 必须判红', () => {
  const view = stripComments(read(VIEW))
  const broken = view.replace(':src="q.vec_url || q.image_url"', ':src="thumbUrl(q.image_url)"')
  assert.notEqual(broken, view, '替换点必须命中')
  const violations = figureClarityViolations(broken, stripComments(read(LECTURE)), stripComments(read(COMPOSE)))
  assert.ok(violations.length > 0, '写坏的版本必须被同一检查函数判红')
})

test('反向自检：删掉配图 img 标签必须判红（防止锚点静默消失）', () => {
  const view = stripComments(read(VIEW)).replace(/<img[^>]*class="pb-row__figure"[^>]*>/, '')
  const violations = figureClarityViolations(view, '', '')
  assert.ok(violations.some(v => v.includes('找不到')), '锚点丢失必须 fail-closed')
})

/**
 * ⛔ 2026-11-10 四次报障的真因：canvas.toBuffer('image/jpeg', quality) 用 0~100 整数，
 * 生产管线曾写 CROP_RENDER_QUALITY = 0.92 ⇒ 4x 整页图只有 84KB（其他卷 432~558KB），
 * 从源头把整卷所有裁片压糊。前三轮都在给一张压坏的图做后期增强，全错。
 * 这里把参数口径锁死，任何回退都必须判红。
 * @returns {string[]} 违规列表，空数组 = 通过
 */
function renderQualityViolations(src) {
  const bad = []
  if (!/const CROP_RENDER_QUALITY = 92\b/.test(src)) bad.push('4x 高清页渲染质量必须是整数 92')
  if (/CROP_RENDER_QUALITY\s*=\s*0\.\d+/.test(src)) bad.push('禁止把 quality 写成 0~1 小数（整卷压糊的根因）')
  if (!/quality: CROP_RENDER_QUALITY/.test(src)) bad.push('4x 渲染必须显式传 quality')
  if (!/scale: CROP_RENDER_SCALE/.test(src)) bad.push('裁片必须走 4x 高清页，不得退回 2x')
  return bad
}

const SERVICE = 'server/services/paperBankService.js'
const REHI = 'scripts/ops/rehi_paper_figures.mjs'

test('★ 4x 高清页渲染质量必须是 92（0~100 整数），禁止回退 0.92', () => {
  assert.deepEqual(renderQualityViolations(read(SERVICE)), [])
})

test('★ 存量卷重渲染工具必须按同一工序（4x + quality=92 + 按 bbox 重裁）', () => {
  const s = read(REHI)
  assert.match(s, /quality: 92/, '存量重渲染必须与生产同一质量口径')
  assert.match(s, /scale: 4/, '必须是 4x')
  assert.match(s, /cropQuestionImage/, '必须复用生产裁剪函数')
  assert.match(s, /analyzeCropFigure/, '必须复用生产图形带判据')
  assert.ok(!/UnsharpMask|\.sharpen\(|linear\(1\.5/.test(s), '不得做任何像素增强（按其他卷原样重裁）')
})

test('反向自检：把 92 改回 0.92 或删掉 quality 传参，两种都判红', () => {
  const src = read(SERVICE)
  const broken = src.replace('const CROP_RENDER_QUALITY = 92', 'const CROP_RENDER_QUALITY = 0.92')
  assert.notEqual(broken, src, '替换点必须命中')
  assert.ok(renderQualityViolations(broken).length > 0, '写回小数质量必须判红')

  const noParam = src.replace('quality: CROP_RENDER_QUALITY,', '')
  assert.ok(renderQualityViolations(noParam).length > 0, '删掉显式传参必须判红')
})
