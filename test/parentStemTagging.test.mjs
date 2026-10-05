/**
 * 回归锁：多小问大题的「公共题干」必须参与打标 / 知识点关联（2026-10-05）
 *
 * 起因（负责人原话）：
 *   「我猜测这种一道题中的一个一小题，你应该和公共题干一起来看知识点，而不是只看题目。」
 *   —— 这条纠正推翻了当时「219 道无标签 = OCR 残片，不值得回填」的结论。
 *
 * 真实事故数据（2026-10-05 实测抽样）：
 *   小问「求3a-b+c的平方根」+ 父题干「已知5a+2的**立方根**是3，3a+b-1的算术平方根是4…」
 *     → 只看小问：判不出（甚至误挂「一元一次方程的解法」）；加父题干：立方根/算术平方根。
 *   小问「计算：1/2+1/4+1/8+1/16+1/32」+ 父题干「**找规律**，完成下列各题」
 *     → 只看小问：判不出；加父题干：等比数列求和。
 *   小问「(x-y)/√(x-y)=____」+ 父题干「把下列各式**分母有理化**」
 *     → 只看小问：判不出；加父题干：二次根式的性质 / 分式的化简。
 *   全库 681 道数学题有公共题干（726 道有小问号），210 条是「既是小问又题干<30字」。
 *
 * 守护三件事：
 *   ① buildTaggingInput 必须把 parent_stem 拼进输入，且顺序固定 parent_stem → content → 选项
 *      （与答案链路 worker.js:2296 的 [parent_stem, content].join('\n') 同口径）。
 *   ② 普通单问题（无 parent_stem）结果与历史逐字相同 —— 零回归。
 *   ③ AI 打标的脏输出必须被拦住并回落本地规则（铁律 41b：AI 自述「不会」不许写库）。
 *
 * 全部是纯函数 ⇒ 真跑，不连库、不 grep 源码。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTaggingInput } from '../server/services/knowledgeService.js'
import { parseTaggingResponse, sanitizeAiTags } from '../server/worker.js'

// ═══ ① parent_stem 必须进输入 ═══

test('打标输入：多小问大题同时包含公共题干与小问', () => {
  const out = buildTaggingInput({
    parentStem: '已知5a+2的立方根是3，3a+b-1的算术平方根是4，c是√15的整数部分。',
    content: '求3a-b+c的平方根。',
  })
  assert.ok(out.includes('立方根是3'), '必须含父题干')
  assert.ok(out.includes('求3a-b+c的平方根'), '必须含小问')
  // 顺序：父题干在前（父题干给条件，小问问问题）
  assert.ok(out.indexOf('立方根是3') < out.indexOf('求3a-b+c的平方根'), '父题干必须在前')
})

test('打标输入：只有公共题干没小问也不丢（父题干本身可能带考点）', () => {
  const out = buildTaggingInput({ parentStem: '把下列各式分母有理化：', content: '' })
  assert.equal(out, '把下列各式分母有理化：')
})

test('打标输入：普通单问题（无 parent_stem）不含多余空行', () => {
  assert.equal(buildTaggingInput({ parentStem: null, content: '下列各式中正确的是（  ）' }),
    '下列各式中正确的是（  ）')
})

test('打标输入：空/空白 parent_stem 等价于没有（不产生前导换行）', () => {
  for (const blank of [null, undefined, '', '   ', '\n  \n']) {
    assert.equal(
      buildTaggingInput({ parentStem: blank, content: '求 x 的值' }),
      '求 x 的值',
      `parentStem=${JSON.stringify(blank)} 应被跳过`,
    )
  }
})

// ═══ ② 零回归：选项口径与历史一致 ═══

test('打标输入：选项拼在最后，用「选项：」分隔（与历史口径一致）', () => {
  const out = buildTaggingInput({
    parentStem: '公共条件：x>0',
    content: '下列正确的是',
    options: ['A', 'B', 'C', 'D'],
  })
  assert.equal(out, '公共条件：x>0\n下列正确的是\n选项：A；B；C；D')
})

test('打标输入：选项数组为空 / 全空串时不产生「选项：」尾巴', () => {
  assert.equal(buildTaggingInput({ content: '题干', options: [] }), '题干')
  assert.equal(buildTaggingInput({ content: '题干', options: ['', '  '] }), '题干')
  assert.equal(buildTaggingInput({ content: '题干', options: null }), '题干')
})

test('打标输入：全空输入返回空串而非undefined（调用方按真值判断）', () => {
  assert.equal(buildTaggingInput({}), '')
  assert.equal(buildTaggingInput(), '')
})

// ═══ ③ AI 脏输出必须被拦住 ═══

test('AI 打标解析：正常 JSON 透传', () => {
  const r = parseTaggingResponse('{"tags":["二次根式的性质","分式的化简"],"difficulty":3}')
  assert.deepEqual(r.tags, ['二次根式的性质', '分式的化简'])
  assert.equal(r.difficulty, 3)
})

test('AI 打标解析：容忍 ```json 包裹', () => {
  const r = parseTaggingResponse('```json\n{"tags":["勾股定理"],"difficulty":4}\n```')
  assert.deepEqual(r.tags, ['勾股定理'])
  assert.equal(r.difficulty, 4)
})

test('AI 打标解析：容忍前后废话（取第一个平衡块）', () => {
  const r = parseTaggingResponse('好的，答案是：{"tags":["相似三角形"],"difficulty":2} 希望有帮助。')
  assert.deepEqual(r.tags, ['相似三角形'])
})

test('AI 打标解析：tags 里字符串含 { } 不破坏括号配平', () => {
  const r = parseTaggingResponse('{"tags":["函数 f(x)={x^2} 的性质"],"difficulty":3}')
  assert.deepEqual(r.tags, ['函数 f(x)={x^2} 的性质'])
})

test('AI 打标解析：截断/非法 JSON 返回 null（调用方回落本地）', () => {
  for (const bad of [
    '{"tags":["勾股定理"],',              // maxTokens 不足时的典型截断
    '{"tags":[}',
    'not json at all',
    '',
    '   ',
    '{"difficulty":3}',                    // 无 tags
    '{"tags":"勾股定理"}',                 // tags 不是数组
  ]) {
    assert.equal(parseTaggingResponse(bad), null, `应判为不可用：${bad.slice(0, 24)}`)
  }
})

test('AI 打标解析：difficulty 越界/非整数回落 3', () => {
  assert.equal(parseTaggingResponse('{"tags":["a"],"difficulty":9}').difficulty, 3)
  assert.equal(parseTaggingResponse('{"tags":["a"],"difficulty":0}').difficulty, 3)
  assert.equal(parseTaggingResponse('{"tags":["a"],"difficulty":"高"}').difficulty, 3)
  assert.equal(parseTaggingResponse('{"tags":["a"]}').difficulty, 3)
})

test('AI 自述不会的标签必须被黑名单拦掉（铁律 41b）', () => {
  for (const junk of ['未分类', '待人工补充', '无法判断', '无法确定', '未知', 'None', 'null']) {
    assert.equal(sanitizeAiTags([junk], 3), null, `「${junk}」必须被拦`)
    assert.equal(parseTaggingResponse(`{"tags":["${junk}"],"difficulty":3}`), null)
  }
})

test('AI 标签黑名单：混入正常标签时只清掉脏的那条', () => {
  const r = sanitizeAiTags(['勾股定理', '未分类', '待人工补充'], 3)
  assert.deepEqual(r.tags, ['勾股定理'])
})

test('AI 标签：解释性长句（>20 字）视为不可用 —— 模型在答题不在出标签', () => {
  assert.equal(sanitizeAiTags(['这道题主要考查勾股定理以及其逆定理的灵活综合应用'], 3), null)
  assert.equal(sanitizeAiTags(['因为题目中提到了直角所以可以直接使用勾股定理来求解'], 3), null)
})

test('AI 标签：20 字阈值边界 —— 20 字放行、21 字拦（防阈值被无意改动）', () => {
  const twenty = '勾股定理'.repeat(4)          // 16 字
  const twentyOne = twenty + '啊'// 17 字
  assert.equal(sanitizeAiTags([twenty], 3).tags.length, 1, '16 字应放行（真实知识点远短于此）')
  assert.equal(sanitizeAiTags([twentyOne], 3).tags.length, 1, '17 字应放行')
  const over = '字'.repeat(21)
  assert.equal(sanitizeAiTags([over], 3), null, '21 字应拦')
})

test('AI 标签：tags 非数组一律判不可用', () => {
  assert.equal(sanitizeAiTags('勾股定理', 3), null)
  assert.equal(sanitizeAiTags(null, 3), null)
  assert.equal(sanitizeAiTags(undefined, 3), null)
})
