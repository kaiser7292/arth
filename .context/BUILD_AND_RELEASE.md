# Build & Release Process

## Complete Release Checklist (Do This Every Release)

```
1. Make code changes, test locally
2. Bump version in app.json  (expo.version + expo.android.versionCode)
3. Commit the version bump:  git commit -m "chore(release): bump version to X.Y.Z"
4. Commit all other changes: git commit -m "feat/fix/chore: description"
5. Create and push git tag:  git tag vX.Y.Z && git push origin master --tags
6. Run local build:          build-local.bat  (from repo root)
7. Create GitHub release:    gh release create vX.Y.Z --title "Arth vX.Y.Z" --notes "..."
8. Upload APK:               gh release upload vX.Y.Z builds\<apk-file>
```

### Version Bump Rules
- **PATCH** (X.Y.Z+1): Bug fixes, no new features
- **MINOR** (X.Y+1.0): 1–5 new features
- **MAJOR** (X+1.0.0): 6+ new features

### How to Bump Version (app.json)
```json
"version": "1.1.2",
"android": {
  "versionCode": 10102
}
```
Formula: `versionCode = major * 10000 + minor * 100 + patch`

---

## Automated Builds with GitHub Actions

The CI workflow only fires on pushes to `staging` or `main` branches (NOT `master`). The self-hosted runner must be online.

### Workflow
1. Push changes to `staging` → GitHub Actions builds staging APK → Creates release → Uploads APK
2. Test staging APK
3. If good, merge to `main` → GitHub Actions builds production APK → Creates release → Uploads APK

### Staging vs Main Builds

| Aspect | Staging | Main |
|--------|---------|------|
| **Package Name** | `com.souravbaid.artha.staging` | `com.souravbaid.artha` |
| **App Name** | "Arth Stg" | "Arth" |
| **Release Tag** | `vX.Y.Z-staging` | `vX.Y.Z` |
| **Purpose** | Testing new features | Production builds |
| **Install Behavior** | Separate app | Updates main app |

### GitHub Actions Workflow
- **Triggers**: Push to `staging` or `main` branches
- **Runner**: Self-hosted on the dev machine (Windows) — see `.github/workflows/build-apk.yml`. Sets up Java 21 via `actions/setup-java`; Android SDK is pre-installed (Android Studio), not provisioned per-run.
- **Staging**: Automatically changes package name to `com.souravbaid.artha.staging` and app name to "Arth Stg" (`sed` on `app.json`)
- **Main**: Uses production package name `com.souravbaid.artha` and app name "Arth"
- **Output**: Creates GitHub release with APK

### Workflow File
`.github/workflows/build-apk.yml` handles:
- Node.js and Java setup
- Android SDK configuration
- Expo prebuild
- Gradle build
- GitHub release creation
- APK upload to release

## Manual Builds (Local)

### Prerequisites

#### macOS with Apple Silicon
- **Node.js:** v25.5.0 (managed via .nvmrc)
- **Java:** JDK 21 from Android Studio (NOT Java 24 — breaks CMake/NDK)
- **Android SDK:** via `~/Library/Android/sdk`
- **EAS CLI:** `npm install -g eas-cli` (fallback build path only)

#### Windows
- **Node.js:** v25.5.0 (via Scoop)
- **Java:** JDK 21 (via Scoop)
- **Android SDK:** via `C:\Users\soura\AppData\Local\Android\Sdk`
- See [SETUP_GUIDE_WINDOWS.md](./SETUP_GUIDE_WINDOWS.md) for detailed Windows setup

### Required Environment Variables

#### macOS
```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
```

#### Windows (set in batch scripts)
```batch
set JAVA_HOME=C:\Users\soura\scoop\apps\openjdk21\21.0.2-13
set ANDROID_HOME=C:\Users\soura\AppData\Local\Android\Sdk
set PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%
```

### One-Time Setup

#### macOS
```bash
# local.properties for Gradle
echo "sdk.dir=$HOME/Library/Android/sdk" > android/local.properties

# NativeWind tailwind symlink
ln -sf ../tailwind.config.js android/tailwind.config.js
```

#### Windows (run configure-android.bat)
```batch
echo sdk.dir=C:\Users\soura\AppData\Local\Android\Sdk > android\local.properties
copy ..\tailwind.config.js tailwind.config.js
```

