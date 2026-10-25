/**
 * 根号参数括号丢失导致「数学等值答案被判错」的回归锁（2026-10-25）。
 *
 * 事故（负责人截图 #20，题 eb09599c / task d17eedd8 第 20 题）：
 *   题面  ：计算 √(0.5y) + (2/y)√(2y³) - y√(72/y)
 *   学生  ：解：原式=√(1/2y)+2√2y-√72y =√2y/2 + 2√2y - 6√2y =-7√2y/2   ← 做对了
 *   参考  ：-7/2√(2y)（OCR 抄来）
 *   判定  ：is_correct=false，且**已假错入册**。
 *
 * 根因：OCR 把学生手写的 √(2y) 识别成 √2y（丢括号，同卷另一个实例保留了括号就判对）。
 * judgeService.convertSqrtToPower 按**严格数学语义**读无括号根号（√2y = √2·y），
 * 而参考的 √(2y) 读成 √(2y) ⇒ 代数不等 ⇒ 判错。
 *
 * ⛔ 本锁同时锁住**判题语义的边界**：无括号根号「√2y = √2·y」是严格数学约定，
 *    **故意不能改成 √(2y)** —— 改了会把 `√2m`（真义 √2·m）误读成 √(2m) ⇒ 放水。
 *    修复走的是「参考答案改成与学生同形态的等值写法」这条路，不是改判题器。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { judgeAnswer } from '../server/services/judgeService.js'

const sqrt = '√'      // √
const minus = '-'     // -

// 题面：计算 √(0.5y) + (2/y)√(2y³) - y√(72/y)
// 学生 OCR 后的推导（根号参数括号丢失）：最后一行 = -7√2y/2
const student = [
  '解：原式=' + sqrt + '(1/2y)+2' + sqrt + '2y' + minus + sqrt + '72y',
  '=' + sqrt + '2y/2 + 2' + sqrt + '2y ' + minus + ' 6' + sqrt + '2y',
  '=' + minus + '7' + sqrt + '2y/2',
].join('\n')

test('等值写法：参考答案与学生同形态时判对（本次修复后的状态）', () => {
  // 修复后参考答案 = -7√(2y)/2（与学生答案形态一致）
  assert.deepEqual(
    judgeAnswer(student, minus + '7' + sqrt + '(2y)/2', 'answer'),
    { isCorrect: true, unrecognized: false }
  )
  // 只取最终结果那一行也判对
  assert.deepEqual(
    judgeAnswer(minus + '7' + sqrt + '2y/2', minus + '7' + sqrt + '(2y)/2', 'answer'),
    { isCorrect: true, unrecognized: false }
  )
})

test('⛔ 判题语义边界：无括号根号严格读作 √2·y，不得被改成 √(2y)（防放水）', () => {
  // √2y（严格 = √2·y）与 √(2y)（= √(2y)）代数不等 —— 这是**故意判错**的。
  // 任何"顺手把无括号根号补上括号"的改动都会让这条翻成 true ⇒ 放水。
  assert.deepEqual(
    judgeAnswer(minus + '7' + sqrt + '2y/2', minus + '7/2' + sqrt + '(2y)', 'answer'),
    { isCorrect: false, unrecognized: false }
  )
  // 纯数字根号无歧义，两侧形态一致时判对
  assert.deepEqual(
    judgeAnswer(minus + '7' + sqrt + '2/2', minus + '7' + sqrt + '(2)/2', 'answer'),
    { isCorrect: true, unrecognized: false }
  )
})

test('真错仍然判错（系数算错不得被放过）', () => {
  // 同一题的另一个实例：学生与 AI 都算成 -3√(2y)/2（系数错），参考 -7/2√(2y)
  assert.deepEqual(
    judgeAnswer(minus + '3' + sqrt + '(2y)/2', minus + '7/2' + sqrt + '(2y)', 'answer'),
    { isCorrect: false, unrecognized: false }
  )
  // 与修复后参考答案比，也仍是错
  assert.deepEqual(
    judgeAnswer(minus + '3' + sqrt + '(2y)/2', minus + '7' + sqrt + '(2y)/2', 'answer'),
    { isCorrect: false, unrecognized: false }
  )
})
