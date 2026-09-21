// 批改路线（task_type + worksheet_id / resource_id）改写的唯一判定入口。
//
// 事故背景（2026-09-20）：上传时选了「练习册批改路线」，后来发现这张卷子其实不是
// 那本练习册 —— workbook 管线会拿 A 册的答案库去对 B 卷的题号，整卷错判；
// 更糟的是 workbook 的 OCR 只提「页标题 + 题号 + 手写答案」，题干靠答案库回填，
// 匹配不上就整卷落成「第 N 题」占位符，还会以 source_type='workbook' +
// 错误的 worksheet_id 进错题本（周末课件按 ws:{worksheet_id}|p|n 聚合，脏题会混进
// 那本练习册的题单）。而系统当时没有任何改路线的入口：PUT 只能改 status、
// retry 从 DB 回读原字段重跑同一条管线 ⇒ 重试 N 次都是同一个错。
//
// 口径（禁止各调用方自行拼 UPDATE）：
//   1. 重练卷（generated_exam_id 非空 / task_type ∈ wrong_retry|retry_paper）**禁止转路线**：
//      题目行不属本卷（见 topics/retry-paper-order.md §5.5），转路线会毁掉组卷数据。
//   2. 转 homework：task_type='homework'，worksheet_id **与** resource_id 都置 NULL。
//      ⚠️ 两者必须一起清 —— retryTaskById（index.js）在非 workbook 时会把 worksheet_id
//      兜底填进 resourceId，只清 task_type 会让任务拐进 processAnswerBankGrading，
//      用同一本练习册的 resource_answers 再错一次（这是本文件存在的头号理由）。
//   3. 转 exam：必须显式给 resourceId（答案库资源），否则走不了答案库管线。
//   4. 已经是目标路线且字段一致 → noop，调用方不应入队重跑。

import { isAutoTaskName } from './taskTitle.js'

// homework=日常作业（完整 OCR + AI 判题）；exam=答案库资源；workbook=练习册预埋答案。
// 三者互相可转（老师选错批改方式时纠正），转 workbook 必须显式给 worksheetId。
export const ROUTE_TARGETS = ['homework', 'exam', 'workbook']

// 题目行不归本卷所有的路线：转路线 = 毁数据，一律拒绝。
const BLOCKED_TASK_TYPES = ['wrong_retry', 'retry_paper']

// ── 功能开关（2026-09-21 起默认关闭）───────────────────────────────────
//
// 转路线会 DELETE 该任务的 judgements / wrong_questions / questions，并因 question_assets
// 是 ON DELETE CASCADE 连带删掉已发布几何重绘图 —— 不可逆，且老师误点一次就丢一整份。
// 产品决定先关停观察：前端按钮置灰（apiService.TASK_ROUTE_CONVERT_ENABLED），
// 后端这里同步拦截，避免有人绕过界面直接打接口。
// 重新开放：Render 配环境变量 TASK_ROUTE_CONVERT_ENABLED=1，且前端常量改 true（两端都开才生效）。

