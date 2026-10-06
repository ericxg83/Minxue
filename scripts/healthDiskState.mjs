/**
 * 磁盘健康判定的**唯一实现**（2026-10-06 r198）。
 *
 * 背景：体检脚本里「服务器磁盘」这一项原本是一句**永远成立**的警告——
 * 不管剩多少、也不管有没有数据，每次采样都打「体检读不到磁盘用量，请定期在 Render 后台看」。
 * 于是每次结论都是「没有致命问题，但有 1 项想提醒你」。
 * ⚠️ **恒定亮着的黄灯等于没有黄灯**：它会把真正的告警（批改失败、队列积压）一起淹掉，
 * 负责人看多了会直接跳过。所以这里把「读不到」和「真的快满了」当成两件不同的事分开判。
 *
 * 判据（只跟**剩余空间**有关，跟总容量无关 —— 配额大小是平台给的，我们控制不了）：
 *   - 拿不到用量 ⇒ warn，但**必须说清去哪儿看**（仍然是人话，而不是假装没问题）；
 *   - 剩余 < DISK_WARN_FREE_MB（默认 200MB）⇒ warn，给出剩余/总量与「怎么办」；
 *   - 其余 ⇒ ok。
 *
 * ⛔ 不要在这里做**因果推断**：磁盘满会导致上传失败，但上传失败也可能是别的原因；
 * 本函数只回答「还剩多少 / 够不够」，不回答「为什么慢」。
 */

/** 剩余低于这个 MB 就提醒（Render 免费实例整盘约 1GB，200MB 还剩 5 个 20MB 拍照上传的余量）。 */
export const DISK_WARN_FREE_MB = 200

/** 拿不到用量时的兜底文案（人话：告诉老师该去哪儿看，而不是一句「读不到」）。 */
export const DISK_UNKNOWN_DETAIL =
  '这次没测到磁盘还剩多少。这个盘是服务器的临时空间（作业图片存在 OSS，不受它影响），' +
  '但分享卡/重练卷 PDF 渲染会往这儿写临时文件。可以上 Render 后台看用量，或隔几分钟再体检一次。'

/**
 * @param {{freeMb?: number|null, totalMb?: number|null, path?: string|null}|null|undefined} disk
 *   /api/health 回的 disk 字段；拿不到时为 null/undefined。
 * @returns {{status: 'ok'|'warn', detail: string}}
 */
export function resolveDiskState(disk) {
  const free = disk && typeof disk.freeMb === 'number' ? disk.freeMb : null
  if (free === null) {
    return { status: 'warn', detail: DISK_UNKNOWN_DETAIL }
  }
  const total = disk && typeof disk.totalMb === 'number' ? disk.totalMb : null
  const totalTxt = total === null ? '' : `（总共约 ${total}MB）`
  if (free < DISK_WARN_FREE_MB) {
    return {
      status: 'warn',
      // ⚠️ 别夸大成「拍照上传会失败」：作业图片存 OSS，这个盘只承载临时文件。
      // 说准了才有人信，也才排得上障。
      detail: `磁盘只剩 ${free}MB${totalTxt}，快满了。这个盘是服务器的临时空间` +
        '（作业图片存在 OSS，不受影响），但**生成分享卡 / 重练卷 PDF** 要往这儿写临时文件，' +
        '满了会生成失败。现在该做的：清掉服务器上没用的临时文件，或者上 Render 后台看用量/升级套餐。'
    }
  }
  return {
    status: 'ok',
    detail: `还剩 ${free}MB${totalTxt}，生成分享卡/重练卷够用`
  }
}
