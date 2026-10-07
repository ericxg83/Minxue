' 敏学移动端 dev 守护 —— 开机自启启动器（放入 shell:startup，隐藏窗口）
' 2026-10-08 按 keep_backend.vbs / patrol_daemon.vbs 先例，开机自动拉起 keep_mobile_dev.mjs
' 守护逻辑：每 15s 探活 :5173，失败自动重启 vite dev（含 90s 冷却保护防冷启动误杀）
' 移除方法：删除 启动 文件夹里的 minxue_keep_mobile_dev.vbs 即可
CreateObject("Wscript.Shell").Run "cmd /c cd /d D:\Minxue_App_V3 && node scripts\dev\keep_mobile_dev.mjs >> logs\keep_mobile_dev.log 2>&1", 0, False