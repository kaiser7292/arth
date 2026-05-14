# Local Build Mechanism with GitHub Upload

Enable local builds on laptop that upload APK to GitHub, while keeping GitHub Actions auto-build on commit.

## Requirements (from user)
1. Trigger: Script command
2. Upload location: Separate folder in artha project, upload that folder to GitHub
3. Package name: Yes, apply staging name modification
4. Skip Actions: Yes, skip GitHub Actions build when doing local build
5. Upload type: Artifact with date/timestamp to identify latest builds

## Implementation Plan

### 1. Create local build script (build-local.bat)
- Modify package name to "Artha Staging" if on staging branch
- Build APK locally using Gradle
- Create `builds/` folder in project root
- Copy APK to `builds/` with date/timestamp (e.g., `artha-staging-2026-05-11-22-30.apk`)
- Commit and push the `builds/` folder to a separate branch (e.g., `builds/staging`)
- Use `[skip ci]` in commit message to skip GitHub Actions

### 2. Add builds/ to .gitignore
- Keep local builds folder ignored from main branch
- But allow it in the builds/ branch

### 3. Create usage documentation
- Document how to run `build-local.bat`
- Explain the builds/ folder structure

