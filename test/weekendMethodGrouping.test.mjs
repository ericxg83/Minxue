/**
 * 回归锁：周末班课件「按考点/方法分节」（2026-11-08 P0）
 * 纯函数真跑，不连库。锁定：同名节点归一、待归类不丢题、index 连续、
 * 桶内由易到难、方法卡与知识链注入、方法卡回退口径。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeKpGroupKey,
  loadKnowledgeMeta,
  regroupSlidesByKp,
  UNLINKED_LABEL,
  OTHERS_LABEL,
} from '../server/lib/weekendMethodGroup.js'
import {
  getMethodCard,
  parseKaofaNotes,
  hasMethodCard,
} from '../server/lib/methodCardLibrary.js'

const q = (index, over = {}) => ({
  kind: 'question',
  index,
  sectionLabel: '11/03',
  day: '11/03',
  tier: 'medium',
  difficulty: 3,
  students: [{ name: '甲' }],
  kpId: null,
  kpName: '',
  kpGroupKey: null,
  ...over,
})

const sec = (label) => ({ kind: 'section', label, topicCount: 3, studentCount: 1, students: ['甲'], tiers: {} })

const emptyMeta = () => ({
  kpByQuestion: new Map(),
  kpNamesById: new Map(),
  kaofaByKpId: new Map(),
  kaofaByKpKey: new Map(),
  chainByKpId: new Map(),
})

/** 假 pool：按 SQL 特征返回固定行，用来锁住「主考点收敛」这类纯取数逻辑（不连真库） */
const mockPool = ({ qk = [], kaofa = [], rel = [] }) => ({
  query: async (sql) => {
    if (sql.includes('FROM question_knowledge qk')) return { rows: qk }
    if (sql.includes('FROM teaching_question_types t')) return { rows: kaofa }
    if (sql.includes('FROM kp_relations r')) return { rows: rel }
    return { rows: [] }
  },
})

test('同名不同 id 的考点归一到同一节（实测库里「一元二次方程」有两个节点）', () => {
  assert.equal(
    normalizeKpGroupKey('数学', '二次根式'),
    normalizeKpGroupKey('数学', '二次根式'),
  )
  assert.notEqual(
    normalizeKpGroupKey('数学', '不等式'),
    normalizeKpGroupKey('英语', '不等式'),
  )

  const slides = [
    sec('11/03'),
    q(1, { kpGroupKey: '数学::二次根式', kpName: '二次根式', kpId: 'k1' }),
    q(2, { kpGroupKey: '数学::二次根式', kpName: '二次根式', kpId: 'k2' }),
    sec('11/05'),
    q(3, { kpGroupKey: '数学::二次根式', kpName: '二次根式', kpId: 'k1' }),
  ]
  const { slides: out, sections } = regroupSlidesByKp(slides, emptyMeta())
  assert.equal(sections.length, 1, '同名节点不能拆成两节')
  assert.equal(sections[0].label, '二次根式')
  assert.equal(sections[0].topicCount, 3)
  assert.equal(out.filter(s => s.kind === 'question').length, 3)
})

test('挂不上考点的题如实进「待归类」节，且永远垫底，不静默丢题', () => {
  const slides = [
    sec('11/03'),
    q(1, { kpGroupKey: '数学::二次根式', kpName: '二次根式', kpId: 'k1' }),
    q(2),
    q(3, { kpGroupKey: '数学::分母有理化', kpName: '分母有理化', kpId: 'k2' }),
    q(4),
  ]
  const { slides: out, sections } = regroupSlidesByKp(slides, emptyMeta())
  // 二次根式(1) + 分母有理化(1) + 待归类(2) = 3 节
  assert.equal(sections.length, 3)
  assert.equal(sections.at(-1).label, UNLINKED_LABEL)
  assert.equal(sections.at(-1).topicCount, 2)
  assert.equal(sections.at(-1).unlinked, true)
  assert.equal(sections.at(-1).methodCard.source, 'none', '待归类节不编方法卡')
  assert.equal(out.filter(s => s.kind === 'question').length, 4)
})

