/**
 * cert_probe 的「哪些外部外联算脏」唯一判定（r246）
 *
 * 为什么单独成 kit：判据要同时被两处使用 ——
 *   ① `scripts/gate/cert_probe.mjs`（决定退出码）
 *   ② `test/certProbeExternalOrigin.test.mjs`（喂合成请求跑行为）
 * 判据只写在探针里的话，测试就得复制一份逻辑，两边迟早漂移成「假绿」。
 *
 * ⛔ 本文件**刻意放在 `scripts/` 而不是 `scripts/gate/`**：`test/gateBase.test.mjs`（r158）规定
 *   「scripts/gate 下每个 .mjs 都得走 base.mjs 的 BASE 解析」—— 那是给**闸门脚本**定的规矩，
 *   本文件是纯判据、根本不解析 BASE。放进去会让那把锁误判（实测：新加文件当场判红）。
 *   仓内同类 kit 也都放 `scripts/` 根：`backupKit.mjs`、`nightlyAuditVerdict.mjs`、`healthDiskState.mjs`。
 *
 * ⛔ r246 修的是**假红**（不是假绿）：
 *   r224 把判据定成「外部 origin 必须为空」，当时是对的 —— 那时应用不拉任何外部资源。
 *   但 r244 给批改中心加了「试卷首页小图」（学生作业图存 OSS，前端 `<img>` 直拉），
 *   于是 `#/grade` 一渲染就会请求 `minxue-app-oss.oss-cn-shanghai.aliyuncs.com` 的图片
 *   ⇒ 探针**恒定 exit 1**（实测：移动端首页 0 外部请求，只有 `#/grade` 拉 OSS 图片 7 张）。
 *   探针自己的用途写的是「验产物有没有烤入**生产 API base**」—— 图片 CDN 不是 API base，
 *   把它算脏就是判据取错了范围。恒红的闸和恒绿的闸一样坏：没人再看它（r198「常量黄灯」同族）。
 *
 * 新口径（保留 r224 的原意，只把范围收窄到「数据/脚本外联」）：
 *   - 外联请求里**只有图片/字体/媒体** ⇒ 静态资源，正常业务，**不算脏**（但仍然打印出来，不藏）；
 *   - 出现 fetch / xhr / script / websocket … 等**任何非静态类型** ⇒ 算脏（烤入生产 API base 正是这个形态）；
 *   - 类型读不出来 / 是没见过的类型 ⇒ **算脏**（fail-closed：不确定就报，别放过）。
 */

/** 只有这些资源类型算「正常静态资源」。其余一律算脏（含读不出来的）。 */
export const STATIC_ASSET_TYPES = new Set(['image', 'font', 'media'])

/** @param {string} type Playwright 的 resourceType */
export function isStaticAssetRequest(type) {
  return STATIC_ASSET_TYPES.has(String(type || '').toLowerCase())
}

/**
 * 把「本次探针访问过的外部请求」归纳成三份清单。
 *
 * @param {{origin:string,type:string}[]} requests 每次响应记一条（同源的要传进来，由本函数剔除）
 * @param {string} baseOrigin 被审产物的 origin（严格相等比较，⛔ 不用 startsWith —— 端口边界会假同源）
 * @returns {{all:string[], apiLike:string[], staticOnly:string[]}} 三个清单都已去重排序
 */
export function summarizeExternalRequests(requests, baseOrigin) {
  const all = new Set()
  const apiLike = new Set()
  const staticOnly = new Set()
  for (const r of requests || []) {
    const origin = r && r.origin
    if (!origin || origin === baseOrigin) continue
    all.add(origin)
    if (isStaticAssetRequest(r.type)) staticOnly.add(origin)
    else apiLike.add(origin)
  }
  // 同一 origin 既拉图片又发 fetch ⇒ 它是数据外联，不算「仅静态资源」
  for (const o of apiLike) staticOnly.delete(o)
  const asc = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  return {
    all: [...all].sort(asc),
    apiLike: [...apiLike].sort(asc),
    staticOnly: [...staticOnly].sort(asc),
  }
}
