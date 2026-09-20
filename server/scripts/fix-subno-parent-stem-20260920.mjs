/**
 * 存量修复：多小问大题「拆行落库时丢 sub_no / parent_stem」（2026-09-20 第19题事故延伸排查）
 *
 * ── 背景 ────────────────────────────────────────────────────────────────
 * 2026-09-01 ~ 09-18，`worker.js` 落库映射漏了 `sub_no` / `parent_stem` 两个字段
 * （见 worker.js 该处注释「2026-09-18 血泪」），模型拆行输出的小问被静默丢弃 →
 * 同一题号落成多条「无小问号、无公共题干」的残句记录。
 * 实测存量：167 个题组 / 484 条记录 / 60 个任务 / 19 名学生，其中 157 条已进错题本。
 * 09-19 起不再产生（代码已修），但存量从未回填。
 *
 * ── 为什么两个字段都要回填 ──────────────────────────────────────────────
 * `server/lib/weekendHandout.js` 的 `buildCompleteQuestion`：
 *   subItems = group.filter(x => x.sub_no != null)   // 全空 → subParts 为空
 *   wholeItem = group.find(x => x.sub_no == null)    // → 只取【第一条】的 content
 * 所以只补 parent_stem 的话，题11 仍只显示「(1)求证：△ABC∽△AEB.」，
 * (2)(3) 依然看不见。必须同时按内容匹配回填 sub_no。
 *
 * ── 做法 ────────────────────────────────────────────────────────────────
 * 对每个受影响任务：下载残题涉及页的整页图 → 走生产 OCR prompt 重识别 →
 * 把 OCR 出的小问（含合并输出的拆分）与库里的残句**按内容匹配**（不依赖题号，
 * 因为题号本身也可能识别错）→ 回填 sub_no + parent_stem。
 *
 * 安全：
 *   · 默认 dry-run；`--apply` 才写库，并落回滚快照。
 *   · 只填空值，绝不覆盖已有 sub_no / parent_stem。
 *   · OCR 若发生降级（usedBackup=true）→ 该页结果标记不可信并跳过，不写库。
 *   · 匹配不上的记录原样保留（宁可不填，不可填错）。
 *
 * 用法：
 *   node scripts/fix-subno-parent-stem-20260920.mjs                      # 全量 dry-run
 *   node scripts/fix-subno-parent-stem-20260920.mjs --limit=3            # 先看前 3 个任务
 *   node scripts/fix-subno-parent-stem-20260920.mjs --task=<taskId>      # 单个任务
 *   node scripts/fix-subno-parent-stem-20260920.mjs --apply --limit=3
 */
import dotenv from 'dotenv'
import fs from 'node:fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../.env') })

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const LIMIT = Number((argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || 0)
const ONLY_TASK = (argv.find(a => a.startsWith('--task=')) || '').split('=')[1] || null
const CONCURRENCY = Number((argv.find(a => a.startsWith('--concurrency=')) || '').split('=')[1] || 2)

const CACHE_DIR = 'D:/Minxue_App_V3/_pageimgs/taskfix'
fs.mkdirSync(CACHE_DIR, { recursive: true })

const { query } = await import('../config/neon.js')
const { buildOCRPrompt, callVisionCompletion } = await import('../config/ai.js')
const sharp = (await import('sharp')).default
const { syncQuestionCompleteness } = await import('../services/questionCompletenessSync.js')

// ── 文本归一化与匹配 ──────────────────────────────────────────────────────

/** 去掉行首的小问标号：「（2）求证：…」→「求证：…」 */
const stripSubPrefix = (s) => String(s || '').replace(/^\s*[（(]\s*\d+\s*[)）]\s*/, '').trim()

/**
 * 归一化：去空白、去标点、**去 LaTeX 标记**、统一全角、统一上下标写法。
 * 去 LaTeX 很关键：库里的 content 常是 `$\frac{x-1}{x}$`，而新 OCR 可能给 `(x-1)/x`，
 * 不去标记则两者永远匹配不上（实测未匹配样本里数学表达式占大头）。
 * 上下标统一同样关键：`x^3` / `x³`、`\sqrt[3]{a}` / `∛a` / `sqrt(a)` 必须归一到同一形态。
 */
const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' }
const FRAC = { '½': '12', '¼': '14', '¾': '34' }

const norm = (s) => String(s || '')
  .replace(/\$/g, '')                    // 行内公式标记（⚠️ 别删：漏了它所有数学题都会匹配失败）
  .replace(/\\sqrt\s*\[[^\]]*\]/g, '')   // \sqrt[3]{a} → {a}，与 ∛a 对齐（必须先于通用命令名剥离）
  .replace(/\\[a-zA-Z]+/g, '')           // \frac \sqrt \le \pm … 命令名
  .replace(/[{}\\]/g, '')                // 花括号 / 残留反斜杠
  .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, c => SUP[c]) // x³ → x3
  .replace(/[½¼¾]/g, c => FRAC[c])       // ½ → 12
  .replace(/[\s\u3000]+/g, '')
  .replace(/[，。；、,;.．：:！？!?（）()【】\[\]"'“”‘’·×÷=≤≥<>＋+－^√∛∜_/|]/g, '')
  .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))

