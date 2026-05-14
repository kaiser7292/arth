@echo off
setlocal
set PATH=C:\Users\soura\scoop\apps\nodejs\25.5.0;C:\Users\soura\scoop\apps\openjdk21\21.0.2-13\bin;C:\Users\soura\scoop\shims;%PATH%
set NODE_PATH=C:\Users\soura\scoop\apps\nodejs\25.5.0
set JAVA_HOME=C:\Users\soura\scoop\apps\openjdk21\21.0.2-13
set ANDROID_HOME=C:\Users\soura\scoop\apps\android-studio\2025.3.4.7
cd /d C:\Users\soura\artha
C:\Users\soura\scoop\apps\nodejs\25.5.0\npx.cmd expo prebuild --platform android
endlocal
