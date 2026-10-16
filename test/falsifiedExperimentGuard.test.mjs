/**
 * r297 回归锁：两个「证伪实验」服务模块不得复活（pageRuler + figureCompleteness）。
 *
 * 真缺陷（实测，2026-10-16 r297 零导入方扫描发现）：
 *   两个模块自出生起**全仓零导入方**，且都被实验数据证伪，却一直躺在活代码树里：
 *   ① `server/services/pageRuler.js`（b93c594，2026-09-20 生，45 行）：
 *      给页图叠归一化刻度让视觉模型「读刻度」。2026-09-20 实测结论
 *      （.workbuddy-ai/memory/2026-09-20.md:69 + topics/bbox-contract.md:24）：
 *      **「不提升精度」「无收益」**。从未接线：git log -S 全史只有 patrol 文档
 *      提及（R61/R62 两轮「✅健全」审计只描述了它做什么，**没查调用方**——
 *      「门禁看着在，其实没在」的同型）。
 *   ② `server/utils/figureCompleteness.js`（1b26340，2026-09-24 入库，136 行）：
 *      配图完整性纯像素复检。2026-09-23 标定实验结论
 *      （.workbuddy/memory/2026-09-23.md:547）：**「证伪的像素启发式，未上生产，
 *      可删可留作记录」**。从未接线：git log -S 全史只有 patrol 文档提及。
 *   ⇒ r297 删除两文件（A 级死代码清理；git 历史可恢复）。
 *
 * 本守卫盯「别再回来」：① 两文件不得重新存在；② server/scripts/test 活代码
 *   （剔注释后）不得出现两模块的导出令牌。
 *   ⚠️ 不扫 server/_* 探针（.gitignore 的本机存档区，_probe_ruler_measure.mjs /
 *      _diag_figcomplete_calib_0923.mjs 是当年实验的标定件，属历史记录）；
 *      不扫 .vue（前端不可能 import server 模块，扫了只会增加假红面）。
 *
 * 反向自检用被删模块的真实活代码行（内联合成，⛔ 不 spawnSync 调 git，Windows EBUSY）。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = 'test/falsifiedExperimentGuard.test.mjs'

/** 被删模块 → 禁令牌（导出名 + 文件名主干，覆盖「重新加文件」与「重新 import」两种复活形态） */
const DEAD_MODULES = [
  { file: 'server/services/pageRuler.js', tokens: ['pageRuler', 'renderRuledImage'] },
  {
    file: 'server/utils/figureCompleteness.js',
    tokens: ['figureCompleteness', 'verifyFigureCompleteness', 'FIGCOMPLETE_THRESHOLDS'],
  },
]

/** 剔注释：块/行注释里的「反面教材」说明不能判成违规（本文件自己的头注就引用这些名字） */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

/**
 * 判据集合：给定 [相对路径, 源码] 列表，返回「证伪实验模块复活」违规列表。
 */
export function collectDeadModuleRefs(files) {
  const fails = []
  for (const [file, src] of files) {
    const body = stripComments(src)
    for (const mod of DEAD_MODULES) {
      for (const token of mod.tokens) {
        if (body.includes(token)) {
          fails.push(`${file} 仍引用已删除的证伪实验模块 ${mod.file}（令牌 ${token}；r297 清理：实测无收益/已证伪，见该模块 git 历史）`)
        }
      }
    }
  }
  return fails
}

/** 递归枚举若干根目录下的活代码候选（.js/.mjs/.cjs），跳过 server/_* 探针存档区与本锁自身 */
function listCodeFiles(dirs) {
  const out = []
  for (const dir of dirs) {
    const abs = join(ROOT, dir)
    if (!existsSync(abs)) continue
    const walk = (d) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name)
        const rel = full.slice(ROOT.length + 1).replaceAll('\\', '/')
        // server/_* 是 .gitignore 的本机探针存档区（_probe_ruler_measure.mjs /
        //   _diag_figcomplete_calib_0923.mjs 是当年实验的标定件，不是活代码）
        if (dir === 'server' && entry.name.startsWith('_')) continue
        if (entry.isDirectory()) {
          walk(full)
          continue
        }
        if (!/\.(js|mjs|cjs)$/.test(entry.name)) continue
        if (rel === SELF) continue
        out.push([rel, readFileSync(full, 'utf8')])
      }
    }
    walk(abs)
  }
  return out
}

test('两个证伪实验模块文件不得重新存在', () => {
  const existing = DEAD_MODULES.filter((m) => existsSync(join(ROOT, m.file))).map((m) => m.file)
  assert.deepEqual(existing, [], `不得恢复已删除的证伪实验模块：${existing.join(', ')}`)
})

test('server/** + scripts/** + test/** 无证伪实验模块活引用（pageRuler / figureCompleteness）', () => {
  const fails = collectDeadModuleRefs(listCodeFiles(['server', 'scripts', 'test']))
  assert.deepEqual(fails, [])
})

test('反向自检：被删模块的真实活代码行必须判红', () => {
  // = git show HEAD: 导出件 logs/_r297_reverse/ 的真实活代码行（r297 删除）
  //   pageRuler.old.js（b93c594，2026-09-20）：导出签名本体
  const oldPageRuler = [
    'import sharp from "sharp"',
    'export async function renderRuledImage (imageBuffer, opts = {}) {',
  ].join('\n')
  //   复活形态二：别的模块重新 import 它（_probe_ruler_measure.mjs 当年的调用行）
  const oldPageRulerImport = "import { renderRuledImage } from './services/pageRuler.js'"
  //   figureCompleteness.old.js（1b26340，2026-09-24）：导出签名本体
  const oldFigureCompleteness = [
    'export const verifyFigureCompleteness = (inkMask, w, h, box) => {',
    'export const FIGCOMPLETE_THRESHOLDS = Object.freeze({',
  ].join('\n')

  const fails = collectDeadModuleRefs([
    ['server/services/pageRuler.js(修复前)', oldPageRuler],
    ['server/_probe_ruler_measure.mjs(修复前)', oldPageRulerImport],
    ['server/utils/figureCompleteness.js(修复前)', oldFigureCompleteness],
  ])
  // 三个样本都要判红（文件本体 + import 复活形态 + 第二模块），且必须点名两个模块的令牌
  assert.ok(fails.length >= 3, `旧活代码应至少判 3 条红，实际 ${fails.length} 条：${fails.join(' / ')}`)
  assert.ok(
    fails.some((f) => f.includes('pageRuler.js') && f.includes('renderRuledImage')),
    '红必须点名 pageRuler 模块与 renderRuledImage 令牌（否则判据没盯住缺陷本体）'
  )
  assert.ok(
    fails.some((f) => f.includes('figureCompleteness.js') && f.includes('verifyFigureCompleteness')),
    '红必须点名 figureCompleteness 模块与 verifyFigureCompleteness 令牌（否则判据没盯住缺陷本体）'
  )
})
