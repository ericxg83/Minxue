/**
 * 一次性修复：多小问大题「公共题干丢失」（2026-09-20 第19题事故）
 *
 * 症状：弱视觉模型把多小问大题【合并成一条 content】输出时把公共题干整段丢掉 →
 *   questions.parent_stem 为空、content 只剩 (1)(2)(3) 小问 →
 *   答案引擎判「题干缺少条件」→ answer 留空、界面显示「AI 未判定」。
 *   实例：任务 5636fc30 第19题，原卷公共题干「如图，一只蚂蚁从点A沿数轴向右爬行了2个单位长度
 *   到达点B，点A表示-√2，设点B所表示的实数为m」整段消失。
 *
 * 本脚本做两件事（默认 dry-run，加 --apply 才写库）：
 *   ① 用主力模型整页重识别的结果回填 parent_stem。
 *      来源 JSON：_pageimgs/ocr_p3.json / ocr_p4.json / ocr_c8p4.json
 *      —— 这些结果**已逐条与 OSS 原卷页图人工核对**（p3/p4 = 任务 5636fc30 第3、4页；
 *         c8p4 = 任务 165acb27 第4页），确认与原卷印刷题干逐字一致。
 *   ② 对仍无参考答案的题，用「parent_stem + content」重跑答案引擎并写回
 *      （修复前答案引擎只看 content，看不到公共题干）。
 *
 * 用法：
 *   node scripts/fix-lost-parent-stem-20260920.mjs            # dry-run，只打印
 *   node scripts/fix-lost-parent-stem-20260920.mjs --apply    # 写库
 *
 * ⚠️ 写库前会把原值快照落 scripts/logs/lost-parent-stem-<ts>.json，便于回滚。
 */
import dotenv from 'dotenv'
import fs from 'node:fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../.env') })

const APPLY = process.argv.includes('--apply')
const IMG_DIR = 'D:/Minxue_App_V3/_pageimgs'

const { query } = await import('../config/neon.js')
const { updateQuestionAnswer } = await import('../services/neonService.js')
const { formatOptionsForPrompt } = await import('../utils/optionText.js')
const {
  generateAnswerForQuestion,
  extractAnswerFromAnalysis,
  validateAIAnswer,
} = await import('../worker.js')

/**
 * 待修复清单。每条的 parent_stem 都取自整页重识别结果，不手打（避免 LaTeX 转写错误）。
 * pick: 'parent_stem' = 取该题号条目的 parent_stem；
 *       'lead_content' = 取该题号 sub_no=null 条目的 content（题干引导段被单独拆成一条的情形）。
 */
const FIXES = [
  { qid: '4dca950c-3785-4983-afe6-963b2076b6e8', qno: 19, src: 'ocr_p3.json', note: '第19题 蚂蚁数轴' },
  { qid: '67911dfa-229a-4228-a89a-a802fb5764ab', qno: 20, src: 'ocr_p3.json', note: '第20题 平方根' },
  { qid: 'e1954c37-0a5a-4519-88e6-738d4667fa5e', qno: 21, src: 'ocr_p3.json', note: '第21题 规律探究' },
  { qid: 'e8eed97f-6d32-4f35-81a1-178a0b41e69d', qno: 22, src: 'ocr_p4.json', note: '第22题 立方根' },
  { qid: '767a35b9-3515-4df8-811d-36b2a9ae8c7d', qno: 23, src: 'ocr_p4.json', note: '第23题 宣纸' },
  { qid: '9182bc08-3330-4124-af3e-9caf6f43f3ab', qno: 24, src: 'ocr_p4.json', note: '第24题 平方根/立方根' },
  { qid: 'e17762e5-ced2-4ed0-8de8-d6989236670f', qno: 24, src: 'ocr_c8p4.json', pick: 'lead_content', note: '试卷⑧第24题 恒等变形（公共题干=背景引导段）' },
]

const pickParentStem = (fix) => {
  const p = resolve(IMG_DIR, fix.src)
  if (!fs.existsSync(p)) throw new Error(`缺少重识别结果 ${p}`)
  const j = JSON.parse(fs.readFileSync(p, 'utf8'))
  const qs = Array.isArray(j) ? j : j.questions
  const same = qs.filter(q => Number(q.question_number) === fix.qno)
  if (!same.length) throw new Error(`${fix.src} 里没有题号 ${fix.qno}`)
  if (fix.pick === 'lead_content') {
    const lead = same.find(q => !q.sub_no)
    if (!lead) throw new Error(`${fix.src} 题${fix.qno} 没有引导段（sub_no=null）条目`)
    return String(lead.content || '').trim()
  }
  const withStem = same.find(q => q.parent_stem && String(q.parent_stem).trim())
  if (!withStem) throw new Error(`${fix.src} 题${fix.qno} 重识别结果里也没有 parent_stem`)
  return String(withStem.parent_stem).trim()
}

