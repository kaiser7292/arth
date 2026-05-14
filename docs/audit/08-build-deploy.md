# Build & Deployment Audit

## Quick Wins (Low Effort, High Impact)

### 🟡 HIGH — `Update package name for staging` step uses `sed` with fragile pattern matching
**File:** `.github/workflows/build-apk.yml` lines 106–110  
```yaml
sed -i 's/"package": "com.souravbaid.artha"/"package": "com.souravbaid.artha.staging"/g' app.json
sed -i 's/"name": "Artha"/"name": "Artha Stg"/g' app.json
```
**Issue:** These `sed` replacements run on the raw `app.json` string. If `app.json` ever has the package name appear in a different context (e.g., inside a comment or a different field), the replacement would silently corrupt the config. Also, the `app.json` in the repo already has `"name": "Aartha Stg"` (not `"Artha"`) so the second sed is a no-op — it never matches.  
**User / UX Impact:** If `sed` corrupts `app.json` (e.g. double-replaces or produces malformed JSON), `expo prebuild` silently uses a broken config and the APK is built with the wrong package name. Users who install the corrupted staging APK can’t update it from future correct builds (package name mismatch causes install conflict), requiring a manual uninstall that loses all local test data. The dead `name` sed step means staging builds always ship as "Artha Stg" regardless of CI intention — a silent inconsistency.  
**Fix:** Use `node -e` to do proper JSON manipulation: `node -e "const c=require('./app.json'); c.expo.android.package='...'; require('fs').writeFileSync('./app.json', JSON.stringify(c,null,2))"`. This is JSON-safe and explicit.

---

### 🟡 HIGH — Self-hosted runner has no fallback — build silently hangs if machine is off
**File:** `.github/workflows/build-apk.yml` line 41  
```yaml
runs-on: self-hosted
```
**Issue:** If the self-hosted machine is off, in sleep, or the runner service crashed, the workflow queues indefinitely with no timeout and no notification. There's no `timeout-minutes` set on the job.  
**User / UX Impact:** A code commit that fixes a critical user-facing bug (e.g. a crash on the Expenses screen) won’t ship until the build completes. If the runner is sleeping, the fix silently sits in a queue for hours or days with no alert. Users continue experiencing the bug. The developer sees the workflow as "queued" but gets no notification and may not notice. The time-to-fix for production issues is directly tied to whether anyone manually notices the stuck runner.  
**Fix:** Add `timeout-minutes: 45` to the `build` job. Add a Slack/email notification step on failure.

---

### 🟡 HIGH — CI workflow modifies `app.json` in the checkout but `app.json` in the repo already has staging values
**File:** `.github/workflows/build-apk.yml` lines 105–110  
**Issue:** The workflow's `app.json` sed step tries to replace `"Artha"` with `"Artha Stg"` but the committed `app.json` already has `"name": "Aartha Stg"`. The CI step is effectively dead for the `name` field. Additionally the `package` field in `app.json` is `com.souravbaid.artha.staging` in the committed file — so the CI `sed` for package name is also a no-op on the staging branch.  
**User / UX Impact:** The dead sed steps create false confidence that CI is correctly separating staging from production config. If someone ever merges staging config back to main (e.g. during a branch reset), the main branch CI would build with the staging package name — shipping a production APK with `com.souravbaid.artha.staging` as the package ID. Users trying to update from the Play Store would get an install conflict and be unable to update without uninstalling (losing local data).  
**Fix:** Remove the dead `sed` steps for staging or document clearly what they were intended to do. If the CI is meant to handle both staging and production from the same `app.json`, use the `node -e` JSON approach above.

---

### 🟡 MEDIUM — No `lint` or `typecheck` step in CI
**File:** `.github/workflows/build-apk.yml`  
**Issue:** The workflow goes straight from `npm ci` to `expo prebuild` to `gradlew assembleRelease` with no type-checking or linting step. TypeScript errors that pass local dev but fail in stricter CI settings would only be caught at build time (Gradle/Metro errors) rather than early in the pipeline.  
**User / UX Impact:** TypeScript errors that only surface with `strict: true` or in a clean environment silently ship to users. A type error in a service function (e.g. wrong argument type on `createExpense`) could cause a runtime crash on the user’s device that was never caught in the build pipeline. The user sees an error; the developer sees a green CI build.  
**Fix:** Add a `npx tsc --noEmit` step after `npm ci` and before `expo prebuild`. Optionally add `npm run lint` as well. These are fast (< 1 min) and catch issues early.

---

### 🟡 MEDIUM — No `npm test` step in CI
**File:** `.github/workflows/build-apk.yml`  
**Issue:** The 53+ unit tests and 12+ integration tests are never run by the CI pipeline. Regressions are only caught manually.  
**User / UX Impact:** Every regression that a test would catch (wrong SMS amount parsing, budget calculation overflow, duplicate detection false positive) can ship directly to users. The entire test suite only has value if it runs automatically on every commit — currently it’s purely voluntary and easily forgotten in a fast-moving sprint. Users see regressions in features that were previously working.  
**Fix:** Add a `npm test -- --ci --forceExit` step before the build. Jest tests should run in < 2 min.

---