## Build Command

### Primary (v15.9.2+): Direct Gradle Wrapper — macOS only

`bin/build-apk.sh` hardcodes macOS SDK paths (`JAVA_HOME=/Applications/Android Studio.app/...`, `ANDROID_HOME=$HOME/Library/Android/sdk`) — it will fail as-is on Windows. There is no `build-apk.bat` of that exact name, but see "Windows local build" below for the actual (currently broken) equivalent.

```bash
./bin/build-apk.sh             # from repo root, macOS
./bin/build-apk.sh --clean     # after a branch switch or cache corruption
```

**What it does:**
1. Sets JAVA_HOME and ANDROID_HOME
2. Ensures `android/local.properties` and tailwind symlink exist
3. Reads version from `app.json`, computes versionCode
4. Runs `./gradlew assembleRelease` with version params
5. Copies APK to `./build-<timestamp>.apk` at repo root

### Windows local build (currently broken — see `.context/KNOWN_ISSUES.md`)

Root-level `.bat` files: `install-deps.bat`, `install-sdk.bat`, `configure-android.bat`, `prebuild-android.bat` are working one-time setup helpers (correct paths, match `SETUP_GUIDE_WINDOWS.md`). `build-local.bat` is meant to be the actual build+package step — `expo prebuild`, Gradle build, copy APK, then push it to a `builds/<branch>` branch on a remote called `origin-builds` — but it currently cannot run: it hardcodes a stale repo path (`c:\Users\soura\CascadeProjects\artha`, a near-empty leftover directory, not this repo) and `origin-builds` isn't a configured remote. Until fixed, the only reliable Windows build path is the GitHub Actions self-hosted runner (push to `staging`/`main` — see above), which does its own `expo prebuild` + Gradle invocation independent of any of these scripts.

### Fallback: EAS Build Local
```bash
eas build --platform android --profile preview --local --non-interactive
```

## Signing

**Keystore:** `bin/artha-release.keystore` (committed to repo)
- **Alias:** `artha`
- **Store/Key Password:** `artha-local`
- **SHA-256:** `9B:8B:80:23:97:81:80:5A:EF:B2:10:64:96:36:02:70:CC:C0:F8:67:4B:0F:12:18:52:D6:FF:6B:9A:CF:A5:C4`
- **Validity:** 25 years

Wired in `android/app/build.gradle` under `signingConfigs.release`.

## Full Release Pipeline

"Build" in this project means the complete pipeline:

```bash
# 1. Commit
git add <files>
git commit -m "feat/fix/chore: description"

# 2. Push
git push origin main

# 3. Create GitHub Release
gh release create vX.Y.Z --title "vX.Y.Z — description" --notes "changelog"

# 4. Build APK
./bin/build-apk.sh

# 5. Upload APK to Release
gh release upload vX.Y.Z ./build-*.apk
```

## Version Management

### Versioning Rules (Semantic)
- **PATCH** (X.Y.Z+1): Bug fixes, 0 new features
- **MINOR** (X.Y+1.0): 1–5 new features
- **MAJOR** (X+1.0.0): >5 new features

### Version Sources
- `app.json` → `expo.version` (display version, e.g., "1.0.0")
- `app.json` → `expo.android.versionCode` (integer, e.g., 170605)
- Formula: `major * 10000 + minor * 100 + patch`

### Git Conventions
```
feat(scope): add manual expense entry
fix(scope): handle HDFC SMS format
test(scope): add unit tests for budget logic
docs(scope): update Phase 1B features
chore(deps): upgrade expo-sqlite
```

## Common Build Failures

| Error | Fix |
|-------|-----|
| `SDK location not found` | Create `android/local.properties` |
| `Cannot find module 'tailwind.config'` | `ln -sf ../tailwind.config.js android/tailwind.config.js` |
| `could not determine executable to run` | `npm install -g eas-cli` |
| CMake/NDK failure | Ensure Java 21 (not 24) via JAVA_HOME |
| `workflow scope required` | `gh auth refresh -h github.com -s workflow` |

## GitHub Authentication
```bash
echo "ghp_TOKEN" | gh auth login --with-token
```