const snapshot = { ts: new Date().toISOString(), apply: APPLY, items: [] }

console.log('='.repeat(72))
console.log(`🔧 多小问大题公共题干回填（2026-09-20 第19题事故）  mode=${APPLY ? 'APPLY 写库' : 'DRY-RUN 只打印'}`)
console.log('='.repeat(72))

let filled = 0
let answered = 0

for (const fix of FIXES) {
  const { rows } = await query(
    `SELECT id, content, parent_stem, answer, analysis, options, question_type, status, answer_source
     FROM questions WHERE id = $1 AND deleted_at IS NULL`, [fix.qid])
  if (!rows.length) { console.log(`\n⏭️  ${fix.qid.slice(0, 8)} 不存在，跳过`); continue }
  const q = rows[0]

  console.log(`\n── ${fix.note}  (${fix.qid.slice(0, 8)})`)
  console.log(`   现状 parent_stem = ${JSON.stringify(q.parent_stem)}`)
  console.log(`   现状 answer      = ${JSON.stringify(q.answer)}  (${q.answer_source})`)

  const stem = pickParentStem(fix)
  console.log(`   待写入 parent_stem = ${JSON.stringify(stem)}`)

  snapshot.items.push({ qid: fix.qid, note: fix.note, before: { parent_stem: q.parent_stem, answer: q.answer, analysis: q.analysis } })

  if (!APPLY) { filled++; continue }

  // ── ① 回填 parent_stem ──
  if (!q.parent_stem || !String(q.parent_stem).trim()) {
    await query(`UPDATE questions SET parent_stem = $1, updated_at = NOW() WHERE id = $2`, [stem, fix.qid])
    console.log('   ✅ parent_stem 已回填')
    filled++
  } else {
    console.log('   ⏭️  已有 parent_stem，不覆盖')
  }

  // ── ② 重跑答案（仅对仍无参考答案的题）──
  const noAnswer = !q.answer || !String(q.answer).trim()
    || String(q.answer) === '待人工补充' || String(q.answer) === '-'
  if (!noAnswer) {
    console.log(`   ⏭️  已有答案，不重跑`)
    continue
  }
  let options = []
  if (q.options) { try { options = typeof q.options === 'string' ? JSON.parse(q.options) : q.options } catch { options = [] } }
  // ⚠️ 与 worker.js 修复后的口径一致：公共题干 + 本问 + 选项
  const fullContent = [`${stem}\n${q.content}`, options.length ? `选项：${formatOptionsForPrompt(options)}` : '']
    .filter(Boolean).join('\n')

  try {
    const result = await generateAnswerForQuestion(fullContent)
    const validation = validateAIAnswer(result.answer, result.analysis)
    if (validation.isValid) {
      const finalAnswer = extractAnswerFromAnalysis(result.answer, result.analysis, options)
      await updateQuestionAnswer(fix.qid, finalAnswer, result.analysis, true)
      console.log(`   ✅ 答案已生成: ${JSON.stringify(finalAnswer)}`)
      answered++
    } else if (result.analysis && result.analysis.trim()) {
      const extracted = extractAnswerFromAnalysis(result.answer, result.analysis, options)
      if (extracted && extracted !== '-' && extracted !== result.answer) {
        await updateQuestionAnswer(fix.qid, extracted, result.analysis, true)
        console.log(`   ✅ 从分析提取答案: ${JSON.stringify(extracted)}`)
        answered++
      } else {
        await query(`UPDATE questions SET analysis = $1, updated_at = NOW() WHERE id = $2`, [result.analysis, fix.qid])
        console.log(`   ⚠️  仍无法生成答案（${validation.reason}），已保存分析文本`)
      }
    } else {
      console.log(`   ❌ 答案引擎无输出（${validation.reason}）`)
    }
  } catch (err) {
    console.log(`   ❌ 答案重跑失败: ${err.message}`)
  }
  await new Promise(r => setTimeout(r, 800))
}

if (APPLY) {
  // parent_stem / answer 变了，反范式缓存列 is_complete 必须跟着重算
  const { syncQuestionCompleteness } = await import('../services/questionCompletenessSync.js')
  await syncQuestionCompleteness(FIXES.map(f => f.qid))
  console.log('\n🔄 已重算 is_complete（parent_stem / answer 变更后必须同步）')

  fs.mkdirSync(resolve(__dirname, 'logs'), { recursive: true })
  const snapPath = resolve(__dirname, `logs/lost-parent-stem-${Date.now()}.json`)
  fs.writeFileSync(snapPath, JSON.stringify(snapshot, null, 2))
  console.log(`💾 回滚快照: ${snapPath}`)
}

console.log('\n' + '='.repeat(72))
console.log(`📊 ${APPLY ? '执行完成' : 'DRY-RUN 预览'}：parent_stem 处理 ${filled} 条，答案重跑成功 ${answered} 条`)
console.log('='.repeat(72))
process.exit(0)
