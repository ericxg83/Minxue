#!/usr/bin/env node
/**
 * Capacitor App 构建入口。
 *
 * 与 Web 构建的唯一区别：只打移动端 index.html，不打 workbench.html。
 * PC 工作台的 Vue + Element Plus + ECharts 链约 2.4MB，手机 App 里
 * 不会打开这些页面，随 APK 分发只是白占体积。
 *
 * 产物目录 dist-app（见 vite.config.js 的 outDir 与 capacitor.config.json 的 webDir）。
 * 用独立脚本而非 shell 内联环境变量，是为了 Windows / macOS / Linux 行为一致。
 */
import { spawnSync } from 'node:child_process'

const result = spawnSync('npx', ['vite', 'build'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, BUILD_TARGET: 'app' }
})

process.exit(result.status ?? 1)
