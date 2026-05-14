# Setup Guide — Windows

This document explains how to set up the Artha development environment on Windows.

## System Requirements

| Requirement | Minimum | Recommended | Notes |
|-------------|---------|-------------|-------|
| **OS** | Windows 10/11 | Windows 11 | Android builds work natively on Windows |
| **RAM** | 8 GB | 16 GB+ | Gradle + Metro + emulator consume ~6 GB together |
| **Disk** | 20 GB free | 50 GB+ free | Android SDK + node_modules + Gradle cache |
| **Node.js** | v20+ | v25.5.0 (matches .nvmrc) | Use Scoop or nvm-windows to manage versions |
| **Java** | JDK 21 | Android Studio bundled JDK 21 | **NOT Java 24** — breaks CMake/NDK |
| **Android Studio** | 2024.1+ | Latest stable | Needed for SDK, emulator, JDK |
| **Git** | 2.30+ | Latest | — |
| **GitHub CLI** | 2.0+ | Latest | For releases and auth |

## Step-by-Step Setup

### 1. Install Scoop Package Manager

Scoop is a package manager for Windows that doesn't require admin rights.

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
Invoke-RestMethod -Uri https://get.scoop.sh | Invoke-Expression
```

### 2. Install Node.js v25.5.0

```powershell
scoop install nodejs-lts
scoop install nodejs@25.5.0
```

### 3. Install Java JDK 21

```powershell
scoop install openjdk21
```

### 4. Install Android Studio

```powershell
scoop install android-studio
```

### 5. Install Git

```powershell
scoop install git
```

### 6. Install GitHub CLI

```powershell
scoop install gh
```

### 7. Clone the Repository

```bash
git clone https://github.com/kaiser7292/artha.git C:\Users\soura\artha
cd C:\Users\soura\artha
```

### 8. Install Dependencies

Create a batch script to install dependencies with proper PATH:

```batch
@echo off
setlocal
set PATH=C:\Users\soura\scoop\apps\nodejs\25.5.0\bin;C:\Users\soura\scoop\apps\openjdk21\21.0.2-13\bin;C:\Users\soura\scoop\shims;%PATH%
set NODE_PATH=C:\Users\soura\scoop\apps\nodejs\25.5.0
cd /d C:\Users\soura\artha
C:\Users\soura\scoop\apps\nodejs\25.5.0\npm.cmd install --ignore-scripts
endlocal
```

Run the script:
```bash
install-deps.bat
```

### 9. Configure GitHub Authentication

```bash
gh auth login
# Or set token:
echo ghp_YOUR_TOKEN | gh auth login --with-token
```

### 10. Configure Environment Variables

Create a batch script to set environment variables:

```batch
@echo off
REM Environment setup for Artha build
set JAVA_HOME=C:\Users\soura\scoop\apps\openjdk21\21.0.2-13
set ANDROID_HOME=C:\Users\soura\AppData\Local\Android\Sdk
set ANDROID_SDK_ROOT=%ANDROID_HOME%
set PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\bin;%ANDROID_HOME%\cmdline-tools\latest\bin;%ANDROID_HOME%\platform-tools;C:\Users\soura\scoop\apps\nodejs\25.5.0;C:\Users\soura\scoop\shims;%PATH%
set NODE_PATH=C:\Users\soura\scoop\apps\nodejs\25.5.0
echo Environment variables set:
echo JAVA_HOME=%JAVA_HOME%
echo ANDROID_HOME=%ANDROID_HOME%
```

### 11. Accept Android SDK Licenses

Open Android Studio and use SDK Manager to accept licenses:
1. Open Android Studio
2. Go to Tools → SDK Manager
3. Accept all licenses
4. Install Android SDK Platform 34 (or latest)
5. Install Android SDK Build-Tools
6. Install Android SDK Command-line Tools
7. Install NDK (Side by side) — for native module compilation

### 12. Generate Android Native Project

Create a batch script:

```batch
@echo off
setlocal
set PATH=C:\Users\soura\scoop\apps\nodejs\25.5.0;C:\Users\soura\scoop\apps\openjdk21\21.0.2-13\bin;C:\Users\soura\scoop\shims;%PATH%
set NODE_PATH=C:\Users\soura\scoop\apps\nodejs\25.5.0
set JAVA_HOME=C:\Users\soura\scoop\apps\openjdk21\21.0.2-13
set ANDROID_HOME=C:\Users\soura\AppData\Local\Android\Sdk
cd /d C:\Users\soura\artha
C:\Users\soura\scoop\apps\nodejs\25.5.0\npx.cmd expo prebuild --platform android
endlocal
```

Run the script:
```bash
prebuild-android.bat
```

### 13. Configure Android Build

Create a batch script:

```batch
@echo off
setlocal
set ANDROID_HOME=C:\Users\soura\AppData\Local\Android\Sdk
cd /d C:\Users\soura\artha\android
echo sdk.dir=%ANDROID_HOME% > local.properties
cd /d C:\Users\soura\artha\android
copy ..\tailwind.config.js tailwind.config.js
endlocal
```

Run the script:
```bash
configure-android.bat
```

### 14. Build APK

Create a batch script:

```batch
@echo off
setlocal
set REPO_ROOT=C:\Users\soura\artha
cd /d %REPO_ROOT%

