/**
 * 修复（2026-09-21 第三轮）：答案册 83cf0c4b《八上精练与拓展》剩余 5 条答案值错误
 *
 * 背景：前两轮已使管理端「零告警 + 零缺号」，并且删掉了 34 条 OCR 幻觉。
 * 本轮不再动题号结构，只做最后一件事：**把库内答案值逐条对 PDF 原页核准**。
 *
 * 方法：用「数字词元多重集」把库内 vs 离线基准（_basj_offline_fixed5.json）做严格比对，
 *      把 11 处数字差异逐条渲染 PDF 原页裁定——其中 9 处是图注/标点/LaTeX 包装噪声
 *      （库内往往更完整），**5 处是真实值错误**，即本脚本的修复对象。
 *
 * 逐条裁定（每条都渲染原页看过，页码即证据）：
 *   ① 19.1(2) q9            ±4且1,7.        → ±414.7.
 *      依据 PDF p1 1200/2400dpi 原页：「9. ±414.7.」（`且` 是 OCR 幻觉，原页无此字）。
 *      注意：原页确实就是「±414.7」连排、中间无分隔号，疑似原书漏排；**照原页回填，
 *      未擅自猜成分隔号**，并在报告中标注需人工确认。
 *   ② 21.2(3) q13           √a-1 / √b-2 / √c-3  → √(a-1) / √(b-2) / √(c-3)
 *      依据 PDF p13 900dpi：根号横线**明确覆盖两字符**（\sqrt{a-1}）；且库内原值自相矛盾——
 *      若为 √a−1=0 则 a=1，与同句「解得 a=2」冲突；√(b−2)=2 ⇒ b=6、√(c−3)=3 ⇒ c=12 亦只有
 *      两字符版才自洽。
 *   ③ 习题21.3—21.4 q11    当 m=0 时  → 当 m≠0 时
 *      依据 PDF p19 420dpi：「11. 当 m≠0 时，…是一元二次方程」。m=0 时 mx² 项消失、根本
 *      不是一元二次方程，原值逻辑自毁。
 *   ④ 习题22.3 q7           ①②④      → ①②③④
 *      依据 PDF p36 200dpi：「7. ①②③④.」——库内漏了③（离线基准此处反而正确，双向印证）。
 *   ⑤ 期末练习 q24          （仅(3)值）  → 补回 (1) 的值
 *      依据 PDF p42 200dpi：「24. (1) △EBJ≌△CDH, △AJG≌△FHG. (2) … (3) 20+8√2 或 20−8√2.」
 *      库内只剩(3)的值，(1) 丢失。**只补 (1)**：(1) 文本短且被离线 OCR 独立读到同一内容，
 *      双重印证；而 (2) 是长篇证明，**所有 OCR 来源都未识别**，不凭单方阅读臆造，
 *      仅在报告中标注为已知缺口（PDF p42）。
 *
 * 用法：
 *   预演（默认，不改库）：node server/scripts/repair-worksheet-83cf0c4b-20260921c.mjs
 *   执行：                node server/scripts/repair-worksheet-83cf0c4b-20260921c.mjs --apply
 */
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import fs from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '..', '.env') })
const WS = '83cf0c4b-ca07-46dd-b9ca-fc5ffdb6be45'
const APPLY = process.argv.includes('--apply')

const { Pool } = await import('pg')
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

const A21_2_3 =
  '将等式整理并配方，得 (√a-1-1)²+(√b-2-2)²+1/2(√c-3-3)²=0，则 √a-1-1=0, √b-2-2=0, √c-3-3=0，解得 a=2, b=6, c=12. 所以，a+b+c=20.'
const A21_2_3_FIX =
  '将等式整理并配方，得 (√(a-1)-1)²+(√(b-2)-2)²+1/2(√(c-3)-3)²=0，则 √(a-1)-1=0, √(b-2)-2=0, √(c-3)-3=0，解得 a=2, b=6, c=12. 所以，a+b+c=20.'

