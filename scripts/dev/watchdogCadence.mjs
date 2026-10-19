/**
 * watchdogCadence.mjs — 兼容 re-export（2026-10-19 下沉）
 *
 * 实现已迁移到 server/lib/peakWindows.mjs（唯一实现，含时区无关化）。
 * 迁移原因：Render rootDir=server 只部署 server/ 目录，scripts/ 不在生产镜像 ⇒
 * 运行时核心（redisManager 高峰分化心跳）不能依赖 scripts/dev/；而看门狗依赖 server/lib 方向正确。
 * 本文件保留原 import 路径，keep_local_services.mjs 与 test/watchdogCadence.test.mjs 无需改动。
 */
export {
  DEFAULT_PEAK_WINDOWS_SPEC,
  DEFAULT_PEAK_INTERVAL_MS,
  DEFAULT_OFFPEAK_INTERVAL_MS,
  parseWindows,
  isPeak,
  pickIntervalMs,
} from '../../server/lib/peakWindows.mjs'