REM Android SDK + JDK env
set JAVA_HOME=C:\Users\soura\scoop\apps\openjdk21\21.0.2-13
set ANDROID_HOME=C:\Users\soura\AppData\Local\Android\Sdk
set ANDROID_SDK_ROOT=%ANDROID_HOME%
set PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\cmdline-tools\latest\bin;%ANDROID_HOME%\platform-tools;C:\Users\soura\scoop\apps\nodejs\25.5.0;C:\Users\soura\scoop\shims;%PATH%

REM Local-properties sanity
if not exist "android\local.properties" (
  echo sdk.dir=%ANDROID_HOME% > android\local.properties
)

REM Tailwind copy sanity
if not exist "android\tailwind.config.js" (
  copy ..\tailwind.config.js android\tailwind.config.js
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
```

Run the script:
```bash
build-apk.bat
```

## Environment Variables Summary

| Variable | Value | Purpose |
|----------|-------|---------|
| `JAVA_HOME` | `C:\Users\soura\scoop\apps\openjdk21\21.0.2-13` | Gradle uses this for compilation |
| `ANDROID_HOME` | `C:\Users\soura\AppData\Local\Android\Sdk` | SDK tools, platform-tools, build-tools |
| `PATH` | Includes `JAVA_HOME\bin` and `ANDROID_HOME\platform-tools` | Access to java, javac, adb |

## Staging vs Main Builds

### Staging Builds
- Package name: `com.souravbaid.artha.staging`
- App name: "Artha Stg"
- Separate app from main Artha
- For testing new features

### Main Builds
- Package name: `com.souravbaid.artha`
- App name: "Artha"
- Production builds

## Automated Builds with GitHub Actions

The project uses GitHub Actions for automated APK builds:

- **Triggers**: Push to `staging` or `main` branches
- **Staging**: Changes package name to `com.souravbaid.artha.staging`, app name to "Artha Stg"
- **Main**: Uses production package name `com.souravbaid.artha`, app name "Artha"
- **Output**: Creates GitHub release with APK

### Workflow
1. Push changes to staging → GitHub Actions builds staging APK → Creates release → Uploads APK
2. Test staging APK
3. If good, merge to main → GitHub Actions builds production APK → Creates release → Uploads APK

## Troubleshooting

### "node not recognized" during npm install
Use the `install-deps.bat` script which sets PATH and NODE_PATH properly.

### Android SDK license not accepted
Use Android Studio SDK Manager GUI to accept licenses manually.

### local.properties has trailing space
Manually recreate the file:
```batch
echo sdk.dir=C:\Users\soura\AppData\Local\Android\Sdk > android\local.properties
```

### Build fails with "filename, directory name, or volume label syntax is incorrect"
Check that `local.properties` has no trailing space and the SDK path is correct.

### expo prebuild fails with timeout
This is normal - the android directory will still be generated. Check if it exists after the command completes.

## Windows-Specific Notes

- **Scoop** is the preferred package manager (no admin rights needed)
- **Batch scripts** are used for environment setup and builds
- **Backslashes** in paths require careful handling in batch scripts
- **Android Studio SDK Manager GUI** is required for license acceptance
- **GitHub Actions** handles automated builds, reducing need for local builds

## Available Batch Scripts

| Script | Purpose |
|--------|---------|
| `install-deps.bat` | Install npm dependencies with proper PATH |
| `setup-env.bat` | Set environment variables for Java, Android, Node.js |
| `prebuild-android.bat` | Run expo prebuild to generate android/ directory |
| `configure-android.bat` | Configure local.properties and tailwind config |
| `build-apk.bat` | Build release APK using Gradle |
