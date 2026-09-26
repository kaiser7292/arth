# Build & Release Process

## Standard Release Flow (do this every time)

```
1. Make and commit all code changes
2. Bump version in ALL of these (same X.Y.Z everywhere):
     app.json           →  expo.version + expo.android.versionCode
     package.json       →  "version"
     package-lock.json  →  top-level "version" + packages[""].version (first two "version" lines)
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

`app.json` is what the app actually reads (Settings shows `expoConfig.version`, and prebuild copies it into the Android `versionName`/`versionCode`). `package.json` / `package-lock.json` aren't read at runtime, but keep them in sync — they drifted from 3.12.0 to 3.16.7 unnoticed before being fixed in 3.16.8.

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
gh release create vX.Y.Z "android/app/build/outputs/apk/release/app-arm64-v8a-release.apk" --title "vX.Y.Z" --notes "## What's new

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
| `withReleaseSigning` | Signs release builds with the Arth release key from `~/.arth/signing.properties` (see Signing). |

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

Release builds (APK and AAB) are signed with the **Arth release key** by the `withReleaseSigning` config plugin. The same key signs the GitHub APK and is the Play app signing key, so Play and sideloaded installs update each other.

- Keystore: `C:\Users\soura\.arth\arth-release.jks` (alias `arth`, created 2026-09-26, valid until 2054)
- Build reads `~/.arth/signing.properties` (or the path in `ARTH_SIGNING_PROPERTIES`) with `storeFile`, `storePassword`, `keyAlias`, `keyPassword`. Outside the repo; never commit it.
- SHA-256 fingerprint: `4D:D5:90:CD:90:CA:6F:32:A9:3C:0B:6F:C6:A4:D4:DD:57:AA:52:72:97:74:01:6C:04:9C:34:E6:27:67:FA:EB`
- A release build **fails** if the properties file is missing, rather than falling back to the public debug key (a debug-signed APK can't update release-signed installs). `ARTH_ALLOW_DEBUG_SIGNING=1` overrides this for throwaway builds.
- GitHub Actions uses the same file: the self-hosted runner runs on this PC as the same Windows user.
- **The key cannot be recreated.** Losing it means no more updates on Play or GitHub. Backups: password manager + offline copy.

Builds up to v4.1.6 were signed with the public debug key. Moving to the release key requires a one-time backup, uninstall, reinstall, restore.

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
