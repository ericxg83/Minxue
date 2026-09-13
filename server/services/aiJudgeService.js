// 判题终裁（L3）：本地规则 judgeAnswer 判不出的客观题，交给 AI 做等价写法仲裁。
//
// 2026-09-13 实测选型（deliverables/model_hybrid_plan_20260913.md 搭配点2）：
//   13 道「等价但未化简」边界题的宽容率 —— grok-4.5 77%（0 调用失败）> 魔搭 69% > sensenova 54%。
//   → 终裁模型选 grok-4.5（走 Huihuiyun 免费 key，无额外成本）。
//   原计划的 L2「魔搭 AI 判题」层不可实现：魔搭当前无可用纯文本模型（ai.js:283 实测注释），
//   故简化为「规则 → grok-4.5 → 人工」三级。
//
// 安全边界（宁可转人工，不可错判）：
//   · 只接客观题（choice/fill/judge），解答题等主观题永远人工；
//   · 只接「学生确实作答 + 参考答案非空且可验证」的题；
//   · AI 输出 uncertain / 解析失败 / 调用失败 → 维持 is_correct=null 转人工；
//   · 判定只改 is_correct，不碰 student_answer / answer / 污染闸结论。
import { callVendorTextCompletion } from '../config/ai.js'
import { detectUnverifiableReference } from './judgeService.js'

const JUDGE_VENDOR = process.env.AI_JUDGE_VENDOR || 'Huihuiyun'
const JUDGE_MODEL = process.env.AI_JUDGE_MODEL || 'grok-4.5'
// 总开关：AI_JUDGE_ENABLED=0 可整体关闭终裁（回滚开关），默认开
export const AI_JUDGE_ENABLED = process.env.AI_JUDGE_ENABLED !== '0'
const JUDGE_TIMEOUT_MS = parseInt(process.env.AI_JUDGE_TIMEOUT_MS, 10) || 30000

// 导出供冒烟脚本/测试复用，保证冒烟验证与生产发出完全相同的 prompt
export const JUDGE_SYSTEM_PROMPT = [
  '你是一名严格的阅卷老师，唯一任务：判断「学生答案」和「标准答案」是否表达同一个结果。',
  '判定规则：',
  '1. 数学等价即算对：2/4 与 1/2、√8 与 2√2、0.5 与 1/2、x=3 与 3，都算对。',
  '   除非题目明确要求「化简/最简/保留两位小数」等格式，等价未化简不算错。',
  '2. 只比较最终答案，不要求解题过程、书写顺序、措辞一致。',
  '3. 负号、根号、分母不能凭空丢：标准答案是 -2√3，学生写 2√3，算错。',
  '4. 多空/多问答案按顺序逐空比对，全部对才算对；顺序题按题目要求的集合/顺序处理。',
  '5. 选择题比较选项字母，判断题比较对错结论，字母或结论不同即错。',
  '6. 单位：数值等价但学生漏写单位，算对（单位错误不算数值错误）；除非标准答案考察的就是单位换算本身。',
  '7. 信息不足、题目被截断、标准答案本身含糊（如"略"）→ 输出 uncertain，绝不猜。',
  '只输出一行 JSON，不要解释、不要代码块：{"verdict":"correct|wrong|uncertain","reason":"不超过20字"}',
].join('\n')

function buildUserPrompt({ questionType, studentAnswer, referenceAnswer }) {
  const typeLabel = { choice: '选择题', fill: '填空题', judge: '判断题' }[questionType] || questionType
  return [
    `题型：${typeLabel}`,
    `标准答案：${String(referenceAnswer).trim()}`,
    `学生答案：${String(studentAnswer).trim()}`,
  ].join('\n')
}

// 从模型返回中解析裁决。容忍代码围栏、前后缀杂讯；解析失败按 uncertain 处理。
export function parseJudgeVerdict(content) {
  if (!content) return { verdict: 'uncertain', reason: 'AI 无返回' }
  let text = String(content).trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return { verdict: 'uncertain', reason: 'AI 返回无 JSON' }
  try {
    const obj = JSON.parse(m[0])
    const verdict = String(obj.verdict || '').toLowerCase()
    if (!['correct', 'wrong', 'uncertain'].includes(verdict)) {
      return { verdict: 'uncertain', reason: `非法裁决 ${verdict || '空'}` }
    }
    return { verdict, reason: String(obj.reason || '').slice(0, 50) }
  } catch {
    return { verdict: 'uncertain', reason: 'AI 返回 JSON 解析失败' }
  }
}

/**
 * 终裁单题。返回 { isCorrect: true|false|null, reason, model }。
 * isCorrect=null 表示 AI 也不敢下结论 → 调用方维持原状（转人工）。
 */
export async function aiJudgeAnswer({ questionType, studentAnswer, referenceAnswer }) {
  const userText = buildUserPrompt({ questionType, studentAnswer, referenceAnswer })
  try {
    const { content, model } = await callVendorTextCompletion({
      vendorName: JUDGE_VENDOR,
      model: JUDGE_MODEL,
      systemPrompt: JUDGE_SYSTEM_PROMPT,
      userText,
      temperature: 0.1,
      maxTokens: 512,
      timeout: JUDGE_TIMEOUT_MS,
      // grok 不能带 sensenova 的 reasoning_effort:'none'（供应商级 extraBody 的坑）
      extraBody: null,
    })
    const { verdict, reason } = parseJudgeVerdict(content)
    return {
      isCorrect: verdict === 'correct' ? true : verdict === 'wrong' ? false : null,
      reason,
      model,
    }
  } catch (e) {
    return { isCorrect: null, reason: `终裁调用失败: ${e.message}`, model: JUDGE_MODEL }
  }
}

/**
 * 筛选「值得终裁」的题：规则判不出 + 学生作答了 + 参考答案可验证 + 客观题。
 * 纯函数，便于单测。
 */
export function selectJudgeCandidates(questions) {
  return (questions || []).filter(q => {
    if (!q) return false
    if (q.is_correct !== null && q.is_correct !== undefined) return false
    if (q.answer_source === 'blank') return false
    if (!String(q.student_answer || '').trim() || String(q.student_answer || '').trim() === '未作答') return false
    if (!String(q.answer || '').trim()) return false
    if (!['choice', 'fill', 'judge'].includes(String(q.question_type || '').toLowerCase())) return false
    // 参考答案本身无从核对（"证明略""答案不唯一"）→ 主观/开放题，AI 终裁没意义，直接人工
    if (detectUnverifiableReference(String(q.answer || '').trim())) return false
    if (q._ai_judged) return false
    return true
  })
}
