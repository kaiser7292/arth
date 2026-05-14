---
description: Handle Artha APK build workflow from source to GitHub release
---

# Artha Build Workflow Skill

Handles the complete build process for Artha APKs, including syncing files between repos, building with Gradle, and uploading to GitHub releases.

## Prerequisites

- gh CLI installed at C:\Users\soura\scoop\apps\gh\2.92.0\bin\gh.exe
- git installed at C:\Users\soura\scoop\apps\git\2.54.0\mingw64\bin\git.exe
- Both repos accessible: artha (dev) and artha-builds (build)

## Workflow

1. **Sync changed files from artha to artha-builds**
   - Identify files changed in artha repo
   - Copy to artha-builds maintaining directory structure
   - Special handling for Kotlin files (manual patch required)

2. **Build APK**
   - Navigate to artha-builds/android directory
   - Run: `./gradlew assembleRelease`
   - Build time: 3-5 minutes (subsequent builds)
   - APK location: android/app/build/outputs/apk/release/app-release.apk

3. **Upload to GitHub release**
   - Set PATH for git: `$env:PATH = "C:\Users\soura\scoop\apps\git\2.54.0\mingw64\bin;" + $env:PATH`
   - Navigate to artha-builds
   - Use full path to gh: `& "C:\Users\soura\scoop\apps\gh\2.92.0\bin\gh.exe"`
   - Upload: `gh release upload <tag> android\app\build\outputs\apk\release\app-release.apk --clobber`

## Common Patterns

**Always use absolute paths when switching repos:**
```powershell
cd C:\Users\soura\OneDrive\Documents\artha-builds
```

**PowerShell uses semicolon not &&:**
```powershell
cd C:\Users\soura\OneDrive\Documents\artha-builds\android; .\gradlew assembleRelease
```

**Build command:**
```powershell
cd C:\Users\soura\OneDrive\Documents\artha-builds\android; .\gradlew assembleRelease
```

**Upload command:**
```powershell
$env:PATH = "C:\Users\soura\scoop\apps\git\2.54.0\mingw64\bin;" + $env:PATH
cd C:\Users\soura\OneDrive\Documents\artha-builds
& "C:\Users\soura\scoop\apps\gh\2.92.0\bin\gh.exe" release upload v17.6.5-staging android\app\build\outputs\apk\release\app-release.apk --clobber
```

## Version Tagging

Version from app.json: e.g., 17.6.5
Release tag format: v17.6.5-staging (for staging builds)

## Key Files

- Main repo: C:\Users\soura\OneDrive\Documents\artha
- Build repo: C:\Users\soura\OneDrive\Documents\artha-builds
- APK: C:\Users\soura\OneDrive\Documents\artha-builds\android\app\build\outputs\apk\release\app-release.apk
