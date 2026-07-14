# Swipe Pager Implementation Plan

**Goal:** Replace the swipe-between-tabs gesture on the bottom drawer with per-tab horizontal swipable pagers. Add Ask AI + Scan to the global Stack header for the Home tab.

**Design reference:** Mockup approved by user on 2026-07-14. Pattern: horizontal ScrollView with `pagingEnabled` + animated underline tab strip above content.

---

## Phases Overview

| Phase | Scope | Status | Risk |
|-------|-------|--------|------|
| 1 | Remove swipe gesture from `_layout.tsx` | ✅ Done | Low |
| 2 | Build shared `SwipePager` component | ✅ Done | Low |
| 3 | Budget tab — 2-page pager | ✅ Done | Medium |
| 4 | Transactions tab — 5-page pager | ✅ Done | Medium |
| 5 | Home tab — 5-page pager + Ask AI/Scan in header | ✅ Done | High |

---

## Phase 1 — Remove Swipe Gesture ✅ Done

**File:** `app/(tabs)/_layout.tsx`

**What was done:**
- Removed `Gesture`, `GestureDetector` imports from `react-native-gesture-handler`
- Removed `usePathname`, `useRouter` imports from `expo-router` (only used for swipe)
- Removed `TAB_PATHS` constant
- Removed `swipeGesture` Gesture.Pan() block
- Removed `GestureDetector` wrapper around `<View>`
- Removed `router` and `pathname` state variables

**Why:** The `GestureDetector` wrapping the entire tab layout captured horizontal swipes globally. This conflicts with the per-tab horizontal pagers we're adding.

---

## Phase 2 — Shared SwipePager Component ✅ Done

**Files created/changed:**
- `components/ui/SwipePager.tsx` (new)
- `components/ui/index.ts` (added exports)

**Final interface:**
```tsx
interface SwipePagerProps {
  pages: SwipePagerPage[];        // { key: string; label: string }[]
  activeIndex: number;
  onIndexChange: (index: number) => void;
  children: React.ReactNode[];    // one per page
  trailing?: React.ReactNode;     // optional slot right of tab strip (bookmark/star icons)
}
```

**Internals:**
- Tab strip: `flexDirection:"row"` wrapper containing a horizontal `ScrollView` (flex:1) for tabs + optional `trailing` View on the right
- `scrollEnabled={pages.length > 4}` — only scrollable when 5+ tabs
- Underline: `Animated.View` at bottom of tab strip, position driven by `scrollX.interpolate`
- Content: `Animated.ScrollView` with `pagingEnabled`, `decelerationRate="fast"`, `scrollEventThrottle={16}`
- `onLayout` on content wrapper captures `contentSize = {width, height}` — each page `<View>` uses both explicitly so pages fill correctly inside horizontal scroll
- `onMomentumScrollEnd` reads `contentOffset.x / contentSize.width` → calls `onIndexChange`
- Tab press effect: `scrollTo({ x: activeIndex * width })` via `useEffect` on `activeIndex`
- Tab strip auto-scrolls: `scrollTo({ x: Math.max(0, (activeIndex-1) * TAB_WIDTH) })`
- `TAB_WIDTH = 80` constant

**Key fix applied:** Pages need explicit `height` inside horizontal ScrollView — `flex:1` alone doesn't propagate through `contentContainerStyle={{ flexDirection:"row" }}`. Fixed by capturing both width AND height from the content area's `onLayout`.

---

## Phase 3 — Budget Tab (2 pages) ✅ Done

**Files changed:**
- `app/(tabs)/budget.tsx`
- `components/budget/SpendingSplitPage.tsx` (new)

**Pages:**
| Index | Label | Content |
|-------|-------|---------|
| 0 | Monthly summary | Existing `budget.tsx` ScrollView content |
| 1 | Spending split | `components/budget/SpendingSplitPage.tsx` |

