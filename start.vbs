' This script launches the Forge Node server silently (no visible window).
' It is called by start.bat on login via Windows Task Scheduler.
Set objShell = CreateObject("WScript.Shell")
objShell.Run "cmd /c cd /d C:\Users\Brennan\forge && node server.js", 0, False
