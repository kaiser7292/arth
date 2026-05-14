# Setup Guide — New Machine / New Developer / New LLM

This document explains how to set up the Artha development environment from scratch on any machine.

## Platform-Specific Guides

- **macOS/Linux**: This document (primary development platform)
- **Windows**: See [SETUP_GUIDE_WINDOWS.md](./SETUP_GUIDE_WINDOWS.md) for Windows-specific setup instructions

## System Requirements

| Requirement | Minimum | Recommended | Notes |
|-------------|---------|-------------|-------|
| **OS** | macOS 13+ (ARM or Intel) | macOS 14+ (Apple Silicon M1+) | Android builds work on macOS. iOS builds need Xcode. |
| **RAM** | 8 GB | 16 GB+ | Gradle + Metro + emulator consume ~6 GB together |
| **Disk** | 20 GB free | 50 GB+ free | Android SDK + node_modules + Gradle cache |
| **Node.js** | v20+ | v25.5.0 (matches .nvmrc) | Use nvm or fnm to manage versions |
| **Java** | JDK 21 | Android Studio bundled JDK 21 | **NOT Java 24** — breaks CMake/NDK |
| **Android Studio** | 2024.1+ | Latest stable | Needed for SDK, emulator, JDK |
| **Git** | 2.30+ | Latest | — |
| **GitHub CLI** | 2.0+ | Latest | For releases and auth |

## Step-by-Step Setup

### 1. Clone the Repository
```bash
git clone https://github.com/kaiser7292/artha.git ~/accounts-manager-app
cd ~/accounts-manager-app
```

### 2. Install Node.js
```bash
# Using nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install    # reads .nvmrc → installs v25.5.0
nvm use

# Verify
node --version  # Should show v25.5.0
```

### 3. Install Dependencies
```bash
npm install
```

This installs 64+ packages including:
- **expo** (framework), **react-native** (runtime)
- **expo-sqlite** (database), **react-native-mmkv** (key-value store)
- **nativewind** + **tailwindcss** (styling)
- **react-native-reanimated** (animations)
- **react-native-svg** (charts)
- **expo-local-authentication** (biometric lock)
- **react-native-get-sms-android** (SMS reading)
- **react-native-aes-crypto** (backup encryption)
- **xlsx** (Excel import/export)
- **jest** + **jest-expo** + **@testing-library/react-native** (testing)
- **typescript**, **eslint**, **prettier** (dev tooling)

### 4. Install Android Studio + SDK
1. Download Android Studio from https://developer.android.com/studio
2. Install it (drag to Applications on macOS)
3. Open Android Studio → SDK Manager → Install:
   - Android SDK Platform 34 (or latest)
   - Android SDK Build-Tools
   - Android SDK Command-line Tools
   - Android Emulator
   - NDK (Side by side) — for native module compilation
4. Note the SDK location (usually `~/Library/Android/sdk`)

### 5. Install EAS CLI (optional, for fallback builds)
```bash
npm install -g eas-cli
```

### 6. Install GitHub CLI
```bash
brew install gh
# or download from https://cli.github.com/
```

### 7. Configure Environment Variables

Add to your shell profile (`~/.zshrc` or `~/.bashrc`):
```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
```

Then reload:
```bash
source ~/.zshrc
```

### 8. Generate Android Native Project
```bash
npx expo prebuild --platform android
```

This generates the `android/` directory from `app.json` configuration.

### 9. Configure Android Build
```bash
# Create local.properties
echo "sdk.dir=$HOME/Library/Android/sdk" > android/local.properties

# Create tailwind symlink (NativeWind needs this)
ln -sf ../tailwind.config.js android/tailwind.config.js
```

### 10. Verify Setup
```bash
# TypeScript compiles
npx tsc --noEmit

# Tests pass
npx jest

# Dev server starts
npx expo start
```

### 11. First Build
```bash
./bin/build-apk.sh
```

## Environment Variables Summary

