/**
 * 考法归纳质量闸的回归锁（r145）
 *
 * 为什么要锁这些：质量闸是「AI 产出能不能进库」的唯一关口。
 * 它一旦被放宽，r144 那种「平方根 · 填空题关键结论」的机械拼接会重新灌满库，
 * 而老师根本看不出区别（都叫「题型」）。所以判据必须硬。
 *
 * ⛔ 特别锁 `judgeMethodName` 的「等于」而非「包含」：
 *   实测证明「名字禁含任何知识点词」这条约束是错的（BigModel 0/7 全红），
 *   因为「已知平方根反求原数」这类好名字本来就该提到所操作的知识点。
 *   这条断言就是为了防止有人再把判据改回「包含」。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { judgeMethodName, parseMethodResponse, induceMethodsForKp, MIN_ITEMS_PER_METHOD } from '../server/services/kaofaInduction.js'

const VOCAB = ['平方根', '平方', '实数', '立方根', '根式化简', '二次根式', '方程求解', '分类讨论']

test('judgeMethodName：合格的考法名（动作 + 对象，含知识点词）', () => {
  // ⭐ 这几条名字里**含**知识点词但必须放行 —— 动作要落在对象上
  for (const name of [
    '辨析错解并改正',
    '已知平方根反求原数',
    '新定义问题建模',
    '待定系数法求解析式',
    '动点求取值范围',
    '数轴上根式与绝对值的综合化简',
    '反求原数与平方根关系',
  ]) {
    const v = judgeMethodName(name, VOCAB)
    assert.equal(v.ok, true, `「${name}」应合格，实际被拒：${v.reason}`)
  }
})

test('judgeMethodName：⛔ 判据是「等于」不是「包含」', () => {
  // 含知识点但不完全等于 → 放行
  assert.equal(judgeMethodName('反求原数与平方根关系', VOCAB).ok, true)
  // 完全等于知识点名 → 拒绝
  const v = judgeMethodName('平方根', VOCAB)
  assert.equal(v.ok, false)
  assert.match(v.reason, /知识点名本身/)
  // 含知识点 + 动作 → 放行
  assert.equal(judgeMethodName('平方根化简的常见错法', VOCAB).ok, true)
})

test('judgeMethodName：拒绝「·」机械拼接（r144 存量 67 条的形态）', () => {
  for (const name of ['平方根 · 填空题关键结论', '二次函数 · 综合解答与建模', '相似三角形 · 选择题方法辨析']) {
    const v = judgeMethodName(name, VOCAB)
    assert.equal(v.ok, false, `「${name}」必须被拒`)
    assert.match(v.reason, /·/)
  }
})

test('judgeMethodName：拒绝空名 / 过短 / 超长', () => {
  assert.equal(judgeMethodName('', VOCAB).ok, false)
  assert.equal(judgeMethodName('   ', VOCAB).ok, false)
  assert.equal(judgeMethodName(null, VOCAB).ok, false)
  assert.equal(judgeMethodName('解', VOCAB).ok, false)
  const long = 'a'.repeat(25)
  assert.equal(judgeMethodName(long, VOCAB).ok, false)
  assert.match(judgeMethodName(long, VOCAB).reason, /超长/)
})

test('judgeMethodName：空词表时不误杀', () => {
  assert.equal(judgeMethodName('辨析错解并改正', []).ok, true)
  // 词表为空时不该因为"找不到相等项"而误判
  assert.equal(judgeMethodName('平方根', []).ok, true)
})

test('parseMethodResponse：正常结构 + kps/items 归一化', () => {
  const text = JSON.stringify({
    methods: [{
      name: '辨析错解并改正', action: '辨析错解',
      kps: ['平方根', '方程求解', '平方根'],   // 去重
      steps: ['检查方程', '验证解', '分类讨论'],
      pitfalls: '忽略非负性',
      items: [1, 2, 2, 3],                      // 去重
    }],
  })
  const { methods, rejected } = parseMethodResponse(text, VOCAB, 5)
  assert.equal(rejected.length, 0)
  assert.equal(methods.length, 1)
  assert.deepEqual(methods[0].kps, ['平方根', '方程求解'])
  assert.deepEqual(methods[0].items, [1, 2, 3])
  assert.equal(methods[0].action, '辨析错解')
})

test('parseMethodResponse：items 越界被剔除（防模型编造题号）', () => {
  const text = JSON.stringify({ methods: [{ name: '辨析错解', kps: ['实数'], items: [0, 1, 99, 2, -3] }] })
  const { methods } = parseMethodResponse(text, VOCAB, 3)   // 只有 3 道题
  assert.deepEqual(methods[0].items, [1, 2])
})

test('parseMethodResponse：低于题数门槛被拒（粒度闸）', () => {
  const text = JSON.stringify({ methods: [{ name: '辨析错解', kps: ['实数'], items: [1] }] })
  const { methods, rejected } = parseMethodResponse(text, VOCAB, 5)
  assert.equal(methods.length, 0)
  assert.equal(rejected.length, 1)
  assert.match(rejected[0].reason, new RegExp(`低于门槛 ${MIN_ITEMS_PER_METHOD}`))
})

test('parseMethodResponse：kps 为空被拒（无法建关联的考法没有意义）', () => {
  const text = JSON.stringify({ methods: [{ name: '辨析错解', kps: [], items: [1, 2] }] })
  const { methods, rejected } = parseMethodResponse(text, VOCAB, 5)
  assert.equal(methods.length, 0)
  assert.match(rejected[0].reason, /kps 为空/)
})

test('parseMethodResponse：容忍 ```json 包裹与前后废话', () => {
  const text = '好的，这是我的分析：\n```json\n' + JSON.stringify({
    methods: [{ name: '反求原数', kps: ['实数'], items: [1, 2] }],
  }) + '\n```\n希望对你有帮助！'
  const { methods } = parseMethodResponse(text, VOCAB, 5)
  assert.equal(methods.length, 1)
  assert.equal(methods[0].name, '反求原数')
})

test('parseMethodResponse：截断的 JSON 返回 null 而不是抛错', () => {
  const { methods, rejected } = parseMethodResponse('{"methods":[{"name":"辨析错解","kp', VOCAB, 5)
  assert.equal(methods.length, 0)
  assert.equal(rejected.length, 1)
  assert.match(rejected[0].reason, /解析失败/)
})

test('parseMethodResponse：空输入 / 非对象 / methods 非数组都不抛错', () => {
  for (const bad of ['', null, undefined, 'not json', '[1,2,3]', '{"methods":"x"}', '{}']) {
    const r = parseMethodResponse(bad, VOCAB, 5)
    assert.equal(r.methods.length, 0, `输入 ${JSON.stringify(bad)} 应产出 0 条`)
    assert.equal(r.rejected.length, 1)
  }
})

test('parseMethodResponse：字符串内的花括号不破坏解析（深度计数）', () => {
  const text = JSON.stringify({
    methods: [{ name: '辨析错解', kps: ['实数'], items: [1, 2], pitfalls: '误以为 a=b{0} 时成立' }],
  })
  const { methods } = parseMethodResponse(text, VOCAB, 5)
  assert.equal(methods.length, 1)
  assert.match(methods[0].pitfalls, /a=b\{0\}/)
})

// ⛔ r145 事故回归：路由传 apply / 服务收 dryRun ⇒ apply=true 也永不写库，
//   但接口照样返回 applied:true（老师点「写库」静默无效果、无报错）。
//   这条断言确保误用参数名会**硬失败**而不是静默降级成预演。
test('induceMethodsForKp：传错参数名（apply/write/persist）必须硬失败，不能静默不写库', async () => {
  for (const badKey of ['apply', 'write', 'persist']) {
    await assert.rejects(
      () => induceMethodsForKp({ kpId: 'x', kpName: 'y', [badKey]: true }),
      (e) => /参数名错误/.test(e.message) && new RegExp(badKey).test(e.message),
      `传 ${badKey} 应抛参数名错误，实际静默通过了`,
    )
  }
})

test('induceMethodsForKp：守卫不误伤合法调用（dryRun/fetchKpWrongQuestions 不在误用名单里）', async () => {
  // 只验证「守卫不越界」：传这些 key 不该被判参数名错误。
  // 不给 kpId ⇒ fetchKpWrongQuestions 会去查库并失败，这里只断言错误**不是**参数名错误。
  for (const okKey of ['dryRun', 'userId', 'days', 'limit', 'minWrong', 'callText']) {
    const payload = { kpId: 'x', kpName: 'y' }
    payload[okKey] = okKey === 'callText' ? async () => ({ content: '{}' }) : true
    try {
      await induceMethodsForKp(payload)
    } catch (e) {
      assert.doesNotMatch(e.message, /参数名错误/, `${okKey} 不该被判参数名错误`)
    }
  }
})