/**
 * 把一段 content 按小问标号拆开。合并输出时（如「(1)…(2)…(3)…」）需要它。
 * @returns {Array<{subNo:string, content:string}>} 拆不出小问时返回空数组
 */
const splitSubQuestions = (content) => {
  const s = String(content || '')
  const re = /[（(]\s*(\d+)\s*[)）]/g
  const hits = [...s.matchAll(re)]
  if (hits.length < 2) return []
  return hits.map((h, i) => {
    const start = h.index + h[0].length
    const end = i + 1 < hits.length ? hits[i + 1].index : s.length
    return { subNo: h[1], content: s.slice(start, end).trim() }
  }).filter(x => x.content)
}

/** 从整页 OCR 结果摊平成小问列表 */
const flattenOcrSubs = (questions) => {
  const out = []
  for (const q of questions) {
    const parts = splitSubQuestions(q.content)
    if (parts.length >= 2) {
      for (const p of parts) {
        out.push({ qno: Number(q.question_number), subNo: p.subNo, content: p.content, parentStem: q.parent_stem || '' })
      }
    } else {
      out.push({
        qno: Number(q.question_number),
        subNo: q.sub_no != null ? String(q.sub_no) : null,
        content: String(q.content || ''),
        parentStem: q.parent_stem || '',
      })
    }
  }
  return out
}

/**
 * 更狠的归一化：只保留 CJK + 字母数字（小写）。
 * 用于跨模型数学符号差异兜底：`√` vs `sqrt`、`·` 有无、`△`/`∠` 丢失等。
 * 阈值必须比 norm 高（≥8），否则「求a，b，c的值」这类短句会互相误配。
 */
const normLoose = (s) => norm(s).replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').toLowerCase()

/**
 * 从残句自身文本取小问号（OCR 内容没匹配上时的兜底）。
 * 只在「整段仅出现一个小问标号」时才认——合并输出的残句（含 (1)(2)(3)）一律拒绝，
 * 避免把一条合并记录误判成某一个小问。
 */
const subNoFromContent = (content) => {
  const s = String(content || '')
  const all = [...s.matchAll(/[（(]\s*(\d+)\s*[)）]/g)]
  if (all.length !== 1) return null
  const m = /^[^（(]{0,12}[（(]\s*(\d+)\s*[)）]/.exec(s)
  return m ? m[1] : null
}

/** 在 OCR 小问里按内容找匹配（1 精确 → 2 包含 → 3 宽松包含） */
const matchSub = (dbContent, ocrSubs) => {
  const key = norm(stripSubPrefix(dbContent))
  if (key.length < 4) return null
  const exact = ocrSubs.find(s => norm(stripSubPrefix(s.content)) === key)
  if (exact) return exact
  const near = ocrSubs.find(s => {
    const k = norm(stripSubPrefix(s.content))
    return k.length >= 6 && (k.includes(key) || key.includes(k))
  })
  if (near) return near
  const lk = normLoose(stripSubPrefix(dbContent))
  if (lk.length >= 8) {
    const loose = ocrSubs.find(s => {
      const k = normLoose(stripSubPrefix(s.content))
      return k.length >= 8 && (k.includes(lk) || lk.includes(k))
    })
    if (loose) return loose
  }
  return null
}

// ── 页图 OCR（带磁盘缓存） ────────────────────────────────────────────────

const ocrPage = async (taskId, pageIdx, imageUrl) => {
  const cacheFile = resolve(CACHE_DIR, `${taskId}_p${pageIdx + 1}.json`)
  if (fs.existsSync(cacheFile)) {
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
  }
  const resp = await fetch(imageUrl)
  if (!resp.ok) throw new Error(`下载页图失败 HTTP ${resp.status}`)
  const raw = Buffer.from(await resp.arrayBuffer())
  const buf = await sharp(raw).rotate().normalize()
    .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 }).toBuffer()
  const res = await callVisionCompletion({
    imageDataURL: 'data:image/jpeg;base64,' + buf.toString('base64'),
    systemPrompt: buildOCRPrompt(),
    userText: '请识别这张作业图片中的所有题目，并返回JSON格式结果。',
    temperature: 0.3,
    maxTokens: 8192,
  })
  const text = String(res.content).replace(/^```json\s*/, '').replace(/```\s*$/, '')
  let parsed
  try { parsed = JSON.parse(text) } catch { throw new Error('OCR 返回非法 JSON') }
  const out = {
    pageIdx,
    vendor: res.vendorName || null,
    usedBackup: !!res.usedBackup,
    questions: Array.isArray(parsed) ? parsed : (parsed.questions || []),
  }
  fs.writeFileSync(cacheFile, JSON.stringify(out, null, 2))
  return out
}

