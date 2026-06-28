@echo off
setlocal EnableDelayedExpansion
set REPO_ROOT=C:\Users\soura\artha
cd /d %REPO_ROOT%

REM Stash uncommitted changes so the temporary app.json edit below (and its
REM `git checkout app.json` revert) can't clobber any in-progress edits of yours.
REM If the script exits early, app.json is restored and the stash is popped.
git diff-index --quiet HEAD >nul 2>&1
if errorlevel 1 (
    echo Stashing uncommitted changes...
    git stash push -m "build-local-stash" --include-untracked >nul 2>&1
    if errorlevel 1 (
        echo ERROR: git stash failed
        exit /b 1
    )
    set STASHED=1
) else (
    set STASHED=0
)

REM Android SDK + JDK env
set JAVA_HOME=C:\Users\soura\scoop\apps\openjdk21\21.0.2-13
set ANDROID_HOME=C:\Users\soura\scoop\apps\android-clt\14742923
set ANDROID_SDK_ROOT=%ANDROID_HOME%
set PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\cmdline-tools\latest\bin;%ANDROID_HOME%\platform-tools;C:\Users\soura\scoop\apps\nodejs\25.5.0;C:\Users\soura\scoop\shims;%PATH%

REM Check current branch
for /f "delims=" %%i in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%i
echo Current branch: %BRANCH%

REM Determine if staging branch
if "%BRANCH%"=="staging" (
    echo Staging branch detected - applying staging modifications
    set PACKAGE_NAME=com.souravbaid.artha.staging
    set APP_NAME=Arth Stg
    set APK_NAME=arth-staging
    set ABI_FLAG=-PreactNativeArchitectures=arm64-v8a
) else (
    echo Main branch detected
    set PACKAGE_NAME=com.souravbaid.artha
    set APP_NAME=Arth
    set APK_NAME=arth
    set ABI_FLAG=-PreactNativeArchitectures=arm64-v8a
)

REM Modify package name in app.json
echo Modifying package name to %PACKAGE_NAME%
powershell -Command "(Get-Content app.json) -replace '\"package\": \"com.souravbaid.artha\"', '\"package\": \"%PACKAGE_NAME%\"' | Set-Content app.json"
powershell -Command "(Get-Content app.json) -replace '\"name\": \"Arth\"', '\"name\": \"%APP_NAME%\"' | Set-Content app.json"

REM Read version from app.json
for /f "tokens=*" %%i in ('node -p "require('./app.json').expo.version"') do set VERSION=%%i
echo App version: %VERSION%

REM Parse version code
for /f "tokens=1,2,3 delims=." %%a in ("%VERSION%") do (
    set MAJOR=%%a
    set MINOR=%%b
    set PATCH=%%c
)
set /a VERSION_CODE=MAJOR*10000+MINOR*100+PATCH
echo Version code: %VERSION_CODE%

REM Regenerate android/ directory for this Windows machine
REM CNG requires platform-specific native directories - cannot be shared
echo Regenerating android/ directory for local build...
npx expo prebuild --platform android --clean

REM Create local.properties (forward slashes required for Gradle)
REM Convert Windows backslashes to forward slashes to avoid
REM "The filename, directory name, or volume label syntax is incorrect"
set ANDROID_HOME_FWD=%ANDROID_HOME:\=/%
echo sdk.dir=%ANDROID_HOME_FWD% > android\local.properties

REM Copy tailwind config
copy tailwind.config.js android\tailwind.config.js >nul

REM Build APK
echo Building APK...
cd android
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\cmdline-tools\latest\bin;%ANDROID_HOME%\platform-tools;C:\Users\soura\scoop\apps\nodejs\current;C:\Users\soura\scoop\shims;%PATH%"
call gradlew.bat assembleRelease --build-cache -PappVersionName=%VERSION% -PappVersionCode=%VERSION_CODE% %ABI_FLAG%
set BUILD_ERROR=%ERRORLEVEL%
cd ..

REM If Gradle failed, restore app.json and pop stash before exit.
if %BUILD_ERROR% neq 0 (
    echo BUILD FAILED
    git checkout app.json >nul 2>&1
    if "!STASHED!"=="1" git stash pop >nul 2>&1
    exit /b 1
)

if not exist "android\app\build\outputs\apk\release\app-release.apk" (
    echo ERROR: APK not found at expected path
    git checkout app.json >nul 2>&1
    if "!STASHED!"=="1" git stash pop >nul 2>&1
    exit /b 1
)

REM Create builds folder
if not exist "builds" mkdir builds

REM Generate timestamp
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set DT=%%I
set TIMESTAMP=%DT:~0,13%000

set APK_FILE=%APK_NAME%-%VERSION%-%TIMESTAMP%.apk
echo Copying APK to builds folder...
copy "android\app\build\outputs\apk\release\app-release.apk" "builds\%APK_FILE%" >nul

REM Restore app.json so the package name change never lands in any commit.
git checkout app.json >nul 2>&1

echo.
echo Build OK: builds\%APK_FILE%
echo To publish: gh release upload ^<tag^> builds\%APK_FILE%

if "!STASHED!"=="1" git stash pop >nul 2>&1

