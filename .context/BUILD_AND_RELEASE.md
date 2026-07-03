# Build & Release Process

## Standard Release Flow (do this every time)

```
1. Make and commit all code changes
2. Bump version in app.json  →  expo.version + expo.android.versionCode
3. Commit the bump:          git commit -m "chore(release): bump version to X.Y.Z"
4. Push to master:           git push origin master
5. Run:                      build-local.bat   (from repo root, double-click or cmd)
```

`build-local.bat` handles everything from step 5 onward automatically:
- expo prebuild (clean) + Gradle assembleRelease
- Copies APK to `builds\arth-X.Y.Z-TIMESTAMP.apk`
- Creates the git tag `vX.Y.Z` and pushes it
- Creates the GitHub release with auto-generated notes
- Uploads the APK to the release

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
| `SDK location not found` | `build-local.bat` auto-creates `android/local.properties`; if running Gradle manually, create it with `sdk.dir=C:/Users/soura/scoop/apps/android-clt/14742923` (forward slashes) |
| expo prebuild fails | Run `npm install` first; check Node version |
| `workflow scope required` | `gh auth refresh -h github.com -s workflow` |
| APK not found after build | Check Gradle output for the real error — usually a missing dependency or SDK component |

---

## Git Commit Convention
```
feat(scope): add thing
fix(scope): fix bug
test(scope): add tests
chore(release): bump version to X.Y.Z
```
