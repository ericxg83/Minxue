// 回归测试：图片下载必须禁代理（2026-09-22「50 道题参考答案永久为空」事故）
//
// 根因回顾：开发机/容器环境若注入 HTTP_PROXY / HTTPS_PROXY（沙箱、公司网关、CI），
// axios **默认**把请求交给该代理。OSS 页图 GET 经代理后返回
//   400 The plain HTTP request was sent to HTTPS port
// → worker 抛「下载图片失败: Request failed with status code 400」→ 任务 failed。
// 2026-09-22 当天三个作业任务（091e9644 / e376e028 / c118309e）因此 failed，
// 共 50 道题的参考答案永久为空，且没有任何一处提示教师「任务没跑完」。
//
// `server/config/ai.js` 早就对 AI 调用显式关代理（proxyOff），但下载图片的调用点
// 各写各的：worker.js 漏、cropAndUpload.js 漏、tikzWorker.js 漏，只有 geometryWorker.js
// 在 09-18 事故后手写了 proxy:false。四处各自为政 → 必然再漏。
//
// 本测试锁三件事：
//   1. 选项对象本身必须真的关代理（proxy/httpsAgent/httpAgent 三处），且冻结
//   2. server 生产代码里**所有** axios 下载调用点必须带上共享选项（源码级扫描，新增调用点漏带即失败）
//   3. 行为回归：设了 HTTP_PROXY 指向死端口时，禁代理下载仍能直连成功
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import http from 'node:http'
import axios from 'axios'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

/** 生产代码里"从 URL 取图片"的调用点：改动这些文件必须保持带选项 */
const GUARDED_CALL_SITES = [
  'server/worker.js',
  'server/utils/cropAndUpload.js',
  'server/geometryWorker.js',
  'server/tikzWorker.js',
  'server/rerunGeometry.js'
]

/** 递归收集 server/ 下的生产 js（跳过 node_modules 与 _diag_/_probe_ 一次性探针脚本） */
function collectServerSources(dir = resolve(ROOT, 'server'), out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue
    const full = resolve(dir, ent.name)
    if (ent.isDirectory()) {
      collectServerSources(full, out)
    } else if (ent.isFile() && ent.name.endsWith('.js')) {
      // 探针脚本（_diag_*.mjs / _probe_*.mjs）是一次性诊断代码，故意允许手写参数
      if (/^_(diag|probe)_/.test(ent.name)) continue
      out.push(full)
    }
  }
  return out
}

/**
 * 取出 `name(` 的括号内实参文本（括号配平扫描）。
 * 对字符串字面量里含括号的极端写法不严谨，但足够拦住"漏传选项"这类回归。
 */
function findCallArgs(src, name) {
  const re = new RegExp(`${name}\\s*\\(`, 'g')
  const found = []
  let m
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1
    let depth = 0
    let j = open
    for (; j < src.length; j++) {
      if (src[j] === '(') depth++
      else if (src[j] === ')') {
        depth--
        if (depth === 0) break
      }
    }
    found.push(src.slice(open + 1, j))
  }
  return found
}

test('NO_PROXY_DOWNLOAD_OPTS 必须真正关代理（proxy/httpsAgent/httpAgent）且冻结', () => {
  const src = read('server/utils/noProxyHttp.js')
  assert.ok(src.includes('proxy: false'), '必须显式 proxy: false —— axios 默认尊重 HTTP_PROXY 环境变量')
  assert.ok(src.includes('httpsAgent: false'), '必须 httpsAgent: false —— 否则环境代理仍会接管 HTTPS 请求')
  assert.ok(src.includes('httpAgent: false'), '必须 httpAgent: false')
  assert.ok(src.includes("responseType: 'arraybuffer'"), '图片下载应以 arraybuffer 取回')
  assert.ok(src.includes('Object.freeze'), '选项对象应冻结，避免调用点就地改坏')
  assert.ok(
    src.includes('export const downloadImageBufferNoProxy'),
    '应提供 downloadImageBufferNoProxy 供调用点直接复用'
  )
})

test('server 生产代码中所有 axios 下载调用点都必须带 NO_PROXY_DOWNLOAD_OPTS', () => {
  const offenders = []
  let scanned = 0
  for (const file of collectServerSources()) {
    const src = readFileSync(file, 'utf8')
    for (const name of ['axios.get', 'axios.request', 'axios.create']) {
      for (const args of findCallArgs(src, name)) {
        scanned++
        // 允许两条合法路径：共享下载选项 NO_PROXY_DOWNLOAD_OPTS，
        // 或 config/ai.js 里等价的 proxyOff 展开（该对象的关代理性由下一条测试单独锁住）。
        const ok =
          /NO_PROXY_DOWNLOAD_OPTS/.test(args) ||
          /\.\.\.proxyOff/.test(args) ||
          /proxy:\s*false/.test(args)
        if (!ok) offenders.push(`${relative(ROOT, file)} → ${name}(${args.slice(0, 60)}…)`)
      }
    }
  }
  assert.ok(scanned >= 5, `应扫描到至少 5 处 axios 调用，实际 ${scanned}（扫描逻辑可能失效）`)
  assert.deepEqual(
    offenders,
    [],
    `以下 axios 调用未关代理，HTTP_PROXY 环境下会 400：\n  ${offenders.join('\n  ')}`
  )
})

