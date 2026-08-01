/**
 * pickAnswerUnit 章节关键词二次缩窄测试
 *
 * 验证：
 *   1. chapterHint="第二十章二次根式" → 缩窄到 20.x 试卷（而非 19.1 含"根号"的题）
 *   2. chapterHint="第二十一章一元二次方程" → 缩窄到 21.x 试卷
 *   3. chapterHint="第二十二章直角三角形" → 缩窄到 22.x 试卷
 *   4. chapterHint=null 但内容含"二次根式"特征 → 缩窄到 20.x（detectedChapter 缩窄）
 *   5. chapterHint=null 但内容含"无理数"特征 → 缩窄到 19.x 试卷3/4/6
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })

const { pickAnswerUnit } = await import('../worker.js')
const { getResourceAnswersBySection } = await import('../services/neonService.js')

const wsId = '1c31ee45-0879-4d53-a54c-60af85ee15cc'
const map = await getResourceAnswersBySection(wsId)
console.log(`构建答案库: ${map.size} 个 unit\n`)

let passed = 0, failed = 0
const check = (name, got, expected) => {
  const ok = (expected instanceof Set) ? expected.has(got) : got === expected
  const mark = ok ? '✅' : '❌'
  console.log(`  ${mark} ${name}: 选 ${got} ${ok ? '' : `（期望 ${[...expected].join('|')}）`}`)
  if (ok) passed++; else failed++
}

// 场景 1: chapterHint="第二十章二次根式" + 二次根式题目
{
  const qs = [
    { question_number: 5, content: '化简 √12 + √27 - √(1/3)', student_answer: '5√3' },
    { question_number: 6, content: '已知 √(2+a) + |b-3| = 0, 求 √(a²+b²)', student_answer: '5' },
    { question_number: 7, content: '比较 √15 与 ³√60 的大小', student_answer: '√15 > ³√60' },
  ]
  const r = pickAnswerUnit(map, null, qs, 1, '第二十章二次根式')
  if (process.env.DEBUG === '1') console.log(`  DEBUG: r=${r}`)
  check('二次根式章节缩窄', r, new Set(['试卷7|20.1', '试卷8|20.1', '试卷9|20.2', '试卷10|20.2']))
}

// 场景 2: chapterHint="第二十一章一元二次方程" + 一元二次方程题目
{
  const qs = [
    { question_number: 1, content: '解一元二次方程 x²-5x+6=0', student_answer: 'x=2或x=3' },
    { question_number: 2, content: '已知方程 ax²+bx+c=0 有两个相等实根, 求判别式', student_answer: 'Δ=0' },
    { question_number: 3, content: '求根与系数的关系', student_answer: 'x₁+x₂=-b/a' },
  ]
  const r = pickAnswerUnit(map, null, qs, 1, '第二十一章一元二次方程')
  check('一元二次方程章节缩窄', r, new Set(['试卷13|21.1', '试卷10|21.1', '试卷15|21.3', '试卷10|21.3', '试卷16|21.5', '试卷17|21.5', '试卷19']))
}

// 场景 3: chapterHint="第二十二章直角三角形" + 直角三角形题目
{
  const qs = [
    { question_number: 1, content: '在直角三角形中, 两直角边为 3, 4, 求斜边', student_answer: '5' },
    { question_number: 2, content: '利用勾股定理求高', student_answer: '12' },
    { question_number: 3, content: '角平分线分对边的比', student_answer: '2:1' },
  ]
  const r = pickAnswerUnit(map, null, qs, 1, '第二十二章直角三角形')
  check('直角三角形章节缩窄', r, new Set(['试卷5', '试卷2|22.1', '试卷20|22.1', '试卷20|22.3']))
}

// 场景 4: chapterHint=null + 内容含"二次根式"特征（detectedChapter 缩窄）
{
  const qs = [
    { question_number: 5, content: '化简二次根式 √12', student_answer: '2√3' },
    { question_number: 6, content: '比较 √a+√b 的大小', student_answer: '√a+√b > √(a+b)' },
    { question_number: 7, content: '最简二次根式', student_answer: '√3' },
  ]
  const r = pickAnswerUnit(map, null, qs, 1, null)
  check('二次根式 detectedChapter 缩窄', r, new Set(['试卷7|20.1', '试卷8|20.1', '试卷9|20.2', '试卷10|20.2']))
}

// 场景 5: chapterHint=null + 内容含"无理数"特征（detectedChapter 缩窄到实数）
{
  const qs = [
    { question_number: 18, content: '以下说法中，正确的是', student_answer: 'C' },
    { question_number: 19, content: '下列各式中，正确的是 A. √4=±2 B. 8的立方根=±2 C. ³√-1=-1 D. ±√9=3', student_answer: 'C' },
    { question_number: 20, content: '已知无理数 a, b 在数轴上的对应点如图所示', student_answer: 'D' },
  ]
  const r = pickAnswerUnit(map, null, qs, 1, null)
  check('实数 detectedChapter 缩窄', r, new Set(['试卷3|19.2', '试卷4|19.2', '试卷6']))
}

// 场景 6: 二次根式/实数混合内容（"√a + √b" + "无理数"）
//   detectedChapter 应优先匹配"二次根式"（在前）
//   但 unitTitle 应有"二次根式"才算
{
  const qs = [
    { question_number: 1, content: '比较无理数 √2+√3 与 √10', student_answer: '√2+√3 < √10' },
    { question_number: 2, content: '化简二次根式', student_answer: '√3' },
  ]
  const r = pickAnswerUnit(map, null, qs, 1, null)
  check('混合特征 - detectedChapter 应优先', r, new Set(['试卷7|20.1', '试卷8|20.1', '试卷9|20.2', '试卷10|20.2']))
}

console.log(`\n总计: ${passed} 个通过, ${failed} 个失败`)
process.exit(failed > 0 ? 1 : 0)
