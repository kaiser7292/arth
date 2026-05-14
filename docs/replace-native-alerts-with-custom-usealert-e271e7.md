# Replace Native Alert.alert() with Custom useAlert Hook (v18.0.1 Patch)

This plan replaces all 23 instances of React Native's native `Alert.alert()` with the app's custom `useAlert()` hook to ensure all popups adhere to the system design, as a patch for version 18.0.1 to be deployed to staging and main branches.

## Problem

The app uses React Native's native `Alert.alert()` in 4 files, which doesn't follow the app's custom design system. The custom `useAlert()` hook in `hooks/use-alert.tsx` provides:
- Theme-aware colors (light/dark mode)
- Smooth animations (fade in/out, scale)
- Styled buttons (default, cancel, destructive)
- Consistent card styling with shadows
- Custom backdrop with tap-to-dismiss

## Files to Update

### 1. services/sms/sms-permissions.ts (1 instance)
- **Line 207**: `showPermissionExplanation()` function
- **Change**: Replace native `Alert.alert()` with custom alert
- **Note**: This is the SMS permission popup that appears when enabling SMS scanning from settings

### 2. app/settings/kite-connect.tsx (7 instances)
- **Line 47**: API Key Required alert
- **Line 65**: Failed to initiate Kite login error
- **Line 70**: Disconnect Kite confirmation
- **Line 82**: Disconnected success
- **Line 84**: Disconnect error
- **Line 110**: Connected success
- **Line 112**: Authentication error
- **Line 118**: Authentication failed/cancelled
- **Change**: Import and use `useAlert` hook instead of native Alert

### 3. app/settings/notification-collector.tsx (10 instances)
- **Line 75**: Marked as useful success
- **Line 77**: Mark as useful error
- **Line 85**: Marked as not useful success
- **Line 87**: Mark as not useful error
- **Line 92**: Delete notification confirmation
- **Line 105**: Delete error
- **Line 114**: Clear all notifications confirmation
- **Line 126**: Clear all success
- **Line 128**: Clear all error
- **Line 141**: Collection enabled info
- **Change**: Import and use `useAlert` hook instead of native Alert

### 4. app/settings/kite-connect-api-key.tsx (5 instances)
- **Line 38**: API key validation error
- **Line 45**: API key saved success
- **Line 48**: API key save error
- **Line 55**: Clear API key confirmation
- **Line 67**: API key cleared success
- **Line 70**: Clear API key error
- **Change**: Import and use `useAlert` hook instead of native Alert

## Implementation Steps

1. **Update services/sms/sms-permissions.ts**
   - Remove `Alert` from react-native imports
   - Update `showPermissionExplanation()` to return a Promise that resolves based on user choice
   - The caller (`requestSmsPermission()`) will need to be updated to use the custom alert pattern

2. **Update app/settings/kite-connect.tsx**
   - Add `useAlert` hook import
   - Remove `Alert` from react-native imports
   - Replace all `Alert.alert()` calls with `alert()` from the hook
   - Ensure component is wrapped with `AlertProvider` (check if already in _layout.tsx)

3. **Update app/settings/notification-collector.tsx**
   - Add `useAlert` hook import
   - Remove `Alert` from react-native imports
   - Replace all `Alert.alert()` calls with `alert()` from the hook

4. **Update app/settings/kite-connect-api-key.tsx**
   - Add `useAlert` hook import
   - Remove `Alert` from react-native imports
   - Replace all `Alert.alert()` calls with `alert()` from the hook

5. **Verify AlertProvider setup**
   - Check `app/_layout.tsx` to ensure `AlertProvider` wraps the entire app
   - If not present, add it to the root layout

## Testing Checklist

- [ ] Enable SMS scanning from settings - verify custom alert shows
- [ ] Connect to Kite - verify all alerts use custom styling
- [ ] Disconnect from Kite - verify confirmation dialog uses custom styling
- [ ] Mark notification as useful/not useful - verify success/error alerts
- [ ] Delete notification - verify confirmation dialog uses custom styling
- [ ] Clear all notifications - verify confirmation dialog uses custom styling
- [ ] Save Kite API key - verify success/error alerts use custom styling
- [ ] Clear Kite API key - verify confirmation dialog uses custom styling
- [ ] Test in both light and dark mode
- [ ] Verify button styles (cancel, destructive, default) render correctly

## Notes

- The custom `useAlert` hook API mirrors React Native's Alert API, so the transition is straightforward
- All existing button configurations (text, style, onPress) will work with the custom hook
- The custom hook supports async button handlers with loading states, which is an improvement over native Alert

## Version Update

This is a patch release for **version 18.0.1**:
- Update `app.json` version from `"18.0.0"` to `"18.0.1"`
- Update `app.json` versionCode from `180000` to `180001`
- Deploy to both **staging** and **main** branches

## Repository Cleanup

- **Delete the artha builds repository** after this patch is complete
- This repository is no longer needed as builds will be done locally and uploaded directly

## Build Instructions

### Windows (build-apk.bat)

```batch
cd C:\Users\soura\CascadeProjects\artha
build-apk.bat
```

The script:
- Sets up Android SDK and JDK environment variables
- Reads version from app.json and computes versionCode
- Runs Gradle assembleRelease with version parameters
- Outputs APK to repo root as `build-{timestamp}.apk`

### Mac/Linux (bin/build-apk.sh)

```bash
cd /path/to/artha
./bin/build-apk.sh              # Normal build
./bin/build-apk.sh --clean     # Clean build (after branch switch)
```

The script:
- Sets up Android SDK and JDK environment variables
- Ensures local.properties and tailwind symlink exist
- Reads version from app.json and computes versionCode
- Runs Gradle assembleRelease with version parameters
- Outputs APK to repo root as `build-{timestamp}.apk`

### Architecture Focus

Build is optimized for **arm64-v8a** architecture (new Android devices):
- The Gradle build automatically includes arm64-v8a ABI
- No additional flags needed - default release build includes all modern ABIs
- APK will be compatible with ARM64 devices (most modern Android phones)
- **Fallback**: If arm64v8a focused build encounters issues, use the normal Gradle build (default `assembleRelease`) which includes all ABIs

## APK Upload Instructions

### After Build

1. Locate the generated APK: `build-{timestamp}.apk` in repo root
2. Test the APK locally on an Android device
3. Upload to distribution platform (e.g., GitHub Releases, internal server)

### GitHub Release Upload (if applicable)

```bash
gh release create v18.0.1 \
  --title "v18.0.1 - Alert Design System Fix" \
  --notes "Replaces native Alert.alert() with custom useAlert hook for consistent design" \
  build-{timestamp}.apk
```

### Manual Upload

1. Navigate to your distribution platform
2. Create new release/tag: `v18.0.1`
3. Upload the APK file
4. Add release notes describing the alert design system fix
