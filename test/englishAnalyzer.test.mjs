/**
 * 回归锁（r290，2026-10-15）：英语学科分析器 englishAnalyzer 行为锁
 * ─────────────────────────────────────────────────────────────────────
 * 为什么补这把锁（r290 只读核查实证）：
 *   `server/services/englishAnalyzer.js`（2026-09-20 随 b93c594 出生）**零测试覆盖**——
 *   test/ 与 server/tests/ 下没有任何文件 import 它。而它是两个生产链路的共用依赖：
 *     ① variantService.generateVariantsForQuestion：按 englishType 强约束变式题 prompt、
 *        并作为入库 question_type 的兜底（variantService.js:224/256）；
 *     ② knowledgeService.normalizeQuestionTags：英语题 ai_tags 为空时走
 *        classifyEnglishLocally 补题型标签，标签进 matchKnowledgePoints ⇒ 直接影响
 *        知识点关联（knowledgeService.js:244）。
 *   英语语法重练功能 10-15 当天连落 T1-T5 五个提交，这个分类器是其中一环，
 *   没有锁意味着任何重构/正则调整都不会被套件发现。
 *
 * 判据设计：
 *   - 三个导出全是**纯函数**（无 DB/网络）⇒ 真跑函数断言行为，不是源码 grep。
 *   - 生产数据实证（r290 只读探针，54 道英语题）：options 长度只有 0/3/6，
 *     **没有任何一题是 4 个短选项** ⇒ 文件里那个「4 短选项 ⇒ choice」兜底
 *     currently 在生产不可达；本锁把它作为「已知现状」固定下来（含下述 discrepancy）。
 *
 * ⚠️ 已知差异（已提案 r290-P-A，待负责人拍板，**不是本锁要修的东西**）：
 *   detectEnglishQuestionType 的「4 短选项 ⇒ choice」兜底跑在 pattern 循环**之前**，
 *   而文件头注释声明的优先级是「完形 → 语法填空 → … → 选择 → 填空」（兜底本意是
 *   「文本都不命中 pattern 时」才启用）。现行实现让 4 短选项题永远拿不到具体题型：
 *   实测 '完形填空' + 4 短选项 → choice（应为 cloze）、'阅读理解' + 4 短选项 → choice。
 *   本锁用「characterization」断言固定现行行为并显式标注；若 r290-P-A 获批修复
 *   （兜底移到循环后），对应断言必须同步改判为新行为，不允许悄悄删掉。
 *
 * 反向自检（不 spawnSync git，Windows EBUSY）：本文件导出 assertDetect(m) /
 *   assertErrorType(m) / assertLocal(m)，同一批判据喂给**变异副本**必须抛错。
 *   实测三种变异各判红（见 r290 报告）：
 *   M1 删 cloze pattern / M2 taxonomy 倒序遍历 / M3 unshift 改 push。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const mod = await import(pathToFileURL(path.join(ROOT, 'server/services/englishAnalyzer.js')).href)

const { detectEnglishQuestionType, classifyEnglishErrorType, classifyEnglishLocally } = mod

// ── 样本（全部经过现行实现实测，非想象值）──
// 4 个短选项（生产不可达形态，仅锁兜底分支本身）
const FOUR_SHORT = ['A. rains', 'B. rain', 'C. will rain', 'D. rained']
// 4 个超长英文选项（≥60 字符，触发「长文段 ⇒ 不走 choice 兜底」保护）
const FOUR_LONG_EN = [
  'This is a deliberately long English option text that certainly exceeds sixty characters in total length for sure',
  'Another deliberately long English option text that certainly exceeds sixty characters in total length as well',
  'Yet another deliberately long English option text that certainly exceeds sixty characters in total length too',
  'The last deliberately long English option text that certainly exceeds sixty characters in total length yes',
]
// 3 个短选项（生产实证形态： She will cut them __2__ … 的真题就是 3 选项）
const THREE_SHORT = ['careful', 'carefully', 'more careful']

/** detectEnglishQuestionType 全部行为判据（m = 被测模块，供反向自检复用） */
export function assertDetect(m) {
  const det = m.detectEnglishQuestionType

  // ① pattern 主路径：文本命中具体题型（走生产真实的 0/3 选项形态，不碰 4 选项兜底）
  assert.deepEqual(det('完形填空：阅读下面短文，从每题所给选项中选出最佳选项', THREE_SHORT), { type: 'cloze', label: '完形填空' }, '完形填空必须识别为 cloze')
  assert.deepEqual(det('语法填空：用所给词的适当形式填空', []), { type: 'grammar_blank', label: '语法填空' }, '语法填空必须识别为 grammar_blank')
  assert.deepEqual(det('短文改错：下列句中有一处错误', []), { type: 'error_correction', label: '短文改错' }, '短文改错必须识别为 error_correction')
  assert.deepEqual(det('Translate the following sentences into Chinese.', []), { type: 'translation', label: '翻译' }, '翻译题必须识别为 translation')
  assert.deepEqual(det('书面表达：假如你是李华，请写一封邮件', []), { type: 'writing', label: '书面表达' }, '书面表达必须识别为 writing')
  assert.deepEqual(det('阅读理解：阅读下列短文，回答下列问题', []), { type: 'reading', label: '阅读理解' }, '阅读理解必须识别为 reading')
  assert.deepEqual(det('按要求完成下列句子', []), { type: 'sentence_pattern', label: '句型' }, '句型转换必须识别为 sentence_pattern')
  assert.deepEqual(det('下列选项中正确的是', []), { type: 'choice', label: '选择题' }, '文本命中选择题 pattern 必须识别为 choice')

  // ② 无命中 ⇒ unknown/其他（不允许把认不出的题硬塞进某个题型）
  assert.deepEqual(det('这是一个普通题目没有任何特征', null), { type: 'unknown', label: '其他' }, '无命中必须返回 unknown')

  // ③ options 形态鲁棒性：字符串 / null 都不许炸（生产 options 可能是 JSON 字符串）
  assert.deepEqual(det('plain text here', 'A. single string option'), { type: 'unknown', label: '其他' }, 'options 为字符串时不得抛错')
  assert.deepEqual(det('plain text here', null), { type: 'unknown', label: '其他' }, 'options 为 null 时不得抛错')
  assert.deepEqual(det('plain text here', undefined), { type: 'unknown', label: '其他' }, 'options 为 undefined 时不得抛错')

  // ④ 4 短选项兜底（注释声明的本意）：文本不命中任何 pattern 时才启用
  assert.deepEqual(det('If it ___ tomorrow, we will stay at home.', FOUR_SHORT), { type: 'choice', label: '选择题' }, '4 短选项 + 无 pattern 文本必须兜底为 choice')

  // ⑤ 长文段保护：4 个 ≥60 字符的英文选项不得被当成选择题
  assert.deepEqual(det('Read the following passage and choose the best answer', FOUR_LONG_EN), { type: 'reading', label: '阅读理解' }, '4 个长选项不得走 choice 兜底')

  // ⑥ 3 短选项不触发兜底（生产实证 3 选项形态；兜底判据恰为 4）
  assert.deepEqual(det('She will cut them __2__ to make the salad beautiful.', THREE_SHORT), { type: 'unknown', label: '其他' }, '3 个短选项不得触发 choice 兜底')

  // ⑦ ⚠️ characterization（已知差异 r290-P-A，非预期行为）：
  //    4 短选项 + 完形填空文本 ⇒ 现行返回 choice（兜底跑在 pattern 之前，与文件头
  //    优先级声明矛盾）。固定现状；r290-P-A 获批修复后必须改判 {type:'cloze'}。
  assert.deepEqual(det('完形填空：阅读下面短文，从每题所给选项中选出最佳选项', FOUR_SHORT), { type: 'choice', label: '选择题' },
    '【已知差异 r290-P-A】4 短选项 + 完形填空文本现行返回 choice（应为 cloze）——修复后请改判')
}

