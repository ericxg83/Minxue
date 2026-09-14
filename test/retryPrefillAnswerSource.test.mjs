// 回归测试：重练卷 slim 管线回写必须同步刷新 answer_source
//
// 事故背景（2026-09-14「明明写了答案却显示未作答」）：
//   重练卷批改复用原作业的 questions 行（错题本学习轨迹要求同一行）。
//   slim 管线的预填 UPDATE 旧实现只回写 student_answer/is_correct/confidence，
//   answer_source 留着原作业批改时的旧值。原作业 OCR 判空过的题带着
//   answer_source='blank' 进错题本，重练时学生写了答案、答案也回写了，
//   但旧 blank 标留存 ⇒ 批改页 6 态（src/utils/reviewDecision.js:74）
//   blank 优先于 is_correct，显示成「未作答」（实锤：蔡怡希 错题再测-0911
//   Q10 学生答案 18、已判错，界面却显示未作答；全库同病 8 条）。
//
// 本测试锁定两件事：
//   1) blank 判定口径与主 OCR 管线同源（determineAnswerSource）；
//   2) slim 预填 UPDATE 的 SET 子句必须包含 answer_source，且取值来自
//      determineAnswerSource —— 摘掉这个字段，显示层就会复活「新答案 + 旧未作答标」错配。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { determineAnswerSource } from '../server/worker.js'

const ROOT = resolve(import.meta.dirname, '..')
const workerSrc = readFileSync(resolve(ROOT, 'server/worker.js'), 'utf8')

test('determineAnswerSource：空 / 未作答 / 纯下划线 → blank，其余 → recognized', () => {
  assert.equal(determineAnswerSource(''), 'blank')
  assert.equal(determineAnswerSource('   '), 'blank')
  assert.equal(determineAnswerSource('未作答'), 'blank')
  assert.equal(determineAnswerSource('____'), 'blank')
  assert.equal(determineAnswerSource('_ _ _'), 'blank')
  assert.equal(determineAnswerSource('18'), 'recognized')
  assert.equal(determineAnswerSource('-2, -2.1, -3'), 'recognized')
  assert.equal(determineAnswerSource(null), 'blank')
  assert.equal(determineAnswerSource(undefined), 'blank')
})

// 定位 slim 管线预填 UPDATE 的源码片段：
// 起点 prefillFailures 声明（全库唯一），终点 .catch((e) =>（该 await query 自身的兜底块，
// 覆盖 SQL 字符串与参数数组）。
const prefillBlockMatch = workerSrc.match(
  /const prefillFailures = \[\][\s\S]*?\.catch\(\(e\) =>/m
)

test('slim 预填 UPDATE 必须包含 answer_source 回写', () => {
  assert.ok(prefillBlockMatch, '未找到 slim 预填 UPDATE 语句（指纹：is_correct = $2::boolean + WHERE id = $4）')
  assert.ok(
    /answer_source = \$5/.test(prefillBlockMatch[0]),
    'SET 子句缺少 answer_source = $5：重练回写会留下原作业的旧 blank 标，批改页复活「写了答案却显示未作答」'
  )
})

test('answer_source 取值必须来自 determineAnswerSource（与主 OCR 管线同源）', () => {
  assert.ok(prefillBlockMatch, '未找到 slim 预填 UPDATE 语句')
  assert.ok(
    /determineAnswerSource\(/.test(prefillBlockMatch[0]),
    '预填循环必须用 determineAnswerSource 计算 answer_source，不许在管线里另写一套判空口径'
  )
})

test('blank 时 student_answer 必须归一为空串（保证 blank ⇔ 答案为空 的展示层不变量）', () => {
  assert.ok(prefillBlockMatch, '未找到 slim 预填 UPDATE 语句')
  assert.ok(
    /nextAnswerSource === 'blank' \? '' : nextStudentAnswer/.test(prefillBlockMatch[0]),
    'blank 分支必须清空 student_answer，否则又会出现「标 blank 但答案非空」的自相矛盾行'
  )
})
