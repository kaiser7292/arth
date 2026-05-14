@echo off
setlocal
set PATH=C:\Users\soura\scoop\apps\nodejs\25.5.0\bin;C:\Users\soura\scoop\apps\openjdk21\21.0.2-13\bin;C:\Users\soura\scoop\shims;%PATH%
set NODE_PATH=C:\Users\soura\scoop\apps\nodejs\25.5.0
cd /d C:\Users\soura\artha
C:\Users\soura\scoop\apps\nodejs\25.5.0\npm.cmd install --ignore-scripts
endlocal
