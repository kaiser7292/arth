# Fix Version Bump and Settings Build Issues

Investigate and fix why the APK build is not reflecting the correct version (17.7.11) and why settings changes are not appearing.

## Root Cause Analysis

**Version Issue:**
- The `Version` file in both repos shows 17.7.11 (versionCode 170711)
- BUT the `app.json` file in both repos still shows version "17.7.4" and versionCode 170704
- The `app.json` is what Expo uses to generate the Android manifest and APK version
- Only updating the `Version` file is insufficient - `app.json` must also be updated

**Settings Issue:**
- Searched for "redo onboarding" in settings.tsx - no references found
- The function `clearOnboardingCompletedVersion()` exists in services/settings.ts but is not called from the UI
- This suggests the "redo onboarding" feature was either never added to the UI or was already removed
- However, there ARE staged changes in artha-builds that include settings reorganization

**Staged Changes in artha-builds (ALL part of the work):**
- app/(tabs)/expenses.tsx - Changes to expenses screen
- app/(tabs)/settings.tsx - Removing redo onboarding section, removing export logs section
- app/_layout.tsx - Removing classification system initialization, fixing error handling order
- app/settings/export-logs.tsx -> app/settings/exportLogs.tsx - Renamed file with UI improvements
- services/account-transfer.ts - Added getExpensesLinkedToTransfers function

## Fix Plan

1. **Update app.json in both repos** ✅ COMPLETED
   - Change version from "17.7.4" to "17.7.11"
   - Change versionCode from 170704 to 170711
   - Updated in: `C:\Users\soura\OneDrive\Documents\artha\app.json` ✅
   - Updated in: `C:\Users\soura\OneDrive\Documents\artha-builds\app.json` ✅

2. **Commit all changes in artha-builds** ✅ COMPLETED
   - All staged changes (expenses, settings, layout, exportLogs, account-transfer) committed
   - All unstaged changes (Version, app.json, bottom sheets, deleted files) committed
   - APK files removed from git and committed

3. **Commit app.json in artha repo** - PENDING
   - Only app.json was staged, needs to be committed

4. **Run expo prebuild to regenerate Android files** - PENDING
   - This will update the Android manifest with the new version from app.json
   - Command: `npx expo prebuild --platform android --clean`
   - Run in artha-builds directory

5. **Rebuild APK** - PENDING
   - Command: `cd android && ./gradlew assembleRelease`

6. **Upload new APK** - PENDING
   - Create new GitHub release with version v17.7.11-staging
   - Upload the APK

## Notes

- The `Version` file is used for display purposes but `app.json` is the source of truth for the APK version
- Running `expo prebuild` is necessary to regenerate the Android manifest with the updated version
- The staged changes in artha-builds ARE part of the work (settings reorganization, removing redo onboarding, etc.)
- All changes have been committed in artha-builds, only artha repo app.json commit remains
