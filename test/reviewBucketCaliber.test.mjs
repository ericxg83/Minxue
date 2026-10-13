// 回归测试：批改「四桶统计」（服务端）必须与复核「6 态」（前端唯一真相）逐组合一致
//
// 背景（2026-10-13 r280 实测）：
//   `server/utils/taskStats.js` 的 classifyReviewBucket / computeTaskStats 是**批改结果分桶的
//   后端唯一口径**——worker.js 判题结算（gradedRows → tasks.result 四桶）、列表页摘要
//   （错N/空N/待复核N）、待复核角标全走它；而老师每天看的复核页 6 态走
//   `src/utils/reviewDecision.js` 的 getReviewState。两份文件头都写着「严格镜像 / 只允许
//   有一份定义」，但**没有任何测试锁住这个镜像关系**（r280 前全仓 grep：只有
//   retrySlimAutoPass 用源码锁盯「worker 必须调用 computeTaskStats」，没有一把行为锁）。
//   一旦某侧被单独改动（分桶顺序、阈值、blank 归属），就是 r130「图表空柱」同族的
//   **口径漂移**：列表写「7 道题全部正确」、点进去 4 道待人工，且两端都不报错。
//
//   与 questionResultCaliber 的先例对齐：`test/retryExamScoreCaliber.test.mjs` 用 30 种
//   组合锁死「服务端三分类 ↔ effectiveIsCorrect」；本测试补上四桶这一层。
//
// 本测试锁死的映射（生产实证词汇，见下）：
//   excluded（人工排除）  ⟺  isExcluded(q) === true
//   correct               ⟺  getReviewState(q) === 'correct'
//   wrong                 ⟺  getReviewState(q) === 'wrong'
//   empty（未作答）       ⟺  getReviewState(q) === 'blank'
//   pending（待人工）     ⟺  getReviewState(q) ∈ {pending, exception, processing}
//
// ⛔ 词汇表只含生产存在的 5 个 review_status 值（r280 只读探针实测 3716 题：
//   NULL 2982 / correct 517 / wrong 141 / exclude 57 / wrong_no_book 19；
//   'reviewed' 与 'excluded' 均 0 行——见 r280-P-A 提案，勿把两个不存在的值写进用例）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyReviewBucket, computeTaskStats, REVIEW_CONFIDENCE_THRESHOLD } from '../server/utils/taskStats.js'
import { getReviewState, isExcluded, DEFAULT_CONFIDENCE_THRESHOLD } from '../src/utils/reviewDecision.js'

// 生产实证词汇表（r280 探针）
const REVIEW_STATUSES = [null, 'correct', 'wrong', 'wrong_no_book', 'exclude']
const ANSWER_SOURCES = ['recognized', 'blank']
const IS_CORRECTS = [true, false, null]
const CONFIDENCES = [null, 0.3, 0.49, 0.5, 0.9]

/** 把前端 6 态折算成后端四桶（excluded 优先，与各消费方「先判 isExcluded」一致） */
const frontendBucket = (q) => {
  if (isExcluded(q)) return 'excluded'
  const state = getReviewState(q)
  if (state === 'correct') return 'correct'
  if (state === 'wrong') return 'wrong'
  if (state === 'blank') return 'empty'
  if (state === 'pending' || state === 'exception' || state === 'processing') return 'pending'
  return `UNMAPPED:${state}`
}

test('阈值常量同源：服务端四桶与前端 6 态必须用同一个置信度门槛', () => {
  assert.equal(REVIEW_CONFIDENCE_THRESHOLD, DEFAULT_CONFIDENCE_THRESHOLD)
  assert.equal(REVIEW_CONFIDENCE_THRESHOLD, 0.5)
})

test('全组合对账：150 种输入下四桶与 6 态折算结果完全一致（无例外）', () => {
  let checked = 0
  for (const review_status of REVIEW_STATUSES) {
    for (const answer_source of ANSWER_SOURCES) {
      for (const is_correct of IS_CORRECTS) {
        for (const confidence of CONFIDENCES) {
          const q = { review_status, answer_source, is_correct, confidence }
          const be = classifyReviewBucket(q)
          const fe = frontendBucket(q)
          assert.equal(
            be, fe,
            `口径漂移 ${JSON.stringify(q)}：服务端四桶=${be} 前端6态折算=${fe}`
          )
          checked++
        }
      }
    }
  }
  assert.equal(checked, 150)
})

