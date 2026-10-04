/**
 * 周学习诊断报告「错因分布」链路回归锁（2026-10-04，移动端赛道 r117q）
 *
 * 负责人要求：错因是重要信息，且系统里已有 diagnosisService 回填的 wrong_questions.error_type，
 * 只需聚合调用、不重造。本锁守住这条链路两端不被静默改没：
 *   1) 后端 weeklyReport.js 必须按 error_type 聚合（GROUP BY ... error_type）并返回 errorDistribution；
 *   2) 前端 weeklyReportGenerator.js 必须渲染「错因分布」(renderErrorDistribution + 接入学科页)。
 *
 * 反向自检：内联合成「无错因链路」的旧代码，判据必须报红（防空锁，不依赖 git）。
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function collectFailures(root) {
  const fails = []
  const read = (rel) => {
    const p = join(root, rel)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }

  const api = read('server/routes/weeklyReport.js')
  if (api !== null) {
    if (!/error_type/.test(api)) fails.push('weeklyReport.js: 未按 error_type 聚合（错因链路断）')
    if (!/errorDistribution/.test(api)) fails.push('weeklyReport.js: 未返回 errorDistribution 字段')
    if (!/is_blank IS NOT TRUE/.test(api)) fails.push('weeklyReport.js: 错因聚合必须排除空题（is_blank IS NOT TRUE）')
  }

  const gen = read('src/utils/weeklyReportGenerator.js')
  if (gen !== null) {
    if (!gen.includes('renderErrorDistribution')) fails.push('weeklyReportGenerator: 缺 renderErrorDistribution')
    if (!gen.includes('错因分布')) fails.push('weeklyReportGenerator: 学科页未渲染「错因分布」')
    if (!gen.includes('errorDistribution')) fails.push('weeklyReportGenerator: 未消费 errorDistribution 数据')
  }

  return fails
}

test('⛔ 周报错因分布链路（当前树两端都在）', () => {
  const failures = collectFailures(ROOT)
  assert.deepEqual(failures, [], `\n发现 ${failures.length} 处违规：\n` + failures.map(f => `  - ${f}`).join('\n'))
})

test('锁健全性：判据套合成坏样本必须判红（防空锁）', () => {
  const base = join(ROOT, '_r117q_errcause_bad')
  const put = (rel, c) => { const p = join(base, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c, 'utf8') }
  put('server/routes/weeklyReport.js', `const result = { success: true, stats, knowledgeDiagnosis, subjectDiagnosis }`)
  put('src/utils/weeklyReportGenerator.js', `export function buildDiagnosisHTML(d){ return '<html>学科诊断</html>' }`)
  const probe = collectFailures(base)
  assert.ok(probe.length >= 6, `判据套合成坏样本应报 ≥6 处，实际 ${probe.length} —— 锁可能是空锁`)
})
