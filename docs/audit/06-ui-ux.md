# UI / UX Audit

## Quick Wins (Low Effort, High Impact)

### 🟡 HIGH — ErrorBoundary shows raw stack trace in production (info leak risk)
**File:** `app/_layout.tsx` lines 46–53  
**Issue:** The `ErrorBoundary` renders the raw `error.message` and `error.stack` only when `__DEV__`, which is correct. However, the "Something went wrong. Please restart the app." message in production provides no actionable path for the user (no restart button, no feedback option).  
**User / UX Impact:** When the app crashes and the error boundary triggers, the user is stuck on a plain text message with no button, no logo, and no escape — they must manually swipe-close and reopen the app. Many users don't know how to force-kill an app. On a device with no gesture navigation this could leave them fully locked out until a device restart. First-time users who hit a crash during onboarding will likely uninstall rather than troubleshoot.  
**Fix:** Add a "Restart App" button that uses `expo-updates` `reloadAsync()` (or a deep-link reset) so users can self-recover without manually killing the app.

---

### 🟡 HIGH — Database init failure screen has no restart option
**File:** `app/_layout.tsx` lines 297–308  
**Issue:** The `initError` screen shows the raw error string to the user with no way to recover. Users who hit a transient DB init error are stuck.  
**User / UX Impact:** A transient DB init failure (e.g. "disk I/O error" due to a momentary storage hiccup) shows the user a raw technical error string and offers no recovery. The only option is to kill and reopen the app — which most users don't know to try. The raw error text (e.g. "SQLiteException: unable to open database file") is alarming and gives the impression their data is permanently corrupted, even when it isn't. Users seeing this screen are likely to panic and report data loss even when a simple retry would have succeeded.  
**Fix:** Add a "Try Again" button that calls `initDatabase()` again (with a loading state), and a "Contact Support" button (e.g., compose email with error details).

---

### 🟡 MEDIUM — SplashScreen inline styles instead of Tailwind/NativeWind
**File:** `app/_layout.tsx` lines 88–108  
**Issue:** The custom `SplashScreen` component uses large inline `style` objects throughout instead of NativeWind classes. This is inconsistent with the rest of the app and means theme changes need to be applied in two places.  
**User / UX Impact:** If the app's accent color or dark mode background is updated via Tailwind config, the splash screen keeps the old hardcoded colors. Users in dark mode on OLED devices will see a brief flash of white (#FFFFFF inline background) if the dark mode check is missed — a jarring experience on each cold start. The splash is the first thing every user sees; inconsistent theming creates an impression of low polish.  
**Fix:** Migrate inline styles to `className` props using NativeWind. Specifically the `isDark ? "#111111" : "#FFFFFF"` checks should use `dark:bg-black bg-white` equivalent classes.

---

### 🟡 MEDIUM — `step` text on SplashScreen uses lowercase "starting up..." style
**File:** `app/_layout.tsx` line 104  
**Issue:** The step messages ("Preparing database...", "Setting up your workspace...", etc.) are inconsistent in length and casing. Some are conversational, some are terse. On slow devices the user stares at these messages for several seconds.  
**User / UX Impact:** On slow mid-range devices where DB init takes 3–5 seconds, users read these messages carefully. Inconsistent casing (some Title Case, some lowercase) and variable message lengths cause the text to visually jump/reflow as steps advance, which feels janky. A message like "Starting up" with no ellipsis feels like it froze, while "Preparing database..." with ellipsis feels actively loading. The perceived wait time increases when the animation doesn't match the mental model of "progress".  
**Fix:** Standardize to a consistent style (e.g., all title-case, max 30 chars) and consider a brief progress animation to reduce perceived wait time.

---

### 🟡 MEDIUM — Home screen uses `ScrollView` — no empty state for first-time users
**File:** `app/(tabs)/index.tsx`  
**Issue:** On first launch, the home screen ScrollView renders with default zero-data states scattered across cards. There's no unified empty-state / "get started" prompt that guides new users to their first action.  
**User / UX Impact:** New users who complete onboarding land on a Home screen showing "₹0 spent", "0 pending", "0 duplicates" across multiple cards with no context. There is no clear call-to-action — they don't know whether to tap "Import SMS", "Add Expense", or "Add Account" first. This cold-start confusion is a primary driver of early churn: users open the app, see a blank dashboard, and close it. Without a guided first action, activation rates suffer.  
**Fix:** Detect `pendingCount === 0 && totalSpent === 0 && accounts.length === 0` and show a friendly onboarding-state card pointing to "Import SMS" or "Add your first expense".

