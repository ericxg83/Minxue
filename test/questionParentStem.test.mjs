import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  normalizeStemForCompare,
  isStemContainedInContent,
  resolveQuestionDisplayStem,
  getQuestionGroupKey,
  formatQuestionLabel
} from '../server/utils/questionStem.js'
import * as feMirror from '../src/utils/questionStem.js'
import { splitOcrQuestionsBySubNo, isSubRowConsistentWithWhole, splitSubAnswers } from '../server/services/answerParseService.js'

/**
 * 2026-09-11 产品评审定稿：多小问（题组）拆行导致共享题干丢失。
 *
 * 真实事故（task da0b3d35，「27.2 二次函数的图像与性质（2）」）：
 *   原卷一道大题含 (1)(2)，系统拆成两条独立 question 行：
 *     Q10(1) content = "(1)求a、b的值；"
 *     Q10(2) content = "(2)求抛物线与直线y=x+5的两交点及顶点所构成的三角形的面积。"
 *   共用条件「已知抛物线 y=ax²+1(a≠0)与直线 y=-3x+3 交于点(-1,b).」在全库
 *   这两行里都不存在 → 重练卷印出来是无条件空题，学生无法作答。
 *
 * 方案（迁移 057）：questions.parent_stem 单独承载公共题干，仅展示层拼接；
 * content 语义不动（判题/答案引擎/完整性闸/题干指纹的共同输入）。
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))

test('两份 questionStem 镜像逐字一致（服务端 / 前端）', () => {
  const serverCopy = readFileSync(`${ROOT}server/utils/questionStem.js`, 'utf8')
  const feCopy = readFileSync(`${ROOT}src/utils/questionStem.js`, 'utf8')
  assert.equal(serverCopy, feCopy, '镜像文件必须逐字一致，否则三端渲染的题干会分叉')
})

test('resolveQuestionDisplayStem：parent_stem 为空时保持历史行为', () => {
  const r = resolveQuestionDisplayStem({ content: '(1)求a、b的值；' })
  assert.deepEqual(r, { parentStem: '', content: '(1)求a、b的值；' })
  // null / undefined 也安全
  assert.deepEqual(resolveQuestionDisplayStem(null), { parentStem: '', content: '' })
})

test('resolveQuestionDisplayStem：content 未含公共题干时返回它（供前置渲染）', () => {
  const q = {
    parent_stem: '已知抛物线 y=ax²+1(a≠0)与直线 y=-3x+3 交于点(-1,b).',
    content: '(1)求a、b的值；'
  }
  const r = resolveQuestionDisplayStem(q)
  assert.equal(r.parentStem, '已知抛物线 y=ax²+1(a≠0)与直线 y=-3x+3 交于点(-1,b).')
  assert.equal(r.content, '(1)求a、b的值；')
})

test('resolveQuestionDisplayStem：content 已自带公共题干时不重复渲染（历史数据防重）', () => {
  const q = {
    parent_stem: '已知抛物线 y=ax²+1(a≠0)与直线 y=-3x+3 交于点(-1,b).',
    // 代码拆题的历史行为：stem 被拼进 content
    content: '已知抛物线 y=ax²+1(a≠0)与直线 y=-3x+3 交于点(-1,b). (1)求a、b的值；'
  }
  const r = resolveQuestionDisplayStem(q)
  assert.equal(r.parentStem, '', 'content 已含 parent_stem，不应再渲染一遍')
})

test('resolveQuestionDisplayStem：全半角/空白差异不判定为重复', () => {
  const q = {
    parent_stem: '已知抛物线 y=ax²+1(a≠0)与直线y=-3x+3交于点(-1,b).',
    content: '已知抛物线 y=ax²+2(a≠0)与直线y=-3x+3交于点(-1,b). (1)求a、b的值；'
  }
  const r = resolveQuestionDisplayStem(q)
  assert.ok(r.parentStem, '数字不同的「相似」题干不是同一条条件，仍要渲染')
})

test('前端镜像行为与服务端一致（抽查三个核心函数）', () => {
  const q = {
    parent_stem: '已知抛物线 y=ax²+1(a≠0)与直线 y=-3x+3 交于点(-1,b).',
    content: '(2)求抛物线与直线y=x+5的两交点及顶点所构成的三角形的面积。'
  }
  assert.deepEqual(feMirror.resolveQuestionDisplayStem(q), resolveQuestionDisplayStem(q))
  assert.equal(feMirror.isStemContainedInContent('a=5', 'a=5, b=6'), isStemContainedInContent('a=5', 'a=5, b=6'))
  assert.equal(feMirror.getQuestionGroupKey(q), getQuestionGroupKey(q))
})

test('getQuestionGroupKey：同大题同键，跨页同题号不同键', () => {
  const a = { task_id: 't1', page_number: 2, question_number: 10 }
  const b = { task_id: 't1', page_number: 2, question_number: 10 }
  const c = { task_id: 't1', page_number: 1, question_number: 10 }
  assert.equal(getQuestionGroupKey(a), getQuestionGroupKey(b))
  assert.notEqual(getQuestionGroupKey(a), getQuestionGroupKey(c))
  assert.equal(getQuestionGroupKey({}), '')
})

test('formatQuestionLabel：小问 / 大题 / 序号三种形态', () => {
  assert.equal(formatQuestionLabel(10, '2'), '第10题(2)')
  assert.equal(formatQuestionLabel(10, null), '第10题')
  assert.equal(formatQuestionLabel(null, null, 3), '第3题')
})

// ── 拆题函数：代码亲自拆时必须把公共题干落进 parent_stem ──

test('splitOcrQuestionsBySubNo：整题 content 拆小问时，(1) 之前的公共题干进 parent_stem', () => {
  const out = splitOcrQuestionsBySubNo([{
    question_number: 10,
    page_number: 2,
    content: '已知抛物线 y=ax²+1(a≠0)与直线 y=-3x+3 交于点(-1,b). (1)求a、b的值； (2)求抛物线与直线y=x+5的两交点及顶点所构成的三角形的面积。',
    student_answer: '(1) a=5 b=6 (2) S=18/5'
  }])
  assert.equal(out.length, 2)
  assert.equal(out[0].sub_no, '1')
  assert.equal(out[1].sub_no, '2')
  // 共享题干落在 parent_stem，且逐字相同
  assert.ok(out[0].parent_stem.includes('已知抛物线'), `应含公共题干，实际 ${JSON.stringify(out[0].parent_stem)}`)
  assert.equal(out[0].parent_stem, out[1].parent_stem, '同一大题拆出的两条 parent_stem 必须一致')
  // content 保持既有行为：stem 仍拼在 content 里（判题/答案引擎输入不变）
  assert.ok(out[0].content.includes('已知抛物线'))
})

test('splitOcrQuestionsBySubNo：AI 已给 sub_no + parent_stem 时原样保留，并同步到同组其余行', () => {
  const out = splitOcrQuestionsBySubNo([
    { question_number: 10, page_number: 2, sub_no: '1', parent_stem: '已知抛物线 y=ax²+1(a≠0)与直线 y=-3x+3 交于点(-1,b).', content: '(1)求a、b的值；', student_answer: 'a=5' },
    { question_number: 10, page_number: 2, sub_no: '2', parent_stem: null, content: '(2)求面积；', student_answer: 'S=18/5' },
    // 不同页的同题号不是同一大题，不允许被串给
    { question_number: 10, page_number: 1, sub_no: '2', parent_stem: null, content: '(2)另一页的题；', student_answer: 'x' }
  ])
  assert.equal(out[0].parent_stem, '已知抛物线 y=ax²+1(a≠0)与直线 y=-3x+3 交于点(-1,b).')
  assert.equal(out[1].parent_stem, '已知抛物线 y=ax²+1(a≠0)与直线 y=-3x+3 交于点(-1,b).', '同组缺 stem 的行应从组内继承')
  assert.ok(!out[2].parent_stem, '跨页同题号不允许继承')
})

test('splitOcrQuestionsBySubNo：无小问的普通题不加 parent_stem', () => {
  const out = splitOcrQuestionsBySubNo([{ question_number: 3, page_number: 1, content: '3. 计算 1+1。', student_answer: '2' }])
  assert.equal(out.length, 1)
  assert.equal(out[0].sub_no, undefined)
  assert.equal(out[0].parent_stem, undefined)
})

// ── P0.5：答案库小题行防误伤 ──

test('splitSubAnswers：「解：」等短前缀不再导致整题答案漏拆（27.2(2) q=10 事故盲区）', () => {
  // 事故原形：首标记 (1) 前有 "解："（start>2），旧逻辑整题行拆不出分段，
  // 小题行错位防线随之失效
  const segs = splitSubAnswers('解：(1) 由题意知 (-1,b) 既在直线上又在抛物线上，∴ b=6，a=5 (2) 面积 S=18/5')
  assert.ok(Array.isArray(segs) && segs.length === 2, `应拆出 2 段，实际 ${JSON.stringify(segs)}`)
  assert.equal(segs[0].sub_no, '1')
  assert.ok(segs[0].answer.includes('b=6'))
  assert.equal(segs[1].sub_no, '2')
  // 长前缀 / 含数字的前缀仍然拒绝（保持防误拆）
  assert.equal(splitSubAnswers('第 3 题的答案：(1) a (2) b'), null)
  assert.equal(splitSubAnswers('这是一段很长的前缀说明文字：(1) a (2) b'), null)
})

test('isSubRowConsistentWithWhole：小题行答案与整题对应段一致 → 放行', () => {
  const whole = '(1) a=5, b=6 (2) S=18/5'
  assert.equal(isSubRowConsistentWithWhole('1', 'a=5', whole), true)
  assert.equal(isSubRowConsistentWithWhole('2', '18/5', whole), true)
})

test('isSubRowConsistentWithWhole：小题行是别的题的答案（27.2(2) 实测形态）→ 判不一致', () => {
  // 整题行 q=10 是二次函数题；sub='1' 却存了抛物线 y=2(x-2)² 题的答案
  const whole = '(1) a=5, b=6 (2) S=18/5'
  assert.equal(isSubRowConsistentWithWhole('1', '抛物线 y=2(x-2)² 的顶点坐标是 (2,0)', whole), false)
})

test('isSubRowConsistentWithWhole：整题行拆不出分段 / 缺对应段 → 无法证伪，维持现状', () => {
  assert.equal(isSubRowConsistentWithWhole('1', '随便什么', '答案没有小问分段'), true)
  assert.equal(isSubRowConsistentWithWhole('3', '随便什么', '(1) a (2) b'), true)
  assert.equal(isSubRowConsistentWithWhole('1', '', '(1) a=5 (2) b=6'), true, '小题行缺文本时不判死')
})

// ── 采集层提示词与落库口径（文本断言，避免 import worker.js 连数据库） ──

test('练习册/答案库/通用三条 OCR 提示词都带 parent_stem 规则', () => {
  const worker = readFileSync(`${ROOT}server/worker.js`, 'utf8')
  const ai = readFileSync(`${ROOT}server/config/ai.js`, 'utf8')
  // 练习册 + 答案库两条管线的提示词（各出现一次「绝不能丢掉大题的公共题干」）
  const hits = worker.split('拆小问绝不能丢掉大题的公共题干').length - 1
  assert.ok(hits >= 2, `worker.js 两条管线都应含公共题干规则，实际 ${hits} 处`)
  assert.ok(worker.includes('"parent_stem": null'), '练习册/答案库提示词 JSON 模板应声明 parent_stem 字段')
  assert.ok(ai.includes('parent_stem'), '通用提示词应含 parent_stem 规则')
  assert.ok(ai.includes('公共题干绝不能丢'), '通用提示词应含「公共题干绝不能丢」约束')
})

test('createQuestions 落库映射 parent_stem / sub_no（含 shared_stem 别名兜底）', () => {
  const neon = readFileSync(`${ROOT}server/services/neonService.js`, 'utf8')
  assert.ok(neon.includes('parent_stem: coerceAIText(q.parent_stem ?? q.shared_stem) || null'))
  assert.ok(neon.includes('sub_no:'), 'createQuestions 应写 sub_no')
})

test('重练卷 PDF 渲染公共题干（连排去重 + 题组编号）', () => {
  const svc = readFileSync(`${ROOT}server/services/wrongRetryPdfService.js`, 'utf8')
  assert.ok(svc.includes('q.parent_stem, q.sub_no, q.question_number, q.task_id, q.page_number'), 'SQL 应取回题组字段')
  assert.ok(svc.includes('ORDER BY q.page_number NULLS LAST'), '小问必须相邻，否则连排失效')
  assert.ok(svc.includes('q-stem'), 'PDF 模板应有公共题干样式')
  assert.ok(svc.includes('isContinuation'), '应有连排判定（同大题只渲染一次公共题干）')
})
