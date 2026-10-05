/**
 * 回归锁：questions.ai_tags 是 text 列，不是 jsonb（2026-10-05 实测生产缺陷）
 *
 * 起因：全量重算存量关联时，dry-run 报出「200 道里 67 道失去全部关联」，
 *   逐条查下去发现根因不是脚本写错，而是**生产链路一直在丢标签**：
 *   `questions.ai_tags` 列类型是 text，SELECT 出来是字符串
 *   `'["抛物线方程", "抛物线上的点坐标"]'`，
 *   而 normalizeQuestionTags 原来只做 `Array.isArray(aiTags) ? ... : []`
 *   ⇒ 全库 3011 道题的标签**一道都没被用上**，静默全部回落本地规则。
 *
 * 这个 bug最阴的地方：不报错、不告警、tagSource 还诚实写 'local'，
 *   所以「改了知识树 / 加了 AI 打标却看不到关联变化」会让人查很久。
 *
 * 守护：
 *   ① 三种形态都能归一：真数组 / JSON 字符串 / 老式逗号分隔串
 *   ② 解析失败返回空数组（调用方回落本地规则），绝不抛错
 *   ③ 空值形态统一归一为 []
 *   ④ '未分类' 占位在 normalizeQuestionTags 里被剔除（不在本文件职责内）
 *
 * 纯函数，不连库。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { coerceAiTags } from '../server/services/knowledgeService.js'

test('coerceAiTags：真数组原样归一（去空白、剔空项）', () => {
  assert.deepEqual(coerceAiTags(['勾股定理', ' 相似三角形 ', '']), ['勾股定理', '相似三角形'])
})

test('coerceAiTags：text 列读出来的 JSON 字符串必须能解析（这就是生产缺陷本身）', () => {
  // 库里的真实形态
  assert.deepEqual(
    coerceAiTags('["抛物线方程", "抛物线上的点坐标", "抛物线的对称性", "二次函数的应用"]'),
    ['抛物线方程', '抛物线上的点坐标', '抛物线的对称性', '二次函数的应用'],
  )
  assert.deepEqual(coerceAiTags('["倒数定义"]'), ['倒数定义'])
})

test('coerceAiTags：老式逗号/顿号/分号分隔串也能吃', () => {
  assert.deepEqual(coerceAiTags('根式化简, 实数'), ['根式化简', '实数'])
  assert.deepEqual(coerceAiTags('根式化简，实数'), ['根式化简', '实数'])
  assert.deepEqual(coerceAiTags('根式化简、实数'), ['根式化简', '实数'])
  assert.deepEqual(coerceAiTags('根式化简; 实数'), ['根式化简', '实数'])
})

test('coerceAiTags：空值形态统一归一为 []', () => {
  for (const empty of [null, undefined, '', '   ', '[]', 'null', 'undefined']) {
    assert.deepEqual(coerceAiTags(empty), [], `${JSON.stringify(empty)} 应归一为 []`)
  }
})

test('coerceAiTags：非数组非字符串（数字/对象）返回 [] 而不是崩', () => {
  assert.deepEqual(coerceAiTags(42), [])
  assert.deepEqual(coerceAiTags({ tags: ['a'] }), [])
  assert.deepEqual(coerceAiTags(true), [])
})

test('coerceAiTags：损坏的 JSON 数组串返回 []（调用方回落本地规则，绝不抛错）', () => {
  assert.deepEqual(coerceAiTags('["勾股定理",'), [])
  assert.deepEqual(coerceAiTags('[未闭合'), [])
  assert.deepEqual(coerceAiTags('[1,2,3]'), ['1', '2', '3'], '合法 JSON 数组照常解析')
})

test('coerceAiTags：JSON 对象串（不是数组）返回 []', () => {
  assert.deepEqual(coerceAiTags('{"tags":["勾股定理"]}'), [])
})

test('coerceAiTags：数字统一转字符串（text 列里可能有非字符串元素）', () => {
  assert.deepEqual(coerceAiTags([1, '勾股定理']), ['1', '勾股定理'])
  assert.deepEqual(coerceAiTags('[1, "勾股定理"]'), ['1', '勾股定理'])
})
