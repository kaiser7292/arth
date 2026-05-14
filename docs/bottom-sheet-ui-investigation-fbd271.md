# Bottom Sheet UI Investigation

Investigate UI differences between MultiSplitSheet (good pattern) and other bottom sheets to identify best practices for keyboard handling, padding, and layout.

## MultiSplitSheet (Reference - Good Pattern)

**Keyboard Handling:**
- `KeyboardAvoidingView behavior="padding"` at root level (wraps entire content)
- No `keyboardVerticalOffset` or `position: absolute`
- ScrollView has `max-h-[420px]` (fixed max height)

**Padding & Spacing:**
- Main container: `px-5 pb-8 pt-3`
- ScrollView: no padding, `max-h-[420px]`
- Form sections: `gap-3` (consistent vertical spacing)
- Input fields: `px-4 py-3` (person name), `px-3 py-2` (description/amount)
- Header: `mb-4` below handle bar

**Header:**
- Has close button (Ionicons close, p-1) in top-right
- Title changes based on state ("Split Expense" vs "Pick Person")
- Handle bar: `w-10 h-1 rounded-full` with `mb-4`

**Button Styling:**
- Confirm button: `mt-4 py-4 rounded-2xl` (larger, more prominent)
- Add split button: `py-3 rounded-xl border-dashed`
- Toggle buttons: `py-2 rounded-lg border` with active state styling

**Rounded Corners:**
- Main container: `rounded-t-3xl`
- Cards/sections: `rounded-xl`
- Avatar circles: `rounded-full`

**Other Patterns:**
- Uses `gap-3` for consistent vertical spacing between sections
- Person picker is inline (not separate modal)
- Add new person form is inline in picker
- Summary card with background color (`bg-surface-light-alt dark:bg-surface-dark`)

## EntryEditSheet (Simulator Entry)

**Keyboard Handling:**
- `KeyboardAvoidingView behavior="padding"` with `keyboardVerticalOffset={0}`
- Position: `absolute, left: 0, right: 0, bottom: 0`
- maxHeight: `"92%"` (percentage, not fixed pixels)
- ScrollView: `contentContainerStyle={{ paddingBottom: 24 }}`

**Padding & Spacing:**
- Main container: `paddingBottom: Math.max(insets.bottom, 8)`
- Header: `px-5 pb-3`
- Form sections: `px-5 pb-3` (repeated per section)
- No consistent `gap-` usage

**Header:**
- No close button in header (only backdrop press to close)
- Static title based on edit mode
- Handle bar: `w-10 h-1 rounded-full`

**Button Styling:**
- Cancel/Save: `flex-row gap-3`, `py-3 rounded-xl` (smaller than MultiSplit)
- Save button: `flex-1` with opacity when disabled

**Rounded Corners:**
- Main container: `borderTopLeftRadius: 20`, `borderTopRightRadius: 20` (numeric, not Tailwind)
- Form fields: `rounded-lg`

**Other Patterns:**
- Uses inline styles for many properties (borderRadius, colors)
- Form fields scattered with `px-5 pb-3` spacing
- Separate modal pickers for account/category/person

## PrepaymentSheet (Loan Prepayment)

**Keyboard Handling:**
- `KeyboardAvoidingView behavior="padding"` with `keyboardVerticalOffset={0}`
- Position: `absolute, left: 0, right: 0, bottom: 0`
- maxHeight: `"92%"`
- ScrollView: `contentContainerStyle={{ paddingBottom: 8 }}`

**Padding & Spacing:**
- Main container: `paddingBottom: Math.max(insets.bottom, 8)`
- Header: `px-5 pb-3`
- ScrollView: `className="px-5"` (padding on ScrollView, not content)
- Input components: `containerClassName="mb-3"`

**Header:**
- No close button in header
- Static title based on edit mode
- Handle bar: `w-10 h-1 rounded-full`

**Button Styling:**
- Cancel/Save: `flex-row gap-2`, `py-3 rounded-xl` (even smaller than EntryEditSheet)

**Rounded Corners:**
- Main container: `borderTopLeftRadius: 20`, `borderTopRightRadius: 20` (numeric)

**Other Patterns:**
- Uses `Input` component with containerClassName
- Toggle component for strategy selection
- Preview section with impact calculations

## ManualCorrectionSheet (Loan Manual Correction)

**Keyboard Handling:**
- `KeyboardAvoidingView behavior="padding"` with `keyboardVerticalOffset={0}`
- Position: `absolute, left: 0, right: 0, bottom: 0`
- maxHeight: `"92%"`
- ScrollView: `contentContainerStyle={{ paddingBottom: 8 }}`

**Padding & Spacing:**
- Main container: `paddingBottom: Math.max(insets.bottom, 8)`
- Header: `px-5 pb-3`
- ScrollView: `className="px-5"`
- Input components: `containerClassName="mb-3"`

**Header:**
- No close button in header
- Static title based on edit mode
- Handle bar: `w-10 h-1 rounded-full`

**Button Styling:**
- Cancel/Save: `flex-row gap-2`, `py-3 rounded-xl`

**Rounded Corners:**
- Main container: `borderTopLeftRadius: 20`, `borderTopRightRadius: 20` (numeric)

**Other Patterns:**
- Very similar to PrepaymentSheet
- Uses `Input` component with containerClassName

## Key Differences Summary

| Aspect | MultiSplitSheet (Good) | EntryEditSheet | PrepaymentSheet | ManualCorrectionSheet |
|--------|------------------------|----------------|-----------------|----------------------|
| **KeyboardAvoidingView** | Simple `behavior="padding"` at root | `behavior="padding"` with `keyboardVerticalOffset=0` + absolute positioning | Same as EntryEditSheet | Same as EntryEditSheet |
| **Max Height** | Fixed `max-h-[420px]` | Percentage `"92%"` | Percentage `"92%"` | Percentage `"92%"` |
| **Close Button** | Yes (in header) | No | No | No |
| **Padding Pattern** | `px-5 pb-8 pt-3` on container | `paddingBottom: Math.max(insets.bottom, 8)` | Same as EntryEditSheet | Same as EntryEditSheet |
| **Section Spacing** | `gap-3` (consistent) | `px-5 pb-3` per section | `mb-3` on inputs | `mb-3` on inputs |
| **Button Height** | `py-4 rounded-2xl` (larger) | `py-3 rounded-xl` | `py-3 rounded-xl` | `py-3 rounded-xl` |
| **Rounded Corners** | Tailwind `rounded-t-3xl` | Numeric `borderTopLeftRadius: 20` | Numeric `borderTopLeftRadius: 20` | Numeric `borderTopLeftRadius: 20` |
| **ScrollView Padding** | None (max-height instead) | `contentContainerStyle={{ paddingBottom: 24 }}` | `className="px-5"` + `paddingBottom: 8` | `className="px-5"` + `paddingBottom: 8` |

## Recommendations

Apply MultiSplitSheet patterns to other sheets:

1. **Add close button in header** - Improves discoverability of close action
2. **Use fixed max-height** - `max-h-[420px]` instead of percentage for more predictable layout
3. **Simplify KeyboardAvoidingView** - Remove `keyboardVerticalOffset` and `position: absolute`
4. **Use consistent gap spacing** - `gap-3` instead of repeated `pb-3` / `mb-3`
5. **Increase button height** - `py-4 rounded-2xl` for better touch targets
6. **Use Tailwind rounded corners** - `rounded-t-3xl` instead of numeric values
7. **Remove padding from ScrollView** - Put padding on container instead
