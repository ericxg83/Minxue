// 一键体检脚本的安全锁（scripts/healthcheck.mjs）
//
// 这个脚本会连数据库、读环境变量，所以必须锁死两条底线，
// 否则一个"体检工具"可能变成事故源头：
//   ① **永远只读**：只发 GET、只跑 SELECT，不得写库/入队/改配置/删文件；
//   ② **永远不打印密钥**：连接串、密码、API Key 一律不得出现在输出里。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(path.join(ROOT, 'scripts/healthcheck.mjs'), 'utf8')

test('体检脚本只允许发 GET 请求', () => {
  const bad = SRC.match(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/i)
  assert.equal(bad, null, `体检脚本出现了 ${bad?.[1]} 请求，它必须只读`)
  // 也不能出现裸 fetch 的非 GET 简写
  assert.doesNotMatch(SRC, /fetch\([^)]*,\s*\{\s*method/i,
    '体检脚本里出现带 method 的 fetch，需确认不是写操作')
})

test('体检脚本不得写库或入队', () => {
  for (const kw of ['INSERT ', 'UPDATE ', 'DELETE FROM', 'DROP ', 'TRUNCATE', 'queue.add', 'createQueryBuilder']) {
    assert.ok(!SRC.includes(kw), `体检脚本里出现了「${kw.trim()}」——它必须是只读的`)
  }
})

test('体检脚本不得导入写库/入队模块', () => {
  assert.doesNotMatch(SRC, /from\s+['"].*\/config\/neon\.js['"]/,
    '体检脚本不要直接连库（当前设计是走 HTTP 问后端，天然只读）')
  assert.doesNotMatch(SRC, /from\s+['"].*\/queue\.js['"]/, '体检脚本不要碰队列模块')
})

test('体检脚本不得打印密钥/密码/连接串', () => {
  // 允许「判断变量是否存在」，不允许把值输出
  assert.doesNotMatch(SRC, /console\.(log|info|warn|error)\([^)]*process\.env\.[A-Z_]*(KEY|SECRET|TOKEN|PASSWORD|URL)[A-Z_]*(?!\s*\))/,
    '体检脚本疑似把敏感环境变量的值打进了输出')
  assert.doesNotMatch(SRC, /(DATABASE_URL|NEON_DATABASE_URL)\s*[)},\s]/,
    '体检脚本疑似输出数据库连接串')
  // 断言它明确不打印值：出现 .env 读取就必须只取键名
  if (SRC.includes('process.env')) {
    assert.doesNotMatch(SRC, /process\.env\.[A-Z_]+[^)\n]*\)\s*[,;]/,
      '体检脚本疑似把某个环境变量直接拼进输出')
  }
})

test('体检脚本每项检查各自兜住异常（单项坏掉不能让整份体检崩掉）', () => {
  // 至少 4 处独立 try/catch，覆盖 6 个检查项
  const tries = (SRC.match(/try\s*{/g) || []).length
  assert.ok(tries >= 4, `独立 try 只有 ${tries} 处，单项失败会中断整份体检`)
  assert.ok(SRC.includes('process.exit'), '体检脚本应以退出码反映结果（0=好，有 bad 则非 0），方便别处调用')
})

test('体检脚本支持指定地址与 JSON 输出', () => {
  assert.match(SRC, /--api/, '应支持 --api 指定被检地址（本地/生产）')
  assert.match(SRC, /--json/, '应支持 --json 机器可读输出')
})

test('体检脚本支持 --log 持续采样（用于替代"抓一次就下结论"）', () => {
  // 2026-10-04 教训：曾把一次部署重启误判成实例休眠并据此下了结论。
  // 采样日志是纠正这种「单次观测下结论」错误的手段，故必须锁住它不被删掉。
  assert.match(SRC, /--log/, '缺少 --log 参数 ⇒ 无法持续采样，只能靠单次观测，容易再次误判')
  assert.match(SRC, /appendFileSync/, '--log 没有真的追加写入，只是个摆设')
  assert.match(SRC, /upMin|uptimeSec/, '采样必须记录服务器已运行分钟数（判断是否重启的关键）')
  assert.match(SRC, /rtMs|time\.total|rt:/, '采样必须记录响应耗时')
})

test('采样日志必须写在 gitignore 覆盖的目录（别把运行痕迹提交进仓库）', () => {
  assert.match(SRC, /mkdirSync\(path\.dirname\(LOG\)/, 'LOG 所在目录未自动创建，首次采样会因目录不存在而失败')
  const gi = readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
  assert.match(gi, /^tmp\/?$/m, '.gitignore 必须忽略 tmp/，否则采样日志会被提交进仓库')
})

test('体检脚本的结论用大白话（不出现术语堆砌）', () => {
  // 结论行必须是人话，且给出"要不要管"的明确指引
  assert.match(SRC, /一切正常|没有致命问题|项需要处理/,
    '结尾结论必须是负责人一眼能懂的人话')
})
