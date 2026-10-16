/**
 * 选项标号清洗单元测试（r298 接线进 npm test）。
 * 同时断言 server/utils/optionText.js 与 src/utils/optionText.js 两份副本行为一致
 * ——「两份实现必须同改」的守护锁（任何一侧漂移都会在这里判红）。
 *
 * 历史：本文件 2026-09-20（b93c594）以手跑风格提交（node test/option_text_unit.mjs），
 * 文件名不带 `.test.mjs` 后缀 ⇒ `node --test "test/*.test.mjs"` 的 glob 从未覆盖它，
 * npm test 全绿时这 52 条断言一条都没跑（r215/r216 假绿家族的漏网形态：
 * 门禁判据只认 `.test.mjs` 命名）。r298 原地改造为 node:test 并改名纳入套件，
 * 用例与期望值逐字未变。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeOptions as srv, formatOptionsForPrompt as srvFmt } from '../server/utils/optionText.js'
import { normalizeOptions as web, formatOptionsForPrompt as webFmt } from '../src/utils/optionText.js'

const check = (label, input, expected) => {
  test(label, () => {
    const a = srv(input)
    const b = web(input)
    const same = JSON.stringify(a) === JSON.stringify(b)
    assert.ok(same, `两份副本不一致：server=${JSON.stringify(a)}，web=${JSON.stringify(b)}`)
    assert.equal(JSON.stringify(a), JSON.stringify(expected), `输入 ${JSON.stringify(input)} 期望 ${JSON.stringify(expected)}`)
  })
}

// ── 应该剥掉的形态 ──
check('半角括号（线上真实脏数据）', ['(A) 3/4', '(B) 4/3', '(C) 3/5', '(D) 4/5'], ['3/4', '4/3', '3/5', '4/5'])
check('全角括号', ['（A）12米', '（B）4√3米', '（C）5√3米', '（D）6√3米'], ['12米', '4√3米', '5√3米', '6√3米'])
check('裸字母加点', ['A. apple', 'B. banana', 'C. cat', 'D. dog'], ['apple', 'banana', 'cat', 'dog'])
check('裸字母加顿号', ['A、SSS', 'B、SAS', 'C、ASA', 'D、AAS'], ['SSS', 'SAS', 'ASA', 'AAS'])
check('裸字母加右括号', ['A) 1', 'B) 2', 'C) 3', 'D) 4'], ['1', '2', '3', '4'])
check('全角句点', ['A．1', 'B．2'], ['1', '2'])
check('方括号与中括号', ['[A] 1', '[B] 2'], ['1', '2'])
check('括号后还有点', ['(A). 1', '(B). 2'], ['1', '2'])
check('标号与正文之间无空格', ['(A)b=a·sinB', '(B)a=b·cosB'], ['b=a·sinB', 'a=b·cosB'])
check('行内公式定界符包在最外层', ['$(A) \\frac{3}{4}$', '$(B) \\frac{4}{3}$'], ['$\\frac{3}{4}$', '$\\frac{4}{3}$'])
check('两个选项的判断题带标号', ['(A) 正确', '(B) 错误'], ['正确', '错误'])
check('小写标号', ['(a) 1', '(b) 2'], ['1', '2'])
check('八选项', ['A. 1', 'B. 2', 'C. 3', 'D. 4', 'E. 5', 'F. 6', 'G. 7', 'H. 8'], ['1', '2', '3', '4', '5', '6', '7', '8'])

// ── 必须原样保留的形态（防止把正文误当标号）──
check('本来就干净', ['3/4', '4/3', '3/5'], ['3/4', '4/3', '3/5'])
check('幂等：剥过一遍再剥', srv(['(A) 3/4', '(B) 4/3']), ['3/4', '4/3'])
check('判断题无标号', ['正确', '错误'], ['正确', '错误'])
check('只有部分项带标号 → 整组不动', ['(A) 1', '2', '(C) 3'], ['(A) 1', '2', '(C) 3'])
check('标号乱序 → 整组不动', ['(B) 1', '(A) 2'], ['(B) 1', '(A) 2'])
check('不从 A 起 → 整组不动', ['(B) 1', '(C) 2'], ['(B) 1', '(C) 2'])
check('剥完为空 → 整组不动', ['(A)', '(B)'], ['(A)', '(B)'])
check('等式开头恰好像标号但整组不成序', ['A=B', 'C=D'], ['A=B', 'C=D'])
check('空数组', [], [])
check('非数组原样返回', null, null)
check('数字项不参与（非字符串 → 整组不动）', [1, 2], [1, 2])

// ── prompt 拼接（AI 必须看到 A/B/C/D 标号才能回答字母）──
const fmtCases = [
  ['干净选项', ['3/4', '4/3', '3/5', '4/5'], 'A. 3/4；B. 4/3；C. 3/5；D. 4/5'],
  ['脏选项自动剥后补标号', ['(A) 3/4', '(B) 4/3'], 'A. 3/4；B. 4/3'],
  ['无选项返回空串', [], ''],
  ['非数组返回空串', null, ''],
]
for (const [label, input, expected] of fmtCases) {
  test(`formatOptionsForPrompt ${label}`, () => {
    const a = srvFmt(input)
    const b = webFmt(input)
    assert.equal(a, expected, `server 侧期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(a)}`)
    assert.equal(b, expected, `web 侧期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(b)}`)
  })
}
