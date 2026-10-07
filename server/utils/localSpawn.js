/**
 * 本机可用的「同步起子进程」入口 —— 全仓唯一实现（scripts/ 与 test/ 共用）。
 *
 * ⛔ 为什么必须走这里（2026-10-07 实测，不是推理）：
 *   本机（WorkBuddy LiteSandbox，环境里可见 LSBOX_AUDIT_SHMEM）拦 CreateProcessW，
 *   **只要同步起子进程时子进程的 stdin 是管道，就一律失败 EBUSY（errno -4082、status=null）**：
 *     spawnSync(node, ['-v'])                                     → EBUSY
 *     spawnSync(node, ['-v'], { stdio: ['ignore','pipe','pipe'] }) → status=0
 *     execSync / execFileSync                                     → 同样 EBUSY（内部就是 spawnSync + 管道）
 *   对照实验（都真跑过）：
 *     · 与父进程 stdin 形态无关（/dev/null、管道、默认，三者一样失败）
 *     · 与 node 版本无关（托管 v22.22.2 与系统 v24.14.1 都一样）
 *     · 与 NODE_OPTIONS 里注入的 node-language-shim 无关（清空后照样失败）
 *     · 异步 spawn() **不受影响** —— 所以「套件整体跑得起来，只有真起同步子进程的那几处红」
 *   修之前的代价（都是这同一行选项造成的静默失效，不是推理）：
 *     · test/healthTrend + test/auditStoreContractWorks 共 14 条常红，被误当「代码回归」查了几轮
 *     · scripts/patrol daemon 的自动提交静默不执行（日志只说「跳过（无新内容或冲突）」）
 *     · scripts/loopGuard 的远端检查恒返回「无网络」
 *     · scripts/dev/keep_backend 的僵尸清理成死代码（listeners() 恒空）
 *     · scripts/pruneDeadDeclarations 恒「eslint 未产出报告」退出 1
 *
 * 别的机器（没这层拦截）用这里也完全正确：这些调用都不给子进程喂 stdin，
 * 「忽略 stdin」与「给一个空管道」语义等价；真要喂 input 时下面会保留管道。
 * 防复发锁：test/spawnStdinGuard.test.mjs。
 */
import { spawnSync } from 'node:child_process'

/**
 * 把 stdio 归一到「本机可用」的形状：stdin 不用管道，除非调用方真要喂 input。
 * @param {import('node:child_process').StdioOptions | undefined} stdio
 * @param {unknown} input spawnSync 的 input（只有真要喂 stdin 时才保留管道）
 */
function stdioCompat(stdio, input) {
  const needStdinPipe = input !== undefined && input !== null
  if (stdio === undefined || stdio === 'pipe') {
    return needStdinPipe ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe']
  }
  if (typeof stdio === 'string') return stdio
  const arr = [...stdio]
  if (!needStdinPipe && arr[0] === 'pipe') arr[0] = 'ignore'
  return arr
}

/**
 * 以本机可用的方式同步跑一个子进程（默认：忽略 stdin、收 stdout/stderr，utf8 解码）。
 * ⛔ 起不来时**不抛错**，而是照 spawnSync 的约定把原因放在 `r.error` / `r.status === null` ——
 *   调用方必须自己判 `r.status`，别把 null 当成 0（那正是「假装成功」的来源）。
 * @param {string} command
 * @param {string[]} args
 * @param {import('node:child_process').SpawnSyncOptions & { encoding?: BufferEncoding }} [options]
 */
export function spawnLocal(command, args, options = {}) {
  const opts = { encoding: 'utf8', ...options }
  opts.stdio = stdioCompat(opts.stdio, opts.input)
  return spawnSync(command, args, opts)
}

/**
 * 跑一个 node 脚本（用当前 node，即 process.execPath）。
 * @param {string[]} args 脚本路径 + 参数
 * @param {import('node:child_process').SpawnSyncOptions & { encoding?: BufferEncoding }} [options]
 */
export function runNodeScript(args, options = {}) {
  return spawnLocal(process.execPath, args, options)
}

/**
 * 起子进程是否**真的跑起来了**（用来把「起不来」与「跑了但退非 0」分开——
 * 后者常常是「工具在报告问题」，前者才是环境/代码故障，两者混在一起最容易假绿）。
 * @param {import('node:child_process').SpawnSyncReturns<string>} r
 */
export function spawnFailed(r) {
  return !r || r.status === null || !!r.error
}
