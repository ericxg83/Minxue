@echo off
REM ============================================================================
 REM  Minxue local services auto-start (approved by owner 2026-10-13)
 REM  Trigger: Windows Scheduled Task "MinxueLocalServices" (AtLogOn)
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