test('重组后 index 从 1 连续、sectionLabel 与新节标签逐字对齐', () => {
  const slides = [
    sec('11/03'),
    q(9, { kpGroupKey: '数学::二次根式', kpName: '二次根式', kpId: 'k1' }),
    q(7, { kpGroupKey: '数学::分母有理化', kpName: '分母有理化', kpId: 'k2' }),
    q(5, { kpGroupKey: '数学::二次根式', kpName: '二次根式', kpId: 'k1' }),
  ]
  const { slides: out, sections } = regroupSlidesByKp(slides, emptyMeta())
  const qs = out.filter(s => s.kind === 'question')
  assert.deepEqual(qs.map(s => s.index), [1, 2, 3])
  const labelByIndex = new Map(qs.map(s => [s.index, s.sectionLabel]))
  assert.equal(sections.length, 2)
  for (const s of sections) {
    const inSec = qs.filter(x => labelByIndex.get(x.index) === s.label)
    assert.equal(inSec.length, s.topicCount)
  }
})

test('节内按难度由易到难，节按题数降序（先讲错得多的一类）', () => {
  const slides = [
    sec('11/03'),
    q(1, { kpGroupKey: '数学::二次根式', kpName: '二次根式', kpId: 'k1', tier: 'hard', difficulty: 5 }),
    q(2, { kpGroupKey: '数学::二次根式', kpName: '二次根式', kpId: 'k1', tier: 'basic', difficulty: 1 }),
    q(3, { kpGroupKey: '数学::二次根式', kpName: '二次根式', kpId: 'k1', tier: 'medium', difficulty: 3 }),
    q(4, { kpGroupKey: '数学::分母有理化', kpName: '分母有理化', kpId: 'k2' }),
  ]
  const { sections, slides: out } = regroupSlidesByKp(slides, emptyMeta())
  assert.equal(sections[0].label, '二次根式')
  const bodyQs = out.filter(s => s.kind === 'question' && s.sectionLabel === '二次根式')
  assert.deepEqual(bodyQs.map(s => s.tier), ['basic', 'medium', 'hard'])
})

test('方法卡与知识链注入；confirmed 关系排除本节自身并去重', () => {
  const meta = emptyMeta()
  meta.chainByKpId.set('k1', {
    prerequisites: ['实数的运算', '实数的运算', '二次根式'],
    successors: ['二次根式的乘除', '勾股定理'],
  })
  meta.kaofaByKpId.set('k1', [{ name: '根式化简', teaching_notes: '', common_mistakes: '' }])
  const slides = [
    sec('11/03'),
    q(1, { kpGroupKey: '数学::二次根式', kpName: '二次根式', kpId: 'k1' }),
  ]
  const { sections, slides: out } = regroupSlidesByKp(slides, meta)
  const s = sections[0]
  assert.equal(s.methodCard.source, 'library')
  assert.ok(s.methodCard.steps.includes('最简'))
  assert.deepEqual(s.knowledgeChain.prerequisites, ['实数的运算'])
  assert.deepEqual(s.knowledgeChain.successors, ['二次根式的乘除', '勾股定理'])
  const bodyQ = out.find(x => x.kind === 'question')
  assert.equal(bodyQ.methodKind, '二次根式')
  assert.equal(bodyQ.methodSteps, s.methodCard.steps, '白板讲题现场要能直接读到这套动作')
})

test('跨同学科同名节点：节标签加学科后缀，避免 label 撞车', () => {
  const slides = [
    sec('11/03'),
    q(1, { kpGroupKey: '数学::不等式', kpName: '不等式', kpId: 'm1' }),
    q(2, { kpGroupKey: '英语::不等式', kpName: '不等式', kpId: 'e1' }),
  ]
  const { sections } = regroupSlidesByKp(slides, emptyMeta())
  assert.equal(sections.length, 2)
  assert.notEqual(sections[0].label, sections[1].label)
})

