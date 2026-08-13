// ============================================================
// 讲义诊断聚合 —— 规范化知识点合并单元测试
// 跑法：node test/handout_knowledge_merge.mjs
//
// 不依赖 DB：注入 fake matcher 验证 normalizeTagToKnowledgeName 的归一化；
// 直接测纯函数 groupByCanonical 的合并/去重/排序/截断。
// ============================================================

import { normalizeTagToKnowledgeName, groupByCanonical } from '../server/services/handoutDiagnosisService.js'

let failures = 0
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    console.log(`  ✅ ${name}`)
  } else {
    failures++
    console.log(`  ❌ ${name}\n     期望: ${e}\n     实际: ${a}`)
  }
}

// ── 1) 归一化：注入 fake matcher（模拟 matchKnowledgePoints 选出最具体规范节点） ──
const fakeMatcher = async (tags) => {
  const map = {
    '一元一次方程的解法': [{ name: '一元一次方程', level: 2 }],
    '解一元一次方程': [{ name: '一元一次方程', level: 2 }],
    '二元一次方程组的解法': [{ name: '二元一次方程组', level: 2 }],
    '根的判别式': [{ name: '判别式', level: 3 }],
  }
  const found = []
  for (const t of tags) {
    if (map[t]) found.push(...map[t])
  }
  return found
}

check('归一化：一元一次方程的解法 → 一元一次方程',
  await normalizeTagToKnowledgeName('一元一次方程的解法', '数学', fakeMatcher), '一元一次方程')
check('归一化：根的判别式 → 判别式',
  await normalizeTagToKnowledgeName('根的判别式', '数学', fakeMatcher), '判别式')
check('归一化：无法匹配时回退原标签',
  await normalizeTagToKnowledgeName('冷门自定义标签', '数学', fakeMatcher), '冷门自定义标签')
check('归一化：空标签回退空串',
  await normalizeTagToKnowledgeName('', '数学', fakeMatcher), '')

// ── 2) 合并：同一规范知识点（不同标签、多条诊断）合并 + 样本去重 ──
const raw = [
  // 属于「一元一次方程」的两条自由标签诊断
  {
    kpName: '一元一次方程', subject: '数学',
    blank_count: 3, wrong_count: 2, student_count: 5,
    samples: [
      { questionId: 'q1', content: '题1' },
      { questionId: 'q2', content: '题2' },
    ],
  },
  {
    kpName: '一元一次方程', subject: '数学',
    blank_count: 1, wrong_count: 1, student_count: 3,
    samples: [
      { questionId: 'q2', content: '题2' }, // 重复样本应去重
      { questionId: 'q3', content: '题3' },
    ],
  },
  // 另一个规范知识点
  {
    kpName: '判别式', subject: '数学',
    blank_count: 5, wrong_count: 0, student_count: 4,
    samples: [{ questionId: 'q4', content: '题4' }],
  },
]

const merged = groupByCanonical(raw)
const yiyuan = merged.find(m => m.kpName === '一元一次方程')
const panbie = merged.find(m => m.kpName === '判别式')

check('合并后知识点数量', merged.length, 2)
check('空题数累加（3+1=4）', yiyuan ? yiyuan.blank : null, 4)
check('做错数累加（2+1=3）', yiyuan ? yiyuan.wrong : null, 3)
check('涉及学生用 max（max(5,3)=5）', yiyuan ? yiyuan.students : null, 5)
check('样本跨标签聚合且去重（q1,q2,q3）',
  yiyuan ? yiyuan.samples.map(s => s.questionId) : null, ['q1', 'q2', 'q3'])
check('排序：空题多的规范知识点在前（判别式5 > 一元一次方程4）',
  merged.map(m => m.kpName), ['判别式', '一元一次方程'])

// ── 3) 截断：maxItems 生效 ──
const truncated = groupByCanonical(raw, 1)
check('maxItems=1 截断', truncated.map(m => m.kpName), ['判别式'])

console.log(failures === 0 ? '\n🎉 讲义诊断聚合全部通过' : `\n💥 ${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