/** 转路线功能是否开放（读 env，默认关闭）。 */
export function isRouteConvertEnabled(env = process.env) {
  const v = String(env?.TASK_ROUTE_CONVERT_ENABLED ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

/** 关闭时的统一拒绝理由（接口与日志共用，方便 grep）。 */
export const ROUTE_CONVERT_DISABLED_MESSAGE = '「改批改方式」功能当前关闭（会清空题目/判题/错题，风险较高），如需启用请联系管理员'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const isBlank = (v) => v === null || v === undefined || v === ''

/**
 * 当前路线的人话描述（日志 / 接口返回用）。
 * @returns {'workbook'|'answer_bank'|'slim_retry'|'general'|'unknown'}
 */
export function resolveRouteKind(task) {
  if (!task) return 'unknown'
  // 顺序 = worker 的路由顺序（worker.js processTask）：重练卷 → workbook → 答案库 → general。
  if (task.task_type === 'wrong_retry' || task.task_type === 'retry_paper' || !isBlank(task.generated_exam_id)) {
    return 'slim_retry'
  }
  if (task.task_type === 'workbook') return 'workbook'
  if (!isBlank(task.resource_id)) return 'answer_bank'
  return 'general'
}

/**
 * 计算改路线的字段补丁。
 * @param {{task_type?:string|null, worksheet_id?:string|null, resource_id?:string|null, generated_exam_id?:string|null}} task
 * @param {'homework'|'exam'|'workbook'} target
 * @param {{resourceId?:string|null, worksheetId?:string|null}} [opts]
 * @returns {{ok:boolean, code:string, reason?:string, patch?:{task_type:string, worksheet_id:string|null, resource_id:string|null}, target?:string, from?:object}}
 */
export function planTaskRouteChange(task, target, { resourceId = null, worksheetId = null } = {}) {
  if (!task) return { ok: false, code: 'no_task', reason: '任务不存在' }
  if (!ROUTE_TARGETS.includes(target)) {
    return { ok: false, code: 'bad_target', reason: `目标路线必须是 ${ROUTE_TARGETS.join(' / ')}，实际 ${target}` }
  }

  // ① 重练卷：题目行共用原作业的（wrong_retry / retry_paper / 带 generated_exam_id），
  //    转路线会连带清掉别人的题目行与错题，一律拒绝。
  if (!isBlank(task.generated_exam_id) || BLOCKED_TASK_TYPES.includes(task.task_type)) {
    return {
      ok: false,
      code: 'blocked_retry_paper',
      reason: '错题重练卷不能转路线：题目行不属本卷（共用原作业题目），转路线会毁掉组卷与错题数据',
    }
  }

  // ② 目标补丁。
  //    · 非 workbook 目标：worksheet_id 恒置 NULL（见文件头第 2 条：防 resourceId 兜底再错一次）；
  //    · workbook 目标：必须显式给 worksheetId，resource_id 恒置 NULL。
  let patch
  if (target === 'workbook') {
    if (isBlank(worksheetId) || !UUID_RE.test(String(worksheetId))) {
      return { ok: false, code: 'workbook_needs_worksheet', reason: '转练习册路线必须传合法的 worksheetId（练习册资源 id）' }
    }
    patch = { task_type: 'workbook', worksheet_id: String(worksheetId), resource_id: null }
  } else if (target === 'exam') {
    if (isBlank(resourceId) || !UUID_RE.test(String(resourceId))) {
      return { ok: false, code: 'exam_needs_resource', reason: '转 exam（答案库）路线必须传合法的 resourceId' }
    }
    patch = { task_type: 'exam', worksheet_id: null, resource_id: String(resourceId) }
  } else {
    patch = { task_type: 'homework', worksheet_id: null, resource_id: null }
  }

  // ③ 已经是目标路线 → 不用重跑，避免白删一遍题。
  const same = task.task_type === patch.task_type
    && isBlank(task.worksheet_id) === isBlank(patch.worksheet_id)
    && (isBlank(patch.resource_id) ? isBlank(task.resource_id) : task.resource_id === patch.resource_id)
  if (same) {
    return { ok: false, code: 'noop', reason: `该任务已经是 ${target} 路线，无需转换` }
  }

  return {
    ok: true,
    code: 'ok',
    target,
    from: {
      task_type: task.task_type || null,
      worksheet_id: task.worksheet_id || null,
      resource_id: task.resource_id || null,
    },
    patch,
  }
}

// ── 任务名：转路线后必须还原成"日常作业"口径 ──────────────────────────
//
// workbook 路线下客户端拼的任务名是「科目 · 练习册名」（useUploadFlow.js:633），
// 而通用管线的改名闸 `isAutoTaskName` **默认不认这种名字**（treatClientPaperNameAsAuto
// 只有 workbook 管线传 true，见 worker.js:5262 / 6858）⇒ 不改名就两条后果：
//   ① 任务列表里永远挂着「数学 · 《XX练习册》」，而这份卷根本不是该册的；
//   ② 重跑时卷面 OCR 标题也覆盖不上它（不是自动名）⇒ 老师分不清哪份是哪份。
// 处置：转路线时把它重置成客户端同款自动名「{科目}作业 MM/DD HH:mm」，
// 重跑时由卷面印刷标题按 taskTitle.js 口径改写（校名页眉会被剥掉）。
// 老师手工改过的名字（非自动名）**不动**。

/** 是不是"系统拼的自动名"（含 workbook 的「科目 · 册名」与通用「科目作业 时间」）？ */
export function isRouteAutoName(name) {
  return isAutoTaskName(typeof name === 'string' ? name.trim() : '', { treatClientPaperNameAsAuto: true })
}

/** 这个名字是不是"批改方式给的自动名"（转路线后应当还原）？ */
export function shouldResetTaskName(name) {
  const n = typeof name === 'string' ? name.trim() : ''
  if (!n) return true
  // 只有练习册/答案库路线拼出的「科目 · 册名」才需要还原；
  // 通用自动名「数学作业 09/18 19:44」本来就是目标口径，不动。
  return /\s·\s/.test(n) && isAutoTaskName(n, { treatClientPaperNameAsAuto: true })
}

/**
 * 生成还原用的自动名，与客户端口径一致（GMT+8）。
 * @param {{subject?:string|null, createdAt?:string|Date|null}} [opts]
 */
export function buildAutoTaskName({ subject = null, createdAt = null } = {}) {
  const src = createdAt ? new Date(createdAt) : new Date()
  const t = Number.isNaN(src.getTime()) ? new Date() : src
  // 服务端是 UTC，客户端按北京时间拼 ⇒ 统一 +8h 再取 UTC 字段，避免差 8 小时。
  const bj = new Date(t.getTime() + 8 * 60 * 60 * 1000)
  const pad = (v) => String(v).padStart(2, '0')
  const stamp = `${pad(bj.getUTCMonth() + 1)}/${pad(bj.getUTCDate())} ${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}`
  return `${subject || '数学'}作业 ${stamp}`
}

// ── 转路线的"数据代价"提示（dryRun 与实跑共用，前端原样展示）─────────────
//
// 三个方向代价**不对称**：
//   · 转 homework / exam：只是换一套判题源，题目会被重建但题干仍来自卷面 OCR，
//     信息量只增不减（最多是判题口径变了）；
//   · 转 workbook：**会丢东西** —— workbook 管线的 OCR 只提「页标题 + 题号 + 手写答案」
//     （worker.js:4531），题干由练习册答案库回填（worker.js:5342）。已经识别好的完整
//     题干会被答案库题干替换，题号对不上的题直接落成「第 N 题」占位符。这是不可逆的
//     信息损失，必须让老师在点确认前看到。

/**
 * 列出本次转换会让老师付出的数据代价。
 * @param {{target?:string, questions?:number, placeholderQuestions?:number, workbookAnswerCount?:number|null}} [opts]
 * @returns {string[]} 人话提示（可直接展示给老师）
 */
export function describeRouteRisk({
  target,
  questions = 0,
  placeholderQuestions = 0,
  workbookAnswerCount = null,
} = {}) {
  const out = []
  if (target !== 'workbook') return out

  const withRealStem = Math.max(Number(questions || 0) - Number(placeholderQuestions || 0), 0)
  if (withRealStem > 0) {
    out.push(
      `现有 ${withRealStem} 道已识别的完整题干会被练习册答案库的题干替换：练习册路线只从卷面识别题号与手写答案，题号在答案库里对不上的题会落成「第 N 题」占位符`,
    )
  }
  if (workbookAnswerCount === 0) {
    out.push('这本练习册还没解析出答案（0 条），转换后整卷拿不到参考答案，判题会大面积转人工')
  }
  return out
}
