/**
 * 测试：连续页面单元继承
 *
 * 场景：
 *   第 1 页有单元标题 → 正常匹配 unitA
 *   第 2 页无标题/无 chapterHint → 继承 unitA
 *   第 3 页无标题/无 chapterHint，但题号在 unitA 里不存在 → 放弃继承，noUnit
 *   第 4 页有新标题 → 匹配 unitB，继承链重置
 *   第 5 页无标题 → 继承 unitB
 */

function pickAnswerUnitFake(answersByUnit, pageTitle, chapterHint) {
  if (pageTitle && answersByUnit.has(pageTitle)) return pageTitle
  if (chapterHint && answersByUnit.has(chapterHint)) return chapterHint
  return null
}

function processPages(answersByUnit, pages) {
  const results = []
  let prevMatchedUnit = null

  for (const { pageNumber, pageTitle, chapterHint, questions } of pages) {
    if (questions.length === 0) continue

    let matchedUnit = pickAnswerUnitFake(answersByUnit, pageTitle, chapterHint)

    // 继承逻辑（与 worker.js 一致）
    const hasPageContext = !!pageTitle || !!chapterHint
    if (!matchedUnit && !hasPageContext && prevMatchedUnit) {
      const candidateAnswers = answersByUnit.get(prevMatchedUnit)
      if (candidateAnswers) {
        let anyMatch = false
        for (const q of questions) {
          if (q.question_number == null) continue
          const qKey = `${Number(q.question_number)}|${q.sub_no || ''}`
          for (const qMap of candidateAnswers.values()) {
            if (qMap.has(qKey)) {
              anyMatch = true
              break
            }
          }
          if (anyMatch) break
        }
        if (anyMatch) {
          matchedUnit = prevMatchedUnit
        }
      }
    }

    if (matchedUnit) prevMatchedUnit = matchedUnit

    results.push({ pageNumber, matchedUnit, inherited: matchedUnit && !pageTitle && !chapterHint })
  }

  return results
}

// 模拟答案库：unitA 有 1-5 题，unitB 有 11-15 题
function buildAnswers(questionNos) {
  const qMap = new Map()
  for (const no of questionNos) {
    qMap.set(`${no}|`, { answer: `ans${no}` })
  }
  const sectionMap = new Map()
  sectionMap.set('', qMap)
  return sectionMap
}

const answersByUnit = new Map([
  ['unitA', buildAnswers([1, 2, 3, 4, 5])],
  ['unitB', buildAnswers([11, 12, 13, 14, 15])],
])

const pages = [
  { pageNumber: 1, pageTitle: 'unitA', chapterHint: null, questions: [{ question_number: 1 }] },
  { pageNumber: 2, pageTitle: null, chapterHint: null, questions: [{ question_number: 2 }] }, // 应继承 unitA
  { pageNumber: 3, pageTitle: null, chapterHint: null, questions: [{ question_number: 11 }] }, // unitA 无 11，应放弃
  { pageNumber: 4, pageTitle: 'unitB', chapterHint: null, questions: [{ question_number: 11 }] }, // 新标题，unitB
  { pageNumber: 5, pageTitle: null, chapterHint: null, questions: [{ question_number: 12 }] }, // 继承 unitB
]

const results = processPages(answersByUnit, pages)

console.log('=== 连续页单元继承测试 ===\n')
let allPassed = true
const expect = [
  { pageNumber: 1, matchedUnit: 'unitA', inherited: false },
  { pageNumber: 2, matchedUnit: 'unitA', inherited: true },
  { pageNumber: 3, matchedUnit: null, inherited: null },
  { pageNumber: 4, matchedUnit: 'unitB', inherited: false },
  { pageNumber: 5, matchedUnit: 'unitB', inherited: true },
]

for (let i = 0; i < results.length; i++) {
  const r = results[i]
  const e = expect[i]
  const ok = r.pageNumber === e.pageNumber && r.matchedUnit === e.matchedUnit && r.inherited === e.inherited
  console.log(`页 ${r.pageNumber}: matchedUnit=${r.matchedUnit} inherited=${r.inherited} ${ok ? '✅' : '❌ 期望 ' + JSON.stringify(e)}`)
  if (!ok) allPassed = false
}

console.log('\n' + (allPassed ? '✅ 全部测试通过' : '❌ 有测试失败'))
process.exit(allPassed ? 0 : 1)
