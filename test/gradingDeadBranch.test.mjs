// 回归锁：移动端批改页 Grading/index.jsx 的 handleComplete 不得残留
// 「在 legacy else 分支内嵌套 if (generatedExamId) 调 markGeneratedExamGraded」的不可达死分支。
//
// 背景（2026-11-02 r379 巡查）：
//   handleComplete 结构是 `if (generatedExamId) { gradeGeneratedExam } else { ... }`，
//   else 分支内又写了一句 `if (generatedExamId) { markGeneratedExamGraded }` ——
//   此时 generatedExamId 必为 falsy，该分支永远不可达。且新流程的 gradeGeneratedExam
//   已在服务端 gradingFinalizer.finalizeGeneratedExamResults 内 `SET status='graded'`
//   （gradingFinalizer.js:557），这句中遗留的 markGeneratedExamGraded 既不执行、也
//   让 maintainer 误以为新流程漏标 graded。属行为保持型死代码，删除零行为变化。
//
// 锁判据：源码不得再出现 markGeneratedExamGraded 的「调用」形态（带 open paren）。
// 反向自检：向合成坏样本注入该死分支，判据必须判红（不依赖 git，规避 Windows EBUSY）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = join(__dirname, '..', 'src', 'pages', 'Grading', 'index.jsx')

// 死分支特征：源码中存在 `markGeneratedExamGraded(` 调用形态。
// 修复后（连同无用的 import 一并删除）该 token 不得再出现。
const deadBranchAbsent = (src) => !src.includes('markGeneratedExamGraded(')

test('Grading handleComplete 不得残留 markGeneratedExamGraded 不可达死分支', () => {
  const src = readFileSync(SRC, 'utf8')
  assert.ok(
    deadBranchAbsent(src),
    '源码仍含 markGeneratedExamGraded( 调用（不可达死分支未删干净）'
  )
})

test('反向自检：注入死分支后判据必须判红', () => {
  const bad = `
import { markGeneratedExamGraded } from '../../services/apiService'
export default function handleComplete() {
  if (generatedExamId) {
    await gradeGeneratedExam(generatedExamId, studentId, resultsArray)
  } else {
    await batchUpsertWrongQuestionStatus(studentId, legacyResults)
    if (generatedExamId) {
      await markGeneratedExamGraded(generatedExamId)
    }
  }
}
`
  assert.equal(
    deadBranchAbsent(bad),
    false,
    '反向自检失败：含死分支的坏样本应被判红'
  )
})
