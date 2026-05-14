@echo off
setlocal
set REPO_ROOT=C:\Users\soura\artha
cd /d %REPO_ROOT%

REM Android SDK + JDK env
set JAVA_HOME=C:\Users\soura\scoop\apps\openjdk21\21.0.2-13
set ANDROID_HOME=C:\Users\soura\scoop\apps\android-clt\14742923
set ANDROID_SDK_ROOT=%ANDROID_HOME%
set PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\cmdline-tools\latest\bin;%ANDROID_HOME%\platform-tools;C:\Users\soura\scoop\apps\nodejs\25.5.0;C:\Users\soura\scoop\shims;%PATH%

REM Local-properties sanity
if not exist "android\local.properties" (
  echo sdk.dir=%ANDROID_HOME% > android\local.properties
)

REM Tailwind copy sanity
if not exist "android\tailwind.config.js" (
  copy tailwind.config.js android\tailwind.config.js
)

REM Read version from app.json
for /f "tokens=*" %%i in ('C:\Users\soura\scoop\apps\nodejs\25.5.0\node.exe -p "require('./app.json').expo.version"') do set APP_VERSION=%%i

REM Parse version and compute versionCode
for /f "tokens=1,2,3 delims=." %%a in ("%APP_VERSION%") do (
  set MAJOR=%%a
  set MINOR=%%b
  set PATCH=%%c
)
if "%MAJOR%"=="" set MAJOR=0
if "%MINOR%"=="" set MINOR=0
if "%PATCH%"=="" set PATCH=0

REM Calculate versionCode (major*10000 + minor*100 + patch)
set /a VERSION_CODE=%MAJOR%*10000 + %MINOR%*100 + %PATCH%

echo ==> Version: %APP_VERSION% (versionCode %VERSION_CODE%)

cd android

REM Run gradlew assembleRelease
echo ==> Building release APK (Gradle direct)
call gradlew.bat assembleRelease "-PappVersionName=%APP_VERSION%" "-PappVersionCode=%VERSION_CODE%"

set APK_SRC=app\build\outputs\apk\release\app-release.apk
if not exist "%APK_SRC%" (
  echo ==> BUILD DID NOT PRODUCE APK AT %APK_SRC%
  exit /b 1
)

REM Copy to repo root with timestamp
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set datetime=%%I
set TIMESTAMP=%datetime:~0,13%000
set DEST=%REPO_ROOT%\build-%TIMESTAMP%.apk
copy "%APK_SRC%" "%DEST%"

for %%F in ("%DEST%") do set APK_SIZE=%%~zF
set /a APK_SIZE_MB=%APK_SIZE%/1048576

echo.
echo ==> BUILD OK
echo     APK: %DEST%
echo     Size: %APK_SIZE_MB% MB

endlocal
