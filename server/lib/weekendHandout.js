/**
 * 周末班错题课件 —— 核心取数 + 聚合逻辑（可调用模块）
 * ================================================================
 * 2026-09-17 从 scripts/weekend-handout.mjs 抽取：CLI 保留（渲染 HTML/JSON/slides），
 * 本模块供 API（preview/generate）复用同一套取数与聚合口径。
 *
 * buildHandout(opts) → {
 *   title, grade, subject, periodLabel, period:{start,end}, withAnswer,
 *   scope, stats, overview, sections, slides, allStudents, studentRows
 * }
 *   - sections: 分节（含 topics，topic 含 多小问完整化/配图/学生明细/难度）
 *   - slides:   slideList（kind=section|question，PPT 渲染输入）
 *
 * 口径要点（与脚本一致，改前必读 memory/topics/wrong-paper-aggregation.md）：
 *   1. 按「日期倒序 → 段内难度由易到难」组织；同题跨学生合并标注「共 N 人错」
 *   2. 多小问（同 task#题号）合并成完整题：parentStem + 全部小问升序 + 整题三段答案
 *   3. 合并走归一化题干精确匹配（normalizeStem），禁止相似度阈值合并
 *   4. 配图默认只用图形裁片（clean_geometry_image_url/geometry_image_url）
 */
import pg from 'pg'
import { normalizeStem } from '../utils/stemNormalize.js'
import { ocrStemKey } from '../utils/ocrStemKey.js'
// blockBoxTrust 的三道闸原先只服务于 resolveWbImage（整题裁片的展示护栏）。
// 整题裁片于 2026-09-21 下线（用户口径：题目一律结构化入库，留痕只用整页原图），
// 课件题图改为「配图（A）优先 → 回退整页原卷图」，不再消费裁片 → 护栏也一并移除。
// 判据本体保留在 utils/blockBoxTrust.js（写入侧 / 其它读取侧仍可能引用）。
import { getCatalogForGrade, resolveChapter } from '../config/textbookCatalog.js'

// ── 常量（渲染端共用，勿改）──
export const TIERS = [
  { key: 'basic', label: '基础', hint: '难度 1-2', desc: '识记 / 简单', match: d => d !== null && d <= 2 },
  { key: 'medium', label: '中等', hint: '难度 3', desc: '常规题', match: d => d === 3 },
  { key: 'hard', label: '较难', hint: '难度 4-5', desc: '综合 / 压轴', match: d => d !== null && d >= 4 },
  { key: 'unknown', label: '难度未判定', hint: 'difficulty IS NULL', desc: '需人工判断', match: d => d === null },
]
export const QTYPE_LABEL = {
  choice: '选择题', fill: '填空题', blank: '填空题', answer: '解答题',
  essay: '解答题', proof: '证明题', drawing: '作图题', composition: '作文',
}
export const ANSWER_SOURCE_LABEL = {
  recognized: '卷面识别', worksheet: '练习册答案库', teacher_input: '教师录入',
  blank: '学生未作答', ai: 'AI 生成', cached: '缓存复用',
  wrong_book: '错题本（自包含）',
}

export function toYmd(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(d)
}

/** 组内难度：取众数；并列取较小值；全空为 null */
export function aggregateDifficulty(vals) {
  const nums = vals.filter(v => v !== null && v !== undefined)
  if (nums.length === 0) return null
  const cnt = new Map()
  for (const n of nums) cnt.set(n, (cnt.get(n) || 0) + 1)
  let best = null, bestN = -1
  for (const [v, n] of [...cnt.entries()].sort((a, b) => a[0] - b[0])) {
    if (n > bestN) { best = v; bestN = n }
  }
  return best
}

function parseOptions(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter(Boolean)
  if (typeof raw === 'string') {
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p.filter(Boolean) : [] } catch { return [] }
  }
  return []
}

/** 取目录节点及其全部后代节点 id（用于「选章包含全部课时」） */
function chapterNodeIds(catalog, nodeId) {
  const ids = new Set([nodeId])
  let changed = true
  while (changed) {
    changed = false
    for (const n of catalog.nodes) {
      if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) {
        ids.add(n.id)
        changed = true
      }
    }
  }
  return ids
}

/**
 * @param {object} opts
 * @param {pg.Pool} opts.pool      数据库连接池（调用方管理生命周期）
 * @param {string} [opts.grade='初三']
 * @param {string} [opts.subject='']
 * @param {number} [opts.days=20]
 * @param {string} [opts.from]      含头（上海时区自然日）
 * @param {string} [opts.to]        含尾（脚本内部 +1 天做不含尾）
 * @param {string[]} [opts.students] 学生姓名过滤（空=该年级全部）
 * @param {number} [opts.maxPerDay=0] 每天最多题数（按难度由易到难）
 * @param {number} [opts.limit=0]    整份课件最多题数
 * @param {number} [opts.mergeThin=0] 题量小于该值的天并入其后第一个足量日
 * @param {boolean} [opts.withAnswer=true]
 * @param {string} [opts.chapter=''] 标准教材章节 id（空=不限）
 * @param {(msg:string)=>void} [opts.logger]
 */
