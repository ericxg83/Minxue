' Minxue local services - hidden autostart launcher
' Runs start-local.cmd with a hidden console window (no black box at logon).
CreateObject("Wscript.Shell").Run "cmd /c ""D:\Minxue_App_V3\scripts\start-local.cmd""", 0, False
