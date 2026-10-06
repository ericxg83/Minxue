/**
 * 考点名对齐回归锁（r220）
 *
 * ⛔ 这道闸为什么必须有：r219 实测发现 AI 造的 6 个关联考点名里 **3 个在树里查不到**：
 *     「相似三角形判定」 → 树里真名是「相似三角形的**的**判定」
 *     「相似三角形性质」 → 树里是「相似三角形的性质」
 *     「几何图形性质」   → 树里**根本没有**
 *   ⇒ 不做对齐就写入，考法**挂不回知识树**，「按考点找这批题」会漏掉它们，
 *     而老师完全不知道自己漏了什么（记忆铁律：挂不上树的关联 = 第二份假真相）。
 *
 * 判据：
 *   1. 精确 / 去「的」两种主路径必须能对上（树里 15+ 节点带「的」）
 *   2. 对不上必须**如实回报**（unmatched），绝不静默丢、也绝不猜
 *   3. 包含匹配要有长度差门槛，否则「三角形」会乱匹配一串节点
 *   4. 同一节点被多个 AI 名抢到时只留一个，其余退回 unmatched（不重复写）
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(resolve(ROOT, 'server/services/kaofaInduction.js'), 'utf8')

// 服务是压缩写法不能直接 import，这里用 Function 构造器取出纯函数真跑。
// ⛔ 两个提取坑（都实测踩过）：
//   1. 必须**花括号配对**，不能靠 '\n}' —— 函数体里嵌套对象字面量，按行截断会切在半路。
//   2. 必须取**整个函数声明**并去掉 `export` 前缀再包成表达式。
//      只取函数体 `{...}` 包进括号会变成「括号里的块语句」⇒ SyntaxError。
function loadPureFn(name) {
  const start = SRC.indexOf(`export function ${name}(`)
  assert.ok(start > -1, `源文件里找不到 ${name}`)
  const braceAt = SRC.indexOf('{', start)
  let depth = 0
  let end = -1
  for (let i = braceAt; i < SRC.length; i++) {
    const ch = SRC[i]
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  assert.ok(end > braceAt, `${name} 的花括号没配平`)
  const decl = SRC.slice(start, end + 1).replace(/^export\s+/, '')
  // eslint-disable-next-line no-new-func
  return new Function(`return (${decl})`)()
}

const alignKpNames = loadPureFn('alignKpNames')

// r219 实测的树（探针 _diag_r220_check.mjs 取自生产库）
const TREE = [
  { id: 'kp1', name: '相似三角形' },
  { id: 'kp2', name: '相似三角形的判定' },
  { id: 'kp3', name: '相似三角形的性质' },
  { id: 'kp4', name: '比例线段' },
  { id: 'kp5', name: '面积公式' },
  { id: 'kp6', name: '比例关系' },
  { id: 'kp7', name: '勾股定理' },
  { id: 'kp8', name: '三角形' },
  { id: 'kp9', name: '一次函数的图象和性质' },
  { id: 'kp10', name: '全等三角形' },
]

test('对齐：精确同名必须走exact', () => {
  const r = alignKpNames(['比例线段', '面积公式'], TREE)
  assert.equal(r.matched.length, 2)
  assert.equal(r.unmatched.length, 0)
  assert.deepEqual(r.matched.map(m => m.how), ['exact', 'exact'])
})

test('对齐：AI 省掉「的」必须能对上（r219 实测的主场景）', () => {
  const r = alignKpNames(['相似三角形判定', '相似三角形性质'], TREE)
  assert.equal(r.unmatched.length, 0, '这两个是 r219 实测对不上的，不能再对不上')
  assert.deepEqual(r.matched.map(m => m.id), ['kp2', 'kp3'])
  assert.deepEqual(r.matched.map(m => m.how), ['strip-de', 'strip-de'])
  // 对齐后返回的必须是**树里的真名**，否则写库还是挂不上
  assert.deepEqual(r.matched.map(m => m.name), ['相似三角形的判定', '相似三角形的性质'])
})

test('对齐：树里没有的名字必须如实回报，不得静默丢也不得猜', () => {
  // 「几何图形性质」是 r219 实测树里真不存在的一个
  const r = alignKpNames(['几何图形性质'], TREE)
  assert.equal(r.matched.length, 0)
  assert.deepEqual(r.unmatched, ['几何图形性质'])
})

test('对齐：同一节点被多个 AI 名抢到时只留一个，其余退回 unmatched', () => {
  const r = alignKpNames(['相似三角形判定', '相似三角形的判定'], TREE)
  assert.equal(r.matched.length, 1, '不能把同一个节点写两遍关联')
  assert.equal(r.unmatched.length, 1)
  assert.equal(r.unmatched[0], '相似三角形的判定')
})

test('对齐：包含匹配要有长度差门槛（防「三角形」乱匹配）', () => {
  // 「三角形」与「相似三角形」长度差 2，按规则**允许**匹配 —— 但要挑最贴近的
  const r = alignKpNames(['三角形'], TREE)
  assert.equal(r.matched.length, 1)
  assert.equal(r.unmatched.length, 0)
  // 短名必须优先精确命中，而不是被「相似三角形」抢走
  const r2 = alignKpNames(['三角形'], TREE)
  assert.equal(r2.matched[0].id, 'kp8', '精确存在的「三角形」必须优先于包含匹配')
})

test('对齐：空输入不得抛异常', () => {
  for (const input of [[], null, undefined, ['', '  ', null]]) {
    const r = alignKpNames(input, TREE)
    assert.ok(Array.isArray(r.matched))
    assert.ok(Array.isArray(r.unmatched))
  }
})

test('对齐：树为空时全部退回 unmatched（不能因为树查不到就崩）', () => {
  const r = alignKpNames(['相似三角形判定'], [])
  assert.equal(r.matched.length, 0)
  assert.deepEqual(r.unmatched, ['相似三角形判定'])
})

// ── 源码层断言：写入路径必须真的用了对齐 ──────────────────────────────
test('写入路径必须走对齐（否则改了纯函数也没人调用）', () => {
  assert.match(
    SRC,
    /const\s*\{[^}]*\}\s*=\s*alignKpNames\(/,
    'saveMethod 里必须调用 alignKpNames，否则纯函数写了也白写、关联仍挂不上树。',
  )
  assert.match(
    SRC,
    /inserted:\s*rows\[0\]\?\.inserted\s*===\s*true[^}]*unmatchedKpNames/,
    'saveMethod 必须把 unmatchedKpNames 透出，接口才能如实回报给老师。',
  )
  //⛔ 不能再用 `kp.name = ANY($3::text[])` 这种精确匹配 —— 那正是 r219 的坑
  assert.doesNotMatch(
    SRC,
    /WHERE\s+kp\.name\s*=\s*ANY\(/,
    '关联考点不能再用 name=ANY() 精确匹配：AI 造的名字带不带「的」随机，精确匹配必然漏。',
  )
})

test('整组题：examples 必须挂 items 全组（不是 1 条代表题）', () => {
  // saveMethod 的调用处：exampleQuestions 应来自 m.items 全组
  assert.match(
    SRC,
    /exampleQuestions:\s*m\.items\.map\(\(n\)\s*=>\s*questions\[n\s*-\s*1\]\)\.filter\(Boolean\)/,
    '每个考法必须挂它 items 里的全部题—— 这就是「一个考法 = 一组题」的落点。',
  )
  assert.match(
    SRC,
    /wrongCount:\s*q\.wrongCount\s*\|\|\s*0/,
    '题目快照要带错次，学生/老师要看「这道题错了几个人」。',
  )
})

// ⛔⛔ r220 实测事故：写入顺序错了会留下「0 考点 0 题」的僵尸 draft。
//   我把关联写入改成 unnest($3::text[]) 后与 uuid 列比较 → `operator does not exist: text = uuid`
//   ⇒ saveMethod 第 1 步的 INSERT 已提交、第 2 步炸了 ⇒ 库里留下 1 条僵尸。
//   「写一半」比「没写」更糟：老师会看到一个空考法，以为自己操作错了。
test('写入顺序：所有可能失败的纯计算必须在 INSERT 之前', () => {
  const fnStart = SRC.indexOf('export async function saveMethod')
  const fn = SRC.slice(fnStart, SRC.indexOf('\n}', fnStart))
  const alignAt = fn.search(/alignKpNames\(/)
  const insertAt = fn.search(/INSERT INTO teaching_question_types/)
  assert.ok(alignAt > -1, 'saveMethod 里必须有 alignKpNames')
  assert.ok(insertAt > -1, 'saveMethod 里必须有 INSERT')
  assert.ok(
    alignAt < insertAt,
    'alignKpNames 必须在 INSERT 之前：否则关联写入失败时会留下「0 考点 0 题」的僵尸 draft（r220 实测踩过）。',
  )
})

test('uuid数组参数必须是 uuid[] 而不是 text[]', () => {
  // r220 实测：unnest($3::text[]) 与 uuid 列比较 → `operator does not exist: text = uuid`
  assert.match(
    SRC,
    /unnest\(\$3::uuid\[\]\)/,
    '关联考点 id 是 uuid，传参必须用 uuid[]；text[] 会和 uuid 列比较报类型错。',
  )
  assert.doesNotMatch(
    SRC,
    /unnest\(\$3::text\[\]\)/,
    '不能用 text[] 传 uuid 数组列 —— 这正是 r220 造成僵尸 draft 的直接原因。',
  )
})

test('一条关联都对不上时必须跳过写入，不留空考法', () => {
  assert.match(
    SRC,
    /if\s*\(\s*!kpHits\.length\s*\)\s*\{[^}]*throw\s+new\s+Error/,
    '关联考点全部对不上知识树时要明确失败（进 errors），不能写一条 0 关联的僵尸考法。',
  )
})

test('接口必须如实透出对不上的关联考点名', () => {
  const ROUTE = readFileSync(resolve(ROOT, 'server/routes/teachingQuestionTypes.js'), 'utf8')
  assert.match(
    ROUTE,
    /unmatchedKpNames:\s*r\.unmatchedKpNames\s*\|\|\s*\[\]/,
    'results 里必须带 unmatchedKpNames，UI 才能告知老师「有N 个关联没挂进树」。',
  )
  assert.match(
    ROUTE,
    /unmatchedKpNames,\s*\n\s*\}\)/,
    '响应顶层也要汇总一份 unmatchedKpNames（跨考点去重），供前端一句话提示。',
  )
})