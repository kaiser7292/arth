@echo off
setlocal
set ANDROID_HOME=C:\Users\soura\scoop\apps\android-clt\14742923
cd /d C:\Users\soura\artha\android
echo sdk.dir=%ANDROID_HOME% > local.properties
cd /d C:\Users\soura\artha\android
copy ..\tailwind.config.js tailwind.config.js
endlocal
