' 敏学巡逻 daemon —— 开机自启启动器（放入 shell:startup，隐藏窗口）
' 2026-10-07 根因：系统重启后 daemon 不自动恢复（R55 后 8 小时断档），故按 keep_backend.vbs 先例做开机自启
' 移除方法：删除 启动 文件夹里的 minxue_patrol_daemon.vbs 即可
CreateObject("Wscript.Shell").Run "cmd /c cd /d D:\Minxue_App_V3 && node scripts\patrol\daemon.mjs >> logs\patrol_daemon.log 2>&1", 0, False