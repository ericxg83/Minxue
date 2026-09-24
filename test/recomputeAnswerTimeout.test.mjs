/**
 * 回归测试（2026-09-24）：教师工作台「AI 重解析」——超时 与 答案准确性 双口径。
 *
 * ── 事故形态 ──
 * 老师在 PC 批改中心点「AI 重解析」，转圈 150 秒后弹出
 *   「重算超过 150 秒仍未完成（数据库或答案引擎响应过慢），请稍后重试或人工填写答案」
 *
 * ── 根因（等待不可控）──
 * 重解析接口（同步 HTTP，老师点了按钮在等）直接复用了**后台异步批改**口径的
 * generateAnswerForQuestion。该函数在「答案引擎降级」时会并行补采 3 路做投票，
 * 而 429 会把全局 AI 信号量压到并发 1 → 3 路退化成串行 → 单题实测 140–230s
 * （见 worker.js 该处注释），必然撞穿接口的 150s 兜底。
 *
 * ── 修法定调：准确性优先，不是「更快拿到一个答案」──
 * 参考答案必须准确，**不接受弱模型的答案**。弱模型单次采样是掷骰子
 * （实测同题连出 ±5/±10/±10），多路投票只是从若干次随机采样里挑多数派 ——
 * 那仍是「抖出来的答案」，不是「算出来的答案」，当标准答案比留空更危险。
 * ⇒ 重解析走 strictPrimary：**只打主模型，拿不到就失败，绝不降级备用模型**。
 * ⇒ 顺带把等待压回兜底内（不降级 ⇒ 不触发投票，只剩主模型一条链）。
 * ⇒ 「关掉投票以加速」这个后门**必须不存在**，否则就是给降级答案放行。
 *
 * ⚠️ 静态断言的两条铁律（2026-09-23 convert-route 事故教训）：
 *    · 扫违规前必须先剥注释，否则注释里的反例会造成假红、注释里的正例会造成假绿；
 *    · 切路由体必须以「下一个同级 app.<method>(」为界，不能按固定长度或关键字截断。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const serverDir = join(here, '..', 'server')
const read = (p) => readFileSync(join(serverDir, p), 'utf8')

/** 剥掉 // 行注释与 /* *\/ 块注释，避免注释文本污染静态断言 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/.*$/, ''))
    .join('\n')
}

/** 切出某个路由 handler 的源码体：以「下一个同级 app.<method>(」为界 */
function routeBody(src, routeLiteral) {
  const start = src.indexOf(routeLiteral)
  assert.ok(start >= 0, `未找到路由 ${routeLiteral}`)
  const rest = src.slice(start + 1)
  const next = rest.search(/\napp\.(post|get|put|patch|delete|use)\(/)
  const end = next < 0 ? src.length : start + 1 + next
  return stripComments(src.slice(start, end))
}

const aiSrc = stripComments(read('config/ai.js'))
const workerSrc = stripComments(read('worker.js'))
const indexSrc = read('index.js')

// ── ① 答案引擎：严格模式（只打主模型）+ 单次超时可下调 ────────────────────────
assert.ok(
  /strictPrimary\s*=\s*false/.test(aiSrc),
  'callAnswerEngineCompletion 必须支持 strictPrimary（默认 false，异步批改链路不受影响）'
)
assert.ok(
  /breakerOn\s*\|\|\s*!fallback\s*\|\|\s*strictPrimary/.test(aiSrc),
  '严格模式下模型池必须只剩主模型，不得再带 FALLBACK_MODELS'
)
{
  // 严格模式必须在「备用供应商兜底循环」之前就返回，否则仍会掉进 Huihuiyun 等弱模型
  assert.ok(
    /if\s*\(strictPrimary\)\s*\{[\s\S]{0,300}?return\s*\{[^}]*primary-unavailable/.test(aiSrc),
    '严格模式必须在备用供应商循环前 return（provider=primary-unavailable），绝不碰弱模型'
  )
  const guardAt = aiSrc.indexOf('if (strictPrimary)')
  const backupAt = aiSrc.indexOf('for (const spec of ANSWER_ENGINE.FALLBACK_VENDORS)')
  assert.ok(guardAt >= 0 && backupAt >= 0 && guardAt < backupAt, '严格模式拦截必须位于备用供应商循环之前')
}
{
  const hits = aiSrc.match(/timeout:\s*timeoutMs\s*\|\|\s*ANSWER_ENGINE\.TIMEOUT_MS/g) || []
  assert.equal(hits.length, 2, `主链 + 备用链共 2 处必须使用 timeoutMs 覆盖，实际 ${hits.length} 处`)
}

// ── ② worker：透传严格模式 / 可关整轮重试 / 后门必须不存在 ────────────────────
assert.ok(
  /async\s*\(\s*questionContent\s*,\s*retryCount\s*=\s*0\s*,\s*opts\s*=\s*\{\}\s*\)/.test(workerSrc),
  'generateAnswerForQuestion 必须接受第三个 opts 参数（默认 {}，保证批改链路零变化）'
)
assert.ok(
  /strictPrimary:\s*opts\.strictPrimary/.test(workerSrc),
  'solveOnce 必须把 opts.strictPrimary 透传给答案引擎'
)
assert.ok(
  /timeoutMs:\s*opts\.timeoutMs/.test(workerSrc),
  'solveOnce 必须把 opts.timeoutMs 透传给答案引擎'
)
// ⚠️ 参数名是 `model`，不是 `modelOverride`（2026-09-24 实测踩坑）：
//   写 modelOverride 会被静默忽略 ⇒ 实际打的是全局主模型 deepseek-flash，
//   再配上点名的供应商域名就是 404（"Bailian:deepseek-flash 404 Model not exist"），
//   10 道题全白跑，且现象看起来像「模型没权限」而不是「参数名写错」，极难定位。
assert.ok(
  /model:\s*opts\.modelOverride/.test(workerSrc),
  '点名模型必须传 `model`（引擎只认这个键名）'
)
assert.equal(
  /modelOverride:\s*opts\.modelOverride/.test(workerSrc),
  false,
  '不得写成 modelOverride: opts.modelOverride —— 该键不存在，引擎收到 undefined 会静默退回全局主模型'
)
assert.ok(
  /vendorOverride:\s*opts\.vendorOverride/.test(workerSrc),
  'solveOnce 必须把 opts.vendorOverride 透传（只换 model 换不了供应商 → 跨供应商 404）'
)
assert.ok(
  /opts\.maxRetries\s*\?\?\s*AI_CONFIG\.MAX_RETRIES/.test(workerSrc),
  'maxRetries 必须用 ?? 兜底（用 || 会把合法的 0 翻成 MAX_RETRIES，超时预算被重试吃光）'
)
assert.ok(
  /generateAnswerForQuestion\(questionContent,\s*retryCount\s*\+\s*1,\s*opts\)/.test(workerSrc),
  '网络重试这一跳必须透传 opts，否则重试时丢失严格模式'
)
// 后门：不得存在「关掉补采投票」的开关 —— 那等于给弱模型的单次随机采样放行
assert.equal(
  /opts\.consensus/.test(workerSrc),
  false,
  '不得提供 opts.consensus 开关：降级时关掉投票 = 把弱模型的一次随机采样当标准答案'
)

// ── ③ 批改链路主调用点：不得传 opts（保持原口径）────────────────────────────
{
  const batchCalls = workerSrc.match(/generateAnswerForQuestion\([^)]*\)/g) || []
  const withOpts = batchCalls.filter((c) => /,\s*0\s*,\s*\{|strictPrimary\s*:|consensus\s*:/.test(c))
  assert.equal(
    withOpts.length,
    0,
    `批改链路调用 generateAnswerForQuestion 不得带 opts，否则改动外溢到批改主流程：${withOpts.join(' | ')}`
  )
}

// ── ④ 重解析路由本体 ─────────────────────────────────────────────────────────
const body = routeBody(indexSrc, "app.post('/api/questions/:id/recompute-answer'")

assert.ok(
  /strictPrimary:\s*true/.test(body),
  '重解析必须走严格模式（只打主模型），拿不到就失败，不接受弱模型答案'
)
assert.ok(
  /maxRetries:\s*0/.test(body),
  '重解析必须关闭整轮递归重试（HTTP 层 429 退避保留），否则超时预算被重试吃光'
)
assert.ok(/timeoutMs:\s*ch\.timeoutMs/.test(body), '每级必须用自己那级的超时预算，不能共用一个常量')
{
  // 不硬编码数值，改为断言**不变量**（改预算时不用改测试，但破坏了预算关系会当场红）：
  //   ① 两级串行最坏必须小于接口总兜底；
  //   ② 主链预算不得低于 90s —— 2026-09-24 实测：qwen3.8-flash 单请求（conc=1）
  //      实测出答案耗时 67.2s / 116.7s，批量 p50≈70s、p90≈122s。
  //      原设 45s 依据「正常档 9–13s」是错的（那只是简单题）⇒ 难题会被当场掐断，
  //      再掉回易撞 429 的免费慢通道，**等于主备互换白做**。
  const num = (re) => { const m = body.match(re); return m ? Number(m[1].replace(/_/g, '')) : NaN }
  const primary = num(/ENGINE_TIMEOUT_MS\s*=\s*([\d_]+)/)
  const fallback = num(/SLOW_ENGINE_TIMEOUT_MS\s*=\s*([\d_]+)/)
  const deadline = num(/DEADLINE_MS\s*=\s*([\d_]+)/)
  assert.ok(
    Number.isFinite(primary) && Number.isFinite(fallback) && Number.isFinite(deadline),
    `三个超时常量必须都能解析出来，实际 ${primary}/${fallback}/${deadline}`
  )
  assert.ok(
    primary + fallback < deadline,
    `两级串行最坏 ${primary / 1000}s + ${fallback / 1000}s 必须小于总兜底 ${deadline / 1000}s`
  )
  assert.ok(
    primary >= 90_000,
    `主链预算 ${primary / 1000}s 过小：实测 qwen3.8-flash 单请求出答案最长 116.7s，难题会被掐断`
  )
  assert.ok(
    fallback >= 45_000,
    `备用链预算 ${fallback / 1000}s 过小：kimi-k3 拒绝要约 25–30s、出答案 22–74s，给太短等于没有备用`
  )
}
// 绝不能靠关投票来「加速」——那会给降级答案放行
assert.equal(
  /consensus\s*:\s*false/.test(body),
  false,
  '重解析不得用 consensus:false 换速度：那等于接受弱模型的单次随机采样结果'
)
// 拿不到答案必须如实说明「是刻意不用弱模型」，而不是笼统的「AI 没给出有效答案」
assert.ok(
  /primary-model-unavailable/.test(body),
  '主模型拿不到答案时必须返回 primary-model-unavailable，并说明不会用备用弱模型顶替'
)
assert.ok(
  /empty-input/.test(body),
  '题干为空必须单独识别（那不是引擎忙，重算多少次都没答案），别让老师反复点'
)
// 超时后不得再写库
assert.ok(
  /if\s*\(finished\)\s*\{[\s\S]{0,200}?放弃写库/.test(body),
  '写库前必须拦截已超时的请求：兜底 timer 中断不了在途引擎调用，会导致「老师看到失败、库里却写了答案」'
)
// 参考答案换了，旧风险标注必须清掉/换新
assert.ok(
  /ai_answer_risk_reason\s*=\s*\$4/.test(body),
  '写库必须一并处理 ai_answer_risk_reason，否则重解析成功了页面还挂着「⚠ 参考答案不可信」'
)
assert.ok(
  /isDegradedAnswerEngine\(result\??\.engine,\s*result\??\.expectedProvider\)/.test(body),
  '降级标尺必须用「本次点名的通道」：拿全局主模型当标尺会把一次成功的点名调用误判成降级'
)

// ── ⑤ 换模型：点名实测合格的强模型，deepseek-flash 必须被硬拦 ────────────────
// 依据 `_三模型对比-缺答案求解-20260923.md`：deepseek-flash 可判正确率 33%（+2/10 非 JSON），
// kimi-k3 与 qwen3.8-flash 并列 71%（排除歧义题 100%）。
assert.ok(/RECOMPUTE_CHAIN\s*=\s*\[/.test(body), '重解析必须显式定义通道链，不能沿用全局主模型')
assert.ok(/'qwen3\.8-flash'/.test(body), '重解析首选必须是 qwen3.8-flash（付费快通道）')
assert.ok(/'kimi-k3'/.test(body), '重解析兜底必须是 kimi-k3（免费慢通道）')
{
  // 付费在前、免费在后（2026-09-24 用户拍板反转）：
  // 原顺序「免费在前」是为省额度，但 kimi-k3 作为**同步接口第一级**频繁撞 429，
  // 触发 RETRY_DELAYS_429=[3000,5000] 退避 —— 老师点按钮要白等 8s 才开始算，
  // 之后还要再等它 22–74s，体验不可接受。
  // ⚠️ 429 退避在异步批改链路里无所谓（后台跑），在同步交互里是致命的。
  const kimiAt = body.indexOf("'kimi-k3'")
  const qwenAt = body.indexOf("'qwen3.8-flash'")
  assert.ok(
    kimiAt >= 0 && qwenAt >= 0 && qwenAt < kimiAt,
    'qwen3.8-flash（付费快通道）必须排在 kimi-k3（免费、易撞 429 退避）之前'
  )
}
{
  // 硬闸：deepseek-flash 禁止用于解析答案（用户明确要求记录并拦住）
  assert.ok(
    /RECOMPUTE_BLOCKED_MODELS\s*=\s*\[\s*'deepseek-flash'\s*\]/.test(body),
    '必须显式声明 deepseek-flash 为禁用模型（实测可判正确率仅 33%）'
  )
  assert.ok(/blocked-model-config/.test(body), '命中禁用模型必须报错拒绝执行，绝不静默放行')
  // 链体内不得出现 deepseek-flash（body 已剥注释，不会被注释里的反例污染）
  const chainStart = body.indexOf('RECOMPUTE_CHAIN = [')
  assert.ok(chainStart >= 0, '未找到 RECOMPUTE_CHAIN 定义')
  const chain = body.slice(chainStart, body.indexOf('\n  ]', chainStart) + 4)
  assert.equal(
    /'deepseek-flash'/.test(chain),
    false,
    '通道链内绝不能出现 deepseek-flash：它禁止用于解析答案'
  )
}

// ── ⑥ 「AI 自述不会」不是答案，绝不能写库 ──────────────────────────────────
// 实测（2026-09-24 探针 _diag_recompute_bailian_0924）：kimi-k3 对无图不可判的题
// 会诚实返回「待人工补充」。它非空，能穿过 `!answer.trim()` 检查 ⇒ 一旦写库就成了
// 「标准答案」，再拿它判学生：学生写的 -4 对不上「待人工补充」⇒ 做对的题被判错。
assert.ok(
  /validateAIAnswer\(normalized/.test(body),
  '重解析必须用 validateAIAnswer 校验（与批改链路同口径），「待人工补充」不得当答案'
)
assert.ok(
  /ai-declined/.test(body),
  'AI 自述不会时必须返回 ai-declined：那是终态，别让老师反复重试白烧额度'
)

console.log('✅ recomputeAnswerTimeout: 全部通过（重解析=点名强模型两级链 + deepseek-flash 硬拦 + 批改链路零回归）')
