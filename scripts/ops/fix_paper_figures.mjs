/**
 * 试卷题库配图「高清重做」运维工具（2026-11-09 松江一模二次报障沉淀）。
 *
 * 解决的问题：新导入的卷子配图裁片常只有 300~900px 宽，页面按 340 CSS px 显示、
 * 2x 屏需要 680px ⇒ 放大发虚；而存量卷有矢量 SVG / 大裁片，观感差距明显。
 * 本工具把某一份卷的全部配图做**确定性** 3x 高清化后换回 OSS，只改 image_url。
 *
 * ⛔ 不用生成式超分 / AI 重绘：这些图是判题依据（交点、字母、线段位置），
 *    模型会「顺手」把线条画平滑、补粗甚至挪位 = 悄悄改题。
 * ⛔ 白底化阈值必须 >=225（见 enhance_paper_figures.py）：松江卷是浅灰印刷，
 *    照抄 11-06 深墨卷的 150/185 会把坐标轴刻度与顶点字母整片洗白。
 *
 * 用法（三步，工作目录 `_work_figures/<tag>/` 自动创建、被 .gitignore 的 `_*` 规则忽略）：
 *   1) node scripts/ops/fix_paper_figures.mjs --resource=<uuid> --prepare
 *        # 只读：按卷查出所有配图 URL，去重下载到 src/，写 manifest.json
 *   2) python scripts/ops/enhance_paper_figures.py --tag=<tag>
 *        # 生成 enh/*.png + 逐张骨架校验 + 前后对照图；任何一张判红都不许进第 3 步
 *   3) node scripts/ops/fix_paper_figures.mjs --resource=<uuid>        # 预演
 *      node scripts/ops/fix_paper_figures.mjs --resource=<uuid> --apply # 上传 + 按 id 精确写库
 *
 * 参数：--tag=<slug>（默认取 resource id 前 8 位）、--force（已有高清产物仍强制重做）。
 * 写库前逐行备份 `_backup_paper_figures_<tag>.json`，可一键回滚；写后回读 + 逐 URL 复核。
 * 只动 `resource_questions.image_url`，不碰题干 / 答案 / bbox / 解析 / 判题。
 */
import { fileURLToPath } from 'url'
import fs from 'node:fs/promises'
import dotenv from 'dotenv'
dotenv.config({ path: fileURLToPath(new URL('../../server/.env', import.meta.url)) })
import { getPool } from '../../server/config/neon.js'
import { uploadImage } from '../../server/services/ossService.js'
// ⛔ 同进程禁混用两份 sharp：根目录 0.33.5 与 server 0.35.4 会让 .raw() 抛
//    "colourspace: parameter space not set"。读 server 产物一律用 server 那份。
import sharp from '../../server/node_modules/sharp/dist/index.mjs'

const args = process.argv.slice(2)
const arg = (k, d = '') => {
  const hit = args.find(a => a.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3) : d
}
const RES_ID = arg('resource')
const TAG = arg('tag', RES_ID.slice(0, 8))
if (!RES_ID) {
  console.error('用法: node scripts/ops/fix_paper_figures.mjs --resource=<资源id> [--tag=xx] [--prepare|--apply]')
  process.exit(1)
}
const APPLY = args.includes('--apply')
const PREPARE = args.includes('--prepare')
const FORCE = args.includes('--force')
const WORK = `_work_figures/${TAG}`
const SRC = `${WORK}/src`
const ENH = `${WORK}/enh`
const MANIFEST = `${WORK}/manifest.json`
const BACKUP = `_backup_paper_figures_${TAG}.json`
const pool = getPool()

const { rows } = await pool.query(
  `SELECT id, page_no, question_no, sub_no, image_url
     FROM resource_questions
    WHERE resource_id = $1 AND image_url IS NOT NULL AND image_url::text <> ''
    ORDER BY page_no, question_no, sub_no`, [RES_ID])
console.log(`resource=${RES_ID} tag=${TAG} rows with figure=${rows.length}`)

const groups = new Map()
for (const r of rows) {
  const url = String(r.image_url)
  if (!groups.has(url)) groups.set(url, [])
  groups.get(url).push({ id: r.id, page_no: r.page_no, question_no: r.question_no, sub_no: r.sub_no })
}
console.log('unique figure URLs:', groups.size)

