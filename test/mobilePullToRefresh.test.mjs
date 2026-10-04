/**
 * 移动端「原生下拉刷新」回归锁（2026-10-04，移动端赛道 lane-m01，负责人裁决④走 B 路线）
 *
 * 守住的既有事实（回归即判红）：
 *   1. 绝不再走 antd-mobile 的 PullToRefresh —— 它进 manualChunks 的 vendor 块，
 *      历史上触发过分包断裂白屏（docs/auto/lanes.md 接手提示#2）。只允许原生 Touch。
 *   2. 下拉手势只在滚动容器已滚到顶（scrollTop<=0）时接管，否则抢走列表纵向滚动。
 *   3. touchmove 必须 passive:false 原生监听 —— React 合成 touch 在部分 WebView 下
 *      passive，preventDefault 被忽略，原生橡皮筋/父级滚动链会吃掉手势。
 *   4. 位移用 margin-top，不用 transform —— transform 给 position:fixed 后代建参考系，
 *      错题本底部多选栏（fixed，渲染在滚动容器内）会被带偏。
 *   5. 刷新期间必须有并发锁，防止反复下拉重放请求。
 *   6. App.jsx 的唯一滚动容器 <main.overflow-scroll-area> 必须交给 PullToRefresh 接管，
 *      并接上 handlePullRefresh（当前页缓存失效 + 重新拉网络）。
 *
 * 反向自检：harness 套在合成坏样本上必须判红，证明探测器非空锁（不依赖 git）。
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function collectFailures(dir) {
  const file = (rel) => {
    const p = join(dir, rel)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }
  const fails = []

  const ptr = file(join('components', 'PullToRefresh.jsx'))
  if (ptr === null) {
    fails.push('PullToRefresh.jsx 不存在（裁决④原生下拉刷新被删？）')
  } else {
    if (ptr.includes("from 'antd-mobile'")) fails.push('PullToRefresh: 禁止引入 antd-mobile（vendor 分包白屏历史，只允许原生 Touch）')
    if (!/addEventListener\(\s*['"]touchmove['"][^)]*\{[^}]*passive\s*:\s*false/.test(ptr)) {
      fails.push('PullToRefresh: touchmove 必须用原生 addEventListener 且 passive:false（否则 WebView 下 preventDefault 失效）')
    }
    if (!/scrollTop\s*<=\s*0/.test(ptr)) fails.push('PullToRefresh: 必须仅在 scrollTop<=0（已滚到顶）时接管下拉')
    if (/transform\s*:\s*`?\s*translateY/.test(ptr)) fails.push('PullToRefresh: 位移禁用 transform（会给 fixed 后代建参考系，改用 margin-top）')
    if (!/marginTop/.test(ptr)) fails.push('PullToRefresh: 位移必须用 marginTop（避开 fixed 参考系问题）')
    if (!/busyRef/.test(ptr)) fails.push('PullToRefresh: 刷新期间必须有并发锁（busyRef），防反复下拉重放请求')
  }

  const app = file('App.jsx')
  if (app !== null) {
    if (!/<PullToRefresh\b/.test(app)) fails.push('App.jsx: 唯一滚动容器必须交给 <PullToRefresh> 接管')
    if (!/onRefresh=\{handlePullRefresh\}/.test(app)) fails.push('App.jsx: PullToRefresh 必须接上 onRefresh={handlePullRefresh}')
    // main.overflow-scroll-area 应已移入 PullToRefresh，App 不再直接持有裸滚动 main
    if (/<main\s+className=\{?["`]w-full overflow-scroll-area/.test(app)) {
      fails.push('App.jsx: 仍存在裸 <main.overflow-scroll-area>，下拉刷新未接管滚动容器')
    }
    // 下拉刷新必须含「无学生时重取名名单」恢复分支（App 错误文案「下拉可重试」靠它兜底）
    const pr = app.slice(app.indexOf('pullRefreshRef.current'), app.indexOf('const handlePullRefresh'))
    if (pr.length > 0 && !pr.includes('getStudents')) {
      fails.push('App.jsx: 下拉刷新缺「无学生时重取名名单」恢复分支（冷启动失败后下拉重试的兑现）')
    }
  }

  return fails
}

test('⛔ 移动端原生下拉刷新（当前树必须零违规）', () => {
  const failures = collectFailures(join(ROOT, 'src'))
  assert.deepEqual(
    failures,
    [],
    `\n发现 ${failures.length} 处违规：\n` + failures.map((f) => `  - ${f}`).join('\n')
  )
})

test('锁健全性：判据套合成坏样本必须判红（防空锁，不依赖 git 状态）', () => {
  const base = join(ROOT, '_r131q_badlock', 'src')
  rmSync(base, { recursive: true, force: true })
  const put = (rel, content) => {
    const p = join(base, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content, 'utf8')
  }
  // 坏样本：引 antd-mobile + 合成 touch + transform 位移 + 无 scrollTop 门 + 无锁
  put(join('components', 'PullToRefresh.jsx'),
    `import { PullToRefresh } from 'antd-mobile'\nexport default function Ptr(){ return <div style={{ transform: \`translateY(\${pull}px)\` }} /> }`)
  // 坏样本：App 里裸 main 滚动容器、没接 PullToRefresh、且下拉不恢复学生
  put('App.jsx',
    `const pullRefreshRef = useRef(null)\n pullRefreshRef.current = async () => { if (!currentStudent) return; await loadTasks() }\n <main className="w-full overflow-scroll-area" style={{ paddingBottom: '12px' }}>{children}</main>`)

  const probe = collectFailures(base)
  rmSync(base, { recursive: true, force: true })
  // 合成树应命中：禁 antd-mobile / touchmove passive:false / scrollTop<=0 /
  // 禁 transform / 必须 marginTop / 必须 busyRef（PullToRefresh 6 条）+
  // App 必须包 PullToRefresh / App 必须接 onRefresh / App 裸 main 残留 /
  // App 下拉缺学生恢复 = 4 条，共 10 条判据
  assert.equal(probe.length, 10, `合成坏样本应报 10 处违规，实际 ${probe.length}：\n` + probe.map((f) => `  - ${f}`).join('\n'))
})
