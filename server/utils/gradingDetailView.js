/**
 * gradingDetailView · 组卷「批改详情」只读视图的纯函数构建器（server 侧唯一口径）
 *
 * 服务对象：移动端 ExamDetailModal 的「查看批改详情」（2026-09-15 P1）。
 * 场景：晚托班老师在手机上看答卷图上每题的勾/叉标注，对照纸质卷讲题。
 *
 * 与 PC 批改页完全同源（不许各判一套）：
 *   · 页图：答卷行（tasks.generated_exam_id = exam.id，按 created_at 升序传入）
 *     行内 images JSONB 展开成全局页序 —— 与 reviewStore.currentPaperPages 的
 *     展开规则一致（多图行 page_number 1..n；无 images 回退行 image_url）。
 *   · 定位框：只认 task.result.retryAlign 的【答卷图坐标系】框；取框优先级 =
 *     text_bbox ∪ image_bbox 并集 → 回退 block_coordinates → 无框不画。
 *     绝不回退题目行自身坐标（那是原作业图，画到答卷图上必然错位）。
 *     旧记录缺 pageNumber 视为该行第 1 页（旧管线只 OCR 首页）。
 *   · 多次交卷 / 分批上传：同一 questionId 后写者覆盖（最新提交为准）。
 *
 * 判定（verdict）不在这里算：由调用方按 classifyQuestionResult（人工复核优先）
 * 传入，本文件只负责几何与对位。
 */

/** 安全解析可能是 JSON 字符串的字段 */
export function parseMaybeJson(v) {
  if (v && typeof v === 'object') return v
  if (typeof v === 'string') {
    try { return JSON.parse(v) } catch { return null }
  }
  return null
}

/** 安全解析 bbox（兼容 string/object 与 left/top 别名，统一 {x,y,width,height}）。
 *  与 PaperViewerPanel.parseBbox 逐字同口径。 */
export function parseBbox(raw) {
  const c = parseMaybeJson(raw)
  if (!c || typeof c !== 'object') return null
  const x = c.x ?? c.left
  const y = c.y ?? c.top
  const w = c.width
  const h = c.height
  if ([x, y, w, h].some(v => typeof v !== 'number' || !isFinite(v))) return null
  if (w <= 0 || h <= 0) return null
  return { x, y, width: w, height: h }
}

/** 两框并集（外接矩形），任一为空返回另一框 —— 与 PaperViewerPanel.unionBbox 同口径 */
export function unionBbox(a, b) {
  if (!a) return b
  if (!b) return a
  const left = Math.min(a.x, b.x)
  const top = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.width, b.x + b.width)
  const bottom = Math.max(a.y + a.height, b.y + b.height)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * 构建「批改详情」视图数据。
 *
 * @param {Array<string>} questionIds 组卷题单（exam.question_ids，输出顺序与之一致）
 * @param {Array<{id:string, images:any, result:any, image_url?:string|null}>} sheetRows
 *        答卷任务行，调用方必须按 created_at 升序传入
 * @param {(questionId: string) => 'correct'|'wrong'|'unjudged'} verdictOf 逐题判定（人工复核优先口径）
 * @returns {{pages: Array<{page:number, imageUrl:string}>,
 *            marks: Array<{questionId:string, label:string, verdict:string,
 *                          matchedBy:string|null, page:number|null,
 *                          bbox:object|null, studentAnswer:string|null}>}}
 */
export function buildGradingDetailView(questionIds, sheetRows, verdictOf) {
  const ids = Array.isArray(questionIds) ? questionIds : []
  const rows = Array.isArray(sheetRows) ? sheetRows : []

  // ── 页图展开：行内 images → 全局页序（1-based），并记录每行跨度
  //      （retryAlign.pageNumber 是行内 1-based，换算全局页号必须用行起始页）──
  const pages = []
  const rowSpans = []
  for (const row of rows) {
    const imgs = parseMaybeJson(row?.images)
    const list = Array.isArray(imgs) && imgs.length > 0 ? imgs : []
    const startPage = pages.length + 1
    let count = 0
    if (list.length > 0) {
      for (const img of list) {
        if (!img?.image_url) continue
        pages.push({ page: pages.length + 1, imageUrl: img.image_url })
        count++
      }
    } else if (row?.image_url) {
      pages.push({ page: pages.length + 1, imageUrl: row.image_url })
      count++
    }
    if (count > 0) rowSpans.push({ taskId: row.id, startPage, count })
  }

  // 行内 pageNumber（1-based）→ 全局页号；越界收敛到该行最后一页（防御脏数据）
  const pageIndexOf = (startPage, count, localPage) =>
    Math.min(Math.max(Number(localPage) || 1, 1), Math.max(count, 1)) + startPage - 1

  const marksByQuestion = new Map()
  for (const span of rowSpans) {
    const row = rows.find(r => r?.id === span.taskId)
    const result = parseMaybeJson(row?.result)
    const aligns = Array.isArray(result?.retryAlign) ? result.retryAlign : []
    for (const r of aligns) {
      if (!r?.questionId) continue
      const page = pageIndexOf(span.startPage, span.count, r.pageNumber)
      // 取框优先级与 PC 完全一致；记录在而框全空 → 不画（绝无回退）
      const bbox = unionBbox(parseBbox(r.text_bbox), parseBbox(r.image_bbox)) || parseBbox(r.block_coordinates)
      marksByQuestion.set(r.questionId, {
        questionId: r.questionId,
        label: r.label != null ? String(r.label) : null,
        matchedBy: r.matchedBy || null,
        page,
        bbox,
        studentAnswer: r.studentAnswer != null ? String(r.studentAnswer) : null,
      })
    }
  }

  // 按题单顺序输出；没对位记录的题也给一条（matchedBy=null → 视图按「无记录」处理）
  const marks = ids.map((qid, idx) => {
    const m = marksByQuestion.get(qid)
    return {
      questionId: qid,
      label: m?.label ?? String(idx + 1),
      verdict: verdictOf(qid) || 'unjudged',
      matchedBy: m?.matchedBy ?? null,
      page: m?.page ?? null,
      bbox: m?.bbox ?? null,
      studentAnswer: m?.studentAnswer ?? null,
    }
  })

  return { pages, marks }
}
