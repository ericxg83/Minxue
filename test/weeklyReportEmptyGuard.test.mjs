/**
 * 周学习诊断报告「空数据闸」回归锁（2026-10-04，移动端赛道 r113q，产出物质量）
 *
 * 背景：周报是老师转发给家长的输出物。此前移动端/PC 端两个下载入口都能对
 * 「本周期 0 题批改」的学生生成一份全 0/全空的 PDF（封面 + 0 完成作业 / 0% /
 * 空趋势 / 暂无薄弱点），发给家长毫无意义。两端调用方其实都写了
 * `if (!result) { 提示"暂无学习数据" }`，但 generateWeeklyReport 成功时从不
 * 返回 null —— 那条分支是死的。
 *
 * 本锁三处判据：
 *   1) 生成器在拉到数据后、渲染前，totalQuestions===0 必须 return null（接死活分支）；
 *   2) 移动端下载按钮空数据时必须禁用 + 点击前置拦截（hasReportData）；
 *   3) 反向自检：以上判据套修复前旧树必须判红。
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { anchoredSlice } from './sourceLockKit.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function collectFailures(root) {
  const fails = []
  const read = (rel) => {
    const p = join(root, rel)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }

  const gen = read('src/utils/weeklyReportGenerator.js')
  if (gen !== null) {
    // 取 generateWeeklyReport 函数体（到文件尾或下一个 export）
    const gi = gen.indexOf('export async function generateWeeklyReport')
    const body = gi < 0 ? '' : gen.slice(gi, gen.indexOf('export async function generateAllWeeklyReports') > gi ? gen.indexOf('export async function generateAllWeeklyReports') : gi + 3000)
    if (gi < 0) fails.push('weeklyReportGenerator: generateWeeklyReport 不见了')
    else {
      if (!body.includes('totalQuestions')) fails.push('weeklyReportGenerator: 缺空数据闸（应校验 stats.totalQuestions）')
      // 关键：return null 必须发生在 renderDiagnosisFullHTML 之前（先拦再渲染，否则仍会建 iframe/写组卷）
      const iNull = body.indexOf('return null')
      const iRender = body.indexOf('renderDiagnosisFullHTML')
      if (iNull < 0 || iRender < 0 || iNull > iRender) {
        fails.push('weeklyReportGenerator: 空数据 return null 必须在渲染之前')
      }
    }
  }

  const page = read('src/pages/WeeklyReport/index.jsx')
  if (page !== null) {
    if (!page.includes('hasReportData')) fails.push('WeeklyReport(移动): 缺 hasReportData 空数据判定')
    // 下载按钮 disabled 必须包含 !hasReportData（空数据禁点）
    // ⚠️ r167：原先 `bi < 0 ? '' : ...` + `if (bi >= 0 && !seg...)` 在锚点被改名时
    // 静默通过（fail-open），改走 anchoredSlice（锚点不在 ⇒ 记一条失败）。
    const BTN_LABEL = 'WeeklyReport(移动): 下载按钮空数据时未禁用'
    const seg = anchoredSlice(page, 'onClick={handleDownloadPDF}', 400, BTN_LABEL, fails)
    if (seg !== null && !seg.includes('!hasReportData')) fails.push(BTN_LABEL)
    // 点击前置拦截（双保险，防止绕过 disabled）
    if (!page.includes('本周期暂无学习数据')) fails.push('WeeklyReport(移动): handleDownloadPDF 缺空数据前置提示')
  }

  return fails
}

test('⛔ 周学习诊断报告空数据闸（当前树必须零违规）', () => {
  const failures = collectFailures(ROOT)
  assert.deepEqual(failures, [], `\n发现 ${failures.length} 处违规：\n` + failures.map(f => `  - ${f}`).join('\n'))
})

test('锁健全性：判据套合成坏样本必须判红（防空锁，不依赖 git 状态）', () => {
  // 内联构造一份「无空数据闸」的旧版代码，永远触发全部判据（历史修复合入 HEAD 后，
  // 以 HEAD 为旧树会 0 红，故用合成树）。
  const base = join(ROOT, '_r113q_emptyguard_bad')
  const put = (rel, content) => {
    const p = join(base, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content, 'utf8')
  }
  put('src/utils/weeklyReportGenerator.js',
    `export async function generateWeeklyReport(studentId) {
       const reportData = await resp.json()
       if (!reportData.success) throw new Error('x')
       const [diagnosisHTML] = await Promise.all([renderDiagnosisFullHTML(reportData)])
       return { mode: 'download' }
     }
     export async function generateAllWeeklyReports() {}`)
  put('src/pages/WeeklyReport/index.jsx',
    `const handleDownloadPDF = async () => {
       if (!currentStudent) { Toast.show('请先选择学生'); return }
       if (generating) return
       const result = await generateWeeklyReport(id)
     }
     <button onClick={handleDownloadPDF} disabled={generating || !currentStudent}>下载完整报告 PDF</button>`)
  const probe = collectFailures(base)
  // 生成器 2（totalQuestions 缺 + return null 不在渲染前）+ 页面 3（hasReportData + 按钮未禁 + 无前置提示）=5
  assert.ok(probe.length >= 5, `判据套合成坏样本应报 ≥5 处，实际 ${probe.length} —— 锁可能是空锁`)
})
