@echo off
setlocal EnableDelayedExpansion
set REPO_ROOT=C:\Users\soura\artha
cd /d %REPO_ROOT%

REM ============================================================
REM  Arth local build + release script
REM  Usage: build-local.bat
REM
REM  What it does:
REM    1. Reads version from app.json
REM    2. expo prebuild (clean) + Gradle assembleRelease
REM    3. Copies APK to builds\
REM    4. (release builds only) Creates git tag + GitHub release + uploads APK
REM
REM  Run from repo root. Requires: JDK 21, Android SDK, Node, gh CLI.
REM ============================================================

REM -- Stash any uncommitted changes so app.json edits (staging only)
REM    never land in a commit.
git diff-index --quiet HEAD >nul 2>&1
if errorlevel 1 (
    echo Stashing uncommitted changes...
    git stash push -m "build-local-stash" --include-untracked >nul 2>&1
    if errorlevel 1 ( echo ERROR: git stash failed & exit /b 1 )
    set STASHED=1
) else (
    set STASHED=0
)

REM -- Environment
set JAVA_HOME=C:\Users\soura\scoop\apps\openjdk21\21.0.2-13
set ANDROID_HOME=C:\Users\soura\scoop\apps\android-clt\14742923
set ANDROID_SDK_ROOT=%ANDROID_HOME%
set PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\cmdline-tools\latest\bin;%ANDROID_HOME%\platform-tools;C:\Users\soura\scoop\apps\nodejs\25.5.0;C:\Users\soura\scoop\shims;%PATH%

REM -- Branch
for /f "delims=" %%i in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%i
echo Branch: %BRANCH%

REM -- Build flavor
if "%BRANCH%"=="staging" (
    set PACKAGE_NAME=com.souravbaid.artha.staging
    set APP_NAME=Arth Stg
    set APK_NAME=arth-staging
    set IS_STAGING=1
) else (
    set PACKAGE_NAME=com.souravbaid.artha
    set APP_NAME=Arth
    set APK_NAME=arth
    set IS_STAGING=0
)
set ABI_FLAG=-PreactNativeArchitectures=arm64-v8a

REM -- For staging: temporarily patch app.json package/name
if "%IS_STAGING%"=="1" (
    echo Patching app.json for staging...
    powershell -Command "(Get-Content app.json) -replace '\"package\": \"com.souravbaid.artha\"', '\"package\": \"%PACKAGE_NAME%\"' | Set-Content app.json"
    powershell -Command "(Get-Content app.json) -replace '\"name\": \"Arth\"', '\"name\": \"%APP_NAME%\"' | Set-Content app.json"
)

REM -- Version from app.json
for /f "tokens=*" %%i in ('node -p "require('./app.json').expo.version"') do set VERSION=%%i
for /f "tokens=1,2,3 delims=." %%a in ("%VERSION%") do ( set MAJOR=%%a & set MINOR=%%b & set PATCH=%%c )
set /a VERSION_CODE=MAJOR*10000+MINOR*100+PATCH
echo Version: %VERSION%  ^(code: %VERSION_CODE%^)

REM -- expo prebuild (regenerates android/ for this machine)
echo Running expo prebuild...
npx expo prebuild --platform android --clean
if errorlevel 1 (
    echo ERROR: expo prebuild failed
    if "%IS_STAGING%"=="1" git checkout app.json >nul 2>&1
    if "!STASHED!"=="1" git stash pop >nul 2>&1
    exit /b 1
)

REM -- android/local.properties (wiped by prebuild)
set ANDROID_HOME_FWD=%ANDROID_HOME:\=/%
echo sdk.dir=%ANDROID_HOME_FWD% > android\local.properties

REM -- Gradle build (full path + --project-dir avoids PowerShell dot-parsing issues)
echo Building APK...
cmd /c "C:\Users\soura\artha\android\gradlew.bat --project-dir C:\Users\soura\artha\android assembleRelease --build-cache -PappVersionName=%VERSION% -PappVersionCode=%VERSION_CODE% %ABI_FLAG%"
set BUILD_ERROR=%ERRORLEVEL%

REM -- Restore app.json if we patched it
if "%IS_STAGING%"=="1" git checkout app.json >nul 2>&1

if %BUILD_ERROR% neq 0 (
    echo BUILD FAILED
    if "!STASHED!"=="1" git stash pop >nul 2>&1
    exit /b 1
)

if not exist "android\app\build\outputs\apk\release\app-release.apk" (
    echo ERROR: APK not found at expected path
    if "!STASHED!"=="1" git stash pop >nul 2>&1
    exit /b 1
)

REM -- Copy APK to builds\
if not exist "builds" mkdir builds
for /f "tokens=*" %%i in ('powershell -command "Get-Date -Format yyyyMMdd-HHmmss"') do set TIMESTAMP=%%i
set APK_FILE=%APK_NAME%-%VERSION%-%TIMESTAMP%.apk
copy "android\app\build\outputs\apk\release\app-release.apk" "builds\%APK_FILE%" >nul
if errorlevel 1 (
    echo ERROR: Could not copy APK to builds\
    if "!STASHED!"=="1" git stash pop >nul 2>&1
    exit /b 1
)
echo APK: builds\%APK_FILE%

REM -- Pop stash before releasing
if "!STASHED!"=="1" git stash pop >nul 2>&1

REM ============================================================
REM  GitHub release (release builds only, not staging)
REM ============================================================
if "%IS_STAGING%"=="0" (
    set TAG=v%VERSION%
    echo.
    echo --- GitHub Release ---

    REM Create git tag if it doesn't exist yet
    git rev-parse !TAG! >nul 2>&1
    if errorlevel 1 (
        git tag !TAG!
        git push origin !TAG!
        echo Created and pushed tag !TAG!
    ) else (
        echo Tag !TAG! already exists
    )

    REM Create GitHub release if it doesn't exist yet
    gh release view !TAG! --repo kaiser7292/artha >nul 2>&1
    if errorlevel 1 (
        echo Creating GitHub release !TAG!...
        if exist "RELEASE_NOTES.txt" (
            echo Using RELEASE_NOTES.txt for release body
            gh release create !TAG! --title "Arth !TAG!" --notes-file RELEASE_NOTES.txt --repo kaiser7292/artha
        ) else (
            echo WARNING: RELEASE_NOTES.txt not found - using auto-generated notes
            gh release create !TAG! --title "Arth !TAG!" --generate-notes --repo kaiser7292/artha
        )
        REM Archive the notes so they survive for reference
        if exist "RELEASE_NOTES.txt" (
            if not exist "releases" mkdir releases
            copy "RELEASE_NOTES.txt" "releases\!TAG!.md" >nul
            del "RELEASE_NOTES.txt"
            echo Archived release notes to releases\!TAG!.md
        )
    ) else (
        echo GitHub release !TAG! already exists - uploading APK to it
    )

    REM Upload APK
    echo Uploading APK...
    gh release upload !TAG! "builds\%APK_FILE%" --repo kaiser7292/artha --clobber

    echo.
    echo Release: https://github.com/kaiser7292/artha/releases/tag/!TAG!
)

echo.
echo ============================================================
echo  BUILD COMPLETE
echo  APK: builds\%APK_FILE%
echo ============================================================
