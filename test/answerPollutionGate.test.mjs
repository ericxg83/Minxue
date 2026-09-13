/**
 * 回归测试：OCR answer 污染闸（worker.js P3 闸门）
 *
 * 背景（2026-09-13 实测）：魔搭 Qwen3-VL-235B 在 15 题真实作业照上 15/15 把
 * 学生手写答案原样抄进 answer 字段 → judgeAnswer(学生答案, 学生答案) 恒 true
 * → 整卷判对、0 判错的隐形全卷误判。P3 闸门在落库前把这类 answer 置空。
 *
 * 锁定两条边界：
 *   1) 「一字不差地抄」必须命中（含仅差空白/括号/全角负号的形态差异）
 *   2) 「数学等价但写法不同」必须**不**命中 —— 否则会把正常题误推进人工队列
 */
import { isSameAnswerText } from '../server/worker.js'

let pass = 0
let fail = 0

function check(name, actual, expected) {
  if (actual === expected) {
    pass += 1
    console.log(`  ✅ ${name}`)
  } else {
    fail += 1
    console.log(`  ❌ ${name}  期望=${expected} 实际=${actual}`)
  }
}

console.log('\n=== 应命中（判定为污染，answer 置空）===')
check('完全相同', isSameAnswerText('5-2√6', '5-2√6'), true)
check('空格差异', isSameAnswerText('5 - 2√6', '5-2√6'), true)
check('全角负号差异', isSameAnswerText('−2√3', '-2√3'), true)
check('括号差异', isSameAnswerText('(C)', 'C'), true)
check('全角括号差异', isSameAnswerText('（C）', 'C'), true)
check('大小写差异', isSameAnswerText('abc', 'ABC'), true)
check('句点差异', isSameAnswerText('3。', '3'), true)
check('中文选择题多序号', isSameAnswerText('①④', '①④'), true)

console.log('\n=== 不应命中（正常题，保留 answer）===')
check('数学等价但写法不同 2/4 vs 1/2', isSameAnswerText('2/4', '1/2'), false)
check('数学等价但写法不同 √8 vs 2√2', isSameAnswerText('√8', '2√2'), false)
check('完全不同的答案', isSameAnswerText('5', '8'), false)
check('学生漏负号（模型未抄写）', isSameAnswerText('-2√3', '2√3'), false)
check('答案更长（含过程）', isSameAnswerText('x=5', '5'), false)

console.log('\n=== 空值/边界（一律不命中，避免误伤）===')
check('两者都空', isSameAnswerText('', ''), false)
check('answer 空', isSameAnswerText('', '5'), false)
check('student_answer 空', isSameAnswerText('5', ''), false)
check('null', isSameAnswerText(null, null), false)
check('undefined', isSameAnswerText(undefined, undefined), false)
check('未作答占位', isSameAnswerText('未作答', '未作答'), true)

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
if (fail > 0) process.exit(1)
