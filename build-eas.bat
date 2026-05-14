@echo off
setlocal
set PATH=C:\Users\soura\scoop\apps\nodejs\25.5.0;C:\Users\soura\scoop\shims;%PATH%
cd /d C:\Users\soura\artha
C:\Users\soura\scoop\apps\nodejs\25.5.0\npx.cmd eas-cli build --platform android --profile preview --non-interactive
endlocal
