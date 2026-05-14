# BottomSheet Alternative Research

Research third-party bottom sheet libraries to replace the current custom BottomSheet component that has keyboard handling and spacing issues.

## Recommended Solution: @gorhom/bottom-sheet

**Why this library:**
- Most popular and actively maintained (15k+ GitHub stars)
- Seamless keyboard handling for iOS & Android (solves the main issue)
- Smooth gesture interactions & snapping animations
- Built-in safe area support
- Already has required dependencies installed:
  - `react-native-reanimated: ~4.1.1` ✓
  - `react-native-gesture-handler: ~2.28.0` ✓
  - `react-native-safe-area-context: ~5.6.0` ✓

## Installation

```bash
npm install @gorhom/bottom-sheet
```

## Migration Plan

1. Install `@gorhom/bottom-sheet`
2. Create new `BottomSheet.tsx` wrapper using the library
3. Update all 7 sheets to use the new component:
   - EntryEditSheet
   - PrepaymentSheet
   - ManualCorrectionSheet
   - HisaabInclusionSheet
   - RecurringRuleSheet
   - LoanPaymentPickerSheet
   - PatternEditSheet
4. Test keyboard behavior on both iOS and Android
5. Test gesture navigation vs button navigation
6. Adjust spacing/padding as needed

## Key API Features

- `BottomSheetModal` - Modal presentation with keyboard handling
- `keyboardBehavior` - Config options for keyboard interaction
- `snapPoints` - Configurable sheet heights
- `enablePanDownToClose` - Gesture to close sheet
- `android_keyboardInputMode` - Android-specific keyboard handling

## Alternative Options Considered

1. **react-native-modal** - Basic modal, no bottom sheet specific features
2. **react-native-scroll-bottom-sheet** - Less popular, limited features
3. **Custom implementation with Platform API** - More complex, reinventing the wheel

## Next Steps

1. Confirm approval to proceed with `@gorhom/bottom-sheet`
2. Install and create wrapper component
3. Migrate one sheet as proof of concept (e.g., EntryEditSheet)
4. Test keyboard and spacing behavior
5. If successful, migrate remaining 6 sheets
