// 反向自检基线：r237 修复前 `scripts/frontendHealth.mjs` 的旧判据（提案 ㊰ 的那一枚洞）。
//
// ⛔ 为什么这里是「复刻的判据函数」而不是整份旧脚本：旧脚本是**顶层执行**的探针
// （会真的去 fetch 模块链、写日志、可能 process.exit），整份 import 起来会把它当产品跑一遍。
//    所以把那段内联判据抽成纯函数 —— 逐字照抄 `bafbfad:scripts/frontendHealth.mjs:190-201`：
//      if (result.bad.length === 0 && !dom.blank) { status='healthy'; … '首页正常：模块链全 200，DOM 有内容。' }
//    旧版的命门就是 `!dom.blank`：跑 --no-dom 时 dom = {skipped:true} ⇒ blank 为 undefined
//    ⇒ !undefined === true ⇒ **真白屏也判「首页正常」exit 0**。
//
// ⛔ 2026-10-08 r242：这份基线原先靠环境变量 `R237_OLD_SNIPPET` 指向一个「跑完即删」的探针文件，
//    那个文件早就不在 ⇒ 三条反向自检一直 `t.skip`（skip 会被当成"验过"，r215 教训）。
//    ⇒ 改为随仓库入库，三条自检每次真跑。
// ⛔ 也不能存成 `_` 前缀：eslint 的 `**/_*` 会整段忽略它，且会被下轮巡检当"一次性排障产物"删掉。

const HEALTHY_HEADLINE = '首页正常：模块链全 200，DOM 有内容。'

/** 旧判据（逐字抄自 bafbfad:scripts/frontendHealth.mjs，r237 之前的行为） */
export function decideFrontendVerdict(bad, dom) {
  if (bad.length === 0 && !dom.blank) {
    return { status: 'healthy', exitCode: 0, headline: HEALTHY_HEADLINE }
  }
  if (bad.some((b) => b.verdict === 'persistent') || dom.blank) {
    return { status: 'persistent', exitCode: 1, headline: '持续性缺陷：刷新无用，需要修代码。' }
  }
  return {
    status: 'transient-edit',
    exitCode: 2,
    headline: '编辑中间态：刷新页面即可，等这次改动写完。'
  }
}
