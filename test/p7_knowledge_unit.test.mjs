/**
 * P7 单元验证：知识树归一化 + 掌握度计算（纯函数）—— r298 接线进 npm test。
 * 不依赖 DB：mock 出 knowledge_points 列表，调用 calculateMastery 真实产品函数。
 *
 * 历史：本文件 2026-09-20（b93c594）以手跑风格提交（node test/p7_knowledge_unit.mjs），
 * 文件名不带 `.test.mjs` 后缀 ⇒ npm test 的 glob 从未覆盖它（r215/r216 假绿家族的
 * 漏网形态）。r298 原地改造为 node:test 并改名纳入套件，用例与期望值逐字未变。
 *
 * 覆盖：
 *   - calculateMastery: 0 题 → 0；首答正确 → 100；连续正确 +10 上限；
 *     长期不练 → 衰减（真实调用 server/services/knowledgeMasteryService.js）
 *   - 标签归一化 mock 语义（⚠️ 锁的是文件内复刻的匹配逻辑，不是产品码
 *     matchKnowledgePoints——产品码走 DB，纯函数测试覆盖不到，此处仅防复刻件自身腐化）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

// ── 复用 knowledgeMasteryService.calculateMastery ──
const { calculateMastery } = await import('../server/services/knowledgeMasteryService.js')

test('calculateMastery 边界用例', async (t) => {
  await t.test('total=0 应返回 0', () => {
    const m = calculateMastery({ total: 0, correct: 0, consecutiveCorrect: 0, lastPracticedAt: null })
    assert.equal(m, 0)
  })
  await t.test('首答正确 1/1 + streak=1 应为 100', () => {
    const m = calculateMastery({ total: 1, correct: 1, consecutiveCorrect: 1, lastPracticedAt: null })
    assert.equal(m, 100)
  })
  await t.test('10 题对 8 题，streak=3（拿 +6），无衰减 → 86', () => {
    const m = calculateMastery({ total: 10, correct: 8, consecutiveCorrect: 3, lastPracticedAt: null })
    assert.equal(m, 86, `期望 86，实得 ${m}`)
  })
  await t.test('streak=10 封顶 5 步 → +10 → 90', () => {
    const m = calculateMastery({ total: 10, correct: 8, consecutiveCorrect: 10, lastPracticedAt: null })
    assert.equal(m, 90, `期望 90，实得 ${m}`)
  })
  await t.test('时间衰减：14 天前最后练习不算衰减 → 80', () => {
    const old = new Date(Date.now() - 14 * 86400000).toISOString()
    const m = calculateMastery({ total: 10, correct: 8, consecutiveCorrect: 0, lastPracticedAt: old })
    assert.equal(m, 80, `期望 80（衰减边界 14 天不算衰减），实得 ${m}`)
  })
  await t.test('时间衰减：21 天前最后练习衰减 1 周 → 75', () => {
    const old = new Date(Date.now() - 21 * 86400000).toISOString()
    const m = calculateMastery({ total: 10, correct: 8, consecutiveCorrect: 0, lastPracticedAt: old })
    assert.equal(m, 75, `期望 75（衰减 1 周），实得 ${m}`)
  })
  await t.test('上限封顶 100', () => {
    const m = calculateMastery({ total: 10, correct: 10, consecutiveCorrect: 5, lastPracticedAt: null })
    assert.equal(m, 100, `期望 100（封顶），实得 ${m}`)
  })
})

test('标签归一化匹配（mock 知识树）', () => {
  const mockKp = [
    { id: 'k1', parent_id: null, name: '几何', level: 0, sort_order: 1, synonyms: [] },
    { id: 'k2', parent_id: 'k1', name: '三角形', level: 1, sort_order: 1, synonyms: [] },
    { id: 'k3', parent_id: 'k2', name: '相似三角形', level: 2, sort_order: 1, synonyms: ['相似', '位似'] },
    { id: 'k4', parent_id: 'k2', name: '全等三角形', level: 2, sort_order: 2, synonyms: ['全等', 'SSS'] },
    { id: 'k5', parent_id: 'k2', name: '勾股定理', level: 2, sort_order: 3, synonyms: ['勾股'] },
    { id: 'k6', parent_id: 'k1', name: '圆', level: 1, sort_order: 2, synonyms: [] },
  ]

  const normalizeText = (s) => String(s || '').replace(/\s+/g, '').toLowerCase()

  // 复刻 matchKnowledgePoints 的核心打分逻辑
  const match = (tags) => {
    const tagList = tags.map(normalizeText).filter(Boolean)
    const matched = []
    for (const kp of mockKp) {
      const name = normalizeText(kp.name)
      const syns = (kp.synonyms || []).map(normalizeText)
      let best = 0
      for (const t of tagList) {
        if (name === t) { best = Math.max(best, 100); continue }
        if (syns.includes(t)) { best = Math.max(best, 95); continue }
        for (const n of [name, ...syns]) {
          if (n && n.length >= 2 && t.includes(n)) best = Math.max(best, 60 + n.length)
        }
      }
      if (best > 0) matched.push({ ...kp, score: best })
    }
    matched.sort((a, b) => b.level - a.level || b.score - a.score || a.sort_order - b.sort_order)
    return matched
  }

  // 用例 1: '相似三角形' 应精确命中 k3 (level 2, score 100)
  let r = match(['相似三角形'])
  assert.equal(r[0]?.id, 'k3', `期望 k3 (相似三角形)，实得 ${r[0]?.name}`)
  // 子节点也命中父节点 '三角形' k2 (level 1, score 60+6=66)
  assert.ok(r.some(x => x.id === 'k2'), '应同时命中父节点 三角形')

  // 用例 2: '勾股' 应通过 synonyms 命中 k5
  r = match(['勾股'])
  assert.equal(r[0]?.id, 'k5', `期望 k5 (勾股定理)，实得 ${r[0]?.name}`)
  assert.equal(r[0]?.score, 95, 'synonym 精确命中应为 95')

  // 用例 3: 'SSS' 应通过 synonyms 命中 k4
  r = match(['SSS'])
  assert.equal(r[0]?.id, 'k4', `期望 k4 (全等三角形)，实得 ${r[0]?.name}`)

  // 用例 4: 多标签 ['相似', '勾股'] → 各自命中 k3 + k5
  r = match(['相似', '勾股'])
  const ids = r.map(x => x.id)
  assert.ok(ids.includes('k3'), '应命中 k3 (相似)')
  assert.ok(ids.includes('k5'), '应命中 k5 (勾股定理)')

  // 用例 5: 无关标签 '微积分' 应不命中
  r = match(['微积分'])
  assert.equal(r.length, 0, '无关标签应不命中任何节点')

  // 用例 6: '三角形' (通用) 不应反向命中 '相似三角形'（防止通用标签污染子节点）
  r = match(['三角形'])
  const ids2 = r.map(x => x.id)
  assert.equal(ids2[0], 'k2', '通用标签应优先匹配 level 1 的 三角形 本身')
  assert.ok(!ids2.includes('k3'), '通用标签不应反向命中相似三角形')
})

test('掌握度时间序列模拟（10 题 5 对 5 错 + 后续 5 题连对）', () => {
  // 模拟：先错 5 题，再对 5 题，streak 累积
  let total = 0, correct = 0, consec = 0
  const series = []
  for (let i = 0; i < 5; i++) { // 5 错
    total++
    consec = 0
    const m = calculateMastery({ total, correct, consecutiveCorrect: consec, lastPracticedAt: null })
    series.push(m)
  }
  for (let i = 0; i < 5; i++) { // 5 对
    total++; correct++; consec++
    const m = calculateMastery({ total, correct, consecutiveCorrect: consec, lastPracticedAt: null })
    series.push(m)
  }
  // 第一次答 50% (5/10) + streak 5*2=10 = 60
  assert.equal(series[9], 60, `第 10 题后应为 60，实得 ${series[9]}`)
  // 严格递增（streak 不衰减时）
  for (let i = 1; i < 5; i++) {
    assert.ok(series[i] <= series[i - 1], `错题阶段 mastery 应非递增，idx=${i}`)
  }
  for (let i = 6; i < 10; i++) {
    assert.ok(series[i] > series[i - 1], `对题阶段 mastery 应递增，idx=${i}`)
  }
})
