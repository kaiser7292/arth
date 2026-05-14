@echo off
REM Environment setup for Artha build
set JAVA_HOME=C:\Users\soura\scoop\apps\openjdk21\21.0.2-13
set ANDROID_HOME=C:\Users\soura\scoop\apps\android-studio\2025.3.4.7
set ANDROID_SDK_ROOT=%ANDROID_HOME%
set PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\bin;%ANDROID_HOME%\cmdline-tools\latest\bin;%ANDROID_HOME%\platform-tools;C:\Users\soura\scoop\apps\nodejs\25.5.0\bin;C:\Users\soura\scoop\shims;%PATH%
set NODE_PATH=C:\Users\soura\scoop\apps\nodejs\25.5.0
echo Environment variables set:
echo JAVA_HOME=%JAVA_HOME%
echo ANDROID_HOME=%ANDROID_HOME%
