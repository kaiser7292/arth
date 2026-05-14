# Timezone Support and Split Details Display Fix

Plan to add timezone support for datetime display and fix split details display for single-person splits.

## Part 1: Timezone Support

### Problem
All dates/datetimes are stored in UTC but displayed without timezone conversion. User wants to see times in their local timezone.

### Requirements
- Add timezone preference in Settings -> Region
- Store everything in UTC in DB (already doing this)
- Display dates/datetimes in user's timezone preference
- For date-only fields: keep as-is, no timezone conversion needed
- Default timezone: device's system timezone
- Audit to see if any other place makes sense for timezone conversion

### Solution Steps

1. **Add timezone preference service** (`services/locale-preferences.ts`):
   - Add `getTimezone()` function (default to device timezone using `Intl.DateTimeFormat().resolvedOptions().timeZone`)
   - Add `setTimezone()` function to save preference

2. **Add timezone picker UI** (`app/settings/region.tsx`):
   - Add timezone section below date format
   - Use a picker with common timezones or device timezone as default
   - Show sample datetime conversion

3. **Create timezone utility** (`utils/timezone.ts`):
   - `formatDateTimeInTimezone(isoString, timezone)` - convert UTC ISO string to user timezone
   - `formatTimestampInTimezone(timestamp, timezone)` - convert timestamp to user timezone

4. **Audit and update datetime displays**:
   - `components/expense/ExpenseMetadata.tsx` - `formatTimestamp` for created_at
   - `app/settings/audit-log.tsx` - all datetime fields
   - `app/settings/notification-collector.tsx` - notification timestamps
   - Any other places showing `created_at`, `updated_at`, timestamps

5. **Date-only fields**: Keep as-is (no timezone conversion)

### Files to Modify
- `services/locale-preferences.ts` (add timezone functions)
- `app/settings/region.tsx` (add timezone picker UI)
- `utils/timezone.ts` (new file)
- `components/expense/ExpenseMetadata.tsx` (update formatTimestamp)
- `app/settings/audit-log.tsx` (update datetime displays)
- `app/settings/notification-collector.tsx` (update timestamp displays)

## Part 2: Split Details Display Fix

### Problem
Single-person split details are shown in "Other Info" section at the end, while multi-person splits are shown prominently with per-person breakdown.

### Solution

Move single-person split details from ExpenseMetadata "Other Info" to the main split section in `app/expense/[id].tsx`, displaying it similar to multi-split style:

1. **Update `app/expense/[id].tsx`** (lines 2073-2118):
   - Replace the simple "Split Active" card with a detailed card showing:
     - Person name
     - Original amount
     - Your share (percentage and amount)
     - Link to Hisaab ledger
   - Match the visual style of multi-split card

2. **Remove split details from ExpenseMetadata**:
   - Remove the "Split Details" section from `components/expense/ExpenseMetadata.tsx` (lines 146-165)
   - Single-split details will now only show in the main section

### Files to Modify
- `app/expense/[id].tsx` (update single split display)
- `components/expense/ExpenseMetadata.tsx` (remove split details from Other Info)
