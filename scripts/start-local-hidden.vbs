' Minxue local services - hidden autostart launcher (called by Scheduled Task "MinxueLocalServices", AtLogOn)
' 2026-10-15: switched from one-shot start-local.cmd to the keep-alive daemon.
' Reason: start-local.cmd only launched each service once and never re-checked; the
' backend reported "service started" at 08:21:41 then got Ctrl+C'd around 08:22, and by
' 08:25 neither :3000 nor :4000 was listening. keep_local_services.mjs probes every 15s
' and relaunches on failure, so the services actually survive.
' NOTE: keep this file pure ASCII (wscript reads .vbs as ANSI, not UTF-8).
' 2026-10-28: MINXUE_AUTOSTART=1 tells the daemon this is the autostart chain
' (no external launcher), so it may spawn immediately on first tick instead of
' waiting out the 90s anti-double-spawn cooldown (logon-to-browser was ~12min).
CreateObject("Wscript.Shell").Run "cmd /c set MINXUE_AUTOSTART=1&& cd /d D:\Minxue_App_V3 && node scripts\dev\keep_local_services.mjs --open", 0, False
