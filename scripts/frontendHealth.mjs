#!/usr/bin/env node
/**
 * frontendHealth.mjs —— 前端「白屏/500」一键自证探针
 *
 * 为什么要它（2026-10-04 事故沉淀）：
 *   负责人截图报「移动端首页坏了」，DevTools 里只有一条
 *   `Failed to load resource: the server responded with a status of 500 .../src/app.jsx`。
 *   单看这一条无法区分两种完全不同的成因：
 *     A) 有人正在改App.jsx，Vite 转换到写了一半的中间态 ⇒ 瞬时 500，刷新即好；
 *     B) 代码真的坏了（语法错/依赖断/导出改名）      ⇒ 持续 500，刷新无用。
 *   A 只要刷新，B 刷新多少次都白屏，处置完全相反。
 *
 * 它做什么：
 *   1) 递归请求 /src/ 模块链，列出所有非 200 的模块（含 500 的错误正文片段）。
 *   2) 判据：若失败模块对应的源文件 mtime 在「近 EDIT_WINDOW_MS 内」，
 *      判为 transient-edit（编辑中间态），否则 persistent（真缺陷）。
 *   3) 可选真机冒烟（playwright 读 DOM，⛔ 绝不截图：本机窗口隐藏会必超时）。
 *   4) 追加一行 JSON 到 --log（默认 tmp/health.jsonl）。
 *
 * 退出码（给 CI / 巡检循环用）：
 *   0 = 健康        1 = 持续性缺陷（该修）    2 = 编辑中间态（刷新即可）
 *   3 = 探针自身失败  4 = 白屏这一项等于没盯（没启动浏览器）⛔ 不等于健康
 *
 * 用法：
 *   node scripts/frontendHealth.mjs
 *   node scripts/frontendHealth.mjs --base http://127.0.0.1:3000 --log tmp/health.jsonl
 *   node scripts/frontendHealth.mjs --no-dom            # 只做静态模块链，不启动浏览器
 */
import { appendFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const BASE = argOf('--base', 'http://127.0.0.1:3000').replace(/\/+$/, '');
const LOG = resolve(ROOT, argOf('--log', 'tmp/health.jsonl'));
/**
 * 入口路径可能被 Git Bash 偷改：MSYS 路径转换会把 `/src/main.jsx` 当成
 * Windows 绝对路径，展开成 `C:/Users/.../PortableGit/1.2.0/src/main.jsx`。
 * 这里反解回仓库内相对路径，否则探针会去请求一个根本不存在的地址，
 * 报出「持续性缺陷」的假警报——比不报警更坏。
 */
function normalizeEntry(raw) {
  const v = String(raw || '/src/main.jsx').replace(/\\/g, '/');
  if (!/^[A-Za-z]:\//.test(v) && !v.startsWith('/')) return v;
  // 形如 C:/.../<Git根>/src/xxx.jsx → 取最后一段 /src/ 开头的后缀
  const i = v.indexOf('/src/');
  if (i >= 0) return v.slice(i);
  const j = v.lastIndexOf('/');
  return j >= 0 ? v.slice(j) : v;
}
const ENTRY = normalizeEntry(argOf('--entry', '/src/main.jsx'));
const MAX_DEPTH = Number(argOf('--depth', '4'));
/** 文件 mtime 距今小于此值 ⇒ 判定为「正在编辑中」的中间态 */
const EDIT_WINDOW_MS = Number(argOf('--edit-window-ms', String(120_000)));
const USE_DOM = !argv.includes('--no-dom');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 把 `/src/xxx/yyy.jsx?` 映射回仓库内源文件绝对路径。
 * 剥掉 query 与 `?import` 之类的后缀；找不到就返回 null。
 */
export function moduleUrlToSource(url) {
  const clean = url.split('?')[0];
  if (!clean.startsWith('/src/')) return null;
  const abs = resolve(ROOT, `.${clean}`);
  return existsSync(abs) ? abs : null;
}

/**
 * 成因判据（纯函数，便于回归测试）：给一个失败模块的源文件 mtime，
 * 判断它是不是「刚被写过」——即 500 很可能只是编辑到一半的中间态。
 *
 * 刻意保守：mtime 超过窗口 ⇒ 一律按 persistent 报，宁可多报缺陷，
 * 也不要把真缺陷误判成"刷新就好"（那会让白屏被当成偶发而漏掉）。
 */
export function classifyByMtime(mtimeMs, nowMs, windowMs = EDIT_WINDOW_MS) {
  // 窗口 <= 0 等于「显式关闭瞬时判定」，必须全部落persistent。
  // （少了这一句，`age=0 && window=0` 会因0 <= 0 成立而误判成transient，
  //   连带让反向自检失去意义——注入 0 却不生效，等于没有可注入的开关。）
  if (windowMs <= 0) return 'persistent';
  if (typeof mtimeMs !== 'number' || !Number.isFinite(mtimeMs)) return 'persistent';
  const age = nowMs - mtimeMs;
  if (age < 0) return 'persistent';       // mtime 在未来（时钟/同步抖动）⇒ 不敢当瞬时
  if (age <= windowMs) return 'transient-edit';
  return 'persistent';
}

function stripHtml(s) {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function probeChain() {
  const seen = new Set();
  const bad = [];
  const ok = [];

  async function visit(url, depth) {
    if (seen.has(url) || depth > MAX_DEPTH) return;
    seen.add(url);
    let res, text = '';
    try {
      res = await fetch(BASE + url);
      text = await res.text();
    } catch (e) {
      bad.push({ url, status: 'FETCH_FAIL', detail: String(e).slice(0, 200) });
      return;
    }
    if (res.status !== 200) {
      bad.push({ url, status: res.status, detail: stripHtml(text).slice(0, 300) });
      return;
    }
    ok.push(url);
    const re = /(?:from|import)\s*["'](\/[^"']+)["']/g;
    let m;
    const kids = new Set();
    while ((m = re.exec(text))) {
      const p = m[1];
      if ((p.startsWith('/src/') || p.startsWith('/@')) && !p.includes('?')) kids.add(p);
    }
    for (const k of kids) await visit(k, depth + 1);
  }

  await visit(ENTRY, 0);
  return { ok, bad, seenCount: seen.size };
}

async function domSmoke() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (e) {
    return { skipped: true, reason: 'playwright 不可用：' + String(e).slice(0, 120) };
  }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const consoleErrors = [];
    const badResp = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + String(e).slice(0, 300)));
    page.on('response', (r) => { if (r.status() >= 400) badResp.push(`${r.status()} ${r.url()}`); });
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 40_000 });
    await sleep(2500);
    // ⛔ 禁截图（take_screenshot 在本机会必超时）。只读 DOM。
    const dom = await page.evaluate(() => {
      const root = document.querySelector('#root') || document.body;
      return {
        rootChildren: root.children.length,
        rootHTMLLen: root.innerHTML.length,
        textLen: (document.body.innerText || '').trim().length,
        textSample: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 200),
      };
    });
    // 白屏判据：根节点几乎没内容**且**屏幕文字为空。
    // 只看 rootHTMLLen 会误报（骨架屏/loading 态有内容但无字），所以两个都要。
    const blank = dom.rootChildren <= 1 && dom.rootHTMLLen < 500 && dom.textLen < 20;
    return { blank, ...dom, consoleErrors, badResp };
  } finally {
    await browser.close();
  }
}

/**
 * 白屏这一层到底查没查？（2026-10-07 r237）
 *
 * ⛔ 旧判据写的是 `result.bad.length === 0 && !dom.blank`：
 * dom 只有在**真启动了浏览器**时才带 `blank`；跑 `--no-dom` 时它是 `{skipped:true}`
 * ⇒ `dom.blank === undefined` ⇒ `!undefined === true` ⇒ **真白屏也判「首页正常」并 exit 0**，
 * 结论还替没查的那半边背书写「DOM 有内容」。
 * 这与 healthcheck.mjs 的 missingFieldDetail 是同一枚雷（r221/r233）：**没查 ≠ 正常**。
 *
 * @param {Array<{verdict:string}>} bad 非 200 的模块
 * @param {{skipped?:boolean,error?:string,blank?:boolean}} dom 白屏层结果；该层没跑就没有 blank
 */
export function decideFrontendVerdict(bad, dom) {
  const domChecked = !dom.skipped && !dom.error && typeof dom.blank === 'boolean';
  if (!domChecked) {
    return {
      status: 'dom-not-checked',
      exitCode: 4,
      headline: '白屏这一项等于没盯：没启动浏览器（用了 --no-dom，或浏览器启动失败），这一轮没验证过首页，不算健康。',
    };
  }
  const verdicts = new Set(bad.map((b) => b.verdict));
  if (bad.length === 0 && !dom.blank) {
    return { status: 'healthy', exitCode: 0, headline: '首页正常：模块链全 200，DOM 有内容。' };
  }
  if (verdicts.has('persistent') || dom.blank) {
    return { status: 'persistent', exitCode: 1, headline: '持续性缺陷：刷新无用，需要修代码。' };
  }
  return { status: 'transient-edit', exitCode: 2, headline: '编辑中间态：刷新页面即可，等这次改动写完。' };
}

