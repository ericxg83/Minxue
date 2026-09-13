/**
 * 只读探针：答案层存量与「缺少参考答案」根因
 *   1) questions.answer 的质量盘点（空 / 含解析文字 / 带壳 / 异常长）
 *   2) 「缺少参考答案，无法自动判定」的题：卡在哪条链路（task_type / resource / source）
 *   3) answer_source 分布
 * 只读，不写库。
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import pg from 'pg'
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const q = async (s, p) => (await pool.query(s, p)).rows

const WINDOW = `t.created_at > NOW() - INTERVAL '30 days'`

console.log('\n===== 1. answer_source 分布（近 30 天）=====')
console.table(await q(`
  SELECT q.answer_source AS src,
         COUNT(*)::int AS cnt,
         COUNT(*) FILTER (WHERE q.answer IS NULL OR btrim(q.answer)='')::int AS 空答案,
         COUNT(*) FILTER (WHERE length(btrim(COALESCE(q.answer,''))) > 60)::int AS 超长
  FROM tasks t JOIN questions q ON q.task_id = t.id
  WHERE ${WINDOW} GROUP BY 1 ORDER BY cnt DESC`))

console.log('\n===== 2. 参考答案质量（有答案的题里，疑似含解析文字/带壳的规模）=====')
console.table(await q(`
  SELECT
    COUNT(*) FILTER (WHERE q.answer IS NOT NULL AND btrim(q.answer)<>'')::int AS 有答案,
    COUNT(*) FILTER (WHERE q.answer ~ '(解析|因为|所以|可知|说明|则可能|应是|应为|答[:：])')::int AS 含解析性文字,
    COUNT(*) FILTER (WHERE q.answer ~ '^\\s*(应为|正确答案|标准答案|参考答案|答案\\s*[:：]|答\\s*[:：]|解\\s*[:：])')::int AS 带壳,
    COUNT(*) FILTER (WHERE length(btrim(COALESCE(q.answer,''))) > 60)::int AS 超长_超60字,
    COUNT(*) FILTER (WHERE length(btrim(COALESCE(q.answer,''))) > 150)::int AS 超长_超150字
  FROM tasks t JOIN questions q ON q.task_id = t.id
  WHERE ${WINDOW}`))

console.log('\n===== 3. 含解析文字的参考答案抽样（会被拿去逐串比对，必判错）=====')
console.table((await q(`
  SELECT q.question_type AS qt, q.student_answer AS stu,
         LEFT(regexp_replace(q.answer,'\\s+',' ','g'), 56) AS ref
  FROM tasks t JOIN questions q ON q.task_id = t.id
  WHERE ${WINDOW} AND q.answer ~ '(解析|因为|所以|可知|说明|则可能)'
    AND length(btrim(q.answer)) > 30
  ORDER BY length(q.answer) DESC LIMIT 12`)))

console.log('\n===== 4. 「缺少参考答案」50 条：卡在哪条链路 =====')
console.table(await q(`
  SELECT t.task_type, q.answer_source AS src,
         (q.answer IS NULL OR btrim(q.answer)='') AS 答案为空,
         COUNT(*)::int AS cnt,
         COUNT(DISTINCT t.id)::int AS 任务数
  FROM tasks t JOIN questions q ON q.task_id = t.id
  WHERE ${WINDOW} AND q.answer_exception_reason = '缺少参考答案，无法自动判定'
  GROUP BY 1,2,3 ORDER BY cnt DESC`))

console.log('\n===== 5. 这些题的 task 是否挂了资源 / 练习册（本该能取到答案）=====')
console.table(await q(`
  SELECT t.id, t.task_type, t.resource_id IS NOT NULL AS 有resource,
         COUNT(*)::int AS 缺答案题数,
         MAX(t.original_name) AS 卷名
  FROM tasks t JOIN questions q ON q.task_id = t.id
  WHERE ${WINDOW} AND q.answer_exception_reason = '缺少参考答案，无法自动判定'
  GROUP BY 1,2,3 ORDER BY 缺答案题数 DESC LIMIT 15`).catch(e => { console.log('  ', e.message); return [] }))

console.log('\n===== 6. 这 50 条题在 judgements 里有没有留痕（判断是否走了判题链路）=====')
console.table(await q(`
  SELECT COUNT(DISTINCT q.id)::int AS 缺答案题数,
         COUNT(DISTINCT j.question_id)::int AS 有judgement记录
  FROM tasks t JOIN questions q ON q.task_id = t.id
  LEFT JOIN judgements j ON j.question_id = q.id
  WHERE ${WINDOW} AND q.answer_exception_reason = '缺少参考答案，无法自动判定'`).catch(e => { console.log('  ', e.message); return [] }))

console.log('\n===== 7. question_cache 规模与近期命中情况 =====')
console.table(await q(`
  SELECT COUNT(*)::int AS 缓存总数,
         COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::int AS 近30天新增
  FROM question_cache`).catch(e => { console.log('  ', e.message); return [] }))

await pool.end()
