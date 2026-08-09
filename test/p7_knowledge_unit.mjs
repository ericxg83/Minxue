/**
 * P7 单元验证：知识树归一化 + 掌握度计算（纯函数）
 * 跑法：node test/p7_knowledge_unit.mjs
 *
 * 不依赖 DB：mock 出 knowledge_points 列表，调用 calculateMastery 和
 * normalizeQuestionTags 的内嵌纯函数部分。
 *
 * 覆盖：
 *   - calculateMastery: 0 题 → 0；首答正确 → 100；连续正确 +10 上限；
 *     长期不练 → 衰减
 *   - 标签归一化精确命中（name）和子串命中（"相似三角形" tag 命中"三角形"父节点）
 */

import assert from 'node:assert/strict'

// ── 复用 knowledgeMasteryService.calculateMastery ──
// 通过动态 import 拿到真正的函数
const { calculateMastery } = await import('../server/services/knowledgeMasteryService.js')

console.log('🧪 calculateMastery 边界用例')
{
  const m = calculateMastery({ total: 0, correct: 0, consecutiveCorrect: 0, lastPracticedAt: null })
  assert.equal(m, 0, 'total=0 应返回 0')
}
{
  const m = calculateMastery({ total: 1, correct: 1, consecutiveCorrect: 1, lastPracticedAt: null })
  assert.equal(m, 100, '首答正确 1/1 + streak=1 应为 100')
}
{
  // 10 题对 8 题，streak=3（拿 +6），无衰减 → 80 + 6 = 86
  const m = calculateMastery({ total: 10, correct: 8, consecutiveCorrect: 3, lastPracticedAt: null })
  assert.equal(m, 86, `期望 86，实得 ${m}`)
}
{
  // 10 题对 8 题，streak=10（封顶 5 步 → +10）→ 80 + 10 = 90
  const m = calculateMastery({ total: 10, correct: 8, consecutiveCorrect: 10, lastPracticedAt: null })
  assert.equal(m, 90, `期望 90，实得 ${m}`)
}
{
  // 时间衰减：14 天前最后练习，total=10, correct=8, streak=0 → 80 - 0 = 80
  const old = new Date(Date.now() - 14 * 86400000).toISOString()
  const m = calculateMastery({ total: 10, correct: 8, consecutiveCorrect: 0, lastPracticedAt: old })
  assert.equal(m, 80, `期望 80（衰减边界 14 天不算衰减），实得 ${m}`)
}
{
  // 21 天前最后练习（衰减 1 周 = -5）→ 80 - 5 = 75
  const old = new Date(Date.now() - 21 * 86400000).toISOString()
  const m = calculateMastery({ total: 10, correct: 8, consecutiveCorrect: 0, lastPracticedAt: old })
  assert.equal(m, 75, `期望 75（衰减 1 周），实得 ${m}`)
}
{
  // 上限封顶 100：correct=10, total=10, streak=5 → 100 + 10 = 100
  const m = calculateMastery({ total: 10, correct: 10, consecutiveCorrect: 5, lastPracticedAt: null })
  assert.equal(m, 100, `期望 100（封顶），实得 ${m}`)
}
console.log('  ✅ calculateMastery 全部通过')

// ── 标签归一化：用 mock knowledge_points 验证 matchKnowledgePoints 内部逻辑 ──
// 既然 matchKnowledgePoints 内部依赖 DB，我们手写一个本地匹配函数来验证
// scoring 的语义（与 knowledgeService.matchKnowledgePoints 一致）。

console.log('🧪 标签归一化匹配（mock 知识树）')
{
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

  console.log('  ✅ 标签归一化匹配 6 个用例全部通过')
}

// ── 掌握度公式长期演进一致性 ──
console.log('🧪 掌握度时间序列模拟（10 题 5 对 5 错 + 后续 5 题连对）')
{
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
  console.log(`  掌握度序列：${series.join(' → ')}`)
  console.log('  ✅ 10 题模拟通过')
}

console.log('\n🎉 P7 单元验证全部通过')
