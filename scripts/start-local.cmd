@echo off
REM ============================================================================
 REM  Minxue local services - MANUAL one-shot starter (kept for hand use)
 REM  Autostart is NO LONGER this file: since 2026-10-15 the logon chain is
 REM    Scheduled Task "MinxueLocalServices" (AtLogOn) + Startup folder entry
 REM      -> scripts\start-local-hidden.vbs
 REM      -> scripts\dev\keep_local_services.mjs   (keep-alive watchdog)
 REM  Why: this file only launches each service once and never re-checks.
 REM       2026-10-15 08:19 logon run: backend reported "service started" at
 REM       08:21:41, was Ctrl+C'd (log ends with ^C) around 08:22, and by 08:25
 REM       neither :3000 nor :4000 was listening. The watchdog probes every 15s
 REM       and relaunches, so services actually survive.
 REM  Starts: backend :4000 (node server/index.js) + frontend :3000 (vite dev)
 REM  Note: Redis/Memurai runs as a Windows service (auto-starts on boot);
 REM        services already listening are not restarted (avoid EADDRINUSE).
 REM  Logs: logs/local-boot.log, logs/server.log, logs/vite.log
 REM  This file MUST stay pure ASCII (cmd.exe parses it as GBK, not UTF-8).
 REM ============================================================================
cd /d D:\Minxue_App_V3
if not exist logs mkdir logs
set BOOTLOG=logs\local-boot.log
echo [%date% %time%] local-services boot check >> %BOOTLOG%

REM --- backend :4000 --------------------------------------------------------
netstat -ano | findstr /r /c:":4000 .*LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo [%time%] backend :4000 already listening - skip >> %BOOTLOG%
) else (
    echo [%time%] starting backend :4000 >> %BOOTLOG%
    start "" /min cmd /c ""C:\Program Files\nodejs\node.exe" server\index.js >> logs\server.log 2>&1"
    timeout /t 3 /nobreak >nul
)

REM --- frontend :3000 -------------------------------------------------------
netstat -ano | findstr /r /c:":3000 .*LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo [%time%] frontend :3000 already listening - skip >> %BOOTLOG%
) else (
    echo [%time%] starting frontend :3000 >> %BOOTLOG%
    start "" /min cmd /c ""C:\Program Files\nodejs\npm.cmd" run dev >> logs\vite.log 2>&1"
)

echo [%time%] boot check done >> %BOOTLOG%
