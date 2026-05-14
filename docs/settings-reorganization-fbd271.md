# Reorganize Settings Sections

Reorganize the settings screen by removing Redo Onboarding, moving Help Center to About section, and adding Security to Preferences section.

## Changes

1. **Remove Redo Onboarding**
   - Remove the conditional `SettingsRow` for "Redo Onboarding" (lines 540-550 in settings.tsx)
   - This removes the feature-flagged option to re-run onboarding

2. **Move Help Center to About**
   - Move the "Help Center" `SettingsRow` from the "Help & Support" card to the "About" card
   - Rename "About" card to "About & Help"
   - Remove the now-empty "Help & Support" card

3. **Add Security to Preferences**
   - Add a `SettingsRow` for "Security" in the "Preferences" card
   - Icon: `lock-closed-outline`
   - Label: "Security"
   - Subtitle: "App lock with biometric authentication"
   - Navigation: `/settings/security`
   - Rename "Preferences" card to "Preferences & Security"

## Files Modified
- `app/(tabs)/settings.tsx` - Reorganize Card components and SettingsRow items
