/**
 * 回归锁：组件卸载必须清理已挂起的定时器（R47，2026-10-12）
 *
 * 背景：R46/R47 全仓扫描监听器/setInterval/setTimeout 的成对清理。
 *   - 监听器 15 处（Vue 8 + React 7）全成对；DOMContentLoaded 用 once:true 自动移除；
 *     httpCore 模块级单例常驻属设计行为。
 *   - setInterval 12 处与 clearInterval 12 处一一对应。
 *   - setTimeout 50 处中 49 处有清理/一次性/防御校验；唯一缺口：
 *     `src/pages/WrongBookPage.jsx` 长按定时器（450ms 进入多选模式）只有
 *     cancelPress 清理，组件卸载时若长按仍在进行，定时器触发会 setState 已卸载组件。
 *
 * 修复（R47）：加卸载 cleanup effect，卸载时清 pressTimer。
 *
 * 判据设计：源码级锁定 —— WrongBookPage 必须存在独立的「卸载清理 effect」，
 * 其中对 pressTimer.current 做 clearTimeout。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PAGE = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'WrongBookPage.jsx'), 'utf-8')

test('R47 回归锁：WrongBookPage 卸载必须清长按定时器', () => {
  // 找到「卸载 cleanup」effect：useEffect(() => { return () => {...pressTimer 清理...} }, [])
  const m = PAGE.match(/useEffect\(\(\) => \{\n\s*return \(\) => \{\n\s*if \(pressTimer\.current\) \{ clearTimeout\(pressTimer\.current\); pressTimer\.current = null \}\n\s*\}\n\s*\}, \[\]\)/)
  assert.ok(m, '必须存在卸载 effect：cleanup 中清空 pressTimer.current')
  // 结构约束：必须真正调用 clearTimeout，而不是只置 null
  assert.match(m[0], /clearTimeout\(pressTimer\.current\)/, '必须调用 clearTimeout')
})