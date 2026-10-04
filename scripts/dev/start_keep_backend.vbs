' 敏学后端守护 —— 开机自启启动器（放入 shell:startup，隐藏窗口，r110 负责人批准）
' 移除方法：删除 启动 文件夹里的 minxue_keep_backend.vbs 即可
CreateObject("Wscript.Shell").Run "cmd /c cd /d D:\Minxue_App_V3 && node scripts\dev\keep_backend.mjs", 0, False
