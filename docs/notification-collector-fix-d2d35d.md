# Fix Notification Collector — Full Rewrite

Rewrite the notification collector to write directly from native Kotlin to SQLite (survives app kills), use MMKV for the enabled flag, and wire proper Android permission flow.

## Problem Summary

1. **No `settings` table exists** — `getCollectionEnabledState()` queries a non-existent table, silently fails, always returns `false`. Switch turns itself off.
2. **Native Kotlin service never updated** — `artha-builds/android/app/.../NotificationListenerService.kt` still uses old code. Built APK has stale native code.
3. **Native service depends on JS runtime** — `currentReactContext` is null when app is killed. All background notifications are lost.
4. **Listener only registered on collector screen** — `setupNotificationListener()` is only called in `notification-collector.tsx` useEffect. Not active when user navigates away.
5. **No permission check or intent** — Toggle doesn't verify Android Notification Listener permission, doesn't open system settings.
6. **No lifecycle logging** — Can't tell if service is even bound by the OS.

## Changes

### 1. Native Kotlin Service — Write Directly to SQLite

**File:** `plugins/withNotificationListener.js` (generates `NotificationListenerService.kt`)

- Rewrite `sendToReactNative()` to open the app's SQLite DB directly via `android.database.sqlite.SQLiteDatabase`
- Insert into `notification_collector` table with the same schema the JS layer uses
- DB path: `/data/data/com.souravbaid.artha.staging/databases/artha.db`
- If DB is locked/busy, retry once after 100ms
- After successful DB write, emit to JS via `DeviceEventEmitter` (for immediate UI refresh when app is open)
- If `reactContext` is null, skip the emit — notification is already safely stored in DB
- Add `onListenerConnected()` / `onListenerDisconnected()` with Log.d so we can verify OS binding

### 2. JS Service — Use MMKV + Permission Check

**File:** `services/notification-collector.ts`

- Replace DB-based `getCollectionEnabledState` / `setCollectionEnabledState` with MMKV reads/writes
- Import `settingsStorage` from `services/storage` (already used app-wide for instant settings)
- Add `isNotificationAccessGranted()` using `Notifee` or `react-native-device-info` — actually, use a native module check. Simpler: check if our Kotlin service class `com.souravbaid.artha.NotificationListenerService` is in the enabled notification listeners list via `Settings.Secure.getString(contentResolver, "enabled_notification_listeners")`
- Add `openNotificationAccessSettings()` using Android intent `android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS`
- Keep `setupNotificationListener()` but make it fire-and-forget in `_layout.tsx`
- Listener queries the DB periodically (or on focus) rather than relying solely on events

### 3. App Startup — Register Listener Globally

**File:** `app/_layout.tsx`

- Import `setupNotificationListener` from `services/notification-collector`
- After `initDatabase()` completes, call `setupNotificationListener()` (non-blocking, `.catch` to swallow errors)
- Remove the call from `notification-collector.tsx` useEffect — it's now global

### 4. UI Screen — Permission-Aware Toggle

**File:** `app/settings/notification-collector.tsx`

- On mount, check both: (a) is collection enabled in MMKV, (b) is Android permission granted
- If MMKV says enabled but Android permission is NOT granted → show "Permission Required" banner with a button to open settings
- Toggle `onValueChange` flow:
  1. If turning ON and permission not granted → open Android notification access settings
  2. If turning ON and permission granted → set MMKV flag, show toast/alert
  3. If turning OFF → set MMKV flag off
- Refresh notifications list from DB on screen focus (pulls notifications written by native service while app was killed)
- Add a "Test" button that schedules a local notification and verifies it gets captured

### 5. Settings Table Migration (defensive)

**File:** `database/migrations/043_settings_table.ts`

- Create a proper `settings` table (`user_id`, `key`, `value`) even though we'll use MMKV for the collector
- This fixes the existing broken code paths in case anything else queries it
- Register in `database/migrations/index.ts`

### 6. Sync artha-builds

- Copy all changed files to `artha-builds` repo
- The plugin change will regenerate the Kotlin file on next `prebuild`, but since `android/` is committed, we need to either:
  - Run `npx expo prebuild --platform android --clean` in `artha-builds`, OR
  - Manually edit the `.kt` file in `artha-builds/android/app/src/main/java/com/souravbaid/artha/NotificationListenerService.kt` to match the plugin output
- We'll manually patch the `.kt` file to avoid a full prebuild

## Files Changed

| File | What |
|------|------|
| `plugins/withNotificationListener.js` | Rewrite Kotlin template to write to SQLite directly |
| `services/notification-collector.ts` | MMKV state, permission helpers, listener setup |
| `app/settings/notification-collector.tsx` | Permission-aware toggle, test button, refresh on focus |
| `app/_layout.tsx` | Global listener registration at startup |
| `database/migrations/043_settings_table.ts` | Create settings table (defensive) |
| `database/migrations/index.ts` | Register migration 043 |
| `artha-builds/.../NotificationListenerService.kt` | Manually patch to match new plugin output |
| `artha-builds/services/notification-collector.ts` | Sync JS changes |
| `artha-builds/app/settings/notification-collector.tsx` | Sync UI changes |
| `artha-builds/app/_layout.tsx` | Sync startup registration |

## Test Plan (manual)

1. Install APK, open Notification Collector screen
2. Toggle ON → should open Android "Notification access" settings
3. Grant permission for "Aartha Stg"
4. Return to app → toggle should show ON, banner should say "Permission granted"
5. Send yourself a WhatsApp message or any notification
6. Check Notification Collector screen → notification should appear in list
7. Kill the app (swipe away from recents)
8. Send another notification
9. Reopen app → go to Notification Collector → notification should be there (written by native service while app was killed)
10. Check `adb logcat | grep NotificationListener` to see native service logs

## Note on Rebuild

After these changes, a full APK rebuild is required because:
- The native Kotlin service code changes
- The JS bundle changes

The user will need to run `.\build-apk.bat` in `artha-builds` after syncing.