**Implementation:**
- `PeriodNavigator` sits ABOVE the SwipePager (shared for both pages)
- `PeriodNavigator trailing` prop: shows the widget-manager toggle only when `activePageIndex === 0`
- Widget manager panel: gated on `activePageIndex === 0` — auto-closes when leaving page 0
- Lazy mount: `visitedSplit` boolean — page 1 only mounts after first visit
- `SpendingSplitPage` uses `useDataRefresh(loadData)` instead of `useFocusEffect` — fires correctly when lazy-mounted while screen is already focused
- Removed the "Spending Split" action button from the Budget Summary widget (now redundant)
- Standalone route `/budget/spending-split` unchanged

---

## Phase 4 — Transactions Tab (5 pages) ✅ Done

**File changed:** `app/(tabs)/expenses.tsx`

**Pages:**
| Index | Label | `filterNature` value |
|-------|-------|---------------------|
| 0 | All | `"all"` |
| 1 | Expenses | `"realized"` |
| 2 | Committed | `"committed"` |
| 3 | Credits | `"credit"` |
| 4 | Transfers | `"transfers"` |

**What was done:**
- Added `NATURE_TABS: SwipePagerPage[]` constant (outside component)
- `activeNatureIndex` computed from `filterNature` (derived, not state)
- `handleNatureChange(index)` callback replicates full pill-tap logic: saves groupBy per-nature, clears refund/avoidability filters, clears category/tag/payment filters when entering Transfers
- Removed `|| filterNature !== "realized"` from `hasNonDateFilters` (nature is now a tab, not a hidden filter overlay)
- Moved date preset selector and active filter chips ABOVE the SwipePager
- Moved `FullScreenFilter` modal ABOVE the SwipePager (it's an absolute overlay — position in tree doesn't matter)
- SwipePager wraps the FlatList area with `trailing` = bookmark + star icons
- Each of 5 pages: `{activeNatureIndex === pageIdx ? <real FlatList> : <View style={{flex:1}} />}` — only the active page renders content; others are empty placeholders (swipe transitions are fast enough)
- Default `filterNature` stays `"realized"` → starts on Expenses tab (index 1)
- Saved views that set `filterNature` externally still work: `activeNatureIndex` auto-derives, `useEffect` in SwipePager scrolls to correct page

**Unchanged:** FABMenu, BulkActionBar (both `position:absolute`), bulk picker modals, credit/transfer sheets, pending badge in `_layout.tsx`

---

## Phase 5 — Home Tab (5 pages) 🔲 Todo

**Files to touch:**
- `app/(tabs)/index.tsx` — wrap in SwipePager, remove custom App Header
- `app/(tabs)/_layout.tsx` — add Ask AI + Scan to `headerRight` for Home tab, scan state managed here
- `components/home/pages/InsightsPage.tsx` (new)
- `components/home/pages/ReviewQueuePage.tsx` (new)
- `components/home/pages/VaultPage.tsx` (new)
- `components/home/pages/SimulatorPage.tsx` (new)

**Pages:**
| Index | Label | Content source |
|-------|-------|----------------|
| 0 | Overview | Existing home ScrollView content (minus App Header section) |
| 1 | Insights | Embedded version of `app/insights/index.tsx` |
| 2 | Queue | Embedded version of `app/expense/review-queue.tsx` |
| 3 | Vault | Embedded version of `app/vault/index.tsx` |
| 4 | Simulator | Embedded version of `app/simulator/index.tsx` |

### Step A — `_layout.tsx` changes

Add scan state and Ask AI + Scan buttons to the Home tab header:

