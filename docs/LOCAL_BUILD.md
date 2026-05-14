# Local Build Guide

This guide explains how to build the Artha APK locally and upload it to GitHub.

## Overview

The local build mechanism allows you to:
- Build APK on your laptop (faster than GitHub Actions)
- Upload the APK to a separate `builds/` branch on GitHub
- Skip GitHub Actions build with `[skip ci]` in commit message
- Track builds with date/timestamp in filename

## Usage

### Running the Local Build

From the project root, run:

```bash
build-local.bat
```

This script will:
1. Detect current branch (staging or main)
2. Modify package name for staging branch (com.souravbaid.artha.staging)
3. Build APK using Gradle locally
4. Copy APK to `builds/` folder with timestamp
5. Commit and push to `builds/<branch>` branch with `[skip ci]`

### Example Output

```
Starting local build...
Current branch: staging
Staging branch detected - applying staging modifications
Modifying package name to com.souravbaid.artha.staging
App version: 17.6.5
Version code: 170605
...
Local build complete!
APK: builds/artha-staging-17.6.5-2026-05-11-2230.apk
Uploaded to: builds/staging branch
```

## Build Artifacts

- Local builds are stored in `builds/` folder
- Filename format: `artha-staging-VERSION-TIMESTAMP.apk` or `artha-VERSION-TIMESTAMP.apk`
- Uploaded to GitHub branch: `builds/staging` or `builds/main`
- Folder is ignored from main branch (see .gitignore)

## GitHub Actions

The local build commits use `[skip ci]` in the commit message, which prevents GitHub Actions from triggering a redundant build on the `builds/` branch.

## Advantages

- **Faster builds**: Local builds leverage your machine's resources
- **No queue time**: No waiting for GitHub Actions runner availability
- **Immediate testing**: APK available immediately after build
- **History preserved**: All builds tracked in `builds/` branch with timestamps