test('分桶顺序：未作答先于 is_correct 判定（防同一行同时命中 wrong 与 empty 的双重计数）', () => {
  // 旧 recalculate-stats 事故形态：blank 题被 AI 判 false 时同时进 wrong 与 empty 两桶
  assert.equal(classifyReviewBucket({ answer_source: 'blank', is_correct: false, review_status: null, confidence: 0.9 }), 'empty')
  assert.equal(classifyReviewBucket({ answer_source: 'blank', is_correct: null, review_status: null, confidence: null }), 'empty')
  // 非 blank 的 null 结论 → 待人工（AI 没判出来不许悄悄算对）
  assert.equal(classifyReviewBucket({ answer_source: 'recognized', is_correct: null, review_status: null, confidence: 0.8 }), 'pending')
})

test('人工复核结论优先级最高：老师翻案必须覆盖 AI 判定', () => {
  // AI 判对、老师判错 → wrong（r130 同族：家长/列表看到的必须是人工结论）
  assert.equal(classifyReviewBucket({ review_status: 'wrong', is_correct: true, confidence: 0.99 }), 'wrong')
  // AI 判错、老师判对 → correct
  assert.equal(classifyReviewBucket({ review_status: 'correct', is_correct: false, confidence: 0.1 }), 'correct')
  // wrong_no_book 与 wrong 同桶
  assert.equal(classifyReviewBucket({ review_status: 'wrong_no_book', is_correct: true }), 'wrong')
  // exclude → excluded（不计入总数）
  assert.equal(classifyReviewBucket({ review_status: 'exclude', is_correct: true }), 'excluded')
})

test('置信度边界：恰好达标算 correct，差一丝算 pending', () => {
  assert.equal(classifyReviewBucket({ is_correct: true, confidence: 0.5 }), 'correct')
  assert.equal(classifyReviewBucket({ is_correct: true, confidence: 0.49 }), 'pending')
  assert.equal(classifyReviewBucket({ is_correct: true, confidence: null }), 'pending')
  // 自定义阈值透传（两个函数都收 threshold 参数）
  assert.equal(classifyReviewBucket({ is_correct: true, confidence: 0.6 }, 0.9), 'pending')
  assert.equal(computeTaskStats([{ is_correct: true, confidence: 0.6 }], 0.9).correctCount, 0)
  assert.equal(computeTaskStats([{ is_correct: true, confidence: 0.6 }], 0.9).pendingCount, 1)
})

test('computeTaskStats：四桶互斥且穷尽，excluded 不计入总数', () => {
  const rows = [
    { review_status: 'correct', is_correct: true, confidence: 0.9 },   // correct
    { review_status: 'wrong', is_correct: true, confidence: 0.9 },     // wrong（人工翻案）
    { answer_source: 'blank', is_correct: false },                     // empty（未作答）
    { is_correct: null, confidence: 0.4 },                             // pending（置信度不足）
    { review_status: 'exclude', is_correct: true },                    // excluded：不计入
  ]
  const stats = computeTaskStats(rows)
  assert.equal(stats.questionCount, 4)
  assert.equal(stats.correctCount, 1)
  assert.equal(stats.wrongCount, 1)
  assert.equal(stats.emptyCount, 1)
  assert.equal(stats.pendingCount, 1)
  // 恒等式：四桶之和 = 总数（excluded 既不计入也不打破互斥穷尽）
  assert.equal(stats.correctCount + stats.wrongCount + stats.emptyCount + stats.pendingCount, stats.questionCount)
})

test('computeTaskStats：每一行都落在且只落在一個桶里（逐行不变量）', () => {
  for (const review_status of REVIEW_STATUSES) {
    for (const answer_source of ANSWER_SOURCES) {
      for (const is_correct of IS_CORRECTS) {
        for (const confidence of CONFIDENCES) {
          const q = { review_status, answer_source, is_correct, confidence }
          const stats = computeTaskStats([q])
          const filled = [stats.correctCount, stats.wrongCount, stats.emptyCount, stats.pendingCount]
            .filter((n) => n > 0).length
          if (review_status === 'exclude') {
            assert.equal(stats.questionCount, 0, `excluded 行不应计入总数：${JSON.stringify(q)}`)
          } else {
            assert.equal(stats.questionCount, 1, `行必须被计数：${JSON.stringify(q)}`)
            assert.equal(filled, 1, `行必须且只能落进一个桶：${JSON.stringify(q)}`)
          }
        }
      }
    }
  }
})

test('空输入与脏输入不炸', () => {
  assert.deepEqual(computeTaskStats([]), { questionCount: 0, wrongCount: 0, emptyCount: 0, pendingCount: 0, correctCount: 0 })
  assert.deepEqual(computeTaskStats(null), { questionCount: 0, wrongCount: 0, emptyCount: 0, pendingCount: 0, correctCount: 0 })
  // null 行（数据缺损）按待人工计——与前端 getReviewState(null)='processing' 同归待处理
  assert.equal(computeTaskStats([null]).pendingCount, 1)
})
