# Build & Release Process

## Standard Release Flow (do this every time)

```
1. Make and commit all code changes
2. Bump version in app.json  →  expo.version + expo.android.versionCode
3. Commit the bump:          git commit -m "chore(release): bump version to X.Y.Z"
4. Commit any untracked files (see "Pre-build checklist" below)
5. Push to master:           git push origin master
6. Run steps below manually  (build-local.bat is unreliable — see known issue)
```

### Pre-build checklist (MUST do before building)

`build-local.bat` will fail silently if the working tree is dirty. **Always ensure:**

1. **No untracked files** — `git status` should show nothing (or only files you're sure are in `.gitignore`). Commit or gitignore any loose files.
2. **No existing stash** — `git stash list` should be empty. If there's a leftover `build-local-stash` entry, pop or drop it before running.
3. **`git diff-index --quiet HEAD` exits 0** — run this to confirm the tree is clean.

Untracked files (even spec/doc files in `.context/`) trigger the stash guard and cause it to fail with `ERROR: git stash failed` even though the stash itself succeeds.

### Version Bump Rules
- **PATCH** (X.Y.Z+1): Bug fixes only
- **MINOR** (X.Y+1.0): 1–5 new features
- **MAJOR** (X+1.0.0): 6+ new features

### versionCode formula
`versionCode = major * 10000 + minor * 100 + patch`

Example: `1.2.0` → `10200`

```json
"version": "1.2.0",
"android": {
  "versionCode": 10200
}
```

---

## Manual Build Steps (proven — use these instead of build-local.bat)

Run each step in PowerShell from the repo root. Replace `X.Y.Z` with the version.

### Step 1 — Expo prebuild
```powershell
$env:JAVA_HOME   = "C:\Users\soura\scoop\apps\openjdk21\21.0.2-13"
$env:ANDROID_HOME = "C:\Users\soura\scoop\apps\android-clt\14742923"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:PATH = "$($env:JAVA_HOME)\bin;$($env:ANDROID_HOME)\cmdline-tools\latest\bin;$($env:ANDROID_HOME)\platform-tools;C:\Users\soura\scoop\apps\nodejs\25.5.0;C:\Users\soura\scoop\shims;$($env:PATH)"

npx expo prebuild --platform android --clean
```

### Step 2 — Write local.properties (wiped by prebuild every time)
```powershell
"sdk.dir=C:/Users/soura/scoop/apps/android-clt/14742923" | Out-File -FilePath "android\local.properties" -Encoding utf8
```

### Step 3 — Gradle assembleRelease
```powershell
cmd /c "C:\Users\soura\artha\android\gradlew.bat --project-dir C:\Users\soura\artha\android assembleRelease -PreactNativeArchitectures=arm64-v8a"
```
Full paths + `--project-dir` are required — PowerShell misparses version strings like `1.2.0` otherwise.

### Step 4 — Copy APK to builds/
```powershell
$ts  = Get-Date -Format "yyyyMMdd-HHmmss"
$ver = "X.Y.Z"
Copy-Item "android\app\build\outputs\apk\release\app-release.apk" "builds\arth-$ver-$ts.apk"
```

### Step 5 — Tag and push
```powershell
git tag vX.Y.Z
git push origin vX.Y.Z
```

### Step 6 — Create GitHub release and upload APK
```powershell
$apk = (Get-ChildItem builds\arth-X.Y.Z-*.apk | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
gh release create vX.Y.Z $apk --title "vX.Y.Z" --generate-notes
```

---

## Known Issue: build-local.bat stash bug

`build-local.bat` has a Windows batch errorlevel bug in its stash guard:

```batch
git diff-index --quiet HEAD >nul 2>&1
if errorlevel 1 (
    git stash push -m "build-local-stash" --include-untracked >nul 2>&1
    if errorlevel 1 ( echo ERROR: git stash failed & exit /b 1 )
```

The `git stash push --include-untracked` can return exit code 1 in Windows CMD even when the stash is successfully created (e.g. when there's already a prior stash entry). The `if errorlevel 1` then triggers and aborts the build. This means the script works only when the working tree is **completely pristine** with no prior stash.

**Workaround:** Use the manual steps above. They bypass the stash entirely since they run each step directly from PowerShell.

---

## build-local.bat Reference

**Location:** repo root — `C:\Users\soura\artha\build-local.bat`

**Run from:** repo root (double-click or `cmd /c build-local.bat`)

**Requirements:** JDK 21, Android SDK, Node, `gh` CLI (all set up via Scoop)

**Paths baked in:**
```
JAVA_HOME    = C:\Users\soura\scoop\apps\openjdk21\21.0.2-13
ANDROID_HOME = C:\Users\soura\scoop\apps\android-clt\14742923
Node         = C:\Users\soura\scoop\apps\nodejs\25.5.0
```

**Gradle invocation** (the proven Windows pattern — do not change):
```
cmd /c "C:\Users\soura\artha\android\gradlew.bat --project-dir C:\Users\soura\artha\android assembleRelease ..."
```
This uses full paths + `--project-dir` to bypass PowerShell's dot-parsing of version strings like `1.2.0`.

**Branch behavior:**
| Branch | Package | App Name | GitHub Release? |
|--------|---------|----------|-----------------|
| master (or any non-staging) | `com.souravbaid.artha` | Arth | Yes |
| staging | `com.souravbaid.artha.staging` | Arth Stg | No |

---

## GitHub Actions (automated CI)

CI only fires on pushes to `staging` or `main` — NOT `master`. The self-hosted runner must be online.

**Workflow file:** `.github/workflows/build-apk.yml`

For `master` branch work (the normal case), use `build-local.bat` instead.

---

## Signing

**Keystore:** `bin/artha-release.keystore` (committed to repo)
- **Alias:** `artha`
- **Store/Key Password:** `artha-local`
- **SHA-256:** `9B:8B:80:23:97:81:80:5A:EF:B2:10:64:96:36:02:70:CC:C0:F8:67:4B:0F:12:18:52:D6:FF:6B:9A:CF:A5:C4`

Wired in `android/app/build.gradle` under `signingConfigs.release`.

---

## Common Build Failures

| Error | Fix |
|-------|-----|
| `ERROR: git stash failed` | Untracked files or an existing stash caused the stash guard to misfire. Commit all untracked files, pop any existing stash (`git stash list`), then use the **Manual Build Steps** above instead of `build-local.bat` |
| `SDK location not found` | Prebuild wiped `android/local.properties`. Re-create it: `"sdk.dir=C:/Users/soura/scoop/apps/android-clt/14742923" \| Out-File android\local.properties -Encoding utf8` |
| expo prebuild fails | Run `npm install` first; check Node version |
| `workflow scope required` | `gh auth refresh -h github.com -s workflow` |
| APK not found after build | Check Gradle output for the real error — usually a missing dependency or SDK component |
| Build says exit 0 but no APK / no release | `build-local.bat` exited silently after stash failure. The 2-line `build-X.Y.Z.log` is the tell. Use manual steps. |

---

## Git Commit Convention
```
feat(scope): add thing
fix(scope): fix bug
test(scope): add tests
chore(release): bump version to X.Y.Z
```