| Variable | Value | Purpose |
|----------|-------|---------|
| `JAVA_HOME` | `/Applications/Android Studio.app/Contents/jbr/Contents/Home` | Gradle uses this for compilation |
| `ANDROID_HOME` | `$HOME/Library/Android/sdk` | SDK tools, platform-tools, build-tools |
| `PATH` | Includes `$JAVA_HOME/bin` and `$ANDROID_HOME/platform-tools` | Access to java, javac, adb |

## Dependencies Breakdown

### Production Dependencies (what ships in the APK)
| Package | Purpose |
|---------|---------|
| expo (~54.0.33) | App framework, managed native modules |
| react (19.1.0) | UI library |
| react-native (0.81.5) | Native bridge |
| expo-router (~6.0.23) | File-based navigation |
| expo-sqlite (~16.0.10) | SQLite database |
| react-native-mmkv (^3.3.3) | Fast key-value storage |
| nativewind (^4.2.3) | Tailwind CSS for React Native |
| react-native-reanimated (~4.1.1) | 60fps animations |
| react-native-svg (15.12.1) | SVG rendering (charts) |
| react-native-aes-crypto (^3.3.0) | AES-256-GCM encryption for backups |
| react-native-get-sms-android (^2.1.0) | Android SMS reading |
| expo-local-authentication (^55.0.13) | Biometric/passcode auth |
| expo-notifications (~0.32.16) | Push notifications |
| expo-file-system (~19.0.21) | File read/write |
| expo-document-picker (~14.0.8) | File picker UI |
| expo-sharing (~14.0.8) | Share sheet |
| expo-print (~15.0.8) | PDF generation |
| expo-haptics (~15.0.8) | Haptic feedback |
| expo-secure-store (^55.0.13) | Secure credential storage |
| xlsx (^0.18.5) | Excel file parsing/generation |
| @react-navigation/* | Navigation primitives |
| react-native-gesture-handler (~2.28.0) | Touch gestures |
| react-native-screens (~4.16.0) | Native screen containers |
| react-native-safe-area-context (~5.6.0) | Safe area insets |
| react-native-webview (^13.16.1) | WebView (PDF preview) |

### Dev Dependencies
| Package | Purpose |
|---------|---------|
| typescript (~5.9.2) | Type checking |
| jest (^29.7.0) + jest-expo (~54.0.17) | Test runner |
| @testing-library/react-native (^13.3.3) | Component testing utils |
| eslint (^9.25.0) + eslint-config-expo | Linting |
| prettier (^3.8.2) | Code formatting |
| tailwindcss (^3.4.19) | CSS utility classes (build-time) |

## Troubleshooting

### "Cannot find module 'tailwind.config'" during build
```bash
ln -sf ../tailwind.config.js android/tailwind.config.js
```

### Java version mismatch (CMake error)
Ensure JAVA_HOME points to JDK 21 from Android Studio, NOT Java 24:
```bash
java -version  # Should show 21.x
```

### Metro bundler won't start
```bash
npx expo start --clear
```

### Tests fail with "Cannot find module '@/services/...'"
The `@/*` path alias requires `tsconfig.json` and jest config both set up. This should work out of the box with the committed config.

### Android build fails with "SDK location not found"
```bash
echo "sdk.dir=$HOME/Library/Android/sdk" > android/local.properties
```

### expo prebuild wiped android/ directory
Re-apply after prebuild:
1. `echo "sdk.dir=$HOME/Library/Android/sdk" > android/local.properties`
2. `ln -sf ../tailwind.config.js android/tailwind.config.js`
3. Re-apply signing config in `android/app/build.gradle` (see BUILD_AND_RELEASE.md)

## Platform Notes

### macOS (primary development platform)
- Apple Silicon (M1/M2/M3): fully supported, ARM Android emulator available
- Intel Mac: supported but slower builds

### Linux
- Should work for Android builds (untested)
- Set JAVA_HOME to your JDK 21 installation path
- Install Android SDK via command-line tools

### Windows
- Use WSL2 for the best experience
- Android Studio for Windows + SDK
- Adjust paths accordingly (backslashes, different SDK location)

### iOS Development (planned, not yet built)
- Requires macOS + Xcode 15+
- `npx expo prebuild --platform ios`
- Then open in Xcode or `npx expo run:ios`
