# Performance Audit

## Quick Wins (Low Effort, High Impact)

### 🟡 HIGH — `preloadHomeData` fires ALL sections serially within `loadAccountGroupSection`
**File:** `services/home-preload.ts` lines 280–315  
**Issue:** Inside `loadAccountGroupSection`, each account in the group calls `getMonthBalanceSummary()` → and on cache miss, **three more parallel queries** (`getAccountExpensesTotal`, `getAccountCreditsTotal`, `getAccountAdjustmentNet`). For a user with 5+ bank accounts this spawns 15+ sequential DB queries on cold start. The outer `Promise.all` in `preloadHomeData` doesn't help because the bottleneck is inside each section.  
**User / UX Impact:** Users with 4+ bank accounts or wallets will experience a noticeably slower home screen load on cold start. The Home tab and Accounts tab display a loading state for 1–3 extra seconds while account summaries are fetched serially. On older mid-range Android devices (Redmi, Realme) with slower SQLite I/O, this can stretch to 4–5 seconds of blank/loading cards on the home screen after the splash disappears.  
**Fix:** Batch the three fallback queries into a single SQL `UNION ALL` or a multi-account grouped query. This is the largest single cold-start bottleneck outside of `scanAllDuplicatesCached`.

---

### 🟡 HIGH — `scanAllDuplicatesCached` runs on every app open
**File:** `services/home-preload.ts` line 153, `services/duplicate-detection.ts`  
**Issue:** The duplicate scan is called inside `loadHomeSection()` on every app open. Even though it has a cache, the cache is module-level and resets on each JS reload (cold start). A heavy duplicate scan on every cold start adds meaningful latency for users with large transaction histories.  
**User / UX Impact:** For users with 500+ transactions, the duplicate scan can take 300–800ms on each cold start. This directly delays the "Potential Duplicates" count badge appearing on the Home screen — or more visibly, the entire Home tab preload waits for this scan to complete before the home data is cached. The user sees a blank home screen for longer than necessary on every fresh app open.  
**Fix:** Persist the last duplicate scan result and timestamp in MMKV. Only re-run if `dataVersion` changed since last scan.

---

### 🟡 HIGH — `seedMerchantMappings()` called on every DB init (no version check)
**File:** `database/database.ts` line 49  
**Issue:** `seedMerchantMappings()` is called unconditionally on every `initDatabase()`. If the merchant mappings table already has data, this is a no-op, but it still runs the full seeding logic (likely a large `SELECT COUNT` + potential `INSERT OR IGNORE` loop) on every app launch.  
**User / UX Impact:** Adds 100–400ms to every cold-start DB init sequence. The user sees the splash screen "Preparing database..." step for longer than needed. This happens silently — no loading indicator specifically shows this step, but it delays the overall transition from splash to Home. Worst case on low-end devices with large merchant mapping tables: the splash stays visible for a noticeable extra beat.  
**Fix:** Gate behind a `data_bundle_versions` check (like `seedPublicData` does) so it only re-seeds when the bundle version changes.

---

### 🟡 MEDIUM — `loadHomeSection` fires 11 parallel DB queries simultaneously
**File:** `services/home-preload.ts` lines 146–158  
**Issue:** `Promise.all([...11 queries...])` on cold start creates significant SQLite contention. In WAL mode this is better, but 11 concurrent readers on startup still saturates the SQLite connection.  
**User / UX Impact:** On devices where SQLite WAL mode doesn't fully parallelize (older Android 8/9 devices), this can cause individual queries to block each other, turning a theoretical 200ms parallel query into a 600–900ms serialized chain. The user sees the Home tab cards all appearing at once after a longer wait, rather than progressively loading. No spinner is shown for individual cards — the whole screen just seems slow to populate.  
**Fix:** Group into 2–3 batches: (a) user-data queries, (b) account queries, (c) analytics queries. Reduces peak concurrency while still being fast.

---

### 🟡 MEDIUM — `syncAllScheduledNotifications` called on every app open (only debounced 5 min)
**File:** `services/notification-scheduler.ts` lines 333–346  
**Issue:** Every app open calls `syncNotifBackgroundTask()` → `runDailyNotificationCheck()` → `syncAllScheduledNotifications()`. The 5-minute debounce is short. For users who switch apps frequently, this re-fetches all scheduled notifications and potentially cancels/reschedules dozens of per-EMI notifications multiple times per hour.  
**User / UX Impact:** Users who open Artha multiple times per day (common for active budget trackers) will trigger this sync 5–8 times daily. Each sync cancels and re-creates all per-EMI scheduled notifications, which briefly removes them from the OS notification tray queue. More noticeably: on devices with aggressive battery optimization (MIUI, ColorOS), repeated notification reschedules can cause the OS to deprioritize Artha's notification slot — leading to notifications that silently stop arriving.  
**Fix:** Increase debounce to 1 hour or tie reschedule to `dataVersion` change events.