// 幂等守卫：已处理过的卷子（产物名带 -hi）不许无声地做第二次 3x（会变 9x 且洗白）
const looksEnhanced = (u) => /-hi\d{3,}|-hi-|-enh-/i.test(u.split('/').pop() || '')
if (PREPARE) {
  const done = [...groups.keys()].filter(looksEnhanced)
  if (done.length && !FORCE) {
    console.error(`⛔ 该卷已有 ${done.length} 张高清产物，重复跑会把图放大到 9 倍。确需重做请加 --force（并先回滚 ${BACKUP}）`)
    await pool.end()
    process.exit(1)
  }
  await fs.mkdir(SRC, { recursive: true })
  const manifest = []
  let i = 0
  for (const [url, rs] of groups) {
    const base = url.split('?')[0].split('/').pop()
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer())
    await fs.writeFile(`${SRC}/${base}`, buf)
    manifest.push({ base, url, rows: rs, srcBytes: buf.length })
    console.log(`  [src] ${String(i++).padStart(2, '0')} ${base} ${buf.length}B rows=${rs.length}`)
  }
  await fs.writeFile(MANIFEST, JSON.stringify({ resourceId: RES_ID, tag: TAG, manifest }, null, 2))
  console.log(`manifest -> ${MANIFEST}；下一步: python scripts/ops/enhance_paper_figures.py --tag=${TAG}`)
  await pool.end()
  process.exit(0)
}

const { manifest } = JSON.parse(await fs.readFile(MANIFEST, 'utf8'))
const backup = []
let uploaded = 0, updated = 0
for (const item of manifest) {
  const stem = item.base.replace(/\.[^.]+$/, '')
  const enhPath = `${ENH}/${stem}.png`
  let buf
  try { buf = await fs.readFile(enhPath) } catch { console.log(`  [败] 缺增强文件 ${enhPath}`); continue }
  const meta = await sharp(buf).metadata()
  console.log(`  ${item.base}: ${item.srcBytes}B -> ${buf.length}B ${meta.width}x${meta.height}, rows=${item.rows.length}`)
  if (!APPLY) continue
  const name = `pbfig-hi-${TAG}-${stem}.png`
  const url = await uploadImage(buf, name, 'paper-bank')
  if (!url) { console.log(`  [败] 上传失败 ${name}`); continue }
  uploaded++
  const ids = item.rows.map(r => r.id)
  // 乐观锁：旧值被并发改过就不覆盖，按 id 精确更新
  const res = await pool.query(
    `UPDATE resource_questions SET image_url = $2
      WHERE id = ANY($1::uuid[]) AND image_url = $3`, [ids, url, item.url])
  if (res.rowCount !== ids.length) console.log(`  ⚠ 更新行数 ${res.rowCount}/${ids.length}（旧值可能被并发改动）`)
  updated += res.rowCount
  for (const r of item.rows) backup.push({ ...r, oldImageUrl: item.url, newImageUrl: url })
}

if (APPLY && backup.length) {
  await fs.writeFile(BACKUP, JSON.stringify({ resourceId: RES_ID, tag: TAG, at: new Date().toISOString(), backup }, null, 2))
  console.log(`\n备份已写 ${BACKUP}（${backup.length} 行）`)

  const { rows: after } = await pool.query(
    `SELECT id, image_url FROM resource_questions WHERE resource_id=$1 AND image_url IS NOT NULL`, [RES_ID])
  let ok = 0, bad = 0
  const seen = new Set()
  for (const r of after) {
    if (seen.has(r.image_url)) { ok++; continue }
    seen.add(r.image_url)
    try {
      const resp = await fetch(String(r.image_url))
      const b = Buffer.from(await resp.arrayBuffer())
      const m = await sharp(b).metadata()
      if (resp.ok && m.width >= 800) ok++
      else { bad++; console.log(`  [验败] ${r.image_url} http=${resp.status} ${m.width}x${m.height}`) }
    } catch (e) { bad++; console.log('  [验败]', String(e.message || e).slice(0, 100)) }
  }
  console.log(`回读复核: ok=${ok} bad=${bad} unique=${seen.size}`)
}
console.log(`\n完成: apply=${APPLY} uploaded=${uploaded} updated=${updated}`)
await pool.end()
