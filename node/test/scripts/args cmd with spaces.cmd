@echo off
setlocal
set index=0

:check_arg
set "arg=%1"
if not defined arg goto :eof
echo args[%index%]: '%arg%'
set /a index=%index%+1
shift
goto check_arg
