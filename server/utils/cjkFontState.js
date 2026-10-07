/**
 * cjkFontState.js — 「发给家长的那些图，中文还有没有字形」的唯一判定
 *
 * ⛔ 背景（2026-10-05 r134 实测，这是家长可见产物的一等缺陷）
 * 服务端 Chromium（@sparticuz/chromium，AWS Lambda 风格的 Alpine 精简构建）里**一个中文字体都没有**，
 * 模板写的 Microsoft YaHei / PingFang SC / Noto Sans SC 三个名字在容器里全不存在
 * ⇒ 中文全部回落 sans-serif ⇒ 渲染成**方框（豆腐块）**。家长拿到的是一张看不懂的图。
 * r134 修法：把 Noto Sans SC 子集化成 woff2 随仓库走，渲染前内联 @font-face（`renderFontFace.js`）。
 *
 * ⛔ 本文件存在的理由（2026-10-08 r241 实测）
 * r134 之后**没有任何一处会再问一次「字体还在不在」**：
 *   字体文件被误删 / 部署时资产没带上 / 有人把 woff2 换成了别的格式 ⇒
 *   `renderFontFace.js` 只在**自己那一次**渲染时 `console.error` 一句，然后永远退化成方框，
 *   而**体检不看它**（r198 起体检七项：在在线/速度/数据库/任务/队列/磁盘/代码版本，
 *   没有一项和「家长看到的东西」有关）。
 *   ⇒ 缺口形态和 r221「字段没真读到就明说」完全同款：**有一件事看着在盯，其实一次都没盯过**。
 *
 * 设计：
 *   1) **测量** `probeCjkFontAsset()` —— 只在服务端跑一次，读文件、验 woff2 的 magic，
 *      结果缓存（每请求都读 968KB 没意义；`renderFontFace.js` 早就这么缓存了）。
 *   2) **判定** `resolveCjkFontState(value)` —— 纯函数，吃 `/api/health` 回的那个值，
 *      产出体检那盏灯要的「合格/不合格 + 说人话」。scripts/healthcheck.mjs 直接 import 它，
 *      ⛔ 不许在 healthcheck 里另写一套判定（r221「同一件事只准一个实现」）。
 *   3) 文案只讲**后果 + 下一步**，不甩字段名、不夸大（r198：夸大的告警比没告警更糟）。
 */
import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FONT_FILE = 'NotoSansSC-Common.woff2'
const FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts')
const FONT_ASSET_PATH = path.join(FONT_DIR, FONT_FILE)

/** woff2 的文件头（r134 就校验过一次，别让误替换的格式悄悄混进来） */
const WOFF2_MAGIC = 'wOF2'

/** 测量结果：ok | missing | not-woff2 */
let cachedProbe = null

/**
 * 真的去查一次字体资产在不在（只查一次，结果缓存）。
 * ⛔ 失败也要缓存：每次请求都抛一次 readFileSync 异常会把日志刷爆。
 */
export function probeCjkFontAsset() {
  if (cachedProbe) return cachedProbe
  if (!existsSync(FONT_ASSET_PATH)) {
    cachedProbe = 'missing'
    return cachedProbe
  }
  try {
    const bytes = readFileSync(FONT_ASSET_PATH)
    cachedProbe = bytes.length > 4 && bytes.slice(0, 4).toString('latin1') === WOFF2_MAGIC ? 'ok' : 'not-woff2'
  } catch {
    // ⛔ 核心状态写入禁静默 catch：这里必须能看出「查不了」和「查了是不 ok」是两件事。
    cachedProbe = 'missing'
  }
  return cachedProbe
}

/**
 * 把服务端回报的字体状态，判成体检那一盏灯。
 *
 * @param {string|undefined|null} value `probeCjkFontAsset()` 的值；字段没回时是 undefined
 * @returns {{status:'ok'|'warn', detail:string}}
 */
export function resolveCjkFontState(value) {
  if (value === 'ok') {
    return {
      status: 'ok',
      detail: '中文字形正常，家长拿到的卡片和重练卷上的中文都显示得出来',
    }
  }
  if (value === 'missing' || value === 'not-woff2') {
    return {
      status: 'warn',
      detail: '发给家长的卡片/重练卷上的**中文会全变成方框**（只有数字和英文正常）。' +
        '是渲染用的那个中文字体文件丢了或换格式了，把 server/assets/fonts/ 下的字体文件补回来重启后端就行；' +
        '补回来之前家长收到的图是看不懂的，别当它只是显示小问题。',
    }
  }
  // r221 口径：字段（这一项等于没盯）压根没回 ⇒ 不许悄悄判合格。
  // ⛔ 措辞只说后果和下一步，不甩字段名。
  return {
    status: 'warn',
    detail: '接口没回「字体状态」，这一项等于没盯（体检会一直显示正常，其实是空转）。' +
      '多半是接口结构变了，得有个人去核一下，别当它一直是好的。',
  }
}

export const CJK_FONT_DIR = FONT_DIR
export const CJK_FONT_FILE = FONT_FILE
export const CJK_FONT_ASSET_PATH = FONT_ASSET_PATH
