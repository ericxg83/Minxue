/**
 * 「主观题需人工判定」存量清理（2026-10-23 负责人截图 #20）
 *
 * 症状
 *   解答题学生答 3/4、参考答案也是 3/4，复核页却挂着「AI 未判定 · 主观题需人工判定」，
 *   老师被迫逐题拍板。用户质问：「这种怎么被称为主观题？明明很容易批改」。
 *
 * 根因（两层，互不相同）
 *   ① 文案是化石：`UNJUDGED_REASONS.subjective` 原文写着「主观题需人工判定」，
 *      出自「解答题一律不自动判、直接转人工」那条**已废弃**的旧规则。现行实现是
 *      先跑 judgeAnswer，只放行判对（见 worker.js 的 SUBJECTIVE_TYPES 分支）。
 *      文案已在代码里改成「解答题已自动核对，未能确认与参考答案一致，请人工核对」，
 *      但 `answer_exception_reason` 是**一次性写入的历史快照**，存量行不会自己变。
 *   ② 判定是旧结论：判等引擎此后修过多轮（解集通道、多根、LaTeX 归一…），
 *      且参考答案也可能事后被纠正，但没有任何链路会**重跑**历史未判定行。
 *
 * 本脚本做两件事（都只碰「观测/结论」，不动题干、不动参考答案）
 *   A. 可证明相同 → 直接判对：学生答案的最终取值与参考答案**归一化后逐字相等**
 *      （且参考不含多值分隔符）⇒ is_correct=true、清空异常原因、写 judgement 审计。
 *      判据刻意严到"字面相等"，**不使用 judgeAnswer 的等价通道**：实测该通道对
 *      「2x²y√x vs 2xy²√x」这类只差变量位置的多变量式会误判等价（见下），
 *      拿它批量改库会把真错判成对、从错题本里消失。
 *   B. 其余仍是未判定的行 → 只把化石文案换成如实描述（纯展示列，不参与判定）。
 *
 * 用法
 *   node server/scripts/backfill-stale-subjective-20261023.mjs             # dry-run（默认，只读）
 *   node server/scripts/backfill-stale-subjective-20261023.mjs --apply
 *   node server/scripts/backfill-stale-subjective-20261023.mjs --rollback
 *
 * 幂等：A 跑完后这些行 is_correct 非空、原因已清 ⇒ 再跑计划为空。
 */
import '../loadEnv.js'
import { pathToFileURL } from 'node:url'
import { getPool } from '../config/neon.js'
import { judgeAnswer, UNJUDGED_REASONS } from '../services/judgeService.js'
import { createJudgement } from '../services/neonService.js'

const APPLY = process.argv.includes('--apply')
const ROLLBACK = process.argv.includes('--rollback')
const BAK = 'questions_bak_20261023_subjective'
const OLD_TEXT = '主观题需人工判定'
const NEW_TEXT = UNJUDGED_REASONS.subjective

const pool = getPool()
const q = async (sql, params) => (await pool.query(sql, params)).rows

/** 归一化：只做写法归一（LaTeX/全角/空白），不做数学等价 */
const canon = (s) => {
  let out = String(s ?? '')
    .replace(/\$/g, '')
    .replace(/\\left|\\right/g, '')
  // 先根式再分式：\frac{\sqrt{10}}{99} 的分子里带花括号，顺序反了就展不开
  out = out.replace(/\\sqrt\{([^{}]*)\}/g, '√$1')
  for (let i = 0; i < 2; i++) {
    out = out.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2')
  }
  return out
    .replace(/[{}]/g, '')
    .replace(/\s+/g, '')
    .replace(/[。.；;，,、]+$/g, '')
    .toLowerCase()
}

const lastLine = (s) => String(s ?? '').split('\n').map(x => x.trim()).filter(Boolean).pop() || ''
const afterLastEq = (s) => {
  const i = String(s).lastIndexOf('=')
  return i >= 0 ? String(s).slice(i + 1) : String(s)
}
const MULTI_VALUE_RE = /[或，,；;]/

/**
 * 可证明相同：两侧归一化后逐字相等。
 * 参考含多值分隔符（或/,/；）时不走「取等号右侧」的捷径 —— 否则
 * 「参考 x=2或x=3、学生只写 x=3」会被误判为对。
 */
export function triviallyEqual(studentAnswer, referenceAnswer) {
  const refRaw = String(referenceAnswer ?? '').trim()
  const stuRaw = String(studentAnswer ?? '').trim()
  if (!refRaw || !stuRaw) return false
  const refMulti = MULTI_VALUE_RE.test(refRaw)
  const ref = canon(refMulti ? refRaw : afterLastEq(refRaw))
  if (!ref) return false
  const stuLine = lastLine(stuRaw)
  const stu = canon(refMulti ? stuLine : afterLastEq(stuLine))
  if (!stu) return false
  if (stu.length > 60 || ref.length > 60) return false
  return stu === ref
}