// ── 逐条裁定表 ──
// old：整串比对（幂等前置校验，值对不上就跳过）
// repl：[正则, 替换]：只替换片段，其余保留
const FIXES = [
  {
    unit: '19.1(2)', q: 9, sub: '', label: '19.1(2) q9',
    old: '±4且1,7.', next: '±414.7.',
    ev: 'PDF p1 2400dpi「9. ±414.7.」——原页无「且」字，是 OCR 幻觉',
  },
  {
    unit: '21.2(3)', q: 13, sub: '', label: '21.2(3) q13',
    old: A21_2_3, next: A21_2_3_FIX,
    ev: 'PDF p13 900dpi 根号横线覆盖 a-1/b-2/c-3 两字符；且 √a-1=0⇒a=1 与「解得 a=2」自毁',
  },
  {
    unit: '习题21.3—21.4', q: 11, sub: '', label: '习题21.3—21.4 q11',
    repl: [/\$m=0\$/, () => '$m \\neq 0$'],
    old: '当 $m=0$ 时', next: '当 $m \\neq 0$ 时（片段替换）',
    ev: 'PDF p19 420dpi「11. 当 m≠0 时，…是一元二次方程」（m=0 时不是一元二次方程）',
  },
  {
    unit: '习题22.3', q: 7, sub: '', label: '习题22.3 q7',
    old: '①②④', next: '①②③④',
    ev: 'PDF p36 200dpi「7. ①②③④.」——库内漏③',
  },
  {
    unit: '期末练习', q: 24, sub: '', label: '期末练习 q24',
    repl: [/^/, '(1) △EBJ≌△CDH，△AJG≌△FHG. (3) '],
    old: '20+8√2 或 20-8√2', next: '(1) △EBJ≌△CDH，△AJG≌△FHG. (3) 20+8√2 或 20-8√2',
    ev: 'PDF p42 200dpi「24. (1) △EBJ≌△CDH, △AJG≌△FHG. … (3) 20+8√2 或 20−8√2.」',
  },
]

const units = (await pool.query(`SELECT id, unit_key FROM resource_units WHERE resource_id=$1::uuid`, [WS])).rows
const all = (await pool.query(
  `SELECT id, unit_id, question_no, sub_no, answer FROM resource_answers WHERE resource_id=$1::uuid`, [WS])).rows
const unitOf = new Map(units.map(u => [u.id, u.unit_key]))

console.log('══════ 答案册 83cf0c4b 修复（第三轮：答案值校准） ══════')
console.log(`模式：${APPLY ? '★ 执行（改库）' : '预演（不改库）'}`)
console.log()

const plan = []
for (const f of FIXES) {
  const rows = all.filter(a => unitOf.get(a.unit_id) === f.unit && Number(a.question_no) === f.q && (a.sub_no || '') === f.sub)
  if (rows.length !== 1) { console.log(`  ⚠ ${f.label} 匹配 ${rows.length} 行，跳过`); continue }
  const cur = String(rows[0].answer)
  const ok = f.repl ? f.repl[0].test(cur) : cur === f.old
  if (!ok) { console.log(`  ⚠ ${f.label} 现值与预期不符，跳过（现值 ${JSON.stringify(cur.slice(0, 60))}）`); continue }
  const next = f.repl ? cur.replace(f.repl[0], f.repl[1]) : f.next
  if (next === cur) { console.log(`  · ${f.label} 已是目标值，幂等跳过`); continue }
  plan.push({ id: rows[0].id, ...f, cur, next })
  console.log(`  ✓ ${f.label}`)
  console.log(`      现值：${JSON.stringify(cur.length > 90 ? cur.slice(0, 90) + '…' : cur)}`)
  console.log(`      → 改：${JSON.stringify(next.length > 90 ? next.slice(0, 90) + '…' : next)}`)
  console.log(`      依据：${f.ev}`)
}
console.log()
console.log(`共 ${plan.length} 条待改（${FIXES.length} 条裁定表中 ${FIXES.length - plan.length} 条无需动作）`)
console.log()

if (!APPLY) { console.log('预演结束，未改库。加 --apply 执行。'); await pool.end(); process.exit(0) }

// ── 备份 ──
const dir = resolve(__dirname, '..', 'backups')
fs.mkdirSync(dir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
const bf = resolve(dir, `worksheet-83cf0c4b-before-repair3-${stamp}.json`)
fs.writeFileSync(bf, JSON.stringify({ units, answers: all }, null, 1), 'utf8')
console.log(`备份 → ${bf}`)

const client = await pool.connect()
try {
  await client.query('BEGIN')
  for (const p of plan) {
    await client.query(`UPDATE resource_answers SET answer = $2 WHERE id = $1::uuid`, [p.id, p.next])
  }
  console.log(`① 已修正 ${plan.length} 条答案`)
  const cnt = await client.query(
    `UPDATE worksheets w SET answer_count = (SELECT count(*) FROM resource_answers WHERE resource_id = w.id),
            parse_status = 'done', parse_warning = NULL, parse_error = NULL
     WHERE w.id = $1::uuid RETURNING answer_count, parse_status, parse_warning`, [WS])
  console.log(`② 已同步 worksheet：${JSON.stringify(cnt.rows[0])}`)
  await client.query('COMMIT')
  console.log('\n✅ 修复完成')
} catch (e) {
  await client.query('ROLLBACK')
  console.error('\n❌ 失败已回滚：', e.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