### 🟡 MEDIUM — `Copy tailwind config` step is fragile and unexplained
**File:** `.github/workflows/build-apk.yml` line 137  
```yaml
- name: Copy tailwind config
  run: cp tailwind.config.js android/tailwind.config.js
```
**Issue:** This manually copies a file into the `android/` directory. It's not clear why the android directory needs a copy of tailwind.config.js. If `android/` is re-generated by `expo prebuild`, this file is lost (the prebuild step clears it). The step only runs after prebuild, which is correct, but the reason is undocumented.  
**User / UX Impact:** If this step is accidentally removed or runs before prebuild (wrong order), NativeWind styles fail to compile in the Android build. The result is an APK where all Tailwind-styled screens render with no styles — plain unstyled components on a white background. Every screen in the app would look completely broken. This would be immediately obvious in QA but could cause a delayed release if discovered after a CI run.  
**Fix:** Add a comment explaining why this copy is needed. If it's a NativeWind build requirement, document the version and issue number.

---

### 🟡 MEDIUM — Release body includes raw `head_commit.message` without sanitization
**File:** `.github/workflows/build-apk.yml` line 179  
```yaml
${{ github.event.head_commit.message }}
```
**Issue:** Commit messages containing markdown, backticks, or YAML-special characters could corrupt the release body or (in extreme cases) inject content. For a private repo this is low-risk, but good practice to sanitize.  
**User / UX Impact:** No direct app-user impact (this affects GitHub Releases page only). For testers downloading staging APKs, a corrupted release body (e.g. broken markdown from a backtick-heavy commit message) makes the changelog unreadable. They can’t tell what changed in a build and may test the wrong features or miss critical regression fixes that were called out in the release notes.  
**Fix:** Wrap in a bash step that escapes or truncates the commit message before injecting into the release body.

---

### 🟢 LOW — `build-apk.bat`, `build-eas.bat`, `build-local.bat` etc. are undocumented
**Files:** Root `*.bat` files  
**Issue:** Multiple batch files exist at the root with no README explaining when to use which vs the CI workflow vs the artha-builds repo.  
**User / UX Impact:** No direct app-user impact. For the developer: running the wrong `.bat` file (e.g. `build-eas.bat` when intending a local build) could trigger an EAS cloud build, consuming build credits or producing a build with wrong signing keys. A wrong-signed APK can’t be installed alongside a correctly-signed production APK, requiring a fresh install and data loss for anyone testing.  
**Fix:** Add a `LOCAL_BUILD.md` (or update existing `docs/LOCAL_BUILD.md`) with a clear decision tree: use CI workflow for automated builds, use artha-builds repo for local manual builds, explain what each `.bat` file does.

---

### 🟢 LOW — `eas.json` exists but EAS builds are not the primary build path
**File:** `eas.json`  
**Issue:** `eas.json` is present but all actual builds go through the self-hosted GitHub Actions runner or the artha-builds repo. EAS config being stale/wrong could confuse contributors.  
**User / UX Impact:** No direct app-user impact. If a contributor runs `eas build` with the stale config, they may produce an APK with outdated signing config, wrong build profile, or missing env vars. Distributing that APK to a tester produces a non-updatable install (wrong signature) — the tester would need to wipe and reinstall, losing local test data.  
**Fix:** Either remove `eas.json` or add a comment at the top noting it's not actively used (the self-hosted CI is the primary path).

---

### 🟢 LOW — `android-cache` key includes `package-lock.json` hash but not `node_modules` hash
**File:** `.github/workflows/build-apk.yml` line 119  
**Issue:** The android cache key includes `hashFiles('package.json', 'package-lock.json', ...)` which correctly invalidates when native dependencies change. This is correct. However, if only dev deps change in `package-lock.json`, the android cache is unnecessarily invalidated. Low-impact but worth noting.  
**User / UX Impact:** No direct app-user impact. A dev-dep change (e.g. bumping a Jest version) causes a full Gradle rebuild on the next CI run — adding 15–20 extra minutes to the build. This delays how quickly a bug fix reaches users after a commit to `main` or `staging`. During a rapid hotfix cycle, an unnecessary cache miss could delay a critical fix shipping by 20+ minutes.  
**Fix:** Use only `package.json` (prod deps only) for the android cache key hash, not `package-lock.json`.

---

## Summary Table

| Severity | Issue | File | Effort |
|----------|-------|------|--------|
| 🟡 High | Fragile sed on app.json (already staged values) | build-apk.yml | 20 min |
| 🟡 High | No job timeout on self-hosted runner | build-apk.yml | 5 min |
| 🟡 High | Staging sed steps are no-ops (dead code) | build-apk.yml | 10 min |
| 🟡 Medium | No typecheck step in CI | build-apk.yml | 10 min |
| 🟡 Medium | No test step in CI | build-apk.yml | 10 min |
| 🟡 Medium | tailwind copy step undocumented | build-apk.yml | 5 min |
| 🟡 Medium | Raw commit message in release body | build-apk.yml | 15 min |
| 🟢 Low | Root .bat files undocumented | docs/ | 30 min |
| 🟢 Low | eas.json stale/unused | eas.json | 10 min |
| 🟢 Low | android cache key over-invalidates | build-apk.yml | 5 min |