```tsx
// Add imports
import { runSmsScan, getSmsScanAccountIds, isSmsDetectionEnabled } from "@/services/sms";
import { isArthAIEnabled } from "@/services/ai-assistant";
import { useRouter } from "expo-router";
import { Pressable } from "react-native";

// Add inside TabLayout():
const router = useRouter();
const [smsScanning, setSmsScanning] = useState(false);

const handleHomeScan = useCallback(async () => {
  if (smsScanning) return;
  setSmsScanning(true);
  try {
    const accountIds = getSmsScanAccountIds();
    await runSmsScan({ manual: true, accountIds });
  } finally {
    setSmsScanning(false);
  }
}, [smsScanning]);

// Update Home Tabs.Screen options:
<Tabs.Screen
  name="index"
  options={{
    title: "Arth",
    headerRight: () => (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginRight: 16 }}>
        {isArthAIEnabled() && (
          <Pressable onPress={() => router.push("/ai-chat" as never)} hitSlop={8}>
            <Ionicons name="sparkles-outline" size={22} color={colors.tint} />
          </Pressable>
        )}
        {isSmsDetectionEnabled() && (
          <Pressable onPress={handleHomeScan} disabled={smsScanning} hitSlop={8}>
            <Ionicons
              name={smsScanning ? "sync-outline" : "scan-outline"}
              size={22}
              color={colors.tabIconDefault}
            />
          </Pressable>
        )}
      </View>
    ),
    tabBarIcon: ({ color, size }) => (
      <Ionicons name="home-outline" size={size} color={color} />
    ),
  }}
/>
```

### Step B — Remove App Header from `index.tsx`

The home screen has an in-content "App Header" section (lines ~334–394):
```jsx
{/* App Header */}
<View className="px-4 pt-5 pb-3 flex-row items-start justify-between">
  ... title "Arth · अर्थ" + lastScanLabel + Ask AI button + Vault button + Scan button ...
</View>
```

**Remove this entire block.** The Stack header now shows "Arth" + Ask AI/Scan buttons. The month label (`monthLabel`) can stay as a subtitle inside the Overview content or be dropped — it's already shown in the Budget PeriodNavigator when navigating there.

### Step C — Wrap home content in SwipePager

```tsx
// Add to imports:
import { SwipePager } from "@/components/ui";
import type { SwipePagerPage } from "@/components/ui";
import { InsightsPage } from "@/components/home/pages/InsightsPage";
import { ReviewQueuePage } from "@/components/home/pages/ReviewQueuePage";
import { VaultPage } from "@/components/home/pages/VaultPage";
import { SimulatorPage } from "@/components/home/pages/SimulatorPage";

// Add outside component:
const HOME_TABS: SwipePagerPage[] = [
  { key: "overview", label: "Overview" },
  { key: "insights", label: "Insights" },
  { key: "queue", label: "Queue" },
  { key: "vault", label: "Vault" },
  { key: "simulator", label: "Simulator" },
];

// Add inside component:
const [activeHomeIndex, setActiveHomeIndex] = useState(0);
const [visitedHomePages, setVisitedHomePages] = useState(new Set([0]));

const handleHomeIndexChange = useCallback((idx: number) => {
  setActiveHomeIndex(idx);
  setVisitedHomePages((prev) => new Set([...prev, idx]));
}, []);
```

**New JSX structure:**
```jsx
<ScreenContainer padTop={false}>
  <SwipePager pages={HOME_TABS} activeIndex={activeHomeIndex} onIndexChange={handleHomeIndexChange}>
    {/* Page 0 — Overview (existing ScrollView, minus App Header block) */}
    <ScrollView
      className="flex-1"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 80 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={...} />}
    >
      {/* Stale backup warning */}
      {/* Min balance alerts */}
      {/* Action Required card */}
      {/* All other existing home cards unchanged */}
    </ScrollView>

    {/* Page 1 — Insights */}
    {visitedHomePages.has(1) ? <InsightsPage /> : <View style={{ flex: 1 }} />}

    {/* Page 2 — Review Queue */}
    {visitedHomePages.has(2) ? <ReviewQueuePage /> : <View style={{ flex: 1 }} />}

    {/* Page 3 — Vault */}
    {visitedHomePages.has(3) ? <VaultPage /> : <View style={{ flex: 1 }} />}

    {/* Page 4 — Simulator */}
    {visitedHomePages.has(4) ? <SimulatorPage /> : <View style={{ flex: 1 }} />}
  </SwipePager>

  {/* Absolute overlays unchanged */}
  <AccountPickerSheet ... />
  {linkSheetFor && <LinkExpenseSheet ... />}
</ScreenContainer>
```

### Step D — Embedded page components

