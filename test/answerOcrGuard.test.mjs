// 回归测试：练习册答案页 OCR 质量护栏（2026-09-09 九上上海作业答案全本错位修复）
//
// 根因回顾：78 页答案 PDF 分批解析时，15 页 Promise.all 瞬时打爆魔搭「Key×模型」配额，
// callVisionCompletion 静默轮换到弱备份视觉模型（MiniMax-M3/8B/sensenova/agnes/gpt-4o-mini），
// 弱模型读双栏答案页阅读顺序错乱、单元标题漏读 → 84 处题号错位、626 条答案全部错位入库。
//
// 三道防线（源码级断言，防止未来改动悄悄拆掉）：
//   1. 答案页 OCR（分批/单趟两条路径）必须传 noBackup: true，禁止静默降级弱模型
//   2. callVisionCompletion 的三处备份供应商注入点必须受 noBackup 门禁
//   3. 分批 OCR 必须走带并发上限的 mapWithConcurrency（OCR_PAGE_CONCURRENCY），不得裸 Promise.all
//   4. retryTaskById 对 workbook 任务不得把 worksheet_id 兜底进 resourceId
//      （否则重试被 processAnswerBankGrading 抢路由，自包含错题语义被破坏）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

test('答案页 OCR 两条路径都必须传 noBackup: true（禁降级弱模型）', () => {
  const src = read('server/routes/worksheets.js')
  const noBackupCount = (src.match(/noBackup: true/g) || []).length
  assert.ok(noBackupCount >= 2, `ocrExtractFromBuffer 与 ocrExtractRawText 都应传 noBackup: true，实际 ${noBackupCount} 处`)
  // 答案页 OCR 输出上限应放宽到 8192，避免密集页被 4096 截断丢题
  assert.ok(src.includes('maxTokens: 8192'), '答案页 OCR maxTokens 应为 8192')
})

test('callVisionCompletion 的三处备份供应商注入点必须受 noBackup 门禁', () => {
  const src = read('server/config/ai.js')
  assert.ok(
    src.includes('if (!noBackup && (allMsExhausted || forceBackupFirst))'),
    '魔搭全耗尽/BACKUP_FIRST 自动降级分支必须受 noBackup 门禁'
  )
  assert.ok(src.includes('if (!noBackup && gmiFirst && gmiVendor)'), 'GMI_FIRST 插队分支必须受 noBackup 门禁')
  // 备份供应商兜底循环（BACKUP_CONFIG.VENDORS）在 callVisionCompletion 内必须被 if (!noBackup) 包裹
  const visionFn = src.slice(src.indexOf('export async function callVisionCompletion'))
  const guardIdx = visionFn.indexOf('if (!noBackup) {')
  const vendorIdx = visionFn.indexOf('for (const vendor of BACKUP_CONFIG.VENDORS)', guardIdx)
  assert.ok(guardIdx > 0 && vendorIdx > guardIdx, '备份供应商兜底循环必须位于 if (!noBackup) 门禁之后')
})

test('分批 OCR 必须走 mapWithConcurrency 并发上限，不得裸 Promise.all 打满配额', () => {
  const src = read('server/routes/worksheets.js')
  assert.ok(src.includes('OCR_PAGE_CONCURRENCY'), '应定义 OCR_PAGE_CONCURRENCY 并发上限')
  assert.ok(
    src.includes('const ocrContents = await mapWithConcurrency('),
    'processOcrBatch 应用 mapWithConcurrency 替代 Promise.all'
  )
  assert.ok(src.includes('ocrPageWithRetry'), '应有单页空结果重试逻辑')
})

test('retryTaskById 对 workbook 任务不得把 worksheet_id 兜底进 resourceId', () => {
  const src = read('server/index.js')
  assert.ok(
    src.includes("task.task_type === 'workbook'"),
    'retryTaskById 应对 workbook 任务保持 resourceId 原值，防止重试被 processAnswerBankGrading 抢路由'
  )
})