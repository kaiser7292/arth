# Demat Snapshots UI Redesign (Month-wise Period View)

**Status:** Approved by user
**Created:** 2026-07-04
**Modified:** 2026-07-04 (refactored as separate detail page)
**Related files:** 
- `app/demat/snapshots/[id].tsx` (NEW — snapshot detail page)
- `app/settings/account-detail.tsx` (MODIFIED — summary only, no snapshot list)
- `app/reconciliation/demat-portfolio.tsx` (entry point, links to account-detail)

---

## Overview

Replace the current vertical snapshot list with a **month-wise period navigator** (like account ledger) that shows portfolio & fund snapshots side-by-side in a compact table. Simplifies navigation, reduces scroll bloat, and consolidates related data.

This is a **two-page refactor**:
1. Move snapshots to a separate detail page (like account-ledger is separate from account-master)
2. Simplify account-detail to show only summary totals + link to snapshots

---

## Navigation Flow

```
Settings (home) 
  → Account Master 
    → Select Demat Account 
      → account-detail (shows: summary totals + "View Snapshots" button)
        → [Tap "View Snapshots"] 
          → demat/snapshots/[id] (month-view snapshot list)
```

**Pattern:** Mirrors bank account flow (account-detail doesn't show full ledger; account-ledger is separate).

---

## File Structure

```
app/
├── demat/
│   ├── _layout.tsx (NEW — navigation layout for demat routes)
│   └── snapshots/
│       └── [id].tsx (NEW — month-view snapshot detail page)
├── settings/
│   ├── account-detail.tsx (MODIFIED — remove snapshot list, add summary + button)
│   └── account-master.tsx (unchanged)
└── reconciliation/
    └── demat-portfolio.tsx (unchanged — aggregated view)
```

---

## Current State (Before)

- Add form at top (date picker + portfolio input + fund input)
- Vertical list of ALL snapshots (grows indefinitely)
- Inline edit/delete on each row
- No period navigation

**Problem:** Hundreds of snapshots = endless scroll

---

## New Design

### Layout (per month)

```
┌─────────────────────────────────────────────────────────────┐
│ Portfolio Snapshots                                         │
│                                                             │
│ [← July]  2026-07  [August →]                             │
│                                                             │
│ Date    │   Portfolio   │    Fund      │  Actions          │
│ ──────────────────────────────────────────────────        │
│ Jul 15  │  ₹5,25,000    │  ₹75,000    │  [✎] [🗑]        │
│ Jul 8   │  ₹5,20,000    │  ₹50,000    │  [✎] [🗑]        │
│ Jul 1   │  ₹5,00,000    │  ₹25,000    │  [✎] [🗑]        │
│                                                             │
│                                            [+] (bottom-right)│
└─────────────────────────────────────────────────────────────┘
```

### Components

#### 1. Period Navigator
- **Left button:** `← Month name` (navigates to previous month)
- **Center:** `YYYY-MM` (current selected month, clickable → calendar picker optional)
- **Right button:** `Month name →` (navigates to next month)
- Disable/gray out prev arrow if no snapshots exist for prior months
- Same pattern as `PeriodNavigator` in account-ledger.tsx

#### 2. Table Header (sticky, minimal)
```
| Date | Portfolio | Fund | Actions |
```
- `Date` — left-aligned, flex: 1
- `Portfolio` — right-aligned, flex: 1.2
- `Fund` — right-aligned, flex: 1.2
- `Actions` — width: 60px (edit + delete icons, flex: none)
- All caps, 11px, semibold, uppercase tracking
- 0.5px bottom border

#### 3. Snapshot Rows
```
| Jul 15 | ₹5,25,000 | ₹75,000 | [✎] [🗑] |
```
- **Date:** Left-aligned, 13px, `text-secondary`
- **Portfolio value:** Right-aligned, 13px, semibold, `text-primary`
- **Fund value:** Right-aligned, 13px, semibold, `text-primary`
- **Actions:**
  - Edit icon (`ti-edit`, 16px, `text-accent`, tap to inline edit or open modal)
  - Delete icon (`ti-trash`, 16px, `text-secondary`, tap to confirm delete)
  - Both icons have 4px padding, gap of 8px between them
- Row bottom: 0.5px border (except last row)
- Row height: ~40px (12px vertical padding)

#### 4. Add Snapshot Button
- Position: **Bottom-right of the card**, 16px margin from bottom/right edges
- Style: Floating circle button (44×44px)
- Icon: `ti-plus` (20px, `--on-accent`)
- Background: `var(--fill-accent)` (solid, no text)
- Border: None
- Border-radius: 50% (circle)
- Tap → open inline form OR modal with:
  - Date picker (default = today if today is in viewed month, else first day of month)
  - Portfolio input (with formula mode)
  - Fund input (optional, with formula mode)
  - [✓ Save] [✗ Cancel]

---

## Behavior

### Month Navigation
- **Forward/backward arrows:** Load snapshots for next/previous month
- **No snapshots in month:** Show empty state: *"No snapshots recorded for this month."*
- **Show months with data:** Can navigate only to months with at least 1 snapshot? OR allow free navigation like account ledger?
  - **Recommended:** Free navigation (like account ledger) — user may want to jump to June to add a missing snapshot

### Inline Editing
- **Tap edit icon** → Portfolio and Fund values become inputs
- Confirm: [✓ Save] button appears next to the edits
- Cancel: [✗] button to discard
- Alternative: Open a modal with the edit form (cleaner on mobile, same UX as add)

### Delete
- Tap [🗑] → Confirm alert: *"Delete portfolio value for Jul 15?"*
- Options: [Cancel] [Delete]
- After delete: Row disappears, reload month view

### Add Snapshot Form
- **Date:** DateInput (prefilled = today if in viewed month, else month-start)
- **Portfolio value:** Input with `formula` mode enabled
- **Fund (optional):** Input with `formula` mode enabled
  - Placeholder: *"Leave blank to keep current"* (optional field)
- Buttons: [✓ Save] [✗ Cancel]
- After save: Row added to table in correct date order, form clears

---

## Changes to `app/settings/account-detail.tsx`

### Removals
- **Remove:** Entire snapshot list section (the vertical scrolling list)
- **Remove:** Snapshot add form (date picker + portfolio + fund inputs)
- **Remove:** State variables:
  - `dematSnapshots`
  - `dematFundSnapshots`
  - `editingSnapshotId`, `editingSnapshotValue`, `editingFundValue`
  - `newSnapshotDate`, `newSnapshotValue`, `newFundSnapshotValue`
  - `addingSnapshot`
- **Remove:** Functions:
  - `loadData` (in demat section) — replace with simpler load that only fetches latest values
  - Any `useEffect` that loads snapshots for the full list

### Additions
- **Add:** Summary card (like home DematSummaryCard):
  - Portfolio Value (latest from snapshots)
  - Idle Cash / Fund (latest from snapshots)
  - Total (portfolio + fund)
  - "As of" date (snapshot date of latest values)
- **Add:** Pressable "View Snapshots" card:
  - Label: "Portfolio Snapshots"
  - Icon: `ti-chart-line` or `ti-trending-up`
  - Tap → navigate to `/demat/snapshots/${accountId}`
  - Shows snapshot count badge (e.g., "42 snapshots")
  - Styled like other action cards (secondary surface, chevron, gray text)

### Simplify `loadData`
```ts
// Before: loads full snapshot list for pagination + editing
// After: loads only latest portfolio & fund values for display

if (acct.account_type === 'demat') {
  const latestPortfolio = await getLatestPortfolioSnapshot(account.id);
  const latestFund = await getLatestFundSnapshot(account.id);
  setDematLatestValue(latestPortfolio?.portfolio_value ?? null);
  setDematLatestFund(latestFund?.fund_value ?? null);
  setDematSnapshotCount(await getSnapshotCountForAccount(account.id)); // for badge
}
```

---

## New File: `app/demat/snapshots/[id].tsx`

### Purpose
Month-wise snapshot detail page for a single demat account. Mirrors the design from DEMAT_SNAPSHOTS_UI_SPEC.md (month navigator + table).

### Route
```
/demat/snapshots/:id
```

### Props
- `id` (route param) — demat account ID

### Top Section (Header)
- Account name + icon (bank_name + account_identifier or account_label)
- Summary card (current portfolio, current fund, total)

### Main Section (Month-view table)
- Period navigator (← Month | YYYY-MM | Month →)
- Table header (Date | Portfolio | Fund | Actions)
- Snapshot rows (inline edit/delete)
- Floating + button (bottom-right) to add snapshot

### Key States
```ts
const [selectedMonth, setSelectedMonth] = useState<string>('YYYY-MM');
const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([]);
const [fundSnapshots, setFundSnapshots] = useState<FundSnapshot[]>([]);
const [editingId, setEditingId] = useState<string | null>(null);
const [editingValue, setEditingValue] = useState<string>('');
const [addingSnapshot, setAddingSnapshot] = useState(false);
```

### Service Calls
- `getAccount(id)` — fetch account details
- `getSnapshotsForMonth(accountId, yyyymm)` — load portfolio snapshots for month
- `getFundSnapshotsForMonth(accountId, yyyymm)` — load fund snapshots for month
- `addOrUpdateSnapshot(accountId, date, value)` — create/edit snapshot
- `addOrUpdateFundSnapshot(accountId, date, value)` — create/edit fund snapshot
- `deleteSnapshot(snapshotId)` — delete snapshot
- `deleteFundSnapshot(snapshotId)` — delete fund snapshot

### Back Navigation
- Header back button or Android hardware back → return to account-detail

### Design Patterns (consistency)
- **Card wrapper:** `Card className="mb-3"` (same as account-detail)
- **Header:** Match account-detail header style (icon + name)
- **Period navigator:** Use existing `PeriodNavigator` component or copy from account-ledger.tsx
- **Table styling:** Use NativeWind classes for borders, spacing, typography
- **Buttons:** Secondary gray buttons for month nav, rounded icon buttons for edit/delete, accent circle for +
- **Empty state:** *"No snapshots recorded for [Month Year]."*

---

## Implementation Notes

### File: `app/demat/snapshots/[id].tsx` (NEW)

### Pseudo-code Structure

```tsx
export default function DematSnapshotsScreen() {
  const { id } = useLocalSearchParams(); // accountId
  const router = useRouter();
  
  // Main states
  const [account, setAccount] = useState<FinancialAccount | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>(getTodayMonth());
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([]);
  const [fundSnapshots, setFundSnapshots] = useState<FundSnapshot[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  const [addingSnapshot, setAddingSnapshot] = useState(false);
  
  // Load account + snapshots on mount & month change
  useEffect(() => {
    const load = async () => {
      const acct = await getAccount(id);
      setAccount(acct);
      const snaps = await getSnapshotsForMonth(id, selectedMonth);
      const funds = await getFundSnapshotsForMonth(id, selectedMonth);
      setSnapshots(snaps);
      setFundSnapshots(funds);
    };
    load();
  }, [id, selectedMonth]);
  
  // Handlers
  const handleAddSnapshot = async (date: string, portfolio: number, fund: number) => {
    await addOrUpdateSnapshot(id, date, portfolio);
    if (fund > 0) await addOrUpdateFundSnapshot(id, date, fund);
    setAddingSnapshot(false);
    // Reload month
  };
  
  const handleDelete = async (snapId: string) => {
    await deleteSnapshot(snapId);
    // Reload month
  };
  
  return (
    <ScreenContainer padTop={false}>
      {/* Header */}
      <View style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 12 }}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} />
        </Pressable>
        <Text style={{ fontSize: 18, fontWeight: '700' }}>
          {account?.account_label || account?.bank_name}
        </Text>
      </View>
      
      {/* Summary Card */}
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text>Portfolio</Text>
          <Text>{formatAmount(latestPortfolioValue)}</Text>
        </View>
        {/* ... Fund, Total ... */}
      </Card>
      
      {/* Month-view Table */}
      <Card>
        <PeriodNavigator value={selectedMonth} onChange={setSelectedMonth} />
        
        {/* Header row */}
        <View style={{ flexDirection: 'row', borderBottom: '0.5px solid var(--border)' }}>
          <Text style={{ flex: 1 }}>Date</Text>
          <Text style={{ flex: 1.2, textAlign: 'right' }}>Portfolio</Text>
          <Text style={{ flex: 1.2, textAlign: 'right' }}>Fund</Text>
          <View style={{ width: 60 }} />
        </View>
        
        {/* Snapshot rows */}
        {snapshots.length === 0 ? (
          <Text>No snapshots for this month</Text>
        ) : (
          snapshots.map(snap => (
            <SnapshotRow
              key={snap.id}
              snap={snap}
              fund={fundSnapshots.find(f => f.snapshot_date === snap.snapshot_date)}
              isEditing={editingId === snap.id}
              onEdit={() => setEditingId(snap.id)}
              onDelete={() => handleDelete(snap.id)}
              onSave={(val) => handleAddSnapshot(snap.snapshot_date, val, ...)}
            />
          ))
        )}
        
        {/* Add button (floating) */}
        <Pressable onPress={() => setAddingSnapshot(true)} style={{ position: 'absolute', bottom: 16, right: 16 }}>
          <Ionicons name="add-circle" size={44} color="var(--fill-accent)" />
        </Pressable>
      </Card>
      
      {/* Add/Edit Modal */}
      {addingSnapshot && (
        <AddSnapshotModal
          onSave={handleAddSnapshot}
          onCancel={() => setAddingSnapshot(false)}
        />
      )}
    </ScreenContainer>
  );
}
```

---

## Edge Cases

### Empty month
Show: *"No snapshots recorded for July 2026."*
Button still visible for adding first snapshot.

### Fund value missing
If fund row is blank/empty, show `—` or leave empty.
Portfolio value always required.

### Snapshot on same date?
Allow multiple snapshots on the same date? Or enforce one per day?
**Recommendation:** Allow multiple (user may update intraday, old snapshots useful for audit trail).

### Negative fund balance
Allow negative fund balance? (User withdrew more than available cash.)
**Recommendation:** Yes, allow it. User controls their data.

### Editing a historical snapshot
User changes Jul 15's portfolio from 5.25L to 5.50L — should affect trends/milestones if they depend on snapshots.
**Current behavior:** `addOrUpdateSnapshot` just updates the row; no cascade logic.

---

## Styling Reference

- Card: `Card className="mb-3"`
- Header text: `text-xs font-semibold text-text-tertiary dark:text-text-dark-secondary uppercase tracking-wider`
- Row text: `text-sm font-semibold text-text-primary dark:text-text-dark-primary`
- Secondary text: `text-xs text-text-secondary dark:text-text-dark-secondary`
- Icons: Tabler `ti-edit` (accent on hover), `ti-trash` (muted → danger on hover)
- Button: `fill-accent`, `on-accent` text, `border-radius: 50%` for circle
- Borders: `border-border-light dark:border-border-dark`

---

## Implementation Checklist

### Phase 1: Create new demat/snapshots page
- [ ] Create `app/demat/_layout.tsx` (navigation group)
- [ ] Create `app/demat/snapshots/[id].tsx` (full month-view snapshot page)
  - [ ] Header with back button + account name
  - [ ] Summary card (portfolio + fund + total)
  - [ ] Period navigator (← Month | YYYY-MM | Month →)
  - [ ] Table (Date | Portfolio | Fund | Actions)
  - [ ] Snapshot rows with edit/delete
  - [ ] Floating + button
  - [ ] Add snapshot modal/form
  - [ ] Empty state messaging
- [ ] Add service functions (if not existing):
  - [ ] `getSnapshotsForMonth(accountId, yyyymm): Promise<PortfolioSnapshot[]>`
  - [ ] `getFundSnapshotsForMonth(accountId, yyyymm): Promise<FundSnapshot[]>`
  - [ ] `getLatestPortfolioSnapshot(accountId): Promise<PortfolioSnapshot | null>`
  - [ ] `getLatestFundSnapshot(accountId): Promise<FundSnapshot | null>`
  - [ ] `getSnapshotCountForAccount(accountId): Promise<number>`

### Phase 2: Simplify account-detail.tsx
- [ ] Remove snapshot list section entirely
- [ ] Remove snapshot add form
- [ ] Remove states:
  - [ ] `dematSnapshots`, `dematFundSnapshots`
  - [ ] `editingSnapshotId`, `editingSnapshotValue`, `editingFundValue`
  - [ ] `newSnapshotDate`, `newSnapshotValue`, `newFundSnapshotValue`
  - [ ] `addingSnapshot`
- [ ] Remove/update handlers:
  - [ ] Remove snapshot edit handlers
  - [ ] Remove snapshot delete handlers
  - [ ] Remove snapshot add handler
  - [ ] Simplify `loadData` for demat (only fetch latest values)
- [ ] Add summary card:
  - [ ] Portfolio Value (latest)
  - [ ] Idle Cash / Fund (latest)
  - [ ] Total
  - [ ] "As of" date
- [ ] Add "View Snapshots" action card:
  - [ ] Icon + label + chevron
  - [ ] Snapshot count badge
  - [ ] Navigate to `/demat/snapshots/${accountId}` on tap

### Phase 3: Link from demat-portfolio.tsx
- [ ] Verify existing link from account card → account-detail still works
- [ ] Test: demat-portfolio → tap account → account-detail → tap "View Snapshots" → snapshots page

### Phase 4: Testing
- [ ] Navigate months (forward/backward)
- [ ] Add snapshot with formula (e.g., `5,00,000` or `5*100000`)
- [ ] Edit portfolio value
- [ ] Edit fund value (optional field)
- [ ] Delete snapshot (confirm dialog)
- [ ] Empty month state
- [ ] Negative fund balance (allow)
- [ ] Multiple snapshots same date (allow, ordered by time created?)
- [ ] Back navigation (account-detail ← snapshots ← demat-portfolio)
- [ ] Summary card reflects latest values

### Phase 5: Cleanup & Polish
- [ ] Remove any stale imports from account-detail
- [ ] Verify no TypeScript errors
- [ ] Test on device (month nav responsiveness, button spacing)
- [ ] Verify design consistency with existing cards/buttons/typography

---

## Dependencies & Related Files

### Service Functions (check if exist)
- [ ] `getAccount(id)` — fetch single account details
- [ ] `getSnapshotsForMonth(accountId, yyyymm)` — query by month range
- [ ] `getFundSnapshotsForMonth(accountId, yyyymm)` — query by month range
- [ ] `getLatestPortfolioSnapshot(accountId)` — single most recent
- [ ] `getLatestFundSnapshot(accountId)` — single most recent
- [ ] `getSnapshotCountForAccount(accountId)` — total count for badge
- [ ] `addOrUpdateSnapshot(accountId, date, value)` — existing (keep)
- [ ] `addOrUpdateFundSnapshot(accountId, date, value)` — existing (keep)
- [ ] `deleteSnapshot(snapshotId)` — existing (keep)
- [ ] `deleteFundSnapshot(snapshotId)` — existing (keep)

**Location:** `services/financial-account.ts`

### Components to Reuse
- [ ] `PeriodNavigator` — month navigation (from account-ledger.tsx or create if missing)
- [ ] `Card` — card container (already imported in account-detail)
- [ ] `ScreenContainer` — page wrapper
- [ ] `Input` with `formula` prop — amount fields

### Imports to Add in demat/snapshots/[id].tsx
```ts
import { useState, useCallback } from "react";
import { View, Text, ScrollView, Pressable, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Card, Input, DateInput, Button, PeriodNavigator } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { formatAmount } from "@/utils/format";
import { DEFAULT_USER_ID } from "@/constants/app";
import { ac, acAlpha } from "@/utils/accent";
import {
  getAccount,
  getSnapshotsForMonth,
  getFundSnapshotsForMonth,
  getLatestPortfolioSnapshot,
  getLatestFundSnapshot,
  getSnapshotCountForAccount,
  addOrUpdateSnapshot,
  addOrUpdateFundSnapshot,
  deleteSnapshot,
  deleteFundSnapshot,
} from "@/services/financial-account";
import type { FinancialAccount, PortfolioSnapshot, FundSnapshot } from "@/services/financial-account";
```

### Updates to account-detail.tsx Imports
- [ ] Remove unused snapshot-related imports
- [ ] Keep: `formatAmount`, `Card`, form inputs
- [ ] Add (if not present): `useRouter` for navigation

### Files to Review (ensure consistency)
- [ ] `app/reconciliation/account-ledger.tsx` — reference for period navigator pattern
- [ ] `app/reconciliation/demat-portfolio.tsx` — verify account link still works
- [ ] `components/ui/PeriodNavigator.tsx` — understand its API (minMonth, maxMonth, value, onChange)
- [ ] `app/settings/account-master.tsx` — no changes needed, but verify link to account-detail

---

## Design Consistency Checklist

Ensure new page matches existing patterns:

- [ ] **Card styling** — `border-radius: 12px`, `0.5px solid var(--border)`, padding `1rem 1.25rem`
- [ ] **Header** — Icon + name/title, back button top-left (match account-ledger.tsx header)
- [ ] **Typography** — Section labels `text-xs font-semibold uppercase`, body `text-sm`, values `font-semibold`
- [ ] **Color tokens** — Use `var(--text-primary)`, `var(--text-secondary)`, `var(--border)` (no hardcoded hex)
- [ ] **Buttons** — Period nav buttons: secondary gray, edit: `text-accent`, delete: `text-secondary`
- [ ] **Icons** — Tabler outlines only (`ti-edit`, `ti-trash`, `ti-plus`, `ti-chevron-back`)
- [ ] **Spacing** — Use NativeWind (gap, mb, mt, px) for consistency
- [ ] **Focus states** — Secondary buttons should have border on focus
- [ ] **Empty state** — Icon (`ti-inbox`) + message text, centered

---

## Related Issues

- **Demat withdrawal feature (separate):** Mark as Transfer FROM demat account (updates snapshots)
- **Snapshot trend visualization (future):** Mini sparkline below summary card
- **Account master improvements (future):** Show demat snapshot count as badge
