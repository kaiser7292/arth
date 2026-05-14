---
description: Update build workflow to sync source code files
---

# Update Build Workflow to Sync Source Code

Update the build workflow at `.windsurf/workflows/build.md` to include source code sync step, making it the norm to copy changed source files (not just android directory) from artha to artha-builds.

## Problem
The current workflow only syncs the android/ directory, but artha-builds has its own source code that needs to be kept in sync with artha. Without syncing source files, the APK build uses outdated code.

## Solution
Add a new step after android directory sync to copy changed source files from artha to artha-builds using git to identify modified files.

## Changes to Make
1. Add step 4.5: "Sync source code changes from artha to artha-builds"
2. Use git diff to identify changed files since last commit
3. Copy only changed source files (app/, services/, components/, etc.)
4. Update step numbering accordingly

## Implementation
```powershell
### 4.5. Sync source code changes to artha-builds
```powershell
cd C:\Users\soura\OneDrive\Documents\artha
$env:PATH = "C:\Users\soura\scoop\apps\git\2.54.0\mingw64\bin;" + $env:PATH
$changedFiles = git diff --name-only HEAD~1 HEAD
foreach ($file in $changedFiles) {
    if (Test-Path $file -PathType Leaf) {
        $dest = "C:\Users\soura\OneDrive\Documents\artha-builds\$file"
        $destDir = Split-Path $dest -Parent
        if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force }
        Copy-Item -Path $file -Destination $dest -Force
    }
}
```