async function main() {
  const started = Date.now();
  const now = started;
  let result;
  try {
    const chain = await probeChain();
    const enriched = chain.bad.map((b) => {
      const src = moduleUrlToSource(b.url);
      let mtimeMs = null;
      if (src) { try { mtimeMs = statSync(src).mtimeMs; } catch { /* 文件已删 */ } }
      const verdict = b.status === 'FETCH_FAIL' ? 'persistent' : classifyByMtime(mtimeMs, now);
      return { ...b, source: src ? src.replace(ROOT + '\\', '').replace(ROOT + '/', '') : null, mtimeMs, verdict };
    });
    result = { ...chain, bad: enriched };
  } catch (e) {
    console.error('探针自身失败：', e);
    process.exit(3);
  }

  const dom = USE_DOM ? await domSmoke().catch((e) => ({ error: String(e).slice(0, 200) })) : { skipped: true };

  const { status, exitCode, headline } = decideFrontendVerdict(result.bad, dom);

  const record = {
    t: new Date(now).toISOString(),
    // ⛔ r239：这个文件和 healthcheck.mjs 默认都往 tmp/health.jsonl 追加，但结构不同。
    //    打上 kind，读的那边才分得清哪条是后端体检、哪条是前端体检（实测会印 [object Object]）。
    kind: 'frontend',
    base: BASE, entry: ENTRY,
    modulesOk: result.ok.length,
    badCount: result.bad.length,
    bad: result.bad.map((b) => ({ url: b.url, status: b.status, verdict: b.verdict, source: b.source })),
    dom: dom.skipped ? { skipped: true } : { blank: dom.blank, rootHTMLLen: dom.rootHTMLLen, textLen: dom.textLen, consoleErrors: (dom.consoleErrors || []).length, badResp: (dom.badResp || []).length },
    status, elapsedMs: Date.now() - started,
  };
  try {
    mkdirSync(dirname(LOG), { recursive: true });
    appendFileSync(LOG, JSON.stringify(record) + '\n', 'utf8');
  } catch { /* 日志失败不该盖掉结论 */ }

  console.log('────────────────────────────────────────────────');
  console.log(`前端体检 @ ${BASE}（入口 ${ENTRY}）`);
  console.log('────────────────────────────────────────────────');
  console.log(`模块链：200 共 ${result.ok.length} 个，异常 ${result.bad.length} 个`);
  for (const b of result.bad) {
    console.log(`  ✗ [${b.status}] ${b.url}`);
    if (b.source) console.log(`      源文件 ${b.source}（最后写入 ${new Date(b.mtimeMs).toLocaleString('zh-CN')}）`);
    console.log(`      判定 ${b.verdict === 'transient-edit' ? '编辑中间态' : '持续性缺陷'}`);
    if (b.detail) console.log(`      正文 ${b.detail}`);
  }
  if (dom.skipped) console.log(`真机冒烟：已跳过（${dom.reason || '--no-dom'}）`);
  else if (dom.error) console.log(`真机冒烟：失败 ${dom.error}`);
  else console.log(`真机冒烟：${dom.blank ? '✗ 白屏' : '✓ 有内容'}（根节点 ${dom.rootChildren} 个子元素 / ${dom.rootHTMLLen} 字符 HTML / ${dom.textLen} 字可见文字）`);
  if (dom.textSample) console.log(`  画面文字：${dom.textSample}`);
  if (!dom.skipped && dom.consoleErrors?.length) console.log(`  console 报错 ${dom.consoleErrors.length} 条：${dom.consoleErrors.slice(0, 3).join(' | ')}`);
  if (!dom.skipped && dom.badResp?.length) console.log(`  HTTP≥400 共 ${dom.badResp.length} 条：${dom.badResp.slice(0, 5).join(' | ')}`);
  console.log('────────────────────────────────────────────────');
  console.log(`结论：${headline}（status=${status}）`);
  console.log(`已记到 ${LOG.replace(ROOT + '\\', '').replace(ROOT + '/', '')}`);
  process.exit(exitCode);
}

// 仅当本文件被直接执行时才跑 main()。
// 判据用 pathToFileURL 精确比对（⛔ 不用 `argv[1]?.endsWith(...)`：
// `node -e` 下 argv[1] 为undefined、`node --test` 下指向别处，
// 宽松匹配会让「只想 import 判据函数」也把探针整个跑起来并 process.exit）。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
