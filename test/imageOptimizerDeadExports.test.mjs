/**
 * imageOptimizer 死导出回归锁（r357）
 *
 * 防护对象：src/utils/imageOptimizer.js 曾含 7 个零调用方的逐像素处理函数
 * （removeBlackRegions / adjustContrast / sharpenImage / optimizeImage /
 *  cropAndOptimizeImage / autoCropBlackBorders / removeTextBackground）。
 * 它们自出生起从未被任何模块调用（上传压缩走 imageUtils.compressImagesForUpload），
 * 2026-10-29 r357 已整组删除；本锁防止它们被重新引入或重新接线。
 *
 * 反向自检分层：
 *  - 导出断言：合成重新导出这些函数的目标文件必须判红；
 *  - 引用探测：合成 import+调用样本必须被全仓扫描逻辑判红。
 * 两层都证明判据不是空锁（不依赖 git）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')
const TARGET = path.join(ROOT, 'src/utils/imageOptimizer.js')
const THIS_FILE = __filename

const REMOVED = [
  'removeBlackRegions',
  'adjustContrast',
  'sharpenImage',
  'optimizeImage',
  'cropAndOptimizeImage',
  'autoCropBlackBorders',
  'removeTextBackground',
]

const isExportOf = (src, name) =>
  new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b`).test(src) ||
  new RegExp(`export\\s*\\{[^}]*\\b${name}\\b`).test(src)

const hasReference = (txt) => REMOVED.some((name) => new RegExp(`\\b${name}\\b`).test(txt))

test('imageOptimizer 不再导出 7 个已删死的逐像素处理函数', () => {
  const src = fs.readFileSync(TARGET, 'utf8')
  for (const name of REMOVED) {
    assert.ok(!isExportOf(src, name), `${path.relative(ROOT, TARGET)} 不应再导出 ${name}`)
  }
})

test('imageOptimizer 仅保留 dataURLtoFile / rotateImageByUrl 两个活导出', () => {
  const src = fs.readFileSync(TARGET, 'utf8')
  const exported = REMOVED.filter((name) => isExportOf(src, name))
  assert.deepEqual(exported, [], `不应再导出已删函数：${exported.join(', ')}`)
  assert.ok(
    /export\s+(async\s+)?function\s+dataURLtoFile\b/.test(src),
    'dataURLtoFile 必须仍是导出'
  )
  assert.ok(
    /export\s+(async\s+)?function\s+rotateImageByUrl\b/.test(src),
    'rotateImageByUrl 必须仍是导出'
  )
})

test('全仓 src/ + test/ 不再引用被删死的 7 个函数', () => {
  const offenders = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue
        walk(full)
      } else if (full !== TARGET && full !== THIS_FILE && /\.(js|jsx|mjs|ts|tsx|vue)$/.test(entry.name)) {
        const txt = fs.readFileSync(full, 'utf8')
        if (hasReference(txt)) {
          for (const name of REMOVED) {
            if (new RegExp(`\\b${name}\\b`).test(txt)) offenders.push(`${name} @ ${path.relative(ROOT, full)}`)
          }
        }
      }
    }
  }
  walk(path.join(ROOT, 'src'))
  walk(path.join(ROOT, 'test'))
  assert.deepEqual(offenders, [], `发现残留引用:\n${offenders.join('\n')}`)
})

test('反向自检：合成重新导出被删函数的目标文件必须判红', () => {
  const syntheticTarget = `
    export async function optimizeImage(src) { return src }
    export function removeTextBackground(src) { return src }
  `
  for (const name of ['optimizeImage', 'removeTextBackground']) {
    assert.ok(isExportOf(syntheticTarget, name), `导出断言应能命中重新导出的 ${name}（否则是空锁）`)
  }
  assert.ok(!isExportOf('export function dataURLtoFile(){}', 'optimizeImage'), '导出断言不应误伤活导出')
})

test('反向自检：合成含被删函数的 import+调用样本必须被扫描逻辑判红', () => {
  const synthetic = `
    import { optimizeImage, removeTextBackground } from '../utils/imageOptimizer'
    const a = await optimizeImage(x)
    const b = removeTextBackground(y)
  `
  const hits = REMOVED.filter((name) => new RegExp(`\\b${name}\\b`).test(synthetic))
  assert.ok(hits.length > 0, '引用扫描对含被删函数的样本必须判红，否则是空锁')
  assert.ok(hits.includes('optimizeImage'), 'optimizeImage 必须被命中')
  assert.ok(hits.includes('removeTextBackground'), 'removeTextBackground 必须被命中')
})