export async function buildHandout(opts) {
  const {
    pool,
    grade = '初三',
    subject = '',
    days = 20,
    from, to,
    students: studentFilter = [],
    maxPerDay = 0,
    limit = 0,
    mergeThin = 0,
    difficulty = '',
    chapter = '',
    withAnswer = true,
    logger = () => {},
  } = opts
  const log = logger
  if (!pool) throw new Error('buildHandout: pool 必传')
  const catalog = getCatalogForGrade(grade)
  const chapterNode = chapter ? catalog?.nodes?.find(n => n.id === chapter) || null : null
  const chapterIds = chapterNode ? chapterNodeIds(catalog, chapterNode.id) : null
  log(`[0] 章节筛选: chapter=${chapter || '(不限)'}${chapterNode ? ` → ${chapterNode.name} (${chapterIds.size} 个节点)` : ''}`)

  // ── 时段：--from/--to 优先，否则最近 --days 天 ──
  const now = new Date()
  let periodStart, periodEnd
  if (from || to) {
    periodStart = new Date(String(from ?? '2000-01-01') + 'T00:00:00+08:00')
    periodEnd = new Date(String(to ?? toYmd(now)) + 'T00:00:00+08:00')
    periodEnd = new Date(periodEnd.getTime() + 24 * 3600 * 1000)
  } else {
    periodEnd = new Date(now.getTime() + 24 * 3600 * 1000)
    periodStart = new Date(periodEnd.getTime() - days * 24 * 3600 * 1000)
  }

  // ── 学生 ──
  const { rows: studentRows } = await pool.query(
    `SELECT id, name FROM students WHERE grade = $1 ORDER BY name`, [grade]
  )
  if (studentRows.length === 0) {
    const { rows: all } = await pool.query(`SELECT DISTINCT grade FROM students ORDER BY 1`)
    throw new Error(`年级「${grade}」下没有学生。库里实际年级值：${all.map(r => r.grade).join(' / ')}`)
  }
  const studentIds = studentFilter.length
    ? studentRows.filter(s => studentFilter.includes(s.name)).map(s => s.id)
    : studentRows.map(s => s.id)
  if (studentIds.length === 0) {
    throw new Error(`学生过滤后没有匹配。可选：${studentRows.map(s => s.name).join(', ')}`)
  }
  log(`[1] 参数 OK: grade=${grade} subject=${subject || '(不过滤)'} 时段=${toYmd(periodStart)}~${toYmd(periodEnd)} studentIds=${studentIds.length}`)

  // ── 取数 ──
  const params = [studentIds, periodStart, periodEnd]
  let subjectClause = ''
  if (subject) {
    params.push(subject)
    subjectClause = ` AND COALESCE(NULLIF(q.subject,''), NULLIF(wq.subject,''), t.subject) = $${params.length}`
  }

  const { rows } = await pool.query(
    `SELECT
       wq.id AS wq_id, wq.student_id, wq.question_id, wq.added_at, wq.error_count,
       wq.lifecycle_status, wq.is_blank, wq.error_type, wq.error_reason,
       wq.student_answer AS wq_student_answer, wq.correct_answer AS wq_correct_answer,
       wq.content AS wq_content,
       wq.question_no, wq.page_number AS wq_page_number,
       wq.block_coordinates AS wq_block_coordinates,
       wq.source_type, wq.last_wrong_task_id, wq.worksheet_id,
       s.name AS student_name,
       q.id AS q_id, q.content, q.answer AS q_answer, q.options,
       q.question_type AS q_qtype, q.answer_source, q.subject AS q_subject,
       q.difficulty, q.question_number, q.page_number AS q_page_number, q.task_id AS q_task_id,
       q.geometry_image_url, q.clean_geometry_image_url, q.image_url AS q_image_url,
       q.parent_stem, q.sub_no, q.ai_answer_risk_reason, q.ai_tags, q.analysis,
       q.answer_exception, q.review_status, q.is_complete,
       t.images AS task_images, t.subject AS t_subject, t.original_name AS task_name,
       tq.images AS qtask_images
     FROM wrong_questions wq
     JOIN students s ON s.id = wq.student_id
     LEFT JOIN questions q ON q.id = wq.question_id
     LEFT JOIN tasks t ON t.id = wq.last_wrong_task_id
     -- 题目自身所属的卷（原作业/练习册）：wq.last_wrong_task_id 有存量空值时
     -- 原卷图回退到它，见 resolveDocImage
     LEFT JOIN tasks tq ON tq.id = q.task_id
     WHERE wq.student_id = ANY($1::uuid[])
       AND wq.added_at >= $2 AND wq.added_at < $3
       AND COALESCE(wq.lifecycle_status, 'new') <> 'mastered'
       ${subjectClause}
     ORDER BY wq.added_at DESC`,
    params
  )
  const tasksById = new Map()
  {
    const taskIds = [...new Set(rows.map(r => r.last_wrong_task_id || r.q_task_id).filter(Boolean))]
    if (taskIds.length) {
      const { rows: taskRows } = await pool.query(
        `SELECT id, original_name, result FROM tasks WHERE id = ANY($1::uuid[])`,
        [taskIds]
      )
      for (const t of taskRows) tasksById.set(t.id, t)
    }
  }

  // ── 错题行章节归属（读侧，不写 questions/wrong_questions）──
  // 章节名只取标准教材目录；OCR/任务名里的 unit_key 仅用于映射到标准节点。
  const chapterByTaskPage = new Map()  // `${taskId}|${page}` → chapterId
  for (const r of rows) {
    const taskId = r.last_wrong_task_id || r.q_task_id
    const page = r.wq_page_number ?? r.q_page_number ?? null
    if (!taskId || page == null) continue
    const key = `${taskId}|${page}`
    if (chapterByTaskPage.has(key)) continue
    const task = tasksById.get(taskId)
    const pageMeta = task?.result?.sectionMatch?.pages?.find(p => Number(p.page_number) === Number(page))
    const unitKey = pageMeta?.matched_unit || null
    const unitTitle = pageMeta?.section_title || null
    const node = unitKey ? resolveChapter(grade, unitKey, unitTitle, task?.original_name || '') : null
    if (node) chapterByTaskPage.set(key, node.id)
  }
  function chapterOfRow(r) {
    const taskId = r.last_wrong_task_id || r.q_task_id
    const page = r.wq_page_number ?? r.q_page_number ?? null
    const key = taskId && page != null ? `${taskId}|${page}` : null
    if (key && chapterByTaskPage.has(key)) return chapterByTaskPage.get(key)
    return resolveChapter(
      grade,
      r.worksheet_id ? String(r.question_no ?? '') : '',
      '',
      r.task_name || ''
    )?.id || null
  }

  // ── 同大题配图索引 ──
  const figureByQGroup = new Map()
  {
    const scopeTaskIds = [...new Set(rows.map(r => r.q_task_id).filter(Boolean))]
    if (scopeTaskIds.length) {
      const { rows: sibRows } = await pool.query(
        `SELECT task_id, question_number, geometry_image_url, clean_geometry_image_url
         FROM questions
         WHERE task_id = ANY($1::uuid[]) AND question_number IS NOT NULL AND deleted_at IS NULL`,
        [scopeTaskIds])
      for (const r of sibRows) {
        const key = `${r.task_id}#${r.question_number}`
        if (figureByQGroup.has(key)) continue
        const f = r.clean_geometry_image_url || r.geometry_image_url
        if (f) figureByQGroup.set(key, f)
      }
    }
    for (const r of rows) {
      const key = r.q_task_id && r.question_number != null ? `${r.q_task_id}#${r.question_number}` : null
      if (!key || figureByQGroup.has(key)) continue
      const f = r.clean_geometry_image_url || r.geometry_image_url
      if (f) figureByQGroup.set(key, f)
    }
    log(`[2b] 同大题配图索引: ${figureByQGroup.size} 组`)
  }

  // ── 整题裁片护栏已移除（2026-09-21）──
  //
  // 这里原有三块索引（[2c] 均分占位页 / [2d] 框压盖页 / resolveWbImage 里的越界框判据），
  // 全部只服务于「把 wrong_questions.question_image_url（整题裁片）当题图展示」这条路。
  // 整题裁片已下线（用户口径：题目一律结构化入库，留痕只用整页原图；课件题图读配图 A），
  // 消费方消失 → 护栏一并移除，不再为一条已下线的路径维护判据。
  // 判据本体保留在 utils/blockBoxTrust.js，写入侧与其它读取侧仍可引用。

  // ── 同卷同题小问索引（多小问完整化）──
  const subRowsByQGroup = new Map()
  {
    const scopeTaskIds = [...new Set(rows.map(r => r.q_task_id).filter(Boolean))]
    if (scopeTaskIds.length) {
      const { rows: subRows } = await pool.query(
        `SELECT task_id, question_number, sub_no, parent_stem, content,
                answer, is_correct, page_number
           FROM questions
          WHERE task_id = ANY($1::uuid[])
            AND question_number IS NOT NULL
            AND deleted_at IS NULL
          ORDER BY question_number, sub_no NULLS FIRST, page_number`,
        [scopeTaskIds])
      for (const r of subRows) {
        const key = `${r.task_id}#${r.question_number}`
        if (!subRowsByQGroup.has(key)) subRowsByQGroup.set(key, [])
        subRowsByQGroup.get(key).push(r)
      }
      log(`[2c] 同卷同题小问索引: ${subRowsByQGroup.size} 组（用于多小问合并成完整题）`)
    }
  }

  log(`[2] 取数 OK: ${rows.length} 条错题`)
  if (rows.length === 0) {
    throw new Error('该时段没有符合条件的错题，未生成课件。')
  }

  // ── 组装 ──
  const MIN_MERGE_KEY_LEN = 12

  /**
   * 跨天/跨桶「完整题干」合并键（2026-09-20 去重修复）。
   *
   * 背景：同一道印刷体题经不同学生 OCR 后，题面常有等效写法差异
   *   —— 平行符号 ∥ / //、乘号 × / x、全半角括号句读、填空线 ______ 有无。
   *   topicKey 只折叠到 ocrStemKey（`_{2,}→_`），「长为_」与「长为」仍不同键，
   *   同卷同题被拆成多条（实测 f8cf5d96 p1n5 / p1n6）；且原二次合并只用
   *   normalizeStem（不折叠 ∥//、不删填空线），同一个坑。这里合成一条更稳的键：
   *   ocrStemKey（OCR 等价折叠）→ normalizeStem（NFKC/LaTeX 间距/标点/破折号）→
   *   去全部下划线（填空线与下标分隔线差异在合并键语境下视为等价；长度闸防误并）。
   * 护栏不变：长度 < MIN_MERGE_KEY_LEN 的短题面不参与合并；不做相似度阈值。
   */
  function mergeKeyOf(t) {
    const raw = `${t.parentStem || ''}|${(t.subParts || []).map(p => `(${p.subNo})${p.content}`).join('')}|${t.content}`
    if (!String(raw).trim()) return ''
    const k = normalizeStem(ocrStemKey(raw)).replace(/_+/g, '')
    return k.length >= MIN_MERGE_KEY_LEN ? k : ''
  }

  /** 两个学生明细并集：同学生累加错次/日期，答案缺位互补 */
  function mergeStudents(dst, src) {
    const out = [...dst]
    for (const st of src) {
      const exist = out.find(x => x.id === st.id)
      if (exist) {
        exist.wrongTimes += st.wrongTimes
        exist.days = [...new Set([...(exist.days || []), ...(st.days || [])])].sort()
        if (!exist.studentAnswer) exist.studentAnswer = st.studentAnswer
      } else {
        out.push(st)
      }
    }
    return out.sort((a, b) => b.wrongTimes - a.wrongTimes || a.name.localeCompare(b.name))
  }

  /**
   * 把 topic t 并入按合并键分组的 map（若命中已有组则合并并返回 true）。
   * 合并键为空（短题面/self 兜底）时退回按原始 topicKey 查找，防止跨天同键覆盖丢学生。
   */
  function mergeTopicInto(map, t, keyOf) {
    const mergedKey = keyOf(t)
    const lookupKey = mergedKey || t.key
    const cur = map.get(lookupKey)
    if (!cur) {
      map.set(lookupKey, { ...t, _day: t._day || '' })
      return false
    }
    cur.students = mergeStudents(cur.students, t.students)
    cur.studentCount = cur.students.length
    cur.rawCount += t.rawCount
    cur.diffValues = [...new Set([...(cur.diffValues || []), ...(t.diffValues || [])])].sort()
    cur.diffInconsistent = cur.diffValues.length >= 2
    if (t._day > cur._day) cur._day = t._day
    log(`   [去重] 完整题干相同合并: ${cur.questionNumber ?? ''} 现 ${cur.studentCount} 人错`)
    return true
  }

  /** 对一组 topic 做「完整题干相同」去重（2026-09-17 二次合并 / 2026-09-20 全局合并共用） */
  function dedupeTopics(topics, keyOf) {
    const completeMap = new Map()
    for (const t of topics) mergeTopicInto(completeMap, t, keyOf)
    return [...completeMap.values()]
  }

  function topicKey(r) {
    // 练习册错题：同一练习册 + 页码 + 题号 + OCR 等价题干指纹。
    // 同一道题在不同学生任务里可能各生成一条 questions 行（question_id 不同），
    // 只按 question_id 分组会把同卷同题拆成多张 slide（线上 42/43、45/46 事故）。
    // 同时不能只用 worksheet+page+question_no 裸合并：OCR 题号/页码不可靠，
    // 同页同题号可能混入完全不同的题（如「AB//CD//EF」与「直线l₁∥l₂∥l₃」）。
    if (r.source_type === 'workbook' && r.worksheet_id && r.question_no != null) {
      const page = r.wq_page_number ?? r.q_page_number ?? null
      const stem = `${r.parent_stem || ''}${r.content || ''}`
      const norm = ocrStemKey(stem)
      if (page != null && norm.length >= MIN_MERGE_KEY_LEN) {
        return 'ws:' + `${r.worksheet_id}|p${page}|n${r.question_no}|s:${norm}`
      }
    }
    const stem = `${r.parent_stem || ''}${r.content || ''}`
    const norm = normalizeStem(stem)
    if (norm.length >= MIN_MERGE_KEY_LEN) return 'topic:' + norm
    const own = r.question_id || `${r.worksheet_id || ''}#${r.question_no ?? ''}#${r.content || ''}`
    return 'self:' + (own || r.wq_id)
  }

  /** 同卷同题小问完整化（多小问 → 完整题干 + 整题答案） */
  function buildCompleteQuestion(members) {
    const rep = members.find(m => m.q_task_id && m.question_number != null) || members[0]
    const gKey = rep.q_task_id && rep.question_number != null
      ? `${rep.q_task_id}#${rep.question_number}`
      : null
    const group = gKey ? (subRowsByQGroup.get(gKey) || null) : null
    if (!group || group.length <= 1) {
      const stem = rep.content || rep.wq_content || rep.wq_correct_answer || ''
      return { stem, parentStem: rep.parent_stem || '', subParts: [], missingSubs: [], answer: '', mergedSubNos: [] }
    }
    const sorted = [...group].sort((a, b) =>
      (a.sub_no ?? '') < (b.sub_no ?? '') ? -1 : (a.sub_no ?? '') > (b.sub_no ?? '') ? 1 : 0)
    const subItems = sorted.filter(x => x.sub_no != null && x.content)
    const wholeItem = sorted.find(x => x.sub_no == null && x.content)
    const parentStem = group.map(x => x.parent_stem).find(Boolean) || ''
    const stripSubPrefix = (subNo, content) => {
      const re = new RegExp(`^\\s*[（(]\\s*${subNo}\\s*[）)]\\s*`)
      return String(content || '').replace(re, '')
    }
    const subParts = subItems.map(x => ({ subNo: x.sub_no, content: stripSubPrefix(x.sub_no, x.content) }))
    let stem
    if (wholeItem) stem = wholeItem.content
    else if (subItems.length > 1) stem = subItems.map(x => `(${x.sub_no})${stripSubPrefix(x.sub_no, x.content)}`).join('')
    else if (subItems.length === 1) stem = subItems[0].content
    else stem = group.map(x => x.content).find(Boolean) || ''
    const answer = group.map(x => x.answer || '').filter(Boolean).sort((a, b) => b.length - a.length)[0] || ''
    const memberSubs = [...new Set(members.map(m => m.sub_no).filter(Boolean))]
    const mergedSubNos = subParts.map(x => String(x.subNo))
    const missingSubs = memberSubs.filter(s => !mergedSubNos.includes(String(s)))
    if (missingSubs.length) {
      log(`   [合并] ${gKey} 缺小问: 组内=${mergedSubNos.join('/') || '整题'} 错题涉及=${missingSubs.join('/')} — 渲染端会标注「见原卷图」`)
    }
    return { stem, parentStem, subParts, missingSubs, answer, mergedSubNos }
  }

  /**
   * 原卷图解析：整页图优先，block 裁片兜底。
   *
   * 2026-09-18 白板第9题事故：白板「原卷图」弹窗标题写的是"学生原卷（整页图）"，
   * 但这里此前把 `question_image_url`（按 block_coordinates 裁的题目区域）排第一，
   * 于是弹窗显示的是裁片。而 block_coordinates 存在系统性漂移（线上实例 9eff748b 第1页
   * 所有题目的 block y 逐题下移约 1~1.5 题，第9题 block 甚至 y+h=1120 越出页面），
   * 裁片指向的往往是邻题区域 —— 用户看到"点开原卷图页不对"。
   *
   * 修复口径：整页图永远正确（页码由 wq/q 的 page_number 定位），裁片只有在没有整页图
   * 时才兜底。老师点"原卷图"看的是学生手写上下文，整页比错位裁片可用得多。
   *
   * 2026-09-19 二次修复（「就说无原卷图啊」）：存量错题行里 wq.last_wrong_task_id 可能为空
   *   —— 重练卷结算（gradingFinalizer.finalizeGeneratedExamResults）历史上只写
   *   (student_id, question_id, status, lifecycle_status, error_count, practice_count)，
   *   出处列没落；这批行 wq.question_image_url / q.image_url 也基本为空，
   *   于是 docImage 恒为 null，弹窗只剩「无原卷图」。
   *   只用 q.task_id 反查就够：题目行必然知道自己属于哪份卷（tq 别名），
   *   整页图就在 tq.images 里，页码用 q.page_number。
   */
  function resolveDocImage(r) {
    const imgs = Array.isArray(r.task_images) ? r.task_images : []
    const page = r.wq_page_number ?? r.q_page_number ?? null
    const byPage = page == null ? null : imgs.find(i => Number(i?.page_number) === Number(page))
    if (byPage?.image_url) return byPage.image_url
    // [2026-09-21 整题裁片下线] 原先这里还有 `if (r.question_image_url) return r.question_image_url`
    // 作为「原卷图」回退，但 question_image_url 是学生卷面上按 block_coordinates 裁的**整题裁片**，
    // 属「配图 B」，已在写入侧正式下线，且它并不是「留痕用的原始整页图」。
    // 留痕口径：整页原图（tasks.images）优先，缺失时退到题目所属卷的整页图（下方 qImgs）。
    // 详见 _产品评审-练习册管线对齐日常管线-20260921.md 的 P0-6。
    if (r.q_image_url) return r.q_image_url
    const pick = imgs[0]
    if (pick?.image_url) return pick.image_url
    // 末级兜底：wq.last_wrong_task_id 缺失时改用题目所属卷的整页图（同上注释）
    const qImgs = Array.isArray(r.qtask_images) ? r.qtask_images : []
    const qByPage = page == null ? null : qImgs.find(i => Number(i?.page_number) === Number(page))
    if (qByPage?.image_url) return qByPage.image_url
    return qImgs[0]?.image_url || null
  }

  function resolveFigure(r) {
    return r.clean_geometry_image_url || r.geometry_image_url || null
  }

  // ── resolveWbImage 已移除（2026-09-21）──
  //
  // 它返回的是 wrong_questions.question_image_url（学生卷面上按 block_coordinates 裁的
  // **整题裁片**）。用户口径：「题目一律结构化入库；要留痕只需原始图片，不需要这道题的裁片。」
  // 该裁片已于 2026-09-21 在写入侧正式下线（worker.js processWorkbookGrading），
  // 白板题图改为「配图（figure）→ 无配图则不显示」，不再有回退路径。
  // 详见 _产品评审-练习册管线对齐日常管线-20260921.md 的 P0-6。
  // 原卷图另有 resolveDocImage（整页图优先），不受此影响。

  // 按天分桶
  const dayMap = new Map()
  for (const r of rows) {
    const day = toYmd(new Date(r.added_at))
    if (!dayMap.has(day)) dayMap.set(day, [])
    dayMap.get(day).push(r)
  }

  let daysOut = []
  for (const [day, list] of [...dayMap.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
    const dayRows = chapterIds ? list.filter(r => {
      const cid = chapterOfRow(r)
      return cid && chapterIds.has(cid)
    }) : list
    if (dayRows.length === 0) continue
    const topicMap = new Map()
    for (const r of dayRows) {
      const k = topicKey(r)
      if (!topicMap.has(k)) topicMap.set(k, [])
      topicMap.get(k).push(r)
    }
    let topics = []
    for (const [key, members] of topicMap.entries()) {
      const rankPrimary = (a, b) => {
        const score = (x) => (x.content ? 2 : 0) + (x.q_answer ? 2 : 0) + (x.wq_content ? 1 : 0) + (x.parent_stem ? 1 : 0)
        return score(b) - score(a)
      }
      const primary = [...members].sort(rankPrimary)[0]
      const complete = buildCompleteQuestion(members)

      const studentMap = new Map()
      for (const m of members) {
        const cur = studentMap.get(m.student_id)
        const day = toYmd(new Date(m.added_at))
        const item = {
          id: m.student_id,
          name: m.student_name,
          wrongTimes: (cur?.wrongTimes || 0) + 1,
          days: [day],
          difficulty: m.difficulty,
          studentAnswer: m.wq_student_answer,
          errorType: m.error_type || (m.is_blank ? '空题' : null),
          errorReason: m.error_reason,
          docImage: resolveDocImage(m),
          docPage: m.wq_page_number ?? m.q_page_number ?? null,
          isBlank: !!m.is_blank,
        }
        if (cur) {
          cur.wrongTimes = item.wrongTimes
          cur.days = [...new Set([...(cur.days || []), day])].sort()
          cur.studentAnswer = cur.studentAnswer || item.studentAnswer
          cur.docImage = cur.docImage || item.docImage
          cur.isBlank = cur.isBlank && item.isBlank
          if (cur.errorType && item.errorType && cur.errorType !== item.errorType) {
            cur.errorType = `${cur.errorType} / ${item.errorType}`
          } else {
            cur.errorType = cur.errorType || item.errorType
          }
        } else {
          studentMap.set(m.student_id, item)
        }
      }
      const students = [...studentMap.values()].sort((a, b) => b.wrongTimes - a.wrongTimes || a.name.localeCompare(b.name))
      const diffVals = members.map(m => m.difficulty).filter(v => v !== null && v !== undefined)
      const difficulty = aggregateDifficulty(diffVals)
      const diffInconsistent = new Set(diffVals).size >= 2

      const stemText = complete.stem || primary.content || primary.wq_content || primary.wq_correct_answer || ''
      const stemFallback = !primary.content && !primary.wq_content && !!primary.wq_correct_answer
      const ansText = complete.answer || primary.q_answer || primary.wq_correct_answer || ''
      const isMultiSub = complete.subParts.length > 1

      topics.push({
        key,
        questionId: primary.q_id,
        questionNumber: primary.question_number ?? primary.question_no ?? null,
        content: stemText,
        stemIsFallback: stemFallback,
        parentStem: complete.parentStem || primary.parent_stem || '',
        subNo: isMultiSub ? null : (primary.sub_no || null),
        subParts: complete.subParts || [],
        missingSubs: complete.missingSubs || [],
        options: parseOptions(primary.options),
        questionType: primary.q_qtype || '',
        answer: withAnswer ? ansText : '',
        hasAnswer: !!ansText,
        answerSource: primary.answer_source || (primary.q_answer ? null : (ansText ? 'wrong_book' : null)),
        answerRisk: primary.ai_answer_risk_reason || null,
        analysis: withAnswer ? (primary.analysis || '') : '',
        figure: (() => {
          const own = resolveFigure(primary) || members.map(resolveFigure).find(Boolean)
          if (own) return own
          const sibKey = primary.q_task_id && primary.question_number != null
            ? `${primary.q_task_id}#${primary.question_number}` : null
          return (sibKey && figureByQGroup.get(sibKey)) || null
        })(),
        // wbImage（整题裁片）已于 2026-09-21 下线，不再产出。见 resolveWbImage 处的说明。
        students,
        studentCount: students.length,
        rawCount: members.length,
        difficulty,
        diffInconsistent,
        diffValues: [...new Set(diffVals)].sort(),
        sourceTypes: [...new Set(members.map(m => m.source_type).filter(Boolean))],
        chapterId: chapterOfRow(primary) || null,
        chapterName: catalog?.nodes?.find(n => n.id === chapterOfRow(primary))?.name || null,
        chapterTrust: chapterOfRow(primary) ? 'mapped' : 'unknown',
      })
    }

    // 二次合并（2026-09-17 产品化发现 / 2026-09-20 键升级）：多小问完整化后，
    // 「完整题干」相同的条目若因错的小问不同或 OCR 题面微差（∥//、填空线有无）
    // 被拆成多条，这里按 mergeKeyOf 合并为一条，学生/错次/日期累加。
    topics = dedupeTopics(topics, mergeKeyOf)

    // 难度筛选（生成参数可选：basic/medium/hard/unknown，空=不限）
    if (difficulty && difficulty !== 'all') {
      topics = topics.filter(t => {
        const k = TIERS.find(x => x.match(t.difficulty))?.key
        return k === difficulty
      })
    }

    const tierIdx = t => TIERS.findIndex(x => x.match(t.difficulty))
    topics.sort((a, b) =>
      tierIdx(a) - tierIdx(b) ||
      (a.difficulty ?? 99) - (b.difficulty ?? 99) ||
      b.studentCount - a.studentCount ||
      String(a.questionNumber ?? '').localeCompare(String(b.questionNumber ?? ''))
    )

    let clipped = 0
    let kept = topics
    if (maxPerDay > 0 && topics.length > maxPerDay) {
      clipped = topics.length - maxPerDay
      kept = topics.slice(0, maxPerDay)
    }

    daysOut.push({
      day,
      topics: kept,
      rawRows: dayRows.length,
      studentCount: new Set(dayRows.map(r => r.student_id)).size,
      studentIds: [...new Set(dayRows.map(r => r.student_id))],
      clipped,
      totalTopics: topics.length,
    })
  }

  // ── 全局跨天去重（2026-09-20 修复：同一道题被多人/多日错，课件里只出现一次）────
  // 用户口径：「两个人共同错一道题，应累计成同一题 '共 N 人错'，而不是拆成两条重复题。」
  // 原实现只在单天桶内二次合并，跨天共错（实测 20 天 17 组）被拆进不同日期节。
  // 做法：全部天的 topic 拉平 → 按 mergeKeyOf 合并（学生/错次/日期累加）→
  //       归到组内**最近错误日期**的节；该节随后重新排序并再次执行 maxPerDay 上限。
  if (daysOut.length > 1) {
    const flat = []
    for (const d of daysOut) {
      for (const t of d.topics) flat.push({ ...t, _day: d.day })
    }
    const merged = dedupeTopics(flat, mergeKeyOf)
    const byDay = new Map()
    for (const t of merged) {
      if (!byDay.has(t._day)) byDay.set(t._day, [])
      byDay.get(t._day).push(t)
    }
    daysOut = daysOut
      .map(d => ({ ...d, topics: byDay.get(d.day) || [] }))
      .filter(d => d.topics.length > 0)
      .map(d => {
        let topics = sortTopics(d.topics)
        let clipped = 0
        if (maxPerDay > 0 && topics.length > maxPerDay) {
          clipped = topics.length - maxPerDay
          topics = topics.slice(0, maxPerDay)
        }
        const studentIds = [...new Set(topics.flatMap(t => t.students.map(st => st.id)))]
        return {
          ...d,
          topics,
          rawRows: topics.reduce((s, t) => s + t.rawCount, 0),
          studentCount: studentIds.length,
          studentIds,
          clipped,
          totalTopics: topics.length,
        }
      })
    if (daysOut.length === 0) throw new Error('该时段没有符合条件的错题，未生成课件。')
    log(`[3] 全局跨天去重: 共错题合并 → ${daysOut.reduce((s, d) => s + d.totalTopics, 0)} 题（归到最近错题日期节）`)
  }

  // ── 薄天合并 ──
  function tierIndexOf(t) { return TIERS.findIndex(x => x.match(t.difficulty)) }
  function sortTopics(list) {
    return [...list].sort((a, b) =>
      tierIndexOf(a) - tierIndexOf(b) ||
      (a.difficulty ?? 99) - (b.difficulty ?? 99) ||
      b.studentCount - a.studentCount ||
      String(a.questionNumber ?? '').localeCompare(String(b.questionNumber ?? ''))
    )
  }

  function combineDays(group) {
    const dayLabels = group.map(d => d.day)
    const multi = group.length > 1
    const topics = sortTopics(group.flatMap(d =>
      d.topics.map(t => multi ? { ...t, dayLabel: d.day } : t)))
    const ids = new Set(group.flatMap(d => d.studentIds))
    return {
      day: dayLabels[0],
      dayFrom: dayLabels[dayLabels.length - 1],
      mergedDays: multi ? dayLabels.slice(1) : [],
      topics,
      rawRows: group.reduce((s, d) => s + d.rawRows, 0),
      studentCount: ids.size,
      studentIds: [...ids],
      clipped: group.reduce((s, d) => s + d.clipped, 0),
      totalTopics: group.reduce((s, d) => s + d.totalTopics, 0),
      allDayLabels: dayLabels,
    }
  }

  let sections = daysOut.map(d => combineDays([d]))
  if (mergeThin > 0) {
    const out = []
    let pending = []
    for (const d of daysOut) {
      if (d.totalTopics < mergeThin) { pending.push(d); continue }
      out.push(combineDays([...pending, d]))
      pending = []
    }
    if (pending.length) out.push(combineDays(pending))
    sections = out
  }

  // ── 总题数上限 ──
  let limitDropped = 0
  if (limit > 0 && sections.reduce((s, d) => s + d.topics.length, 0) > limit) {
    let left = limit
    const kept = []
    for (const s of sections) {
      if (left <= 0) { limitDropped += s.topics.length; continue }
      const topics = s.topics.slice(0, left)
      limitDropped += s.topics.length - topics.length
      left -= topics.length
      kept.push({ ...s, topics })
    }
    sections = kept.filter(s => s.topics.length > 0)
  }

  // ── 汇总 ──
  const totalTopics = sections.reduce((s, d) => s + d.topics.length, 0)
  const scopedRows = chapterIds ? rows.filter(r => {
    const cid = chapterOfRow(r)
    return cid && chapterIds.has(cid)
  }) : rows
  const totalRows = sections.reduce((s, d) => s + d.rawRows, 0)
  const allStudents = [...new Map(scopedRows.map(r => [r.student_id, r.student_name])).values()]
  const unknownSubject = scopedRows.filter(r => !r.q_subject && !r.t_subject).length
  const chapterBuckets = new Map()
  for (const r of scopedRows) {
    const cid = chapterOfRow(r) || '__unknown__'
    if (!chapterBuckets.has(cid)) chapterBuckets.set(cid, [])
    chapterBuckets.get(cid).push(r)
  }
  const chapterSummary = [...chapterBuckets.entries()]
    .map(([id, list]) => ({
      id: id === '__unknown__' ? null : id,
      name: id === '__unknown__'
        ? '未识别章节'
        : (catalog?.nodes?.find(n => n.id === id)?.name || id),
      rows: list.length,
      students: new Set(list.map(r => r.student_id)).size,
    }))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh'))
  const periodLabel = `${toYmd(periodStart)} ~ ${toYmd(new Date(periodEnd.getTime() - 1))}`
  const nameOf = id => studentRows.find(s => s.id === id)?.name || ''

  // ── slides（PPT 渲染输入）──
  const slideList = []
  let seq = 0
  for (const sec of sections) {
    const secLabel = sec.mergedDays.length ? `${sec.dayFrom} ~ ${sec.day}` : sec.day
    slideList.push({
      kind: 'section',
      label: secLabel,
      day: sec.day,
      dayFrom: sec.dayFrom,
      mergedDays: sec.mergedDays || [],
      topicCount: sec.topics.length,
      studentCount: sec.studentCount,
      students: [...new Set(sec.studentIds.map(nameOf).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh')),
      tiers: TIERS.reduce((acc, t) => { acc[t.key] = sec.topics.filter(x => t.match(x.difficulty)).length; return acc }, {}),
    })
    for (const t of sec.topics) {
      const tier = TIERS.find(x => x.match(t.difficulty)) || TIERS[TIERS.length - 1]
      seq++
      slideList.push({
        kind: 'question',
        index: seq,
        sectionLabel: secLabel,
        day: sec.day,
        dayLabel: t.dayLabel || sec.day,
        tier: tier.key,
        tierLabel: tier.label,
        questionNumber: t.questionNumber,
        questionType: t.questionType,
        typeLabel: QTYPE_LABEL[t.questionType] || t.questionType || '',
        difficulty: t.difficulty,
        diffValues: t.diffValues,
        diffInconsistent: t.diffInconsistent,
        studentCount: t.studentCount,
        students: t.students.map(s => ({
          name: s.name, wrongTimes: s.wrongTimes, days: s.days || [], answer: s.studentAnswer,
          errorType: s.errorType, errorReason: s.errorReason, blank: s.isBlank,
          docImage: s.docImage, docPage: s.docPage,
        })),
        parentStem: t.parentStem || '',
        stem: t.content || '',
        stemIsFallback: !!t.stemIsFallback,
        subNo: t.subNo,
        subParts: t.subParts || [],
        missingSubs: t.missingSubs || [],
        options: t.options,
        figure: t.figure || null,
        // wbImage 不再下发（2026-09-21 整题裁片下线）
        answer: t.answer || '',
        hasAnswer: t.hasAnswer,
        answerSource: t.answerSource,
        answerSourceLabel: t.answerSource ? (ANSWER_SOURCE_LABEL[t.answerSource] || t.answerSource) : '',
        answerRisk: t.answerRisk,
        analysis: (t.analysis || '').slice(0, 600),
      })
    }
  }

  return {
    title: `${grade}${subject ? ' · ' + subject : ''} 周末班错题课件`,
    grade,
    subject: subject || null,
    periodLabel,
    period: { start: toYmd(periodStart), end: toYmd(new Date(periodEnd.getTime() - 1)) },
    withAnswer,
    scope: {
      days, from: from || null, to: to || null,
      limit: limit || null, maxPerDay: maxPerDay || null, mergeThin: mergeThin || null,
      students: studentFilter.length ? studentFilter : null,
      chapter: chapterNode?.id || null,
      chapterName: chapterNode?.name || null,
    },
    stats: {
      rawRows: totalRows, topics: totalTopics, questionSlides: seq,
      days: daysOut.length, sections: sections.length,
      students: allStudents.length, studentNames: allStudents,
      limitDropped,
      unknownSubject,
      chapterSummary,
    },
    overview: sections.map(d => ({
      label: d.mergedDays.length ? `${d.dayFrom} ~ ${d.day}` : d.day,
      topics: d.topics.length,
      students: d.studentCount,
      basic: d.topics.filter(t => t.difficulty !== null && t.difficulty <= 2).length,
      medium: d.topics.filter(t => t.difficulty === 3).length,
      hard: d.topics.filter(t => t.difficulty !== null && t.difficulty >= 4).length,
      unknown: d.topics.filter(t => t.difficulty === null).length,
    })),
    sections,
    slides: slideList,
    allStudents,
    studentRows,
  }
}
