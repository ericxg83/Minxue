/**
 * 批次 5：清掉指向 archived 知识点的存量关联
 *
 * ⛔ 为什么不用 recomputeQuestionKnowledge.mjs 全量重算：
 *   该脚本是「先删后插」，要重写 1.1 万条边，而实测差异只有 26 条
 *   （全部是「题目原来挂了归档节点」）。风险与收益不成比例。
 *   本脚本只删这 26 条，结果与全量重算 dry-run 一致（跑完可用 recompute dry-run 验证差异=0）。
 *   全量重算的价值在「AI 标签本身变好」时才会显现，那需要重跑打标（要花 LLM 额度），不在本次范围。
 */
import '../loadEnv.js'
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const { default: pg } = await import('pg')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const APPLY = process.argv.includes('--apply')
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

const out = []
const say = (...a) => { const s = a.join(' '); out.push(s); console.log(s) }

const { rows: before } = await pool.query(`SELECT count(*)::int AS n FROM question_knowledge`)
say(`现有 question_knowledge 边：${before[0].n}`)

const { rows: detail } = await pool.query(`
  SELECT kp.name, count(*)::int AS n
    FROM question_knowledge qk JOIN knowledge_points kp ON kp.id = qk.kp_id
   WHERE kp.archived = true GROUP BY kp.name ORDER BY n DESC`)
const total = detail.reduce((a, r) => a + r.n, 0)
say(`指向 archived 节点的边：${total}`)
for (const r of detail) say(`  ${r.name} → ${r.n}`)

// 这些题在删掉归档边之后，还剩不剩别的关联？（剩 0 的要单独提示，避免变成无考点题）
const { rows: willEmpty } = await pool.query(`
  SELECT count(*)::int AS n FROM (
    SELECT qk.question_id
      FROM question_knowledge qk JOIN knowledge_points kp ON kp.id = qk.kp_id
     WHERE kp.archived = true
     GROUP BY qk.question_id
    HAVING NOT EXISTS (
      SELECT 1 FROM question_knowledge q2 JOIN knowledge_points k2 ON k2.id = q2.kp_id
       WHERE q2.question_id = qk.question_id AND k2.archived = false)
  ) t`)
say(`⚠️ 删完会「没有任何考点」的题：${willEmpty[0].n}（必须为 0）`)

if (!APPLY) {
  say('')
  say('── dry-run 结束，未写库 ──')
  fs.writeFileSync(path.resolve(ROOT, '_tmp_kp_archive_cleanup.txt'), out.join('\n'), 'utf8')
  await pool.end(); process.exit(0)
}

if (willEmpty[0].n > 0) {
  say('⛔ 有题目会变成无考点，按「宁可留空转人工」原则中止，需先决定这些题的归属。')
  await pool.end(); process.exit(1)
}

const client = await pool.connect()
try {
  await client.query('BEGIN')
  const r = await client.query(`
    DELETE FROM question_knowledge
     WHERE kp_id IN (SELECT id FROM knowledge_points WHERE archived = true)`)
  say('')
  say(`✅ 已删除 ${r.rowCount} 条指向归档节点的边`)
  await client.query('COMMIT')
} catch (e) {
  await client.query('ROLLBACK')
  say(`❌ 已回滚：${e.message}`)
  client.release(); await pool.end(); process.exit(1)
}
client.release()

const { rows: after } = await pool.query(`SELECT count(*)::int AS n FROM question_knowledge`)
say(`复核：${before[0].n} → ${after[0].n}（预期 -${total}）`)
const { rows: orphan } = await pool.query(
  `SELECT count(*)::int AS n FROM question_knowledge qk LEFT JOIN knowledge_points kp ON kp.id = qk.kp_id WHERE kp.id IS NULL`)
say(`孤儿边：${orphan[0].n}（必须为 0）`)
fs.writeFileSync(path.resolve(ROOT, '_tmp_kp_archive_cleanup.txt'), out.join('\n'), 'utf8')
await pool.end()