/** classifyEnglishErrorType 全部行为判据 */
export function assertErrorType(m) {
  const cls = m.classifyEnglishErrorType

  // ① 各错因族可命中（errorType 或 errorReason 任一命中即可）
  assert.deepEqual(cls('时态错误', '一般过去时用错'), { key: 'tense', label: '时态错误' }, '时态错误必须归到 tense')
  assert.deepEqual(cls('粗心', '拼写错误'), { key: 'spelling', label: '拼写错误' }, '错因描述里的「拼写」必须归到 spelling')
  assert.deepEqual(cls('冠词', '漏掉 the'), { key: 'article', label: '冠词错误' }, '冠词问题必须归到 article')

  // ② 无命中 ⇒ null（调用方据此决定要不要回落通用错因，不许硬塞）
  assert.equal(cls('其他', '完全无关的描述'), null, '无命中必须返回 null')
  assert.equal(cls(null, null), null, '双 null 入参不得抛错')
  assert.equal(cls(undefined, undefined), null, '双 undefined 入参不得抛错')

  // ③ 优先级：多命中时按 taxonomy 顺序取第一项（tense 在 spelling 之前）
  assert.deepEqual(cls('时态', '冠词问题'), { key: 'tense', label: '时态错误' }, '多命中必须按 taxonomy 顺序取第一项')
}