// ── 主流程 ────────────────────────────────────────────────────────────────

/**
 * ⚠️ 分组键必须带 `page_number`。
 * 题号是**按页**编的：同一任务里 p1 的「题2」和 p2 的「题2」往往是两道完全无关的题。
 * 只按 (task_id, question_number) 分组会把它俩当成一道多小问大题，
 * 一旦回填 parent_stem 就是**造假**（实测 167 组里 58 组属此类误判）。
 * 加上 page_number 后：294 组，其中页内 >1 条的 109 组（299 条）才是真候选。
 */
const SUSPECT_GROUPS = `
  WITH g AS (
    SELECT task_id, page_number, question_number FROM questions
    WHERE deleted_at IS NULL AND task_id IS NOT NULL
    GROUP BY task_id, page_number, question_number
    HAVING COUNT(*) > 1 AND COUNT(*) FILTER (WHERE sub_no IS NOT NULL AND btrim(sub_no) <> '') = 0
  )`

let taskRows = (await query(`
  ${SUSPECT_GROUPS}
  SELECT DISTINCT t.id, t.original_name, t.created_at, t.status
  FROM g JOIN tasks t ON t.id = g.task_id
  ORDER BY t.created_at DESC`)).rows
if (ONLY_TASK) taskRows = taskRows.filter(t => t.id === ONLY_TASK)
if (LIMIT > 0) taskRows = taskRows.slice(0, LIMIT)

console.log('='.repeat(78))
console.log(`🔧 存量修复：多小问大题 sub_no / parent_stem 回填   mode=${APPLY ? 'APPLY 写库' : 'DRY-RUN'}  任务数=${taskRows.length}`)
console.log('='.repeat(78))

const snapshot = { ts: new Date().toISOString(), apply: APPLY, tasks: [] }
const stat = { pagesOcr: 0, pagesBackup: 0, groups: 0, filledSub: 0, filledStem: 0, unmatched: 0, skippedBackup: 0, hetero: 0 }
const touchedIds = []

