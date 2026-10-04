/**
 * 前端禁直调 AI 回归锁（2026-10-04 第 103 轮，负责人裁决⑧「做」）
 *
 * 背景：前端曾有两条「浏览器直调魔搭」路径（key 烤进 JS 包）——
 *   A. useUploadFlow.processTask → recognizeQuestions（重练卷作答识别）；
 *   B. features/PaperBank → processMultiPagePaperLayout（试卷答案库导入）。
 * 线上包里烤的是占位符 key（your-ai-api-key），生产上这两处**每次 401**：
 * 重练卷上传后必弹假「识别失败」，真正批改一直在服务端 worker
 * processSlimGrading（精简管线）完成。r103 整体拔除，批改口径归一到服务端。
 *
 * 本锁（src/ 范围）：
 *   1. 禁止再出现魔搭端点 / VITE_AI_API_KEY / AI_CONFIG / buildOCRPrompt（前端 AI 配置复活即红）；
 *   2. 已删文件不得回来（aiService / paperBankAIService / taggingService /
 *      recognitionStorage / qrContent / config/ai / features/PaperBank）。
 *
 * 反向自检：collectFailures 套在 r102 旧树上（_r103_old/，git archive 导出）必须判红。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const BANNED_SNIPPETS = [
  ['api-inference.modelscope.cn', '前端不得再直连魔搭端点'],
  ['VITE_AI_API_KEY', '前端 AI key 环境变量不得复活（批改归服务端）'],
  ['VITE_AI_ENDPOINT', '前端 AI 端点环境变量不得复活'],
  ['VITE_AI_MODEL', '前端 AI 模型环境变量不得复活'],
  ['AI_CONFIG', '前端 AI 配置对象不得复活'],
  ['buildOCRPrompt', '前端 OCR 提示词不得复活（提示词归服务端）'],
]

const FORBIDDEN_FILES = [
  'src/config/ai.js',
  'src/services/aiService.js',
  'src/services/paperBankAIService.js',
  'src/services/taggingService.js',
  'src/services/recognitionStorage.js',
  'src/services/qrContent.js',
  'src/features/PaperBank/index.jsx',
]

/** 收集 dir 下命中禁语的文件。导出供反向自检在旧树上复用。 */
export function collectFailures(dir) {
  const fails = []
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const full = join(d, e)
      const st = statSync(full)
      if (st.isDirectory()) { walk(full); continue }
      if (!/\.(js|jsx|vue|css|json|html)$/.test(e)) continue
      const rel = full.slice(dir.length + 1).replace(/\\/g, '/')
      if (rel.startsWith('mobile/')) continue // Capacitor 原生壳目录，与 AI 无关
      const text = readFileSync(full, 'utf8')
      for (const [needle, msg] of BANNED_SNIPPETS) {
        if (text.includes(needle)) fails.push(`${rel}: ${msg}（命中 "${needle}"）`)
      }
    }
  }
  walk(dir)
  for (const f of FORBIDDEN_FILES) {
    if (existsSync(join(dir, f))) fails.push(`${f}: 已删除的前端 AI 文件不得回来`)
  }
  return fails
}

test('⛔ src/ 下禁止前端直调 AI（端点/配置/已删文件全部不得复活）', () => {
  const failures = collectFailures(join(ROOT, 'src'))
  assert.deepEqual(
    failures,
    [],
    `\n发现 ${failures.length} 处违规：\n` + failures.map((f) => `  - ${f}`).join('\n')
      + '\n批改与识别统一走服务端（worker processSlimGrading / server/config/ai.js）。'
  )
})

test('锁健全性：判据确实存在且服务端 AI 配置未误伤', () => {
  const probe = collectFailures(join(ROOT, '_r103_old', 'src'))
  assert.ok(probe.length >= 5, `判据套 r102 旧树应报 ≥5 处，实际 ${probe.length} —— 锁可能被掏空`)
  const serverAI = readFileSync(join(ROOT, 'server/config/ai.js'), 'utf8')
  assert.ok(serverAI.length > 500, '服务端 AI 配置（server/config/ai.js）必须仍在 —— 删的是前端，不是服务端')
})