async function rollback() {
  const t = await q('SELECT to_regclass($1) AS t', [BAK])
  if (!t[0].t) {
    console.log('[rollback] 没有备份表，跳过')
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const r = await client.query(
      `UPDATE questions q
          SET is_correct = b.is_correct,
              status = b.status,
              confidence = b.confidence,
              answer_exception = b.answer_exception,
              answer_exception_reason = b.answer_exception_reason,
              updated_at = NOW()
         FROM ${BAK} b
        WHERE q.id = b.id`
    )
    await client.query('COMMIT')
    console.log(`[rollback] questions 还原 ${r.rowCount} 行`)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

async function main() {
  if (ROLLBACK) {
    await rollback()
    await pool.end()
    return
  }

  const rows = await q(
    `SELECT id, student_id, task_id, question_number, question_type, answer, student_answer,
            is_correct, status, confidence, answer_source, review_status, answer_exception_reason
       FROM questions
      WHERE deleted_at IS NULL
        AND answer_exception_reason = $1
      ORDER BY created_at`,
    [OLD_TEXT]
  )

  const fixable = []
  const textOnly = []
  for (const r of rows) {
    // 已下过结论的行（AI 或老师）、学生整题空白的行：不改判定，只换文案 ——
    // 历史快照留着旧文案，日后重判会以假原因复活。
    const skipFix = r.is_correct !== null || Boolean(r.review_status) ||
      r.answer_source === 'blank' || !String(r.student_answer ?? '').trim()
    if (skipFix) {
      textOnly.push({ ...r, why: r.is_correct !== null ? 'judged' : (r.review_status ? 'reviewed' : 'blank') })
      continue
    }
    const judge = judgeAnswer(r.student_answer, r.answer, r.question_type || 'answer')
    if (triviallyEqual(r.student_answer, r.answer)) {
      fixable.push({ ...r, judge: judge.isCorrect })
    } else {
      textOnly.push({ ...r, why: `judge=${String(judge.isCorrect)}` })
    }
  }

  console.log(`总行数 ${rows.length} ｜ 可证明相同→判对 ${fixable.length} ｜ 仅改文案 ${textOnly.length}`)
  console.log('\n[A] 直接判对（学生最终取值与参考答案归一化后逐字相等）')
  console.table(fixable.map((r) => ({
    题: String(r.id).slice(0, 8),
    题号: r.question_number,
    学生: String(r.student_answer ?? '').slice(0, 22).replace(/\n/g, ' '),
    参考: String(r.answer ?? '').slice(0, 22),
    旧conf: String(r.confidence)
  })))
  console.log('\n[B] 仅换文案（保留未判定，等老师核对）')
  console.table(textOnly.slice(0, 15).map((r) => ({
    题: String(r.id).slice(0, 8),
    题号: r.question_number,
    学生: String(r.student_answer ?? '').slice(0, 18).replace(/\n/g, ' '),
    参考: String(r.answer ?? '').slice(0, 18),
    原因: r.why
  })))

  if (!APPLY) {
    console.log('\n[dry-run] 未写库。加 --apply 执行。')
    await pool.end()
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${BAK} AS
         SELECT id, is_correct, status, confidence, answer_exception, answer_exception_reason, now() AS backed_at
           FROM questions WHERE false`
    )
    const touched = [...fixable, ...textOnly].map((r) => r.id)
    if (touched.length > 0) {
      // 备份表按 id 只留一份（重跑不堆重复行，rollback 取到的永远是最初那次）
      await client.query(`DELETE FROM ${BAK} WHERE id = ANY($1::uuid[])`, [touched])
      await client.query(
        `INSERT INTO ${BAK} (id, is_correct, status, confidence, answer_exception, answer_exception_reason, backed_at)
         SELECT id, is_correct, status, confidence, answer_exception, answer_exception_reason, now()
           FROM questions
          WHERE id = ANY($1::uuid[])`,
        [touched]
      )
    }
    await client.query(
      `UPDATE questions
          SET is_correct = TRUE,
              status = CASE WHEN status = 'mastered' THEN status WHEN status = 'wrong' THEN 'pending' ELSE status END,
              confidence = COALESCE(confidence, 0.9),
              answer_exception = FALSE,
              answer_exception_reason = NULL,
              updated_at = NOW()
        WHERE id = ANY($1::uuid[])
          AND is_correct IS NULL`,
      [fixable.map((r) => r.id)]
    )
    await client.query(
      `UPDATE questions
          SET answer_exception_reason = $2,
              updated_at = NOW()
        WHERE id = ANY($1::uuid[])
          AND answer_exception_reason = $3`,
      [textOnly.map((r) => r.id), NEW_TEXT, OLD_TEXT]
    )
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }

  for (const r of fixable) {
    await createJudgement({
      questionId: r.id,
      studentId: r.student_id,
      source: 'backfill_stale_subjective',
      confidence: r.confidence != null ? Number(r.confidence) : null,
      isCorrect: true,
      content: null,
      answer: r.answer,
      studentAnswer: r.student_answer,
      metadata: { oldIsCorrect: null, oldReason: OLD_TEXT, rule: 'trivially_equal' }
    })
  }

  console.log(`\n[apply] 判对 ${fixable.length} 行 ｜ 改文案 ${textOnly.length} 行 ｜ 备份表 ${BAK}`)
  await pool.end()
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url

if (isMain) {
  main().catch(async (e) => {
    console.error('[fatal]', e)
    try { await pool.end() } catch {}
    process.exitCode = 1
  })
}