test('方法卡：静态库命中 / 考法库回退 / 无内容不编', () => {
  const lib = getMethodCard('二次根式的性质')
  assert.equal(lib.source, 'library')
  assert.ok(hasMethodCard(lib))

  const fallback = getMethodCard('某个没配过的考点', [{
    teaching_notes: '考法动作：辨析错误解法。\n关键步骤：找错 → 归因 → 改正',
    common_mistakes: '忽略平方根的正负性',
  }])
  assert.equal(fallback.source, 'kaofa')
  assert.match(fallback.signals, /辨析错误解法/)
  assert.equal(fallback.steps, '找错 → 归因 → 改正')
  assert.equal(fallback.pitfalls, '忽略平方根的正负性')

  const none = getMethodCard('空考点', [])
  assert.equal(none.source, 'none')
  assert.equal(hasMethodCard(none), false)
  assert.deepEqual(parseKaofaNotes(''), { action: '', steps: '' })
})

test('真库实测坑①：主考点收敛在老师选的专题内，不从一题多考点里串到别的章节', async () => {
  // 按 zh 拼音排序「代数式」(dai) 在「二次根式」(er) 前面，方向明确
  const qk = [
    { question_id: 'q1', kp_id: 'kA', role: 'secondary', name: '二次根式', subject: '数学' },
    { question_id: 'q1', kp_id: 'kB', role: 'secondary', name: '代数式', subject: '数学' },
  ]
  const scoped = await loadKnowledgeMeta(mockPool({ qk }), ['q1'], new Set(['kA']))
  assert.equal(scoped.kpByQuestion.get('q1').kpName, '二次根式', '收敛后必须落在老师选的专题内')
  // 不传 preferred 时会按名称排序挑中「代数式」 ⇒ 试点专题里凭空多一节
  const unscoped = await loadKnowledgeMeta(mockPool({ qk }), ['q1'])
  assert.equal(unscoped.kpByQuestion.get('q1').kpName, '代数式')
})

test('真库实测坑②：考法库按 (学科,名称) 补命中，同名不同 id 也能出方法卡', () => {
  const meta = emptyMeta()
  meta.kaofaByKpKey.set('数学::分式化简', [{
    teaching_notes: '考法动作：分式化简。\n关键步骤：先约分 → 再通分',
    common_mistakes: '漏掉负号',
  }])
  const slides = [
    sec('11/03'),
    q(1, { kpGroupKey: '数学::分式化简', kpName: '分式化简', kpId: 'another-id' }),
  ]
  const { sections } = regroupSlidesByKp(slides, meta)
  assert.equal(sections[0].methodCard.source, 'kaofa')
  assert.match(sections[0].methodCard.steps, /约分/)
})

// ── 薄节门槛（2026-11-08 默认轴改 kp 时补）────────────────────────────
// 真库实测：不设门槛时初三首屏 10 题被切成 6 节（3 节各 1 题），
// 一道题撑不起「一类」，反而比日期轴更碎。

test('每节最少题数：>=2 个薄节并入「其他考点」，题数守恒且编号连续', () => {
  const slides = [
    sec('11/03'),
    q(1, { kpGroupKey: '数学::二次根式', kpName: '二次根式', kpId: 'k1' }),
    q(2, { kpGroupKey: '数学::二次根式', kpName: '二次根式', kpId: 'k1' }),
    q(3, { kpGroupKey: '数学::二次根式', kpName: '二次根式', kpId: 'k1' }),
    q(4, { kpGroupKey: '数学::一元二次方程', kpName: '一元二次方程', kpId: 'k2' }),
    q(5, { kpGroupKey: '数学::三角形外角', kpName: '三角形外角', kpId: 'k3' }),
    q(6, { kpGroupKey: '数学::函数模型', kpName: '函数模型', kpId: 'k4' }),
  ]
  const { slides: out, sections } = regroupSlidesByKp(slides, emptyMeta(), { minPerSection: 2 })
  assert.equal(sections.length, 2, '3 个 1 题节合并成一节')
  assert.equal(sections[0].label, '二次根式')
  assert.equal(sections[0].topicCount, 3)
  assert.equal(sections[1].label, OTHERS_LABEL)
  assert.equal(sections[1].topicCount, 3)
  assert.equal(sections[1].others, true)
  assert.equal(sections[1].unlinked, false, '「其他考点」不等于「待归类」')
  assert.equal(sections[1].methodCard.source, 'none', '多方法混合不给单一方法卡')
  const qs = out.filter(s => s.kind === 'question')
  assert.equal(qs.length, 6, '题数守恒，合并不能丢题')
  assert.deepEqual(qs.map(s => s.index), [1, 2, 3, 4, 5, 6])
  // 「其他考点」里的题不能带方法名，否则白板会把混合节说成某一个方法
  for (const x of qs.filter(s => s.sectionLabel === OTHERS_LABEL)) {
    assert.equal(x.methodKind, '')
    assert.equal(x.methodSteps, '')
  }
})

