#!/usr/bin/env bash
# Build a signed release APK directly via Gradle — bypasses `eas build --local`.
#
# Why: `eas build --local` creates a fresh UUID-scoped scratch directory every
# run (/var/folders/.../eas-build-local-nodejs/<uuid>/build/android/). That
# wipes Gradle's build cache (in ./build/) AND defeats ccache (include paths
# baked into compile command lines change every run). Direct Gradle against
# the persistent android/ directory keeps both caches warm.
#
# Signing: the release buildType in android/app/build.gradle points at the
# debug signingConfig — the standard setup for solo-dev + own-phone installs.
# If the app is ever shipped to Play Store, swap in a proper release keystore.
#
# Output: android/app/build/outputs/apk/release/app-release.apk, then copied
# to ./build-<timestamp>.apk at repo root (matching the old EAS convention so
# downstream tooling — gh release upload patterns, CLAUDE.md paths — keeps
# working).
#
# Usage: ./bin/build-apk.sh
#        ./bin/build-apk.sh --clean   (first build after a branch switch, or
#                                      if you suspect cache corruption)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Android SDK + JDK env — same set documented in CLAUDE.md.
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

# Local-properties sanity: Gradle needs to know where the Android SDK is.
if [ ! -f "android/local.properties" ]; then
  echo "sdk.dir=$ANDROID_HOME" > android/local.properties
fi

# Tailwind symlink sanity — NativeWind/Metro resolves tailwind.config.js
# relative to the android/ dir during the Expo autolinking phase.
if [ ! -e "android/tailwind.config.js" ]; then
  (cd android && ln -sf ../tailwind.config.js tailwind.config.js)
fi

CLEAN=0
if [ "${1:-}" = "--clean" ]; then
  CLEAN=1
fi

# Read version from app.json and compute versionCode the same way EAS does.
# Expo convention: versionCode = major*10000 + minor*100 + patch.
# Passed to Gradle as -PappVersionName / -PappVersionCode, which override the
# hardcoded defaults in android/app/build.gradle.
#
# IMPORTANT: android/ is gitignored (CNG). The companion edit lives in
# android/app/app/build.gradle:
#
#     def _appVersionCode = (findProperty('appVersionCode') ?: '150000') as String
#     def _appVersionName = (findProperty('appVersionName') ?: '15.0.0') as String
#     versionCode _appVersionCode.toInteger()
#     versionName _appVersionName
#
# If `expo prebuild --clean` ever wipes android/, re-apply the block above
# or this wrapper's -P flags have no effect (APK will ship with versionCode
# 150000 and fail to install over any 15.x build).
APP_VERSION=$(node -p "require('./app.json').expo.version")
IFS='.' read -r MAJOR MINOR PATCH <<< "$APP_VERSION"
MAJOR=${MAJOR:-0}; MINOR=${MINOR:-0}; PATCH=${PATCH:-0}
APP_VERSION_CODE=$((MAJOR * 10000 + MINOR * 100 + PATCH))

COMMIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
echo "==> Version: $APP_VERSION (versionCode $APP_VERSION_CODE), commit $COMMIT_SHA"

cd android

if [ "$CLEAN" -eq 1 ]; then
  echo "==> Clean build requested — running clean"
  ./gradlew clean
fi

# Bundle the JS first — Expo's gradle plugin does this automatically when
# `assembleRelease` runs, so we just delegate. Timing is captured via `time`.
echo "==> Building release APK (Gradle direct)"
# Daemon is on by default (per android/gradle.properties). Nothing to flag.
time ./gradlew assembleRelease \
  "-PappVersionName=$APP_VERSION" \
  "-PappVersionCode=$APP_VERSION_CODE"

APK_SRC="app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$APK_SRC" ]; then
  echo "==> BUILD DID NOT PRODUCE APK AT $APK_SRC" >&2
  exit 1
fi

# Copy to repo root with a timestamped name, matching the old EAS convention
# so `gh release upload` pipelines keep working unchanged.
TS=$(date +%s)000
DEST="$REPO_ROOT/build-${TS}.apk"
cp "$APK_SRC" "$DEST"

APK_SIZE=$(du -h "$DEST" | awk '{print $1}')
echo ""
echo "==> BUILD OK"
echo "    APK: $DEST"
echo "    Size: $APK_SIZE"