test('config/ai.js 的 proxyOff 也必须真正关代理（它是上一条测试放行的唯一例外）', () => {
  const src = read('server/config/ai.js')
  const m = src.match(/const proxyOff = \{([^}]*)\}/)
  assert.ok(m, 'config/ai.js 应定义 proxyOff 常量')
  assert.ok(/proxy:\s*false/.test(m[1]), 'proxyOff 必须含 proxy: false')
  assert.ok(/httpsAgent:\s*false/.test(m[1]), 'proxyOff 必须含 httpsAgent: false')
  assert.ok(/httpAgent:\s*false/.test(m[1]), 'proxyOff 必须含 httpAgent: false')
})

test('四个历史下载调用点必须从 utils/noProxyHttp.js 引入（不得再手写 axios 参数）', () => {
  for (const file of GUARDED_CALL_SITES) {
    const src = read(file)
    assert.ok(
      src.includes('noProxyHttp.js'),
      `${file} 应从 utils/noProxyHttp.js 引入禁代理下载能力（2026-09-22 事故教训）`
    )
    assert.ok(
      !src.includes("responseType: 'arraybuffer'"),
      `${file} 不应再手写 responseType: 'arraybuffer' —— 选项只允许在 noProxyHttp.js 定义一处`
    )
  }
})

test('行为回归：HTTP_PROXY 指向死端口时，禁代理下载仍直连成功', async (t) => {
  const { downloadImageBufferNoProxy } = await import('../server/utils/noProxyHttp.js')
  const payload = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'image/jpeg' })
    res.end(payload)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}/page.jpg`

  const saved = { HTTP_PROXY: process.env.HTTP_PROXY, HTTPS_PROXY: process.env.HTTPS_PROXY }
  // 端口 1 必然拒连：只要请求真的走了代理，就一定是 ECONNREFUSED
  process.env.HTTP_PROXY = 'http://127.0.0.1:1'
  process.env.HTTPS_PROXY = 'http://127.0.0.1:1'
  try {
    const buf = await downloadImageBufferNoProxy(url)
    assert.ok(buf.length === payload.length, `应取回 ${payload.length} 字节，实际 ${buf.length}`)
    assert.ok(buf.equals(payload), '取回内容应与服务端一致')

    // 反向验证：证明本用例有区分度（若本机 no_proxy 已排除 localhost，则无从区分，跳过）
    const noProxyEnv = String(process.env.no_proxy || process.env.NO_PROXY || '')
    if (/localhost|127\.0\.0\.1/.test(noProxyEnv)) {
      t.diagnostic(`本机 no_proxy=${noProxyEnv} 已排除 localhost，跳过反向断言`)
    } else {
      await assert.rejects(
        () => axios.get(url, { responseType: 'arraybuffer', timeout: 5000 }),
        (e) => e.code === 'ECONNREFUSED',
        '不带 proxy:false 的 axios.get 应被环境代理劫持（这正是 09-22 事故的复现路径）'
      )
    }
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    await new Promise((r) => server.close(r))
  }
})

test('事故复盘：worker.js 下载图片必须走禁代理选项（含魔数校验，错误页不得喂给视觉模型）', () => {
  const src = read('server/worker.js')
  assert.ok(src.includes('NO_PROXY_DOWNLOAD_OPTS'), 'worker.js downloadImage 必须使用禁代理选项')
  assert.ok(src.includes('isValidImageBuffer'), '下载后应做魔数校验，OSS 错误页不得喂给视觉模型')
  // 旧写法：axios.get(imageUrl, { responseType: 'arraybuffer', ... }) 已必须消失
  assert.ok(
    !/axios\.get\(imageUrl,\s*\{\s*responseType/.test(src),
    'worker.js 不得回到手写 axios 下载参数的老写法'
  )
})

test('禁代理助手文件必须存在且被引用（防止有人删掉共享选项）', () => {
  assert.ok(existsSync(resolve(ROOT, 'server/utils/noProxyHttp.js')), 'server/utils/noProxyHttp.js 必须存在')
  const users = GUARDED_CALL_SITES.filter((f) => read(f).includes('noProxyHttp.js'))
  assert.equal(users.length, GUARDED_CALL_SITES.length, `这些文件应全部引用共享选项：${GUARDED_CALL_SITES.join(', ')}`)
})
