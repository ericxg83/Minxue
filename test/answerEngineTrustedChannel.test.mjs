/**
 * 回归锁：「同档通道」不得被当成降级通道（2026-10-10 负责人要求）
 *
 * 现象（负责人截图）：批改页一道 AI 判对的填空题挂着
 *   「参考答案由降级通道 Bailian:qwen3.8-flash 生成（主模型不可用），建议核对」，
 * 并且因为 `ai_answer_risk_reason` 非空，这题被算进复核页左栏「待处理」
 * （判据 `src/utils/reviewDecision.js#needsHumanAttention`）—— 全库 83 条。
 *
 * 为什么是误报：Bailian:qwen3.8-flash 在 2026-09-21 横评里 **20/20**，与主模型并列满分
 * （依据 `_答案引擎模型选型-全量汇总-20261010.md`）。「主模型当时不可用」是环境噪音，
 * 不代表这条答案需要老师逐条核对。
 *
 * 两条**互不相同**的判据，本次只改前者，别合并：
 *   ① isDegradedAnswerEngine —— 「这条答案要不要提醒老师自己核一遍？」→ 同档通道豁免
 *   ② needsConsensusSampling  —— 「要不要多采两路投票？」→ 同档通道**照旧投票**
 *      因为 Bailian 自己的三路采样也会分歧（全库 39 条留痕），那是目前唯一能自动
 *      发现「参考答案算错」的信号，撤掉等于把它的单次采样当标准答案。
 *
 * 反向自检：见文件末尾「旧口径复现」——旧实现下本锁第一条断言必红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { anchoredRange, includesLit } from './sourceLockKit.mjs'
import {
  ANSWER_ENGINE,
  ANSWER_ENGINE_TRUSTED,
  isTrustedAnswerEngine,
  isDegradedAnswerEngine,
  needsConsensusSampling
} from '../server/config/ai.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(resolve(ROOT, p), 'utf8')
const PRIMARY = `${ANSWER_ENGINE.VENDOR}:${ANSWER_ENGINE.MODEL}`

const PEER = 'Bailian:qwen3.8-flash'
// 实测偏弱的通道（横评 <20/20 或已淘汰）—— 本次改动**不许**顺带把它们放过
const WEAK = [
  'Huihuiyun:deepseek-v4-flash',
  'fallback-text-chain',
  'BigModel:glm-4.7-flash',
  'SenseNova:sensenova-6.8-flash-lite'
]

test('① 同档通道 Bailian:qwen3.8-flash 不算降级 —— 不再挂「建议核对」', () => {
  assert.ok(ANSWER_ENGINE_TRUSTED.includes(PEER), `默认「同档通道」必须含 ${PEER}`)
  assert.equal(isTrustedAnswerEngine(PEER), true)
  assert.equal(
    isDegradedAnswerEngine(PEER), false,
    'Bailian:qwen3.8-flash 横评 20/20（与主模型并列满分），不得判为降级通道'
  )
  // 重解析场景：点名通道就是它自己，同样不算降级
  assert.equal(isDegradedAnswerEngine(PEER, PEER), false)
})

test('② 主模型 / 空通道的既有口径不变', () => {
  assert.equal(isDegradedAnswerEngine(PRIMARY), false, '主模型自己当然不算降级')
  assert.equal(isDegradedAnswerEngine(null), true, '拿不到通道名时按「不确定」处理（fail-closed）')
  assert.equal(isTrustedAnswerEngine(null), false)
})

test('③ 弱通道仍判降级 —— 这次改动不能顺手放过它们', () => {
  for (const w of WEAK) {
    assert.equal(isTrustedAnswerEngine(w), false, `${w} 不在同档通道名单里`)
    assert.equal(
      isDegradedAnswerEngine(w), true,
      `${w} 实测偏弱，必须继续给老师挂「建议核对」（否则等于悄悄放宽门禁）`
    )
  }
})

test('④ 投票闸不受影响：同档通道照旧多路投票（准确性机制，与标注解耦）', () => {
  assert.equal(
    needsConsensusSampling(PEER), true,
    'Bailian 自己的三路采样会分歧（全库 39 条留痕），必须继续投票；豁免的只是「提醒老师核对」'
  )
  assert.equal(needsConsensusSampling(PRIMARY), false, '主模型零额外调用，行为不变')
  assert.equal(needsConsensusSampling(PEER, PEER), false, '点名通道自己不用补采')
  // 两个闸确实是两个答案 —— 这正是本次改动的全部内容
  assert.notEqual(needsConsensusSampling(PEER), isDegradedAnswerEngine(PEER))
})

test('⑤ 源码锁：投票闸走 needsConsensusSampling，标注闸走 isDegradedAnswerEngine', () => {
  const fails = []
  const worker = read('server/worker.js')

  const voteGate = anchoredRange(
    worker,
    'if (ANSWER_QUALITY.CONSENSUS_ENABLED',
    'const extraCount',
    'worker.js 多路投票闸', fails
  )
  if (voteGate !== null) {
    assert.ok(
      voteGate.includes('needsConsensusSampling(engine, expectedProvider)'),
      '投票闸必须用 needsConsensusSampling —— 用 isDegradedAnswerEngine 会让同档通道不再投票'
    )
    assert.equal(
      voteGate.includes('isDegradedAnswerEngine('), false,
      '投票闸里不得出现 isDegradedAnswerEngine（两个闸已解耦）'
    )
  }

  const noteFn = anchoredRange(
    worker,
    'const buildAnswerTrustNotes = (result)',
    'return notes',
    'worker.js 标注闸', fails
  )
  if (noteFn !== null) {
    assert.ok(
      noteFn.includes('isDegradedAnswerEngine(result.engine)'),
      '「降级通道…建议核对」标注必须由 isDegradedAnswerEngine 决定（同档通道因此被豁免）'
    )
  }

  assert.deepEqual(fails, [], fails.join('\n'))
})

test('⑥ 源码锁：重解析路由仍按「本次点名通道」当标尺', () => {
  const idx = read('server/index.js')
  assert.ok(
    /isDegradedAnswerEngine\(result\?\.engine,\s*result\?\.expectedProvider\)/.test(idx),
    '重解析的降级标尺必须用本次点名的通道，否则一次成功的点名调用会被误判成降级'
  )
})

test('⑦ 源码锁：默认名单写死在 config/ai.js（不是散在各调用点）', () => {
  const aiSrc = read('server/config/ai.js')
  assert.ok(
    includesLit(aiSrc, "process.env.ANSWER_ENGINE_TRUSTED || 'Bailian:qwen3.8-flash,SenseNova:glm-5.2,SenseNova:deepseek-v4-pro'"),
    '「同档通道」默认名单必须唯一地定义在 config/ai.js，且含 Bailian:qwen3.8-flash'
  )
})

test('⑧ 反向自检：旧口径下本锁第①条必红', () => {
  // 旧实现：只要不是「主模型/点名通道」就算降级
  const oldRule = (provider, expected = null) => provider !== (expected || PRIMARY)
  assert.equal(
    oldRule(PEER), true,
    '旧口径把 Bailian:qwen3.8-flash 判成降级 —— 说明本锁确实盯住了这次改动（不是空断言）'
  )
})
