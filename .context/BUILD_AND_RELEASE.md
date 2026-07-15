# Build & Release Process

## Standard Release Flow (do this every time)

```
1. Make and commit all code changes
2. Bump version in app.json  →  expo.version + expo.android.versionCode
3. Commit everything + push:  git push origin master
4. Run expo prebuild (applies config plugins)
5. Run Gradle assembleRelease
6. Create GitHub release and upload APK
```

### Version Bump Rules
- **PATCH** (X.Y.Z+1): Bug fixes only
- **MINOR** (X.Y+1.0): 1–5 new features
- **MAJOR** (X+1.0.0): 6+ new features

### versionCode formula
`versionCode = major * 10000 + minor * 100 + patch`

Examples: `2.11.3` → `21103`

```json
"version": "2.11.3",
"android": {
  "versionCode": 21103
}
```

---

## Manual Build Steps (Windows PowerShell — use these)

All commands run from the repo root (`C:\Users\soura\artha`) unless noted.

### Step 1 — Stop any running Gradle daemons
```powershell
Get-Process -Name "java" -ErrorAction SilentlyContinue | Stop-Process -Force
```
Skip if nothing is running. Required if a previous build left a locked daemon.

### Step 2 — Expo prebuild
```powershell
npx expo prebuild --platform android
```
- **Do NOT use `--clean`** unless switching branches or after a native dependency change. Clean wipes the entire `android/` folder and triggers a slower full rebuild.
- Prebuild automatically applies all config plugins (`withArmOnly`, `withAapt2Fix`, `withLargeHeap`, etc.) — no manual patching of gradle files needed.
- Prebuild re-generates `android/app/build.gradle` and `android/gradle.properties` — never edit those files by hand between prebuilds, edits will be lost.

### Step 3 — Gradle assembleRelease
```powershell
cd android
.\gradlew assembleRelease
```
Build takes 3–8 minutes. Output: `android/app/build/outputs/apk/release/app-arm64-v8a-release.apk`

> **Note:** The APK filename is `app-arm64-v8a-release.apk` (not `app-release.apk`) because the `withArmOnly` config plugin enables ABI splits targeting arm64-v8a only. This is intentional — it strips x86/x86_64 emulator libs and cuts the APK from ~210 MB to ~120 MB.

### Step 4 — Create GitHub release
```powershell
cd ..   # back to repo root
gh release create vX.Y.Z "android/app/build/outputs/apk/release/app-arm64-v8a-release.apk#Arth-vX.Y.Z.apk" --title "vX.Y.Z" --notes "## What's new

- Bullet point"
```
This creates the git tag and GitHub release in one shot. No separate `git tag` step needed.

---

## Config Plugins (auto-applied by prebuild)

All plugins live in `plugins/` and are registered in `app.json` under `expo.plugins`.

| Plugin | What it does |
|--------|-------------|
| `withArmOnly` | Adds `splits { abi { include "arm64-v8a" } }` to `build.gradle`. Cuts APK from ~210 MB to ~120 MB by stripping x86/x86_64 emulator libs. Uses `splits` (NOT `ndk.abiFilters` — they conflict in AGP 8+). |
| `withAapt2Fix` | Writes `android.aapt2FromMavenOverride` to `gradle.properties` pointing to the SDK build-tools 35.0.0 AAPT2 binary. Prevents the AGP 8.11+ AAPT2 daemon crash on this Windows machine. |
| `withDisableBackup` | Disables Android auto-backup (privacy — no finance data in cloud). |
| `withLargeHeap` | Sets `android:largeHeap="true"` in the manifest. |
| `withNotificationListener` | Wires notification listener service. |

**Never edit `android/app/build.gradle` or `android/gradle.properties` directly** — changes are wiped on the next prebuild. All permanent customisations must go through a config plugin.

---

## APK Size Breakdown (v2.11.3)

| Layer | Size |
|-------|------|
| `lib/arm64-v8a` (native code) | ~88 MB |
| `assets` (JS bundle + bundled data) | ~14 MB |
| `classes*.dex` (Java/Kotlin) | ~34 MB |
| `res` + `resources.arsc` | ~7 MB |
| **Total** | **~120 MB** |

The arm64-v8a native libs are dominated by `llama.rn` (the AI assistant feature), which ships 6 ARM CPU-variant `.so` files (~60 MB) for runtime dispatch. This is unavoidable without removing the AI feature.

---

## Common Build Failures

| Error | Fix |
|-------|-----|
| `SDK location not found` | Prebuild wiped `android/local.properties`. Re-create it: `"sdk.dir=C:/Users/soura/scoop/apps/android-clt/14742923" \| Out-File android\local.properties -Encoding utf8` |
| `AAPT2 daemon startup failed` | The `withAapt2Fix` plugin should prevent this. If it recurs, verify `android.aapt2FromMavenOverride` is in `android/gradle.properties` after prebuild. |
| `Conflicting configuration: ndk abiFilters cannot be present when splits abi filters are set` | `withArmOnly` now uses `splits` — if an old `ndk { abiFilters }` block remains in `build.gradle`, the plugin's regex didn't remove it. Check `withArmOnly.js`. |
| `EBUSY: resource busy` on prebuild | A Gradle daemon is holding a lock. Run Step 1 (Stop-Process java) and retry. |
| `workflow scope required` | `gh auth refresh -h github.com -s workflow` |
| Build succeeds but wrong APK filename | The splits plugin is applied. Look for `app-arm64-v8a-release.apk`, not `app-release.apk`. |
| expo prebuild fails | Run `npm install` first; check that Node is on PATH. |

---

## Signing

**Using debug keystore for release** (intentional for personal-use app):
- Keystore: `android/app/debug.keystore`
- Alias: `androiddebugkey` / Password: `android`
- Wired in `build.gradle` under `signingConfigs.release → signingConfig signingConfigs.debug`

SHA-256 fingerprint of the installed APK is tracked in the GitHub release notes for reference.

---

## Git Commit Convention
```
feat(scope): add thing
fix(scope): fix bug
test(scope): add tests
chore(scope): description
chore(release): bump version to X.Y.Z
```

## GitHub Actions (not used for master)

CI only fires on pushes to `staging` or `main` — NOT `master`. The self-hosted runner must be online. For `master` branch work (the normal case), use the manual steps above.

**Workflow file:** `.github/workflows/build-apk.yml`
