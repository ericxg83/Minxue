/**
 * iPad 白板书写体验回归锁（2026-10-06）
 *
 * 背景：负责人在 iPad + Apple Pencil 上反馈三个症状 ——
 *   ① 触控笔「有的时候要写 2 次才写到字」；
 *   ② 书写区域老是会移动；
 *   ③ 书写时页面左缘冒出一条「左框」。
 * 三个都不是 iPad/浏览器的问题，是代码缺陷，换浏览器装 App 都救不了。
 *
 * ⛔ 为什么「换浏览器」是死路：iPadOS 上所有浏览器（Safari/Chrome/Edge/Firefox）
 *    被苹果要求走同一套 WebKit 内核（2017 年起，替代引擎仅限欧盟），
 *    下列三条根因全都在 WebKit 层，换壳不改变行为。
 *
 * ① 要写两次 —— DrawingCanvas#onPointerDown 旧判据 `if (e.pointerType === 'pen' &&
 *    (e.buttons & 1) !== 1 && e.button !== 5) { penArmed = true; return }`：
 *    iPadOS 的 WebKit 不保证笔尖刚贴屏那一帧 `buttons` 的笔尖位已置上（常为 0），
 *    于是每一笔的第一下都被当成「误碰笔杆键」而丢弃、不落墨。原先靠
 *    pointermove 补起笔兜底，但手掌搭屏时 Apple Pencil 会被整段吞掉后续事件
 *    （WebKit bug 269535，2024-02 报至今未修，Canva 同样受害），兜底救不回来。
 *    修法：落笔判据加上压感（悬空 pressure 恒 0、贴屏立即 > 0）。
 *    ⛔ 鼠标不能参与 pressure 判据 —— 鼠标按键时 pressure 恒为 0.5，
 *    否则右键/中键会被误判成落笔。
 *
 * ② ③ 漂移 + 左框 —— 画布层 .dc-canvas 早已 touch-action:none，但 touch-action
 *    是**逐元素**判定，iOS 的橡皮筋回弹只认它：祖先链全是 auto 时，笔一落屏
 *    Safari 就认定这是「拖动页面」，把 position:fixed 的白板连整个文档一起
 *    拖走且回弹不到位 —— 书写区漂移（②），页面左缘露出 body 背景即那条
 *    「左框」（③）。修法：把整条祖先链 touch-action/overscroll-behavior 钉死。
 *
 * 反向自检：collectFailures 套在改前那份代码上必须判红，见 _r222_old/。
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

/**
 * 提取一条 CSS 规则的内容（含其后所有声明，直到该规则的闭合大括号）。
 * 不能用「选择器 + 固定长度窗口」那种写法：.board-page 的规则块有 1400+ 字符
 * （投影字号体系那段全在里面），定长窗口会静默截断、把「已修好」判成红灯。
 * 做法：从选择器起点开始按大括号配平。
 */
function cssBlock(src, selector) {
  const start = src.indexOf(selector)
  if (start < 0) return null
  const open = src.indexOf('{', start)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return null
}