for (const t of taskRows) {
  console.log(`\n${'─'.repeat(78)}\n📄 ${t.original_name}  (${t.id.slice(0, 8)})  ${t.created_at?.toISOString?.().slice(0, 10)}  ${t.status}`)

  const { rows: badRows } = await query(`
    ${SUSPECT_GROUPS}
    SELECT q.id, q.question_number, q.page_number, q.content, q.sub_no, q.parent_stem
    FROM questions q JOIN g ON g.task_id = q.task_id
                        AND g.question_number = q.question_number
                        AND g.page_number IS NOT DISTINCT FROM q.page_number
    WHERE q.task_id = $1 AND q.deleted_at IS NULL
    ORDER BY q.page_number, q.question_number, q.id`, [t.id])
  if (!badRows.length) { console.log('   无残题，跳过'); continue }

  const { rows: taskInfo } = await query(`SELECT images FROM tasks WHERE id = $1`, [t.id])
  let imgs = taskInfo[0]?.images
  if (typeof imgs === 'string') { try { imgs = JSON.parse(imgs) } catch { imgs = [] } }
  if (!Array.isArray(imgs) || !imgs.length) { console.log('   ⚠️ 任务无页图，跳过'); continue }

  // 需要 OCR 的页码：残题 page_number 集合；全为空则整份
  const pagesWanted = [...new Set(badRows.map(r => r.page_number).filter(p => p != null))]
  const pageIdxs = pagesWanted.length ? pagesWanted.map(p => Number(p) - 1) : imgs.map((_, i) => i)

  const ocrSubs = []
  let degraded = false
  for (const pi of pageIdxs) {
    const url = imgs[pi]?.image_url || imgs[pi]
    if (!url) continue
    try {
      const r = await ocrPage(t.id, pi, url)
      stat.pagesOcr++
      if (r.usedBackup) { stat.pagesBackup++; degraded = true }
      ocrSubs.push(...flattenOcrSubs(r.questions))
      console.log(`   p${pi + 1} OCR: ${r.questions.length} 题 → 摊平 ${flattenOcrSubs(r.questions).length} 小问  [${r.vendor}${r.usedBackup ? ' ⚠️降级' : ''}]`)
    } catch (e) {
      console.log(`   p${pi + 1} OCR 失败: ${e.message}`)
      degraded = true
    }
    await new Promise(r => setTimeout(r, 500))
  }
  if (!ocrSubs.length) { console.log('   ⚠️ 未取到 OCR 小问，跳过'); continue }

  const byQno = new Map()
  for (const r of badRows) {
    const k = `${r.page_number}#${r.question_number}`   // 页内分组：题号按页编
    if (!byQno.has(k)) byQno.set(k, [])
    byQno.get(k).push(r)
  }

  for (const [gk, rows] of byQno) {
    const [pg, qno] = gk.split('#')
    stat.groups++
    // 先把组内每条残句都试着匹配一遍
    const matched = rows.map(r => ({ r, m: matchSub(r.content, ocrSubs) }))
    // 「同题一致性」闸：组内匹配到的行若指向**多道不同的 OCR 题**，说明这个「题组」
    // 其实是同页不同大题（如「一、选择题 1.」「二、填空题 1.」）题号撞车，
    // 公共题干不能跨题共用 → 禁用兜底（各行仍可用自己匹配到的题干）。
    const hitQnos = [...new Set(matched.filter(x => x.m).map(x => x.m.qno))]
    const coherent = hitQnos.length <= 1
    if (!coherent) stat.hetero++
    const groupStem = coherent ? (matched.map(x => x.m?.parentStem).find(Boolean) || null) : null

    const updates = []
    for (const { r, m } of matched) {
      const noSub = !r.sub_no || !String(r.sub_no).trim()
      const noStem = !r.parent_stem || !String(r.parent_stem).trim()
      if (!m) {
        // 内容没匹配上 OCR：
        //   ① sub_no 还能从残句自身的小问标号取（只认「整段仅一个小问标号」）
        //   ② parent_stem 是整组共享的，可用组内其它残句匹配到的题干兜底
        stat.unmatched++
        const ownSub = noSub ? subNoFromContent(r.content) : null
        const stemVal = noStem ? groupStem : null
        if (ownSub || stemVal) {
          updates.push({ id: r.id, subNo: ownSub, stem: stemVal, viaGroup: !ownSub })
        } else {
          console.log(`     p${pg} 题${qno} 未匹配: ${JSON.stringify(String(r.content).slice(0, 50))}`)
        }
        continue
      }
      const setSub = noSub && m.subNo
      const stemVal = m.parentStem || groupStem
      const setStem = noStem && stemVal
      if (setSub || setStem) {
        updates.push({ id: r.id, subNo: setSub ? String(m.subNo) : null, stem: setStem ? stemVal : null })
      }
    }
    if (!updates.length) continue
    console.log(`   p${pg} 题${qno}: ${rows.length} 条残句 → 可回填 ${updates.length} 条`)
    console.log(`      parent_stem = ${JSON.stringify(String(groupStem || '').slice(0, 90))}`)
    for (const u of updates) {
      console.log(`        ${u.id.slice(0, 8)} sub_no=${u.subNo || '(保持)'}${u.viaGroup ? '  [组内题干兜底]' : ''}`)
      stat.filledSub += u.subNo ? 1 : 0
      stat.filledStem += u.stem ? 1 : 0
      touchedIds.push(u.id)
    }
    if (APPLY && !degraded) {
      for (const u of updates) {
        await query(
          `UPDATE questions
              SET sub_no = COALESCE(NULLIF(btrim(sub_no),''), $1),
                  parent_stem = COALESCE(NULLIF(btrim(parent_stem),''), $2),
                  updated_at = NOW()
            WHERE id = $3`,
          [u.subNo, u.stem, u.id])
      }
    } else if (APPLY && degraded) {
      stat.skippedBackup += updates.length
    }
  }
  if (APPLY && !degraded) {
    snapshot.tasks.push({ taskId: t.id, name: t.original_name, ids: badRows.map(r => r.id) })
  }
}

if (APPLY && touchedIds.length) {
  await syncQuestionCompleteness([...new Set(touchedIds)])
  const snapPath = resolve(__dirname, `logs/subno-stem-fix-${Date.now()}.json`)
  fs.writeFileSync(snapPath, JSON.stringify(snapshot, null, 2))
  console.log(`\n💾 回滚快照: ${snapPath}`)
}

console.log('\n' + '='.repeat(78))
console.log(`📊 ${APPLY ? '执行完成' : 'DRY-RUN 预览'}`)
console.log(`   OCR 页数 ${stat.pagesOcr}（其中降级 ${stat.pagesBackup} 页）`)
console.log(`   题组 ${stat.groups} · 可回填 sub_no ${stat.filledSub} 条 · parent_stem ${stat.filledStem} 条`)
console.log(`   未匹配 ${stat.unmatched} 条 · 因降级跳过 ${stat.skippedBackup} 条 · 同页题号撞车组 ${stat.hetero} 个`)
console.log('='.repeat(78))
process.exit(0)
