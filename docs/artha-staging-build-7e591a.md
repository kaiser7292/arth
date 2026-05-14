# Artha Staging Branch Setup and APK Build Plan

This plan sets up the Artha React Native project on Windows using WSL2, configures GitHub authentication, builds a signed APK on the staging branch, and uploads it as a GitHub release.

## Current State

- **Repository:** Cloned to `C:\Users\soura\OneDrive\Documents\artha`
- **Branch:** Staging branch created and active
- **Main branch:** Untouched (stable)
- **Missing tools:** Node.js, npm, Java, Android SDK, Android Studio
- **Android directory:** Not yet generated (needs `expo prebuild`)

## Prerequisites Setup (WSL2)

### 1. Enable and Install WSL2
```powershell
wsl --install
```
- Reboot if prompted
- Set up Ubuntu username/password
- Update WSL: `wsl --update`

### 2. Install Node.js v25.5.0 in WSL2
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 25.5.0  # matches .nvmrc
nvm use 25.5.0
node --version  # verify
```

### 3. Install Java JDK 21 in WSL2
```bash
sudo apt update
sudo apt install openjdk-21-jdk
java -version  # verify shows 21.x
```

### 4. Install Android Studio in WSL2
```bash
# Download Android Studio for Linux
wget https://redirector.gvt1.com/edgedl/android/studio/ide-zips/2024.1.1.12/android-studio-2024.1.1.12-linux.tar.gz
sudo tar -xzf android-studio-*.tar.gz -C /opt
sudo /opt/android-studio/bin/studio.sh
```
- Complete Android Studio setup wizard
- Install SDK Platform 34, Build-Tools, Command-line Tools, NDK, Emulator
- Note SDK location (typically `~/Android/Sdk`)

### 5. Install npm dependencies
```bash
cd /mnt/c/Users/soura/OneDrive/Documents/artha
npm install
```

### 6. Configure environment variables in WSL2
Add to `~/.bashrc`:
```bash
export JAVA_HOME="/usr/lib/jvm/java-21-openjdk-amd64"
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
```
Then reload: `source ~/.bashrc`

## GitHub Token Configuration

### Configure Git authentication
```bash
cd /mnt/c/Users/soura/OneDrive/Documents/artha
git config --global credential.helper store
git config --global user.name "kaiser7292"
git config --global user.email "kaiser7292@users.noreply.github.com"
```

### Configure GitHub CLI with token
```bash
# Install GitHub CLI in WSL2
sudo apt install gh

# Authenticate with your token
echo "YOUR_GITHUB_TOKEN" | gh auth login --with-token
gh auth status  # verify
```

## Android Project Generation

### Generate android/ directory
```bash
cd /mnt/c/Users/soura/OneDrive/Documents/artha
npx expo prebuild --platform android
```

### Configure Android build
```bash
# Create local.properties
echo "sdk.dir=$HOME/Android/Sdk" > android/local.properties

# Create tailwind symlink
ln -sf ../tailwind.config.js android/tailwind.config.js
```

## Build Script Adaptation

The existing `bin/build-apk.sh` uses macOS paths. Create WSL2-compatible version:

### Create `bin/build-apk-wsl.sh`
```bash
#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# WSL2 Android SDK + JDK env
export JAVA_HOME="/usr/lib/jvm/java-21-openjdk-amd64"
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

# Local-properties sanity
if [ ! -f "android/local.properties" ]; then
  echo "sdk.dir=$ANDROID_HOME" > android/local.properties
fi

# Tailwind symlink sanity
if [ ! -e "android/tailwind.config.js" ]; then
  (cd android && ln -sf ../tailwind.config.js tailwind.config.js)
fi

CLEAN=0
if [ "${1:-}" = "--clean" ]; then
  CLEAN=1
fi

# Read version from app.json
APP_VERSION=$(node -p "require('./app.json').expo.version")
IFS='.' read -r MAJOR MINOR PATCH <<< "$APP_VERSION"
MAJOR=${MAJOR:-0}; MINOR=${MINOR:-0}; PATCH=${PATCH:-0}
APP_VERSION_CODE=$((MAJOR * 10000 + MINOR * 100 + PATCH))

echo "==> Version: $APP_VERSION (versionCode $APP_VERSION_CODE)"

cd android

if [ "$CLEAN" -eq 1 ]; then
  echo "==> Clean build requested — running clean"
  ./gradlew clean
fi

echo "==> Building release APK (Gradle direct)"
./gradlew assembleRelease \
  "-PappVersionName=$APP_VERSION" \
  "-PappVersionCode=$APP_VERSION_CODE"

APK_SRC="app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$APK_SRC" ]; then
  echo "==> BUILD DID NOT PRODUCE APK AT $APK_SRC" >&2
  exit 1
fi

TS=$(date +%s)000
DEST="$REPO_ROOT/build-${TS}.apk"
cp "$APK_SRC" "$DEST"

APK_SIZE=$(du -h "$DEST" | awk '{print $1}')
echo ""
echo "==> BUILD OK"
echo "    APK: $DEST"
echo "    Size: $APK_SIZE"
```

Make executable: `chmod +x bin/build-apk-wsl.sh`

## APK Build

### Build the APK
```bash
cd /mnt/c/Users/soura/OneDrive/Documents/artha
./bin/build-apk-wsl.sh
```

### Verify staging branch
```bash
git branch  # confirm staging is active
```

## GitHub Release Creation

### Create release for staging branch
```bash
# Get current version
VERSION=$(node -p "require('./app.json').expo.version")

# Create release on staging branch
gh release create "$VERSION-staging" \
  --title "v$VERSION (Staging)" \
  --notes "Staging build for testing and development" \
  --target staging \
  --draft
```

### Upload APK to release
```bash
gh release upload "$VERSION-staging" ./build-*.apk
```

### Publish release
```bash
gh release edit "$VERSION-staging" --draft=false
```

## Verification Steps

1. **Verify branch:** `git branch` shows `* staging`
2. **Verify main untouched:** `git log main` shows no new commits
3. **Verify APK built:** `ls -lh build-*.apk` shows file
4. **Verify release:** Check GitHub releases page for staging release
5. **Verify APK attached:** Release includes the APK file

## Important Notes

- **All work happens in staging branch only**
- **Main branch remains untouched throughout**
- **Keystore:** Uses committed `bin/artha-release.keystore` (alias: artha, password: artha-local)
- **Signing:** Configured in `android/app/build.gradle` (needs verification after prebuild)
- **Build artifacts:** APK copied to repo root as `build-<timestamp>.apk`
- **Release naming:** Uses version-staging format (e.g., 17.6.5-staging)
- **WSL2 file access:** Project mounted at `/mnt/c/Users/soura/OneDrive/Documents/artha`

## Estimated Time

- WSL2 setup: 30-45 minutes
- Android Studio + SDK: 45-60 minutes
- Dependencies: 10-15 minutes
- Prebuild: 5-10 minutes
- APK build: 15-30 minutes (first build), 5-10 minutes (subsequent)
- Release creation/upload: 5 minutes

**Total:** ~2-3 hours for first-time setup
