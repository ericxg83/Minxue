// 后端生命周期面包屑锁（提案⑯）
//
// 起因：2026-10-04 巡检发现本地后端进程消失、端口无监听，但日志「戛然而止」——
// 末行只是周期性健康检查，没有崩溃信息也没有退出记录，无法判断是被外部杀掉还是崩溃。
// 这类静默死亡是排障最大的黑洞。本锁确保三条判读线索不被后人删掉。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(path.join(ROOT, 'server/index.js'), 'utf8')

test('启动横幅必须打印 pid/端口/bootAt（用于把日志与进程对上）', () => {
  assert.match(SRC, /\[生命周期\]\s*启动\s+pid=\$\{process\.pid\}/,
    '启动横幅被删了 ⇒ 事后无法判断日志属于哪个进程、起了多久')
  assert.match(SRC, /bootAt=\$\{new Date\(__bootedAt\)\.toISOString\(\)\}/,
    '启动横幅缺 bootAt')
})

test('必须有 exit 钩子（正常退出要留痕）', () => {
  assert.match(SRC, /process\.on\(\s*'exit'/, '缺 exit 钩子 ⇒ 正常退出无痕迹')
  assert.match(SRC, /\[生命周期\]\s*进程退出 code=/, 'exit 钩子没打印退出码与运行时长')
})

test('必须有 SIGTERM / SIGINT 钩子且退出后主动 exit（部署平台停止要留痕）', () => {
  assert.match(SRC, /'SIGTERM'/, '缺 SIGTERM 钩子 ⇒ Render 滚动更新时会静默消失')
  assert.match(SRC, /'SIGINT'/, '缺 SIGINT 钩子')
  // 关键：注册了信号钩子后 Node 不再默认终止，必须自己 exit，否则会变成"关不掉的后端"
  const seg = SRC.slice(SRC.indexOf("['SIGTERM', 'SIGINT']"))
  assert.match(seg.slice(0, 400), /process\.exit\(0\)/,
    '注册信号钩子后没有 process.exit ⇒ 收到 SIGTERM 会不退出，进程反而关不掉')
})

test('信号钩子不得吞掉退出前的收尾（钩子内只允许日志 + exit）', () => {
  // 防回归：有人日后往钩子里塞长耗时收尾逻辑，导致部署平台等到超时才强杀
  const start = SRC.indexOf("['SIGTERM', 'SIGINT']")
  const seg = SRC.slice(start, start + 400)
  const forbidden = /await\s|fetch\(|query\(|setTimeout\(|execSync|writeFileSync/
  assert.doesNotMatch(seg, forbidden,
    '信号钩子里出现了耗时/IO 操作 ⇒ 部署平台会等超时强杀，反而又变回静默死亡')
})

test('未捕获异常兜底仍在（不得为了加日志而改动原有崩溃语义）', () => {
  assert.match(SRC, /process\.on\(\s*'uncaughtException'/)
  assert.match(SRC, /CONNECTION_ERROR_RE/)
  assert.match(SRC, /未捕获异常，进程退出/)
  assert.match(SRC, /process\.on\(\s*'unhandledRejection'/)
})