All 4 components follow the same pattern:
- No `ScreenContainer` (parent provides it)
- No `Stack.Screen` / nav header
- `useDataRefresh(loadData)` instead of `useFocusEffect`
- Own `ScrollView` with `RefreshControl`
- `router.push(...)` for detail navigation (unchanged)

**`InsightsPage.tsx`** — copy of `app/insights/index.tsx` logic:
- Remove `ScreenContainer` wrapper + `if (loading) return <ScreenContainer>...` branch
- Replace with `if (loading) return <LoadingState message="..." />`
- Keep all `router.push` calls to `/insights/insight-detail`
- Export as named export `InsightsPage`

**`ReviewQueuePage.tsx`** — embedded version of `app/expense/review-queue.tsx`:
- Remove `ScreenContainer`, `Stack.Screen`, `useSmsScan` (scan is in header now)
- Remove `useLocalSearchParams` (no deep-link `filter` param when embedded)
- Keep all approve/reject/edit service calls, category assignment, duplicate handling
- `useFocusEffect` → `useDataRefresh`
- `router.push(...)` for editing individual expenses unchanged
- This is a full embedded replica — the screen is complex but all state is self-contained

**`VaultPage.tsx`** — copy of `app/vault/index.tsx` logic:
- Remove `ScreenContainer`, `FAB` (add-new button)
- Keep search, grouped sections, entry rows, `router.push('/vault/[id]')`
- `useFocusEffect` → `useDataRefresh`
- Add a "+ New Entry" Pressable in the page header row instead of the FAB

**`SimulatorPage.tsx`** — copy of `app/simulator/index.tsx` logic:
- Remove `ScreenContainer`
- `useFocusEffect` → `useDataRefresh`
- Keep all scenario CRUD, `router.push('/simulator/[id]')` for scenario detail

**Original routes stay intact:**
- `/insights` → `app/insights/index.tsx` — unchanged
- `/expense/review-queue` → `app/expense/review-queue.tsx` — unchanged
- `/vault` → `app/vault/index.tsx` — unchanged
- `/simulator` → `app/simulator/index.tsx` — unchanged

---

## Key Rules (Do Not Break)

1. **No existing route removed.** Every route that exists today still exists after all phases.
2. **No data loading regression.** Embedded pages use `useDataRefresh` — fires when component mounts while screen is already focused (lazy mount pattern works automatically).
3. **No gesture conflicts.** SwipePager horizontal scroll must not interfere with vertical FlatLists/ScrollViews inside pages, or with `SwipeableRow` components.
4. **Lazy mount.** Pages 1–4 in Home use `visitedHomePages` Set. Page 1 in Budget uses `visitedSplit` boolean. Pages in Transactions are empty `<View>` when not active (single shared FlatList approach).
5. **Period navigator sync.** Budget: both pages share the same `month` state.
6. **Tab badge preserved.** Pending-count badge on Transactions tab icon is in `_layout.tsx` — never touched.
7. **Tab strip scrollable.** SwipePager `scrollEnabled={pages.length > 4}` — kicks in for 5-tab screens (Home, Transactions).
8. **Scan state in _layout.tsx.** After Phase 5, `smsScanning` lives in `_layout.tsx` (not `index.tsx`). The home screen's `handleSmsScan` and `smsScanning` state must be removed from `index.tsx` to avoid duplicates.

---

## Files Changed Per Phase

```
Phase 1:  app/(tabs)/_layout.tsx
Phase 2:  components/ui/SwipePager.tsx (new)
          components/ui/index.ts
Phase 3:  app/(tabs)/budget.tsx
          components/budget/SpendingSplitPage.tsx (new)
Phase 4:  app/(tabs)/expenses.tsx
Phase 5:  app/(tabs)/index.tsx
          app/(tabs)/_layout.tsx
          components/home/pages/InsightsPage.tsx (new)
          components/home/pages/ReviewQueuePage.tsx (new)
          components/home/pages/VaultPage.tsx (new)
          components/home/pages/SimulatorPage.tsx (new)
```

---

## Current Status

All phases complete. Ready to commit, push, build, and release.
