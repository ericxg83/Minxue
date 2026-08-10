import { preprocessMath, convertSqrt, splitToSegments, renderContent } from './src/utils/mathText.js'

const testCases = [
  // 题4
  '3√5 - √5/2',
  // 题5
  '1/(2-√3)',
  // 题6
  '(√3-√2)/(√3-√2)',
  '(√3-√2)/(√3+√2)',
  // 题7
  '(2x-√2)/√5 - √3 > √(6x) - √(2/3)',
  // 更复杂变体
  '已知a = (√3 - √2)/(√3 - √2), b = (√3 - √2)/(√3 + √2), 求 a² - 3ab + b² - 14 的平方根。',
]

for (const t of testCases) {
  console.log('\n===== INPUT =====')
  console.log(t)
  console.log('----- convertSqrt -----')
  console.log(convertSqrt(t))
  console.log('----- preprocessMath -----')
  console.log(preprocessMath(t))
  console.log('----- splitToSegments -----')
  for (const s of splitToSegments(preprocessMath(t))) {
    console.log(`  [${s.isMath ? 'MATH' : 'TEXT'}] ${s.text}`)
  }
  console.log('----- renderContent -----')
  console.log(renderContent(t))
}
