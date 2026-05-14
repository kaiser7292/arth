@echo off
setlocal
set JAVA_HOME=C:\Users\soura\scoop\apps\openjdk21\21.0.2-13
set ANDROID_HOME=C:\Users\soura\scoop\apps\android-clt\14742923
set ANDROID_SDK_ROOT=%ANDROID_HOME%
set PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\cmdline-tools\latest\bin;%ANDROID_HOME%\platform-tools;%PATH%

echo Installing Android SDK components...
cd /d %ANDROID_HOME%\cmdline-tools\latest\bin

echo Installing platform-tools...
call sdkmanager.bat "platform-tools"

echo Installing platform android-34...
call sdkmanager.bat "platforms;android-34"

echo Installing build-tools 34.0.0...
call sdkmanager.bat "build-tools;34.0.0"

echo Installing NDK 25.2.9519653...
call sdkmanager.bat "ndk;25.2.9519653"

echo SDK components installed successfully.
endlocal