export function collectFailures(DC_SRC, WB_SRC, WB_HTML, ROOT_DIR) {
  const fails = []
  const bad = (msg, cond) => { if (!cond) fails.push(msg) }

  // ── ① 落笔判据：必须含压感，且必须有 isPenTipDown 统一实现 ──────────
  bad(
    'DrawingCanvas 必须实现 isPenTipDown（笔尖落笔判据统一走它，避免两处口径漂移）',
    /function\s+isPenTipDown\s*\(/.test(DC_SRC)
  )
  // 判据本体：buttons 笔尖位 或 pen 的 pressure>0
  bad(
    'isPenTipDown 必须认压感：iPadOS 笔尖贴屏那一帧 buttons 常为 0，只看它会丢第一笔',
    /function\s+isPenTipDown\s*\([\s\S]{0,400}?pressure\s*>\s*0/.test(DC_SRC)
  )
  bad(
    'isPenTipDown 必须把 pressure 判据限定在 pointerType === \'pen\'：'
    + '鼠标按键时 pressure 恒为 0.5，不限定会把右键/中键误判成落笔',
    /function\s+isPenTipDown\s*\([\s\S]{0,400}?pointerType\s*!==\s*['"]pen['"][\s\S]{0,200}?return\s+false/.test(DC_SRC)
  )
  // onPointerDown 的笔杆键拦截必须改用新判据
  bad(
    'onPointerDown 的笔杆键待命分支必须用 !isPenTipDown(e)，'
    + '不得再用裸的 (e.buttons & 1) !== 1（那正是丢第一笔的旧实现）',
    /pointerType\s*===\s*['"]pen['"]\s*&&\s*!\s*isPenTipDown\s*\(\s*e\s*\)/.test(DC_SRC)
  )
  bad(
    '不得残留旧的裸判据 `(e.buttons & 1) !== 1 && e.button !== 5`（丢第一笔的元凶）',
    !/\(e\.buttons\s*&\s*1\)\s*!==\s*1\s*&&\s*e\.button\s*!==\s*5/.test(DC_SRC)
  )
  // pointermove 的补起笔兜底必须同判据（两处口径不一致 = 半数 iPad 上仍丢笔）
  bad(
    'onPointerMove 的补起笔兜底也必须用 isPenTipDown(e)，与 onPointerDown 保持同一口径',
    /penArmed[\s\S]{0,200}?pointerType\s*===\s*['"]pen['"][\s\S]{0,80}?isPenTipDown\s*\(\s*e\s*\)/.test(DC_SRC)
  )

  // ── 笔画被截断：pointerleave 不得直接收笔 ───────────────────────────
  bad(
    '画布不得把 @pointerleave 直接绑到 onPointerUp：'
    + 'iOS 上笔尖微抬/悬停就派发 pointerleave，笔画会被从中间截断',
    !/@pointerleave\s*=\s*"onPointerUp"/.test(DC_SRC)
  )
  bad(
    '必须实现独立的 onPointerLeave（笔未抬起时移出边界不算收笔）',
    /function\s+onPointerLeave\s*\(/.test(DC_SRC)
  )
  bad(
    'onPointerLeave 必须在「仍在书写」时直接返回，不得触发收笔',
    /function\s+onPointerLeave\s*\([\s\S]{0,200}?if\s*\(\s*drawing[\s\S]{0,120}?\)\s*return/.test(DC_SRC)
  )

  // ── ② ③ 祖先链 touch-action 钉死（漂移 + 左框）─────────────────────
  // 逐层检查：touch-action 是逐元素判定，链上任何一层漏掉就整条失效。
  for (const [sel, name] of [
    ['.board-page {', '白板根容器'],
    ['.board-main {', '主区'],
    ['.question-wrap {', '题目包裹层'],
  ]) {
    const blk = cssBlock(WB_SRC, sel)
    bad(`${name} ${sel.trim()} 规则必须存在（CSS 结构变了请同步本测试）`, !!blk)
    bad(`${name} ${sel.trim()} 必须设 touch-action: none（iPad 橡皮筋只认逐元素判定，漏一层整条链失效）`,
      !!blk && /touch-action\s*:\s*none/.test(blk))
    bad(`${name} ${sel.trim()} 必须设 overscroll-behavior: none（断掉回弹链，防页面左缘露出 body 背景）`,
      !!blk && /overscroll-behavior\s*:\s*none/.test(blk))
  }
  const immersive = cssBlock(WB_SRC, '.board-page.board-immersive {')
  bad('沉浸模式 .board-immersive（position:fixed 整屏层）规则必须存在（CSS 结构变了请同步本测试）',
    !!immersive)
  bad('沉浸模式 .board-immersive 必须钉死 touch-action（否则 iPad 拖的是整个白板，书写区漂移最明显）',
    !!immersive && /touch-action\s*:\s*none/.test(immersive))
  bad('沉浸模式 .board-immersive 必须钉死 overscroll-behavior（防橡皮筋回弹把整块白板拖出视口）',
    !!immersive && /overscroll-behavior\s*:\s*none/.test(immersive))
  bad(
    '画布容器 .drawing-canvas 也必须设 touch-action: none + overscroll-behavior: none',
    (() => {
      const blk = cssBlock(DC_SRC, '.drawing-canvas {')
      return !!blk && /touch-action\s*:\s*none/.test(blk) && /overscroll-behavior\s*:\s*none/.test(blk)
    })()
  )
  bad(
    '沉浸模式 .board-immersive 是 position:fixed 的整屏层，必须钉死 touch-action '
    + '（否则 iPad 拖动的是整个白板，书写区漂移最明显）',
    /\.board-immersive\s*\{[\s\S]{0,500}?touch-action\s*:\s*none/.test(WB_SRC)
  )

  // ── PWA：iPad「添加到主屏幕」才拿得到全屏 ──────────────────────────
  bad('workbench.html 必须引 manifest（否则装到主屏不是独立窗口，requestFullscreen 在 iOS 必然拿不到）',
    /<link\s+rel="manifest"\s+href="\/manifest\.webmanifest"/.test(WB_HTML))
  bad('workbench.html 必须引 apple-touch-icon（否则主屏图标是网页截图）',
    /<link\s+rel="apple-touch-icon"/.test(WB_HTML))
  bad('manifest 文件必须存在（死链会让 iOS 静默退回浏览器模式）',
    existsSync(join(ROOT_DIR, 'public/manifest.webmanifest')))
  bad('manifest 引用的 192 图标必须真实存在（改前 workbench.html 引的是不存在的文件）',
    existsSync(join(ROOT_DIR, 'public/icon-192x192.png')))
  bad('apple-touch-icon 必须真实存在',
    existsSync(join(ROOT_DIR, 'public/apple-touch-icon.png')))
  if (existsSync(join(ROOT_DIR, 'public/manifest.webmanifest'))) {
    const mf = JSON.parse(read('public/manifest.webmanifest'))
    bad('manifest 的 display 必须是 standalone（否则装到主屏仍有地址栏，无法全屏讲题）',
      mf.display === 'standalone')
    bad('manifest 的 icons 必须覆盖 192 与 512 两档（iOS 按此挑图标）',
      Array.isArray(mf.icons)
      && mf.icons.some((i) => i.sizes === '192x192')
      && mf.icons.some((i) => i.sizes === '512x512'))
    bad('manifest 引用的每个图标文件都必须真实存在',
      Array.isArray(mf.icons) && mf.icons.every((i) => existsSync(join(ROOT_DIR, 'public', i.src.replace(/^\//, '')))))
  }

  return fails
}

const DC_SRC = read('src/workbench/components/DrawingCanvas.vue')
const WB_SRC = read('src/workbench/views/WeekendBoard.vue')
const WB_HTML = read('workbench.html')

test('⛔ iPad 白板书写：落笔判据/防截断/防漂移/PWA 四道闸全过', () => {
  const failures = collectFailures(DC_SRC, WB_SRC, WB_HTML, ROOT)
  assert.deepEqual(failures, [], `\n${failures.length} 处不符：\n` + failures.map((m) => `  - ${m}`).join('\n'))
})
