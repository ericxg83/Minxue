/**
 * gen-pending-stem-list.mjs — 生成「仍需人工补录公共条件」清单（只读）
 * 列出 content 以小问标号开头、但 parent_stem 仍为空的题目行，
 * 供老师在错题本/题库编辑页补录，或后续重跑回填。
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import fs from 'node:fs'
import pg from 'pg'
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

const { rows } = await pool.query(`
  SELECT q.task_id, t.original_name, q.page_number, q.question_number AS qno, q.sub_no,
         btrim(coalesce(q.content,'')) AS content, q.block_coordinates,
         (SELECT count(*) FROM wrong_questions wq WHERE wq.question_id = q.id) AS in_wrongbook
  FROM questions q JOIN tasks t ON t.id = q.task_id
  WHERE q.parent_stem IS NULL
    AND btrim(coalesce(q.content,'')) ~ '^[（(]\\s*[0-9１-９一二三四五六七八九]{1,2}\\s*[)）]'
  ORDER BY in_wrongbook DESC, q.task_id, q.page_number, q.question_number
`)

const DEP = /(求|证明|求证|判断|说明|指出|探究|面积|周长|表达式|解析式|顶点|对称轴|抛物线|函数|图像|图象|如图|已知|取值范围|坐标|关系|条件)/
const need = rows.filter(r => DEP.test(r.content.replace(/^[（(]\s*[0-9１-９一二三四五六七八九]{1,2}\s*[)）]/, '')))

const lines = [
  `# 仍需人工补录公共条件的题目清单`,
  ``,
  `- 生成时间：${new Date().toISOString()}`,
  `- 待补总行数：${rows.length}（其中看起来**必须**有公共条件的 ${need.length} 行）`,
  `- 判定：题干以 (1)(2)… 开头但 parent_stem 为空 —— 学生在重练卷上看到的将是半截题`,
  ``,
  `> 处理方式：① 在错题本/题库编辑页手工补公共题干（最快）；`,
  `> ② 或后续等视觉模型配额空闲时重跑 \`node scripts/backfill-parent-stem.mjs --all --apply\`。`,
  ``,
  `## 必补清单（含依赖条件的表述）`,
  ``,
  `| # | 错题本 | 卷 | 页 | 题号 | 现有题干 | 卡点 |`,
  `|---|---|---|---|---|---|---|`
]
need.forEach((r, i) => {
  const box = r.block_coordinates ? `y=${Number(r.block_coordinates.y).toFixed(0)}` : '无框'
  lines.push(`| ${i + 1} | ${r.in_wrongbook > 0 ? '★' : ''} | ${String(r.original_name || r.task_id.slice(0, 8)).slice(0, 26)} | p${r.page_number} | Q${r.qno} | ${String(r.content).slice(0, 60).replace(/\|/g, '\\|')} | ${box} |`)
})
lines.push(``, `## 其余待补行（多为独立小问，可暂不处理）`, ``, `| 卷 | 页 | 题号 | 现有题干 |`, `|---|---|---|---|`)
rows.filter(r => !need.includes(r)).forEach(r => {
  lines.push(`| ${String(r.original_name || r.task_id.slice(0, 8)).slice(0, 26)} | p${r.page_number} | Q${r.qno} | ${String(r.content).slice(0, 60).replace(/\|/g, '\\|')} |`)
})

const out = 'D:/Minxue_App_V3/_stems_pending_manual.md'
fs.writeFileSync(out, lines.join('\n'), 'utf8')
console.log(`清单已生成: ${out}`)
console.log(`待补 ${rows.length} 行，其中必补 ${need.length} 行；错题本关联行 ${rows.filter(r => r.in_wrongbook > 0).length} 行`)
await pool.end()