---

### 🟡 MEDIUM — Expenses tab uses `FlatList` but filter controls render inside `ScrollView` header
**File:** `app/(tabs)/expenses.tsx` lines 677–704  
**Issue:** Filter date picker is rendered inside a `ScrollView` nested inside the FlatList header area. `nestedScrollEnabled` is set, but on Android this can cause touch event conflicts and janky scrolling.  
**User / UX Impact:** On Android (especially older versions), when a user tries to scroll the filter date picker row, the touch event is frequently stolen by the parent FlatList, causing the filter list to scroll instead of the outer expense list (or vice versa). Users trying to select a date range filter find it unresponsive or erratic — they tap a filter chip but the list scrolls instead. This is one of the most common sources of perceived "the app is glitchy" feedback on Android mid-range devices.  
**Fix:** Move filter controls to a fixed position above the `FlatList` (outside the list entirely) or use a bottom sheet for filter UI.

---

### 🟢 LOW — `Text` in ErrorBoundary and init error screen uses hardcoded hex colors
**File:** `app/_layout.tsx` lines 39–52, 300–306  
**Issue:** Colors like `#EF4444`, `#FFFFFF`, `#111111` are hardcoded inline. If the accent palette or dark mode logic changes, these error screens won't update.  
**User / UX Impact:** In dark mode, the init error screen background is hardcoded `#111111` (near-black) — which happens to look correct today. But if the app's dark mode background changes to a warmer dark tone in a future theme update, the error screen will be visually inconsistent. More immediately: if a user has a custom accent theme applied, the red `#EF4444` error title clashes with the app's normal error colour for that theme. Minor polish issue only.  
**Fix:** Use Tailwind classes (`text-red-500 text-white bg-neutral-900`) for consistency.

---

### 🟢 LOW — App name in splash screen is "अर्थ / Artha" but app.json name is "Aartha Stg"
**File:** `app/_layout.tsx` lines 95–100, `app.json` line 3  
**Issue:** The splash screen prominently shows "अर्थ / Artha" but the staging app's launcher name is "Aartha Stg". This mismatch causes slight confusion during staging testing.  
**User / UX Impact:** Testers using the staging build see "Aartha Stg" in their app drawer but the splash screen says "Artha". When sharing feedback screenshots, this inconsistency makes it unclear whether a tester is running staging or production — which can lead to production bugs being filed against the wrong version. For production users there is no impact.  
**Note:** This is intentional for staging distinction, but worth calling out. Production build should use consistent naming.

---

### 🟢 LOW — SplashScreen `pulseAnim` `useEffect` dep array includes `pulseAnim` unnecessarily
**File:** `app/_layout.tsx` line 67  
**Issue:** `pulseAnim` is a `useRef` and never changes. The dep array `[pulseAnim]` is equivalent to `[]` but misleads readers into thinking the animation re-creates when `pulseAnim` changes.  
**User / UX Impact:** None visible. If React Fast Refresh or a future React version treats the ref identity as changed on hot reload, the animation could briefly restart mid-splash causing a flicker — visible only in dev. In production builds there is no user-facing effect.  
**Fix:** Change to `useEffect(() => { ... }, [])`.

---

## Summary Table

| Severity | Issue | File | Effort |
|----------|-------|------|--------|
| 🟡 High | ErrorBoundary no restart action | app/_layout.tsx | 20 min |
| 🟡 High | DB init failure no recovery UX | app/_layout.tsx | 20 min |
| 🟡 Medium | SplashScreen uses inline styles (not NW) | app/_layout.tsx | 30 min |
| 🟡 Medium | SplashScreen step messages inconsistent | app/_layout.tsx | 10 min |
| 🟡 Medium | Home screen no first-launch empty state | app/(tabs)/index.tsx | 1h |
| 🟡 Medium | Nested ScrollView in Expenses filter | app/(tabs)/expenses.tsx | 1h |
| 🟢 Low | Hardcoded hex colors in error screens | app/_layout.tsx | 15 min |
| 🟢 Low | App name mismatch splash vs launcher (staging) | app.json / _layout.tsx | note only |
| 🟢 Low | useEffect dep array on pulseAnim | app/_layout.tsx | 2 min |
