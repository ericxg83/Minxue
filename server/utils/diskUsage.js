/**
 * 磁盘用量探测（2026-10-06 r198）—— **可观测性**，不是业务逻辑。
 *
 * 为什么要它：体检脚本（scripts/healthcheck.mjs）以前对磁盘永远只能报一句「读不到用量」，
 * 因为除了 Render 后台谁也看不到配额。而「磁盘满了导致拍照上传失败」是老师最容易在
 * 晚托班现场撞到的坑——上传失败时页面只会转圈，事后根本查不出为什么。
 * 现在后端自己量一下所在文件系统还剩多少，接口一秒就能答出来。
 *
 * 实现：`fs.statfs`（Node ≥18.15 自带，无需装包）读所在文件系统的空闲块。
 * ⚠️ 它量的是**进程所在的文件系统**，不是某个目录的目录项大小——
 * Render 免费实例整盘约 1GB，这里报的就是那一份，正好是要预警的那个数。
 *
 * ⛔ 不要在这里做任何**因果推断**（「磁盘慢 ⇒ 是数据库卡」之类）：它只测量，不解释。
 */

/**
 * @param {string} [target] 要量的路径，默认进程工作目录（= 服务所在文件系统）。
 * @returns {Promise<{path: string, freeMb: number, totalMb: number|null}|null>}
 *   测不到时返回 null，并**打印一行日志**（静默返回 null 会让人以为「没问题」）。
 */
export async function measureDiskUsage(target) {
  const fs = await import('node:fs/promises')
  // 老 Node（<18.15）没有 statfs：报「测不到」而不是崩掉整个健康检查。
  if (typeof fs.statfs !== 'function') {
    console.error('[disk] 当前 Node 版本没有 fs.statfs，跳过磁盘用量探测')
    return null
  }
  const p = target || process.cwd()
  try {
    const st = await fs.statfs(p)
    if (!st || !Number.isFinite(st.bsize) || st.bsize <= 0 || !Number.isFinite(st.bfree)) {
      throw new Error('statfs 返回值不可用')
    }
    const toMb = (blocks) => Math.round((blocks * st.bsize) / 1024 / 1024)
    return {
      path: p,
      freeMb: toMb(st.bfree),
      // 总容量取整块数；老文件系统不报 blocks 时为 null（不要伪造一个数字）。
      totalMb: Number.isFinite(st.blocks) ? toMb(st.blocks) : null
    }
  } catch (e) {
    // 探测失败必须看得见：这是「查不出为什么上传失败」的那一类问题。
    console.error(`[disk] 磁盘用量探测失败（${p}）：`, e.message)
    return null
  }
}