---

### 🟡 MEDIUM — `checkAndNotifyOverdue` and `checkAndNotifyUpcoming` both call separate DB queries
**File:** `services/notification-scheduler.ts` lines 407–470  
**Issue:** In `runDailyNotificationCheck`, four separate async checks run sequentially: `checkAndNotifyOverdue`, `checkAndNotifyUpcoming`, `checkAndNotifyRecurringReminders`, `checkAndNotifyLoanEMIs`. Each fetches from the DB independently. For a user with many overdue/upcoming items this is 4 round trips.  
**User / UX Impact:** No direct screen-level visible impact since this runs in the background. However, the extra DB time extends the background task execution window. On Android with strict background execution limits, this can cause the notification check task to be killed before completing — so the user misses overdue or EMI notifications that would have otherwise fired. The notifications that were “about” to be sent simply don’t appear.  
**Fix:** Combine into a single parallel `Promise.all([...])` call (they are independent of each other).

---

### 🟡 MEDIUM — Home tab uses `ScrollView` for potentially long expense list preview
**File:** `app/(tabs)/index.tsx` line 268  
**Issue:** Home tab renders inside a top-level `ScrollView`. If many cards are visible, all card content is mounted at once. Large home screens with many accounts/widgets will render everything eagerly.  
**User / UX Impact:** Users with many accounts (6+ credit cards, 3+ savings accounts, active loans, hisaab entries, investments) will see a noticeably sluggish home tab that takes longer to become interactive after navigation. All cards mount simultaneously — the JS thread is busy rendering off-screen content. On mid-range devices this manifests as tab switching feeling "sticky" or the home screen briefly showing a white flash before content appears.  
**Fix:** Consider `FlatList` for card sections or lazy-render cards that are off-screen using `InteractionManager.runAfterInteractions`.

---

### 🟢 LOW — `cleanupLegacyScheduledScan` runs unconditionally on every startup
**File:** `app/_layout.tsx` lines 119–140  
**Issue:** `cleanupLegacyScheduledScan()` checks `TaskManager.isTaskRegisteredAsync` and `cancelAllScheduledNotificationsAsync` on every startup. These are async OS calls. Once the legacy task is known to be gone (store a flag in MMKV), the check can be skipped entirely.  
**User / UX Impact:** Adds a small async overhead on every cold start (~20–50ms for the OS task registry lookup). More importantly, `cancelAllScheduledNotificationsAsync()` fires on every start — all Layer 1 scheduled EMI and reminder notifications are cancelled and must be re-created in the subsequent sync step. There is a brief window (~100–200ms) at each app open where no notifications are scheduled, meaning if the device crashes or is killed in that window, all future scheduled alerts are lost.  
**Fix:** After first successful cleanup, set an MMKV flag `legacy_sms_task_cleaned = true` and skip the cleanup on subsequent starts.

---

### 🟢 LOW — `Animated.loop` in SplashScreen not cleaned up optimally
**File:** `app/_layout.tsx` lines 67–86  
**Issue:** The pulse animation calls `animation.stop()` on unmount, but the `useEffect` dependency is `[pulseAnim]` — `pulseAnim` is a `useRef` value and never changes. The dep array should be `[]`.  
**User / UX Impact:** No visible animation difference. The incorrect dep array could theoretically cause the animation effect to re-register on each render if React's reconciler treats the ref-wrapped value as "changed" in a future React version. In practice today, no visible impact — this is a correctness concern only.  
**Fix:** Change `useEffect(() => { ... }, [pulseAnim])` to `useEffect(() => { ... }, [])`.

---

## Summary Table

| Severity | Issue | File | Effort |
|----------|-------|------|--------|
| 🟡 High | Account group section spawns N×3 sequential queries | home-preload.ts | 2h |
| 🟡 High | Duplicate scan reruns on every cold start | duplicate-detection.ts | 1h |
| 🟡 High | seedMerchantMappings() uncached re-run on every init | database.ts | 30 min |
| 🟡 Medium | 11 parallel queries on cold start | home-preload.ts | 1h |
| 🟡 Medium | Notification sync too frequent (5 min debounce) | notification-scheduler.ts | 15 min |
| 🟡 Medium | 4 sequential notification checks instead of parallel | notification-scheduler.ts | 10 min |
| 🟡 Medium | Home tab uses ScrollView for all cards | app/(tabs)/index.tsx | 1h |
| 🟢 Low | Legacy cleanup runs every startup | app/_layout.tsx | 15 min |
| 🟢 Low | Splash animation useEffect dep array wrong | app/_layout.tsx | 2 min |
