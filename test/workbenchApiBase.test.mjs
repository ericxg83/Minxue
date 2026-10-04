/**
 * workbench API base 统一回归锁（2026-10-04 第 100 轮，负责人裁决⑦）
 *
 * 背景：workbench 里 11 处裸 `fetch('/api/...')` / fetch(`/api/...`) 用字面相对路径，
 * 而 apiService 走 `VITE_API_URL || '/api'` —— 隔离构建产物里两套口径并存：
 * apiService 打生产、裸 fetch 打本地代理。r95 已把构建强制本地化，本轮把口径归一：
 *  - 轮询/上传改走 apiService（QuotaBanner → apiRequest；QuestionDetailPanel → 既有 uploadImage）；
 *  - blob 下载新增 apiService.apiRequestBlob（HandoutPreview 讲义 Word 导出）；
 *  - 诊断页批量端点（WorksheetManagement）统一 `fetch(`${API_BASE}/...`)`。
 *
 * 本锁：src/workbench 下**不得再出现字面 '/api' 的裸 fetch**（fetch(`/api… 或 fetch('/api…）。
 * 反向自检：collectBareApiFetches 套在 r99 旧树上（_r100_old/）必须报出 11 处。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function stripComments(src) {
  return String(src)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** 收集目录下所有「字面 /api 开头的裸 fetch」。导出供反向自检在旧树上复用。 */
export function collectBareApiFetches(dir) {
  const offenders = []
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const full = join(d, e)
      const st = statSync(full)
      if (st.isDirectory()) { walk(full); continue }
      if (!/\.(vue|js|jsx)$/.test(e)) continue
      const code = stripComments(readFileSync(full, 'utf8'))
      for (const m of code.matchAll(/fetch\(\s*(['"`])\/api/g)) {
        offenders.push(`${full.slice(dir.length + 1)}: ${m[0]}…`)
      }
    }
  }
  walk(dir)
  return offenders
}

test('⛔ src/workbench 下不得再有字面 /api 的裸 fetch（base 必须走 API_BASE / apiService）', () => {
  const offenders = collectBareApiFetches(join(ROOT, 'src/workbench'))
  assert.deepEqual(
    offenders,
    [],
    `\n发现 ${offenders.length} 处裸 fetch('/api…')：\n` + offenders.map((o) => `  - ${o}`).join('\n')
      + '\n统一口径：常规请求走 apiService.apiRequest；blob 下载走 apiService.apiRequestBlob；'
      + '确需裸 fetch 时用 httpCore 的 API_BASE 拼前缀。'
  )
})

test('统一能力存在：apiService.apiRequestBlob 与 httpCore.requestBlob', () => {
  const api = readFileSync(join(ROOT, 'src/services/apiService.js'), 'utf8')
  const core = readFileSync(join(ROOT, 'src/services/httpCore.js'), 'utf8')
  assert.match(api, /export const apiRequestBlob/, 'apiService 应导出 apiRequestBlob')
  assert.match(api, /import \{ requestJson, requestBlob/, 'apiService 应从 httpCore 引入 requestBlob')
  assert.match(core, /export async function requestBlob/, 'httpCore 应导出 requestBlob')
})
