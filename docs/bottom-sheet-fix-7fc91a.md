# Bottom Sheet: Shared Component + Grounding Fix

Extract a reusable `BottomSheet` wrapper and migrate all 7 affected sheets to it, fixing the floating/open-bottom visual and keyboard avoidance.

---

## Root Cause

All sheets share an identical structure but each rolls its own `Modal + Pressable(backdrop) + KeyboardAvoidingView + Animated.View + insets`. The KAV is `position: absolute` with `bottom: 0`, which works fine when the keyboard is hidden — but when the keyboard appears, `behavior="padding"` pushes the KAV up and can leave a gap between the sheet bottom and the screen edge. `PatternEditSheet` additionally uses `pb-8` (32px hardcoded) instead of `insets.bottom`, which causes the floating look.

---

## Affected Files (7 sheets)

| File | Issue |
|------|-------|
| `components/simulator/EntryEditSheet.tsx` | KAV gap on keyboard, correct insets |
| `components/loans/PrepaymentSheet.tsx` | KAV gap, correct insets |
| `components/loans/ManualCorrectionSheet.tsx` | KAV gap, correct insets |
| `components/simulator/HisaabInclusionSheet.tsx` | KAV gap, correct insets |
| `components/expense/RecurringRuleSheet.tsx` | KAV gap, correct insets |
| `components/expense/LoanPaymentPickerSheet.tsx` | KAV gap, correct insets |
| `components/analytics/PatternEditSheet.tsx` | hardcoded `pb-8`, no insets |

---

## Plan

### Step 1 — Create `components/ui/BottomSheet.tsx`

New shared wrapper with this structure:

```
Modal (transparent, animationType="none")
  Pressable  ← full-screen backdrop, onPress=onClose
  KeyboardAvoidingView (absolute, left/right/bottom=0)
    Animated.View  ← slide-up, rounded-t-3xl, paddingBottom=insets.bottom
      drag handle
      {children}    ← header + ScrollView + action row passed in
```

**Key fixes baked in:**
- `paddingBottom: Math.max(insets.bottom, 8)` — always grounds to home indicator
- `keyboardVerticalOffset={insets.top}` — accounts for status bar height (the missing piece causing the gap on keyboard open)
- `maxHeight: "92%"` — prevents overflow on tall content
- Slide-in/out animation via `useSharedValue` + `withTiming`, exposed via `onClose` callback
- Drag handle always rendered

**Props:**
```ts
interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  maxHeightPct?: number;   // default 92
  children: React.ReactNode;
}
```

### Step 2 — Migrate all 7 sheets

For each sheet: replace the `Modal + backdrop + KAV + Animated.View + insets` block with `<BottomSheet visible={visible} onClose={handleClose}>`. The inner content (handle, header text, ScrollView, action buttons) stays untouched — only the outer wrapper changes.

`PatternEditSheet` also gets its hardcoded `pb-8` replaced by the component's `insets.bottom` padding.

### Step 3 — Verify

- TypeScript check: `npx tsc --noEmit` (no new errors in migrated files)
- Full test run: `npx jest --no-coverage`
- Manual: open each sheet with and without keyboard, confirm it's grounded

---

## Files Created / Modified

- **New:** `components/ui/BottomSheet.tsx`
- **Modified (7):** the sheets listed above
- **No logic changes** — only structural wrapper replacement
