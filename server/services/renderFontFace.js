/**
 * renderFontFace.js — 服务端渲染的「中文字体兜底」注入器
 *
 * ⛔ 背景（2026-10-05 r134 实测，这是家长可见产物的一等缺陷）
 * 服务端 Chromium 用的是 `@sparticuz/chromium`（为 AWS Lambda 打造的 Alpine 精简构建），
 * **容器里一个中文字体都没有**。而模板只写了
 * `font-family:'Microsoft YaHei','PingFang SC','Noto Sans SC',sans-serif` ——
 * 这三个名字在容器里全都不存在，于是中文全部回落到 `sans-serif` ⇒ **渲染成方框（豆腐块）**。
 *
 * 生产实测（POST /api/share-card，学生 虞晨熙）：整张卡的中文——品牌名「敏学成长中心」、
 * 「本周」「完成作业」「批改题量」「新增错题」「已记住」「还在攻克」、老师寄语——**全是空心方框**，
 * 只有数字、百分比、拉丁字母正常。家长拿到的那张图等于一张看不懂的图。
 *
 * 修法：把 Noto Sans SC 按「GB2312 一级字库（3755 常用汉字）+ 中英标点」子集化成
 * woff2（约 500KB）随仓库走，渲染前用 @font-face 内联成 base64 ——
 * `page.setContent()` 没有 base URL，相对路径 `url(./x.woff2)` 解析不到，只有 data URI 有效。
 *
 * ⚠️ 字族名刻意叫 MinxueCJK 并**排在字体栈最后**：
 *    - 排在最后 ⇒ 拉丁数字仍走原来的 sans-serif（桌面端 Microsoft YaHei / 容器内 DejaVu），
 *      **版式与数字观感零变化**，只让容器里没有的中文拿到字形；
 *    - 若把它放前面，数字会变成 Noto Sans SC 的字形，整张卡的排版都要重画。
 *
 * ⚠️ 字体文件缺失时**返回原 html**（退化成今天的方框行为），不抛错 ——
 *    缺一个静态资产不该让转发给家长的卡片接口 500。
 */
import { readFileSync } from 'node:fs'

// ⛔ 字体资产的路径只有 cjkFontState.js 一个出处（r241）：那边的 probeCjkFontAsset()
//    还要给 /api/health 报状态，两边各算一次路径，改了一处忘另一处就是「同一事实两个写法」。
import { CJK_FONT_ASSET_PATH } from '../utils/cjkFontState.js'

const FONT_FILE = 'NotoSansSC-Common.woff2'
const FONT_FAMILY = 'MinxueCJK'
/**
 * 幂等判据用「注入过的标记」，⛔ 不能只判字体栈里有没有 FONT_FAMILY：
 * 模板的 body 本来就写了 'MinxueCJK' 这个名字（见 shareCardTemplate），
 * 只判族名会让第二次调用直接短路、根本不注入 @font-face（r134 自己踩的这个坑）。
 */
const INJECT_MARKER = "@font-face{font-family:'MinxueCJK'"

/** 字体只首次读取，base64 只算一次（卡片一次渲染 ≈ 0.7MB 字符串，别每请求重算） */
let cachedCss = null
let cachedMissing = false

function buildFontFaceCss() {
  if (cachedCss !== null) return cachedCss
  if (cachedMissing) return null
  let bytes
  try {
    bytes = readFileSync(CJK_FONT_ASSET_PATH)
  } catch {
    cachedMissing = true
    console.error(`[renderFontFace] 缺字体资产 ${FONT_FILE}，服务端中文将渲染成方框（退化到 r134 之前的行为）`)
    return null
  }
  // 校验真的还是 woff2（有人误把别的格式丢进来时早发现，别等家长看到豆腐块）
  if (!(bytes.length > 4 && bytes.slice(0, 4).toString('latin1') === 'wOF2')) {
    cachedMissing = true
    console.error(`[renderFontFace] ${FONT_FILE} 不是 woff2（magic=${bytes.slice(0, 4).toString('latin1')}），跳过注入`)
    return null
  }
  const b64 = bytes.toString('base64')
  cachedCss =
    `<style>${INJECT_MARKER};` +
    `src:url(data:font/woff2;base64,${b64}) format('woff2');font-display:block;}</style>`
  return cachedCss
}

/**
 * 给待渲染的 HTML 注入中文字体 @font-face（幂等）
 * @param {string} html
 * @returns {string} 注入后的 html；字体缺失时原样返回
 */
export function withCjkFontFontFace(html) {
  if (!html || typeof html !== 'string' || html.includes(INJECT_MARKER)) return html
  const css = buildFontFaceCss()
  if (!css) return html
  const tagRe = /<head>/i
  return tagRe.test(html) ? html.replace(tagRe, (m) => `${m}${css}`) : `${css}${html}`
}

/** 字族名，给模板写 font-family 栈时用（必须与注入的 @font-face 同名） */
export const CJK_FONT_FAMILY = FONT_FAMILY
