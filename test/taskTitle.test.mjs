/**
 * taskTitle.test.mjs — 卷面标题 → 任务名（2026-09-17）
 *
 * 锁定：校徽/页眉跑马灯「新闵学校“成长·桥”练习」不能整条当任务名 ——
 * worker 用它给任务改名后，列表里 13 条任务同名，分不清哪份是哪份。
 * 校名页眉剥掉后：
 *   - 还有课时/章节后缀 → 用后缀（"19.2(3) 实数与数轴"）
 *   - 什么都不剩 → 返回 null，调用方不改名（保留"数学作业 09/16 19:52"）
 * 正常卷面标题（"第27章 二次函数"）必须原样保留。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { deriveTaskTitle, isAutoTaskName, normalizeTitle } from '../server/utils/taskTitle.js'

// ── ① 纯校名页眉：没有信息量，必须拒绝 ──

test('纯校徽文字（无后缀）不可用 —— 当年 13 条任务同名的元凶', () => {
  assert.equal(deriveTaskTitle('新闵学校“成长·桥”练习'), null)
  assert.equal(deriveTaskTitle('新闵学校"成长·桥"练习'), null)
  assert.equal(deriveTaskTitle('新闵学校 “成长·桥” 练习'), null)
})

test('OCR 把校名读错字（“新冈学校”）也要挡住', () => {
  assert.equal(deriveTaskTitle('新冈学校"成长·桥"练习'), null)
})

test('空值 / 纯空白 / 纯通名一律不可用', () => {
  assert.equal(deriveTaskTitle(''), null)
  assert.equal(deriveTaskTitle('   '), null)
  assert.equal(deriveTaskTitle(null), null)
  assert.equal(deriveTaskTitle(undefined), null)
  assert.equal(deriveTaskTitle('练习'), null)
  assert.equal(deriveTaskTitle('作业'), null)
})

// ── ② 校名 + 课时后缀：剥掉校名，留住后缀 ──

test('校名 + 课时号：只留课时部分', () => {
  assert.equal(deriveTaskTitle('新闵学校“成长·桥”练习 19.2(3) 实数与数轴'), '19.2(3) 实数与数轴')
  assert.equal(deriveTaskTitle('新闵学校“成长·桥”练习 11.1 (4) 整式的乘法 (1)'), '11.1 (4) 整式的乘法 (1)')
  assert.equal(deriveTaskTitle('新闵学校“成长·桥”练习 27.4（1）二次函数与一元二次方程（1）'), '27.4（1）二次函数与一元二次方程（1）')
  assert.equal(deriveTaskTitle('新闵学校“成长·桥”练习 第01周'), '第01周')
})

test('校名 + 堂堂清/周末卷：留住卷种与编号', () => {
  assert.equal(deriveTaskTitle('新闵学校"成长·桥"练习 数学堂堂清04'), '数学堂堂清04')
  assert.equal(deriveTaskTitle('新冈学校"成长·桥"练习 数学堂堂清01 第01周'), '数学堂堂清01 第01周')
  assert.equal(
    deriveTaskTitle('新闵学校“成长·桥”练习 2026学年 七上堂堂清 11.1 整式的乘法②'),
    '2026学年 七上堂堂清 11.1 整式的乘法②'
  )
  assert.equal(
    deriveTaskTitle('新闵学校“成长·桥”练习 2026学年第一学期七年级数学第2周周末卷'),
    '2026学年第一学期七年级数学第2周周末卷'
  )
})

test('没有品牌短句、只有校名的页眉也要剥（新闵学校六年级数学周末卷（1））', () => {
  assert.equal(deriveTaskTitle('新闵学校六年级数学周末卷（1）'), '六年级数学周末卷（1）')
})

// ── ③ 正常卷面标题：一个字都不能动 ──

test('普通章节/课时标题原样保留', () => {
  for (const t of [
    '第27章 二次函数',
    '第19章测试(一)',
    '27.4(1) 二次函数与一元二次方程(1)',
    '数学堂堂清 05',
    '2.2(2) 分数的基本性质',
    '课后练习 27.2(5)',
    '陆晨曦 - 错题再测-0904',
  ]) {
    assert.equal(deriveTaskTitle(t), t, `不该改动: ${t}`)
  }
})

test('正文里带"练习"的标题不被削秃（只有切过校名才剥通名）', () => {
  assert.equal(deriveTaskTitle('课后练习 27.2(5)'), '课后练习 27.2(5)')
})

// ── ④ 归一化与兜底 ──

test('压缩空白与全角空格', () => {
  assert.equal(normalizeTitle('  第19章　  测试  '), '第19章 测试')
})

test('超长标题截断到 100 字', () => {
  const long = `新闵学校“成长·桥”练习 ${'整式的乘除混合运算复习'.repeat(10)}`
  assert.ok(deriveTaskTitle(long).length <= 100)
})

// ── ⑤ 哪些名字允许被卷面标题覆盖 ──

test('自动名（科目+时间 / 相机文件名）可覆盖', () => {
  assert.equal(isAutoTaskName('数学作业 09/16 19:52'), true)
  assert.equal(isAutoTaskName('IMG_20260916_195233.jpg'), true)
  assert.equal(isAutoTaskName('MINXUE_20260913.jpg 等2页'), true)
  assert.equal(isAutoTaskName(''), true)
})

test('"科目 · 练习册名"只有 workbook 管线当自动名（通用管线保持历史行为）', () => {
  assert.equal(isAutoTaskName('数学 · 上海作业 九年级上'), false)
  assert.equal(isAutoTaskName('数学 · 上海作业 九年级上', { treatClientPaperNameAsAuto: true }), true)
})

test('用户/系统给过的真名字不可覆盖', () => {
  assert.equal(isAutoTaskName('陆晨曦 - 错题再测-0904'), false)
  assert.equal(isAutoTaskName('第19章测试(一)'), false)
  assert.equal(isAutoTaskName('27.5 二次函数的简单应用'), false)
})