test('每节最少题数：只有一个薄节时保留原名，不造含糊的「其他」节', () => {
  const slides = [
    sec('11/03'),
    q(1, { kpGroupKey: '数学::二次根式', kpName: '二次根式', kpId: 'k1' }),
    q(2, { kpGroupKey: '数学::二次根式', kpName: '二次根式', kpId: 'k1' }),
    q(3, { kpGroupKey: '数学::函数模型', kpName: '函数模型', kpId: 'k2' }),
  ]
  const { sections } = regroupSlidesByKp(slides, emptyMeta(), { minPerSection: 2 })
  assert.equal(sections.length, 2)
  assert.equal(sections[0].label, '二次根式')
  assert.equal(sections[1].label, '函数模型', '单独一个薄节信息量更大，不该被并')
  assert.equal(sections.some(s => s.label === OTHERS_LABEL), false)
})

test('每节最少题数：「待归类」永不并入「其他考点」，且仍垫底', () => {
  const slides = [
    sec('11/03'),
    q(1),
    q(2),
    // 二次根式凑够 2 题才算「一类」；下面两个各 1 题才会被并进「其他考点」
    q(3, { kpGroupKey: '数学::二次根式', kpName: '二次根式', kpId: 'k1' }),
    q(6, { kpGroupKey: '数学::二次根式', kpName: '二次根式', kpId: 'k1' }),
    q(4, { kpGroupKey: '数学::函数模型', kpName: '函数模型', kpId: 'k2' }),
    q(5, { kpGroupKey: '数学::三角形外角', kpName: '三角形外角', kpId: 'k3' }),
  ]
  const { sections } = regroupSlidesByKp(slides, emptyMeta(), { minPerSection: 2 })
  const unlinked = sections.filter(s => s.unlinked)
  assert.equal(unlinked.length, 1, '待归类只允许一节')
  assert.equal(unlinked[0].label, UNLINKED_LABEL)
  assert.equal(unlinked[0].topicCount, 2, '待归类的题不能被并入其他考点')
  assert.equal(sections.at(-1).unlinked, true, '待归类永远垫底')
  assert.equal(sections[0].label, '二次根式')
  assert.equal(sections[0].topicCount, 2)
  const others = sections.find(s => s.label === OTHERS_LABEL)
  assert.equal(others.topicCount, 2, '只有真正成不了类的题进其他考点')
})

test('每节最少题数：0/1 等于关闭合并（既有调用方不传时行为不变）', () => {
  const slides = [
    sec('11/03'),
    q(1, { kpGroupKey: '数学::二次根式', kpName: '二次根式', kpId: 'k1' }),
    q(2, { kpGroupKey: '数学::函数模型', kpName: '函数模型', kpId: 'k2' }),
    q(3, { kpGroupKey: '数学::三角形外角', kpName: '三角形外角', kpId: 'k3' }),
  ]
  for (const v of [undefined, 0, 1]) {
    const { sections } = regroupSlidesByKp(slides, emptyMeta(), v === undefined ? undefined : { minPerSection: v })
    assert.equal(sections.length, 3, `minPerSection=${v} 不应合并`)
    assert.equal(sections.some(s => s.label === OTHERS_LABEL), false)
  }
})
