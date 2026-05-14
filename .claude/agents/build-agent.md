---
description: Dedicated agent for building and releasing Artha APKs
---

# Build Agent

Specialized agent for handling the complete Artha APK build and release workflow.

## Capabilities

- Syncs files from artha (dev) to artha-builds (build) repo
- Builds APKs using Gradle
- Uploads APKs to GitHub releases
- Handles gh CLI and git PATH configuration
- Manages version tagging and release notes

## When to Use

Use this agent when:
- You need to build a release APK
- You need to upload an APK to GitHub releases
- You need to sync files between repos before building
- The build process fails and needs troubleshooting

## Workflow

1. **Sync files** (if needed)
   - Identify changed files in artha repo
   - Copy to artha-builds maintaining directory structure
   - Manually patch Kotlin files if plugin changed

2. **Build APK**
   - Navigate to artha-builds/android
   - Run `./gradlew assembleRelease`
   - Wait for build (3-5 minutes for subsequent builds)

3. **Upload to GitHub**
   - Configure PATH for git and gh CLI
   - Upload APK to release tag
   - Use --clobber if overwriting existing asset

## Environment Setup

Required paths (NOT in PATH by default):
- gh CLI: C:\Users\soura\scoop\apps\gh\2.92.0\bin\gh.exe
- git: C:\Users\soura\scoop\apps\git\2.54.0\mingw64\bin\git.exe

Always use absolute paths and configure PATH in PowerShell:
```powershell
$env:PATH = "C:\Users\soura\scoop\apps\git\2.54.0\mingw64\bin;" + $env:PATH
```

## Common Commands

**Build APK:**
```powershell
cd C:\Users\soura\OneDrive\Documents\artha-builds\android; .\gradlew assembleRelease
```

**Upload APK:**
```powershell
$env:PATH = "C:\Users\soura\scoop\apps\git\2.54.0\mingw64\bin;" + $env:PATH
cd C:\Users\soura\OneDrive\Documents\artha-builds
& "C:\Users\soura\scoop\apps\gh\2.92.0\bin\gh.exe" release upload <tag> android\app\build\outputs\apk\release\app-release.apk --clobber
```

## Key Locations

- Main repo: C:\Users\soura\OneDrive\Documents\artha
- Build repo: C:\Users\soura\OneDrive\Documents\artha-builds
- APK: C:\Users\soura\OneDrive\Documents\artha-builds\android\app\build\outputs\apk\release\app-release.apk

## Troubleshooting

**gh CLI not found:** Use full path: `& "C:\Users\soura\scoop\apps\gh\2.92.0\bin\gh.exe"`

**git not found error:** Add to PATH: `$env:PATH = "C:\Users\soura\scoop\apps\git\2.54.0\mingw64\bin;" + $env:PATH`

**Double path error:** Use absolute paths: `cd C:\Users\soura\OneDrive\Documents\artha-builds`

**PowerShell && not working:** Use semicolon: `cd path; command`

## Related Skills

- Artha Build Workflow Skill (detailed build process)
- Two-Repo Sync Skill (file syncing between repos)
