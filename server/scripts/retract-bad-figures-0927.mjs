/**
 * 撤回带缺陷的重绘产物（2026-09-27 视觉评审结论落地）。
 *
 * 背景：229 道引图错题的「当前展示图 vs 原始裁片」全量视觉评审发现 30 道内联 SVG 有缺陷：
 *   - R1（17 道）：SVG 带模型幻觉标签（X_pos/Y_pos/P1_L/p_0…）或丢关键标注，但同一题的
 *     clean_geometry_image_url 是另一套渲染，已逐张目检确认正确 —— 只清内联 SVG，
 *     前端 getGeometryDisplayUrl 自动落到 clean URL（type='clean'）。
 *   - R2（13 道）：SVG 与 URL 都不可用（标签错位/两三角形比例颠倒/数轴D点数值画错/
 *     多面板选项图只画一个面板/丢曲线/丢题干必须的尺寸标注）—— 清 SVG + URL，
 *     回退原始裁片（原图永远正确，宁可少显示也不显示错图）。
 *
 * 安全性：30 道的资产 last_error 均不含「无可重绘的几何结构」，回退不会命中
 * 「仅剩原始裁片」展示闸导致 none。幂等：重跑跳过已清空行。
 *
 * 用法：
 *   node server/scripts/retract-bad-figures-0927.mjs            # 预演
 *   node server/scripts/retract-bad-figures-0927.mjs --apply    # 实撤
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import pg from 'pg'

const APPLY = process.argv.includes('--apply')

// R1: URL 已目检正确，只撤内联 SVG
const R1 = [
  '56b77a92', // X_pos/X_neg/Y_pos/Y_neg 调试标签（URL 为干净抛物线+O+A）
  '602d324b', // 调试标签（URL 为抛物线+弦AB+C+O）
  'eb51e564', // 调试标签+丢网格（URL 有虚线网格+抛物线+A+O）
  'b9550fe9', // P1_L/P1_R… 调试标签（URL 为三线+截线+A D H B E F C）
  'cb625fc3', // P4_0_t… 调试标签（URL 为干净积木金字塔）
  '2373ea24', // p_0…p_10 散点化平行四边形（URL 为正规四边形+抛物线）
  '332711ac', // X_1/X_2/Y_1/Y_2 调试标签+正方形比例错（URL 已修正）
  'f5e4d499', // SVG 丢抛物线曲线只剩多边形（URL 有完整抛物线）
  '9c34bed7', // SVG 丢直线与 D E F 标注（URL 齐全）
  '2964cd93', // SVG 丢 D E F 标注（URL 齐全）
  '7d5fda9a', // SVG 画成孤立抛物线，原题为6花瓣图案（URL 正确重绘）
  '29ea1e77', // SVG 丢 -1/1/4 刻度（URL 刻度齐全）
  '73954cd1', // 同上（另一副本）
  '504368f9', // SVG 丢刻度（URL 有 O/1）
  '033d6738', // SVG 丢出口/E F 标注（URL 有 E F 与斜墙)
  '248d6e9b', // SVG 丢尺寸（尺寸在题干文字里，URL 几何正确即可用）
  '8fae272f', // 同上（另一副本）
]
// R2: SVG 与 URL 均不可用，撤到原始裁片
const R2 = [
  'b456c04d', // 反碟长：丢直线 y=½x、L₁/L₂、P Q、第二条抛物线
  '0b31b1fa', // 同上
  'b77fd012', // 城门洞：URL 无坐标系与拱高标注
  '74a4114d', // B/E 标签错挂到 l₁（应在 l₂），A D 丢失
  'fbb823fc', // 两三角形比例颠倒（DE=4,DF=8 的 △DEF 画得比 △ABC 小）
  'b6b1112e', // 数轴 D 画在 4，题干为 5 —— 数值性画错
  '2d0554b8', // 4m/8m 尺寸数字丢失且题干无此数据，图不足以解题
  '9b409c35', // 网格无数字刻度且题干无数据，表达式不可定
  '79741aad', // AD 段上多余圆（疑为角标误画成整圆），易误导
  '1db136a7', // 四选项格点图只画了题图面板，选项图丢失
  '325fd250', // 同上
  '7e185d42', // 同上
  'cceab838', // 同上
]

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

const pick = async (id8) => {
  const rs = await pool.query(
    `SELECT id, clean_geometry_svg IS NOT NULL AS has_svg,
            clean_geometry_image_url IS NOT NULL AND clean_geometry_image_url NOT LIKE '<svg%' AS has_url
       FROM questions WHERE id::text LIKE $1`,
    [id8 + '%'],
  )
  return rs.rows[0] || null
}

let n1 = 0, n2 = 0, skip = 0
for (const [group, ids] of [['R1', R1], ['R2', R2]]) {
  for (const id8 of ids) {
    const row = await pick(id8)
    if (!row) { console.log(`✗ ${id8}: 未找到题行`); skip++; continue }
    if (group === 'R1' && !row.has_svg) { console.log(`↷ ${id8}: SVG 已为空，跳过`); skip++; continue }
    if (group === 'R2' && !row.has_svg && !row.has_url) { console.log(`↷ ${id8}: SVG/URL 均已为空，跳过`); skip++; continue }
    console.log(`${APPLY ? '✔' : '◌'} [${group}] ${row.id} has_svg=${row.has_svg} has_url=${row.has_url}`)
    if (!APPLY) { group === 'R1' ? n1++ : n2++; continue }
    if (group === 'R1') {
      await pool.query(`UPDATE questions SET clean_geometry_svg = NULL, updated_at = NOW() WHERE id = $1`, [row.id])
      await pool.query(`UPDATE question_assets SET clean_geometry_svg = NULL, updated_at = NOW() WHERE question_id = $1 AND asset_type = 'geometry_image'`, [row.id])
      n1++
    } else {
      await pool.query(`UPDATE questions SET clean_geometry_svg = NULL, clean_geometry_image_url = NULL, updated_at = NOW() WHERE id = $1`, [row.id])
      await pool.query(`UPDATE question_assets SET clean_geometry_svg = NULL, updated_at = NOW() WHERE question_id = $1 AND asset_type = 'geometry_image'`, [row.id])
      n2++
    }
  }
}
console.log(`\n${APPLY ? '已执行' : '预演'}：R1 撤SVG ${n1} 道，R2 撤SVG+URL ${n2} 道，跳过 ${skip}`)
await pool.end()