/** classifyEnglishLocally 全部行为判据 */
export function assertLocal(m) {
  const cls = m.classifyEnglishLocally

  // ① 有本地标签时：题型标签 unshift 到最前（knowledgeService 依赖它做 KP 匹配）
  const r1 = cls('If it ___ tomorrow, we will stay at home.', '英语', FOUR_SHORT)
  assert.equal(r1.englishType.type, 'choice', 'englishType 必须回传')
  assert.ok(Array.isArray(r1.tags) && r1.tags.length > 0, 'tags 必须非空数组')
  assert.equal(r1.tags[0], r1.englishType.label, '题型标签必须 unshift 到 tags[0]（local 标签之前）')
  assert.equal(typeof r1.difficulty, 'number', 'difficulty 必须是数字')

  // ② tags 全空时：兜底 [题型标签] + difficulty 3（englishAnalyzer 自己的硬编码契约）
  const r2 = cls('随机内容 xyz', '英语', null)
  assert.deepEqual(r2.tags, ['其他'], '无任何标签时必须兜底为 [题型标签]')
  assert.equal(r2.difficulty, 3, '兜底分支 difficulty 必须为 3')
  assert.equal(r2.englishType.type, 'unknown', '兜底分支 englishType 必须为 unknown')
}

test('⛔ 英语题型识别：pattern 主路径 + unknown 兜底 + options 形态鲁棒性', () => {
  assertDetect(mod)
})

test('⛔ 英语题型识别：4 短选项 choice 兜底与长文段保护（含已知差异 characterization）', () => {
  // ④⑤⑥⑦ 单独成条：兜底语义是本文件最需要盯的一段（r290-P-A 的落点）
  const det = mod.detectEnglishQuestionType
  assert.deepEqual(det('If it ___ tomorrow, we will stay at home.', FOUR_SHORT), { type: 'choice', label: '选择题' })
  assert.deepEqual(det('Read the following passage and choose the best answer', FOUR_LONG_EN), { type: 'reading', label: '阅读理解' })
  assert.deepEqual(det('She will cut them __2__ to make the salad beautiful.', THREE_SHORT), { type: 'unknown', label: '其他' })
  assert.deepEqual(det('完形填空：阅读下面短文，从每题所给选项中选出最佳选项', FOUR_SHORT), { type: 'choice', label: '选择题' },
    '【已知差异 r290-P-A】修复后必须改判 cloze')
})

test('⛔ 英语错因归类：taxonomy 命中 / null 回落 / 多命中取第一项', () => {
  assertErrorType(mod)
})

test('⛔ 英语本地标签：题型标签 unshift + 空 tags 兜底契约', () => {
  assertLocal(mod)
})
