import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const LIB_SRC = readFileSync(resolve(ROOT, 'server/lib/weekendHandout.js'), 'utf8')
const CLI_SRC = readFileSync(resolve(ROOT, 'server/scripts/weekend-handout.mjs'), 'utf8')
const KEY_SRC = readFileSync(resolve(ROOT, 'server/utils/ocrStemKey.js'), 'utf8')

test('周末班课件：练习册错题用 卷+页+题号+OCR等价题干 合并（不裸并不同题）', () => {
  // 聚合层必须复用 OCR 等价指纹，且只对 workbook 自然键生效
  assert.ok(LIB_SRC.includes("import { ocrStemKey } from '../utils/ocrStemKey.js'"), 'lib 必须复用 ocrStemKey')
  assert.ok(CLI_SRC.includes("import { ocrStemKey } from '../utils/ocrStemKey.js'"), 'CLI 必须复用 ocrStemKey')
  assert.ok(KEY_SRC.includes('平行'), '指纹必须把平行符号等价写法归一到同一字符')
  assert.ok(KEY_SRC.includes('x'), '指纹必须把常见乘号变体归一到同一字符')
  assert.ok(LIB_SRC.includes("r.source_type === 'workbook'"), '练习册错题键必须限定 source_type=workbook')
  assert.ok(LIB_SRC.includes('r.worksheet_id') && LIB_SRC.includes('r.question_no'), '键必须带 worksheet_id 与 question_no')
  assert.ok(LIB_SRC.includes("|s:${norm}") || LIB_SRC.includes('|s:' + '${norm}'), '键必须带题干指纹，不能裸用题号')
})

test('ocrStemKey：OCR 等效写法归一为同一键', async () => {
  const { ocrStemKey } = await import('../server/utils/ocrStemKey.js')
  const a = ocrStemKey('如图，已知直线l₁∥l₂∥l₃，那么下列结论中，正确的是（ ）')
  const b = ocrStemKey('如图，已知直线l₁ // l₂ // l₃，那么下列结论中，正确的是( )')
  assert.equal(a, b)
  const c = ocrStemKey('如图，已知直线l₁∥l₂∥l₃，AC=6，DE=3，EF=2，那么BC的长为______')
  const d = ocrStemKey('如图，已知直线l₁ // l₂ // l₃AC=6 DE=3,EF=2，那么BC的长为______')
  assert.equal(c, d)
  const e = ocrStemKey('如图，AB//CD//EF，AF、BE 交于点 G，下列比例式中，错误的是')
  assert.notEqual(a, e)
})

test('2026-09-20 去重修复：合并键折叠 OCR 差异并删除填空线；全局跨天合并（CLI 同构）', () => {
  // ① 合并键 = ocrStemKey + normalizeStem + 去下划线（填空线有无/∥// 不再拆题）
  assert.ok(LIB_SRC.includes('function mergeKeyOf'), 'lib 必须定义 mergeKeyOf（跨天/跨桶合并键）')
  assert.ok(CLI_SRC.includes('function mergeKeyOf'), 'CLI 必须同构 mergeKeyOf')
  assert.ok(LIB_SRC.includes(".replace(/_+/g, '')"), 'lib 合并键必须删除填空线/下标分隔下划线')
  assert.ok(CLI_SRC.includes(".replace(/_+/g, '')"), 'CLI 合并键必须删除填空线')
  // ② 全局跨天合并：_day 归节（两个人共错一题跨天只出现一次，累计共 N 人错）
  assert.ok(LIB_SRC.includes("_day: t._day"), 'lib 必须有跨天合并的日期归属逻辑 _day')
  assert.ok(CLI_SRC.includes("_day: t._day"), 'CLI 必须同构跨天合并 _day')
  assert.ok(LIB_SRC.includes('全局跨天去重'), 'lib 必须有全局跨天去重')
  assert.ok(CLI_SRC.includes('全局跨天去重'), 'CLI 必须同构全局跨天去重')
  // ③ 学生明细记录错误日期 days（跨天合并后保留「谁哪天错的」）
  assert.ok(LIB_SRC.includes('days: [day]'), 'lib 学生明细必须记录错误日期 days')
  assert.ok(CLI_SRC.includes('toYmd(new Date(m.added_at))'), 'CLI 学生明细必须记录错误日期 days')
})

test('mergeKeyOf 语义：OCR 折叠 + 去下划线后，填空线有无 / ∥// 不影响合并键（2026-09-20）', async () => {
  // 与 lib mergeKeyOf 相同的组合：ocrStemKey → normalizeStem → 去 _
  const { ocrStemKey } = await import('../server/utils/ocrStemKey.js')
  const { normalizeStem } = await import('../server/utils/stemNormalize.js')
  const merge = raw => normalizeStem(ocrStemKey(raw)).replace(/_+/g, '')
  // 实测 f8cf5d96 p1n5：同题两条仅「填空线有无 + 标点空格」差异 → 必须同键
  const a = merge('如图，已知直线l₁//l₂//l₃，DE=2，EF=6，BC=5，那么AB的长为______')
  const b = merge('如图，已知直线l₁∥l₂∥l₃DE=2 EF=6,BC=5，那么AB的长为')
  assert.equal(a, b)
  // 同页同题号混入的另题（两条不平行的直线）绝不能同键
  const c = merge('如图，两条不平行的直线l1与l2相交于点O，四条平行线分别交直线l1于点A、B、C、D')
  assert.notEqual(a, c)
})

test('2026-09-21 题号撞车护栏：组内整题行互不相同时放弃合并，回落单题展示（CLI 同构）', () => {
  // 白板第125题事故：分组键 (task_id, question_number) 不含 page_number，跨页撞号时
  // 题干/答案/选项分别来自不同题（题干=选择题、答案=另一题的 -1<t<0、选项=空）。
  // 护栏：整题行（sub_no 为空）≥2 条且内容互不相同 → buildCompleteQuestion 直接回落 rep 自身。
  for (const [label, SRC] of [['lib', LIB_SRC], ['CLI', CLI_SRC]]) {
    assert.ok(SRC.includes('numberCollision'), `${label} 必须产出 numberCollision 标记`)
    assert.ok(SRC.includes('整题行（题号跨页撞车）'), `${label} 必须有撞车放弃合并的日志/护栏注释`)
    assert.ok(SRC.includes('if (complete.numberCollision) return null'), `${label} 撞车组必须禁用同大题配图兜底（宁可不出图，不显示邻题的图）`)
  }
  // 护栏判据语义：只统计「整题行」（sub_no == null 且有内容），小问行跨页的合法组不受影响
  assert.ok(LIB_SRC.includes('x.sub_no == null && x.content'), 'lib 判据必须只看整题行')
  assert.ok(CLI_SRC.includes('x.sub_no == null && x.content'), 'CLI 判据必须只看整题行')
})
