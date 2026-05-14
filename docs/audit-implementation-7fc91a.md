# Artha Audit — Full Implementation Tech Design (Revised)

Full sprint-by-sprint implementation plan for all 75 issues, revised after architectural impact review. Changes from review are marked **[ARCH FIX]**.

> **Pre-implementation verifications (all resolved):**
> - ✅ WAL mode: already enabled in `database.ts` line 37 — `Promise.all` on notification checks is safe
> - ✅ `resolveJsonModule`: enabled via `expo/tsconfig.base` — JSON imports work
> - ❌ `expo-updates`: NOT in `package.json` — `reloadAsync()` cannot be used; `BackHandler.exitApp()` is the fallback
> - ✅ Lock screen always navigates to `/(tabs)` — `returnTo` param fix confirmed necessary

---

## Sprint 1 — Critical + High-impact quick fixes (~3h total)
> Correctness bugs, data loss risks, and glaring production gaps. Do these first.

---

### S1-1 · Fix `simulation_entries` in TABLE_SCHEMAS (5 min)
**File:** `database/TABLE_SCHEMAS.ts` lines 592–612

Add two lines inside the `simulation_entries` array, after `"hisaab_kind"`:
```ts
// v16.0.9 — simulator transfer accounts (migration 042)
"from_account_id",
"to_account_id",
```
No migration needed. Backup/restore will now include these columns for all simulation transfer rows.

---

### S1-2 · Add `settings` table to TABLE_SCHEMAS + BACKUP_TABLES (10 min)
**File 1:** `database/TABLE_SCHEMAS.ts` — append before the closing `} as const`:
```ts
// v17.x — per-user key-value settings (migration 043)
settings: [
  "user_id",
  "key",
  "value",
  "updated_at",
] as const,
```

**File 2:** `services/backup.ts` — add after `"expense_edit_history"` in `BACKUP_TABLES`:
```ts
// v17.x — per-user DB settings (migration 043)
"settings",
```

---

### S1-3 · Fix migration 042 to use the `db` parameter (10 min)
**File:** `database/migrations/042_simulator_transfers.ts`

Replace entire file:
```ts
import type { SQLiteDatabase } from "expo-sqlite";

export default {
  version: 42,
  name: "simulator_transfers",
  up: async (db: SQLiteDatabase): Promise<void> => {
    await db.execAsync(`
      ALTER TABLE simulation_entries ADD COLUMN from_account_id TEXT REFERENCES financial_accounts(id);
      ALTER TABLE simulation_entries ADD COLUMN to_account_id TEXT REFERENCES financial_accounts(id);
    `);
  },
};
```
Removes: `getDatabase()` import, `down()` method, wrong import.

---

### S1-4 · Document migration gaps 037 and 041 (5 min)
**File:** `database/migrations/index.ts`

In the imports block, after `migration036`, add two comments:
```ts
// 037: removed in v17.5.x — notification_collector_events migration deleted with feature
// 038: present ↓
import migration038 from "./038_null_masked_account_descriptions";
import migration039 from "./039_loan_account_number_and_sms_reminder";
import migration040 from "./040_expense_edit_history";
// 041: removed in v17.5.x — notification_collector_triggers migration deleted with feature
import migration042 from "./042_simulator_transfers";
```
No code change — comments only.

---

### S1-5 · Fix hardcoded localhost URL in kite-connect (30 min)
**File:** `services/kite-connect.ts`

Replace line 7:
```ts
// BEFORE:
const BACKEND_URL = 'http://localhost:3000'; // Change this to your backend URL (use ngrok URL for mobile)

// AFTER:
// Configure via app.json `extra.kiteBackendUrl` or set EXPO_PUBLIC_KITE_BACKEND_URL in .env
const BACKEND_URL: string = process.env.EXPO_PUBLIC_KITE_BACKEND_URL ?? '';

if (!__DEV__ && !BACKEND_URL) {
  // Hard fail in production so misconfigured builds are caught at runtime
  throw new Error('[Artha] EXPO_PUBLIC_KITE_BACKEND_URL is not set. Kite integration will not work.');
}
```

**File:** `.env` (create if absent, add to `.gitignore`):
```
EXPO_PUBLIC_KITE_BACKEND_URL=https://your-backend.example.com
```

Also update `exchangeRequestToken` to enforce HTTPS check:
```ts
if (!BACKEND_URL.startsWith('https://') && !__DEV__) {
  throw new Error('[Artha] Kite backend URL must use HTTPS in production');
}
```

---

### S1-6 · Fix `useRouter()` called inside try/catch (5 min)
**File:** `app/_layout.tsx` lines 147–154

```ts
// BEFORE:
const routerRef = useRef<ReturnType<typeof useRouter> | null>(null);

try {
  routerRef.current = useRouter();
} catch (e) {
  logger.warn("Router not ready during initial render", e);
}

// AFTER:
const router = useRouter();
const routerRef = useRef(router);
useEffect(() => {
  routerRef.current = router;
}, [router]);
```
`useRouter()` is unconditionally called at the top of the component (valid hook call). `routerRef` is kept for the notification deep-link handler (which needs the ref to avoid stale closures).

---

### S1-7 · Fix UUID fallback to use expo-crypto (10 min)
**File:** `utils/uuid.ts`

```ts
import * as Crypto from 'expo-crypto';

export function generateUUID(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }
  // Fallback using expo-crypto's CSPRNG (covers environments without crypto.randomUUID)
  const bytes = Crypto.getRandomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant bits
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
```

---

### S1-8 · Add ErrorBoundary restart button (20 min) **[ARCH FIX A4]**
**File:** `app/_layout.tsx` — `ErrorBoundary.render()` method

> **[ARCH FIX A4]:** `expo-updates` is NOT in `package.json` — `reloadAsync()` cannot be used. Use `BackHandler.exitApp()` instead (closes app; user reopens from launcher). This is the correct pattern for bare local APK builds.

`BackHandler` is already imported from `react-native` in `_layout.tsx`. Add `TouchableOpacity` to the existing import:
```ts
import { ..., TouchableOpacity, BackHandler } from 'react-native';
```

Replace the error render block:
```tsx
render() {
  if (this.state.error) {
    return (
      <View style={{ flex: 1, backgroundColor: '#111111', padding: 32, paddingTop: 80 }}>
        <Text style={{ color: '#EF4444', fontSize: 20, fontWeight: 'bold', marginBottom: 16 }}>
          Something went wrong
        </Text>
        <Text style={{ color: '#FFFFFF', fontSize: 14, marginBottom: 24 }}>
          Please close and reopen the app to continue.
        </Text>
        <TouchableOpacity
          onPress={() => BackHandler.exitApp()}
          style={{ backgroundColor: '#134E4A', padding: 14, borderRadius: 10, alignItems: 'center' }}
        >
          <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Close App</Text>
        </TouchableOpacity>
        {__DEV__ && (
          <ScrollView style={{ marginTop: 16 }}>
            <Text style={{ color: '#FFFFFF', fontSize: 14, marginBottom: 8 }}>
              {this.state.error.message}
            </Text>
            <Text style={{ color: '#6B7280', fontSize: 12 }}>{this.state.error.stack}</Text>
          </ScrollView>
        )}
      </View>
    );
  }
  return this.props.children;
}
```

---

### S1-9 · Add DB init failure retry + close buttons (20 min) **[ARCH FIX A4]**
**File:** `app/_layout.tsx` — `initError` render block (lines 297–308)

> **[ARCH FIX A4]:** No `expo-updates`. Provide two actions: "Try Again" (retry init in-process) and "Close App" (`BackHandler.exitApp()`).

Add a `retryCount` state and `retryInit` callback inside `RootLayout`:
```ts
const [retryCount, setRetryCount] = useState(0);
const retryInit = useCallback(() => {
  setInitError(null);
  setDbReady(false);
  setRetryCount((c) => c + 1);
}, []);
```

Update the init `useEffect` deps to include `retryCount`:
```ts
useEffect(() => { /* existing init logic */ }, [retryCount]);
```

Replace the `initError` render:
```tsx
if (initError) {
  return (
    <View style={{ flex: 1, backgroundColor: '#111111', padding: 32, paddingTop: 80 }}>
      <Text style={{ color: '#EF4444', fontSize: 20, fontWeight: 'bold', marginBottom: 16 }}>
        Database Init Failed
      </Text>
      <Text style={{ color: '#FFFFFF', fontSize: 14, marginBottom: 24 }}>
        This may be a temporary issue. Try again or close and reopen the app.
      </Text>
      <TouchableOpacity
        onPress={retryInit}
        style={{ backgroundColor: '#134E4A', padding: 14, borderRadius: 10, alignItems: 'center', marginBottom: 12 }}
      >
        <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Try Again</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => BackHandler.exitApp()}
        style={{ borderWidth: 1, borderColor: '#374151', padding: 14, borderRadius: 10, alignItems: 'center' }}
      >
        <Text style={{ color: '#9CA3AF', fontWeight: '600' }}>Close App</Text>
      </TouchableOpacity>
      {__DEV__ && (
        <ScrollView style={{ marginTop: 16 }}>
          <Text style={{ color: '#FFFFFF', fontSize: 12 }}>{initError}</Text>
        </ScrollView>
      )}
    </View>
  );
}
```

---

### S1-10 · Fix CI workflow — remove dead sed, add timeout + tests (20 min)
**File:** `.github/workflows/build-apk.yml`

**a) Add job timeout** — add under `runs-on: self-hosted`:
```yaml
timeout-minutes: 60
```

**b) Replace fragile sed** — replace the `Update package name for staging` step:
```yaml
- name: Update package name for staging
  if: steps.config.outputs.branch == 'staging'
  run: |
    node -e "
      const fs = require('fs');
      const c = JSON.parse(fs.readFileSync('app.json','utf8'));
      c.expo.android.package = 'com.souravbaid.artha.staging';
      c.expo.name = 'Aartha Stg';
      fs.writeFileSync('app.json', JSON.stringify(c, null, 2));
    "
```

**c) Add typecheck + test steps** — insert after `Install dependencies`:
```yaml
- name: Typecheck
  run: npx tsc --noEmit

- name: Run tests
  run: npm test -- --ci --forceExit --passWithNoTests
```

---

## Sprint 2 — Functional + Security fixes (~4h total)
> Runtime behavior bugs with real user-visible impact.

---

### S2-1 · Fix monthly summary re-firing on day 1 (15 min)
**File:** `services/notification-scheduler.ts`

Add a new MMKV key constant at the top:
```ts
const MONTHLY_SUMMARY_LAST_SENT_KEY = "notif_monthly_summary_last_sent_month";
```

Replace the day-1 block in `runDailyNotificationCheck` (lines 653–655):
```ts
const today = new Date();
if (today.getDate() === 1) {
  const currentMonth = `${today.getFullYear()}-${today.getMonth() + 1}`;
  const lastSentMonth = storage.getString(MONTHLY_SUMMARY_LAST_SENT_KEY) ?? "";
  if (lastSentMonth !== currentMonth) {
    storage.set(MONTHLY_SUMMARY_LAST_SENT_KEY, currentMonth);
    sendMonthlySummaryNow(userId).catch((e) => logger.warn("Monthly summary failed", e));
  }
}
```

---

### S2-2 · Fix biometric deep-link bypass (30 min) **[ARCH FIX B2+B4]**
**File 1:** `app/_layout.tsx` — notification response listener (lines 264–274)

> **[ARCH FIX B2+B4]:** Lock screen always navigates to `/(tabs)` post-unlock (line 49 of `lock.tsx`). Pass `returnTo` as a search param so the lock screen can navigate to the correct destination after unlock.

Replace the listener handler:
```ts
const subscription = Notifications.addNotificationResponseReceivedListener(
  async (response) => {
    const screen = response.notification.request.content.data?.screen;
    if (!screen || typeof screen !== 'string' || !ALLOWED_DEEP_LINK_SCREENS.has(screen)) return;
    if (!routerRef.current) return;

    // Check lock BEFORE navigating — pass returnTo so lock screen redirects correctly
    if (getFlag('v15_biometric_lock') && shouldShowLock()) {
      routerRef.current.replace({
        pathname: '/(lock)/lock' as never,
        params: { returnTo: screen },
      });
      return;
    }
    routerRef.current.push(screen as never);
  }
);
```

**File 2:** `app/(lock)/lock.tsx` — read `returnTo` param and use it post-unlock:
```ts
import { useLocalSearchParams } from 'expo-router';

// Inside LockScreen():
const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();

// Replace the router.replace("/(tabs)") line (line 49):
const destination = returnTo && ALLOWED_DEEP_LINK_SCREENS.has(returnTo)
  ? returnTo
  : '/(tabs)';
router.replace(destination as never);
```

Also import `ALLOWED_DEEP_LINK_SCREENS` at the top of `lock.tsx`:
```ts
import { ALLOWED_DEEP_LINK_SCREENS } from '@/constants/routes';
```

---

### S2-3 · Gate legacy cleanup behind MMKV flag (15 min) **[ARCH FIX A1]**
**File:** `app/_layout.tsx`

> **[ARCH FIX A1]:** Use a static top-level import for `settingsStorage`, not a dynamic import inside the function. Dynamic imports inside async functions bypass Jest MMKV mocks. `settingsStorage` is already indirectly loaded by other imports in `_layout.tsx` at startup — no circular issue.

Add static import at the top of the file (alongside existing imports):
```ts
import { settingsStorage } from '@/services/storage';
```

Add constant at module level (outside the function):
```ts
const LEGACY_CLEANUP_DONE_KEY = "artha_legacy_sms_task_cleaned_v2";
```

Update `cleanupLegacyScheduledScan`:
```ts
async function cleanupLegacyScheduledScan(): Promise<void> {
  // Skip entirely once confirmed done — runs only once per install
  if (settingsStorage.getBoolean(LEGACY_CLEANUP_DONE_KEY)) return;

  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(LEGACY_SMS_CHECK_TASK);
    if (isRegistered) {
      await BackgroundFetch.unregisterTaskAsync(LEGACY_SMS_CHECK_TASK);
    }
  } catch (e) {
    logger.warn("Legacy SMS task cleanup failed:", e);
  }
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (e) {
    logger.warn("Legacy scheduled notification cleanup failed:", e);
  }
  settingsStorage.set(LEGACY_CLEANUP_DONE_KEY, true);
}
```

---

### S2-4 · Add FK for expense_edit_history via new migration 044 (20 min) **[ARCH FIX A6]**
**File:** create `database/migrations/044_expense_edit_history_fk.ts`

> **[ARCH FIX A6]:** Multi-step DDL (CREATE → INSERT → DROP → RENAME) MUST be wrapped in `withTransactionAsync`. A crash mid-sequence without a transaction would permanently destroy user edit history. Also disable FK checks during table recreation (required by SQLite for rename-based table rebuild).

```ts
import type { SQLiteDatabase } from "expo-sqlite";

export default {
  version: 44,
  name: "expense_edit_history_fk",
  up: async (db: SQLiteDatabase): Promise<void> => {
    await db.withTransactionAsync(async () => {
      // Disable FK checks for duration of table rebuild
      await db.execAsync(`PRAGMA foreign_keys = OFF;`);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS expense_edit_history_new (
          id TEXT PRIMARY KEY NOT NULL,
          expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
          field_name TEXT NOT NULL,
          old_value TEXT,
          new_value TEXT,
          edited_at TEXT NOT NULL DEFAULT (datetime('now')),
          undone INTEGER NOT NULL DEFAULT 0
        );
      `);
      await db.execAsync(`INSERT INTO expense_edit_history_new SELECT * FROM expense_edit_history;`);
      await db.execAsync(`DROP TABLE expense_edit_history;`);
      await db.execAsync(`ALTER TABLE expense_edit_history_new RENAME TO expense_edit_history;`);
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS idx_edit_history_expense ON expense_edit_history(expense_id);
        CREATE INDEX IF NOT EXISTS idx_edit_history_date ON expense_edit_history(edited_at DESC);
      `);
      await db.execAsync(`PRAGMA foreign_keys = ON;`);
    });
  },
};
```

**File:** `database/migrations/index.ts` — import and add to array:
```ts
import migration044 from "./044_expense_edit_history_fk";
// ...in array:
..., migration043, migration044
```

---

### S2-5 · Extract daily summary raw SQL to expense-queries service (30 min)
**File:** `services/expense-queries.ts` — add new exported function:
```ts
export async function getYesterdaySpendingSummary(
  userId: string,
  date: string
): Promise<{ total: number; count: number }> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ total: number; count: number }>(
    `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
     FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized'
       AND deleted_at IS NULL AND date = ?;`,
    userId, date,
  );
  return row ?? { total: 0, count: 0 };
}
```

**File:** `services/notification-scheduler.ts` — replace the inline `import("@/database")` block in `sendDailySummaryNotification` (lines 101–113):
```ts
import { getYesterdaySpendingSummary } from "@/services/expense-queries";

// ...inside sendDailySummaryNotification:
const { total: yesterdayTotal, count: yesterdayCount } =
  await getYesterdaySpendingSummary(userId, yesterday);
```

---

### S2-6 · Fix duplicate EMI overdue notifications (20 min)
**File:** `services/notification-scheduler.ts` — `checkAndNotifyLoanEMIs` function

Add a per-EMI dedup key using the schedule entry's ID:
```ts
const OVERDUE_EMI_LAST_NOTIF_PREFIX = "notif_emi_overdue_last_";

// Inside checkAndNotifyLoanEMIs, before sending each notification:
const dedupKey = `${OVERDUE_EMI_LAST_NOTIF_PREFIX}${emi.id}`;
const lastSent = storage.getNumber(dedupKey) ?? 0;
const oneDayMs = 24 * 60 * 60 * 1000;
if (Date.now() - lastSent < oneDayMs) continue; // already notified today
storage.set(dedupKey, Date.now());
// ... then sendLocalNotification(...)
```

---

### S2-7 · Parallelise the 4 sequential notification checks (10 min) **[ARCH FIX A2 — resolved ✅]**
**File:** `services/notification-scheduler.ts` — `runDailyNotificationCheck` (lines 648–651)

> **[ARCH FIX A2 resolved]:** WAL mode is already enabled in `database.ts` line 37 (`PRAGMA journal_mode = WAL`). WAL allows concurrent readers against a single SQLite connection — `Promise.all` on 4 read-only DB query functions is safe.

```ts
// BEFORE (sequential):
const overdue = await checkAndNotifyOverdue(userId);
const upcoming = await checkAndNotifyUpcoming(userId);
const recurringReminders = await checkAndNotifyRecurringReminders(userId);
const loanEMIs = await checkAndNotifyLoanEMIs(userId);

// AFTER (parallel — safe under WAL mode):
const [overdue, upcoming, recurringReminders, loanEMIs] = await Promise.all([
  checkAndNotifyOverdue(userId),
  checkAndNotifyUpcoming(userId),
  checkAndNotifyRecurringReminders(userId),
  checkAndNotifyLoanEMIs(userId),
]);
```

---

### S2-8 · Persist duplicate scan count across cold starts (1h) **[ARCH FIX A3]**
**File:** `services/duplicate-detection.ts`

> **[ARCH FIX A3]:** Storing the full `DuplicatePair[]` in MMKV is wrong — MMKV loads all values into memory on boot and is designed for small scalars. The Home screen only uses the **count** of duplicates (badge/action card number), not the full pair list. Cache only the count + data version. The full list is loaded on demand when the user navigates to the review screen.

Add three exported helpers:
```ts
import { settingsStorage } from "@/services/storage";

const DUP_SCAN_COUNT_KEY = "dup_scan_count";
const DUP_SCAN_DATA_VERSION_KEY = "dup_scan_data_version";

export function getCachedDuplicateCount(): number {
  return settingsStorage.getNumber(DUP_SCAN_COUNT_KEY) ?? -1;
}

export function persistDuplicateScanCount(count: number, dataVersion: number): void {
  settingsStorage.set(DUP_SCAN_COUNT_KEY, count);
  settingsStorage.set(DUP_SCAN_DATA_VERSION_KEY, dataVersion);
}

export function getCachedDuplicateScanDataVersion(): number {
  return settingsStorage.getNumber(DUP_SCAN_DATA_VERSION_KEY) ?? -1;
}
```

**File:** `services/home-preload.ts` — update the duplicate scan section:
```ts
import { getDataVersion } from "@/services/settings";
import {
  getCachedDuplicateCount,
  persistDuplicateScanCount,
  getCachedDuplicateScanDataVersion,
  scanAllDuplicatesCached,
} from "@/services/duplicate-detection";

// Inside loadHomeSection:
const currentVersion = getDataVersion();
let duplicateCount: number;
if (getCachedDuplicateScanDataVersion() === currentVersion) {
  // Use cached count — skip expensive scan entirely
  duplicateCount = getCachedDuplicateCount();
} else {
  const pairs = await scanAllDuplicatesCached(userId);
  duplicateCount = pairs.length;
  persistDuplicateScanCount(duplicateCount, currentVersion);
}
```

---

### S2-9 · Increase notification sync debounce to 1 hour (5 min)
**File:** `services/notification-scheduler.ts` line 41

```ts
// BEFORE:
const COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours

// AFTER — keep COOLDOWN_MS for the check, add separate sync debounce:
const SCHEDULE_SYNC_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour for rescheduling
```

In `syncAllScheduledNotifications`, gate on this longer cooldown:
```ts
const lastSync = storage.getNumber(LAST_SCHEDULE_SYNC_KEY) ?? 0;
if (Date.now() - lastSync < SCHEDULE_SYNC_COOLDOWN_MS) return;
storage.set(LAST_SCHEDULE_SYNC_KEY, Date.now());
```

---

### S2-10 · Fix `backup.ts` — use typed import for app version (5 min)
**File:** `services/backup.ts` lines 43–44

```ts
// BEFORE:
// eslint-disable-next-line @typescript-eslint/no-var-requires
const APP_VERSION: string = require("../app.json").expo.version;

// AFTER:
import appConfig from "../app.json";
const APP_VERSION: string = appConfig.expo.version;
```

Also remove the now-unnecessary `export type _AesAlgorithmGCM = AesAlgorithmGCM;` at line 189 — the `AesAlgorithmGCM` type alias is used locally on line 166 and doesn't need re-exporting.

---

### S2-11 · Fix `sanitizeFilename` regex (5 min)
**File:** `services/backup.ts` line 56

```ts
// BEFORE:
return name.replace(/[/\\.\0]/g, "").replace(/\.\./g, "");

// AFTER — only strip path-traversal sequences and null bytes, not all dots:
return name.replace(/\.{2,}/g, "").replace(/[/\\\0]/g, "");
```

---

### S2-12 · Fix `MAGIC_HEADER` guard to run in production too (2 min)
**File:** `services/backup.ts` line 46

```ts
// BEFORE:
if (__DEV__ && MAGIC_HEADER.length !== 9) {

// AFTER:
if (MAGIC_HEADER.length !== 9) {
```

---

### S2-13 · Rename `V15FlagName` type + migration 040 name (10 min)
**File:** `services/feature-flags.ts`
```ts
// BEFORE:
export type V15FlagName = keyof typeof V15_FLAGS;
export function getFlag(name: V15FlagName): boolean {

// AFTER:
export type FeatureFlagName = keyof typeof V15_FLAGS;
export type V15FlagName = FeatureFlagName; // backward compat alias — remove in v18
export function getFlag(name: FeatureFlagName): boolean {
```

**File:** `database/migrations/040_expense_edit_history.ts` line 5:
```ts
name: "expense_edit_history",  // was "040_expense_edit_history"
```

---

### S2-14 · Remove duplicate index from settings migration (5 min)
**File:** `database/migrations/043_settings_table.ts`

Remove lines 23–26:
```ts
// DELETE THIS BLOCK:
await db.execAsync(`
  CREATE INDEX IF NOT EXISTS idx_settings_user_key
  ON settings(user_id, key);
`);
```
The `PRIMARY KEY (user_id, key)` already creates the B-tree index.

> **Note:** This only affects fresh installs or when migration 043 runs for the first time. Existing installs already have the index — a cleanup migration (045) can drop it if desired.

---

## Sprint 3 — Testing coverage (3h total)
> Fill the most dangerous testing gaps identified in the audit.

---

### S3-1 · Re-enable hisaab deactivation test (30 min)
**File:** `__tests__/integration/hisaab.test.ts` line ~108

Investigate the import issue: `deactivateHisaabPerson` likely moved from a barrel to a direct import. Fix by importing from the correct module:
```ts
import { deactivateHisaabPerson } from "@/services/hisaab"; // or wherever it now lives
```
Uncomment the test and add assertions:
```ts
it("soft-deletes a hisaab person", async () => {
  await deactivateHisaabPerson("person-1");
  const db = getDatabase();
  const row = await db.getFirstAsync<{ deleted_at: string | null }>(
    "SELECT deleted_at FROM hisaab_persons WHERE id = 'person-1';"
  );
  expect(row?.deleted_at).not.toBeNull();
});
```

---

### S3-2 · Add migration 042 schema verification test (30 min)
**File:** Create `__tests__/unit/migration-042.test.ts`
```ts
import { runMigrations } from "@/database/migrations";

it("migration 042 adds from_account_id and to_account_id to simulation_entries", async () => {
  // Use in-memory SQLite
  const { openDatabaseAsync } = await import("expo-sqlite");
  const db = await openDatabaseAsync(":memory:");
  // Run up to migration 041 (pre-condition) then 042
  await runMigrations(db);
  const cols = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(simulation_entries);"
  );
  const colNames = cols.map((c) => c.name);
  expect(colNames).toContain("from_account_id");
  expect(colNames).toContain("to_account_id");
});
```

---

### S3-3 · Add backup/restore tests for simulator transfer columns + settings (1h)
**File:** `__tests__/integration/backup.test.ts` — add two test cases:

```ts
it("backup/restore preserves simulation_entries transfer columns", async () => {
  const db = getDatabase();
  await db.runAsync(
    `INSERT INTO simulation_entries (id, scenario_id, direction, amount, date, source, status, from_account_id, to_account_id)
     VALUES ('e1', 's1', 'out', 1000, '2026-01-01', 'manual', 'pending', 'acc-1', 'acc-2');`
  );
  // perform backup then restore
  // ... (use existing test helpers)
  const restored = await db.getFirstAsync<{ from_account_id: string; to_account_id: string }>(
    "SELECT from_account_id, to_account_id FROM simulation_entries WHERE id = 'e1';"
  );
  expect(restored?.from_account_id).toBe("acc-1");
  expect(restored?.to_account_id).toBe("acc-2");
});

it("backup/restore preserves settings table rows", async () => {
  const db = getDatabase();
  await db.runAsync(
    `INSERT INTO settings (user_id, key, value) VALUES (1, 'test_key', 'test_value');`
  );
  // backup/restore
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'test_key';"
  );
  expect(row?.value).toBe("test_value");
});
```

---

### S3-4 · Add monthly summary deduplication test (30 min)
**File:** `__tests__/unit/notification-scheduler.test.ts`

```ts
it("does not send monthly summary twice on day 1 of month", async () => {
  jest.useFakeTimers().setSystemTime(new Date("2026-06-01T10:00:00"));
  const sendSpy = jest.spyOn(notifModule, "sendLocalNotification").mockResolvedValue(undefined);
  
  await runDailyNotificationCheck("default-user");
  await runDailyNotificationCheck("default-user"); // second call same day
  
  const summaryCallCount = sendSpy.mock.calls.filter(
    ([title]) => title.includes("spent")
  ).length;
  expect(summaryCallCount).toBe(1);
  jest.useRealTimers();
});
```

---

### S3-5 · Expand UUID test to cover fallback path (15 min)
**File:** `__tests__/unit/uuid.test.ts`

```ts
import { generateUUID } from "@/utils/uuid";

describe("generateUUID", () => {
  it("returns a valid UUID v4 format", () => {
    const id = generateUUID();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("returns unique values across 100 calls", () => {
    const ids = new Set(Array.from({ length: 100 }, generateUUID));
    expect(ids.size).toBe(100);
  });

  it("fallback path produces valid UUID v4 when crypto.randomUUID is unavailable", () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    const id = generateUUID();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
  });
});
```

---

### S3-6 · Add full DB cold-start integration test (2h)
**File:** Create `__tests__/integration/db-init.test.ts`

```ts
import { initDatabase } from "@/database";

it("initDatabase creates all expected tables on a fresh install", async () => {
  const db = getTestDatabase(); // in-memory fresh
  await initDatabase(); // or runMigrations(db) + seed
  const tables = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
  );
  const tableNames = tables.map(t => t.name);
  expect(tableNames).toContain("expenses");
  expect(tableNames).toContain("simulation_entries");
  expect(tableNames).toContain("settings");
  expect(tableNames).toContain("expense_edit_history");
  // Verify columns
  const simCols = await db.getAllAsync<{ name: string }>("PRAGMA table_info(simulation_entries);");
  expect(simCols.map(c => c.name)).toContain("from_account_id");
});
```

---

## Sprint 4 — UI/UX polish (2h total)

---

### S4-1 · Fix SplashScreen useEffect dep array (2 min)
**File:** `app/_layout.tsx` line 86

```ts
// BEFORE:
}, [pulseAnim]);

// AFTER:
}, []); // pulseAnim is a useRef — never changes, dep array should be empty
```

---

### S4-2 · Standardise SplashScreen step messages (10 min)
**File:** `app/_layout.tsx` — update all `setInitStep(...)` calls to consistent Title Case with ellipsis:
```ts
setInitStep("Preparing Database...");
setInitStep("Setting Up Workspace...");
setInitStep("Learning Patterns...");
setInitStep("Almost Ready...");
```

---

### S4-3 · Add Home screen first-launch empty state (1h) **[ARCH FIX B4]**
**File:** `app/(tabs)/index.tsx`

> **[ARCH FIX B4]:** Detecting first-launch by `totalSpent === 0 && accounts.length === 0` is fragile — it matches a user who deleted all their data, showing them the onboarding state permanently. Gate on `getOnboardingCompletedVersion() === null` instead, which is set by the onboarding wizard and never cleared. Users who completed onboarding never see this state regardless of data counts.

```ts
import { getOnboardingCompletedVersion } from "@/services/settings";
```

After data loads:
```tsx
const isFirstLaunch = getOnboardingCompletedVersion() === null;

if (loaded && isFirstLaunch) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <Text className="text-2xl font-bold text-neutral-900 dark:text-white mb-3">
        Welcome to Artha
      </Text>
      <Text className="text-neutral-500 text-center mb-8">
        Start by importing your bank SMS or adding your first expense.
      </Text>
      <TouchableOpacity onPress={() => router.push('/sms-import')}
        className="bg-teal-900 px-6 py-4 rounded-xl mb-3 w-full items-center">
        <Text className="text-white font-semibold">Import Bank SMS</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => router.push('/expense/new')}
        className="border border-teal-900 px-6 py-4 rounded-xl w-full items-center">
        <Text className="text-teal-900 dark:text-teal-400 font-semibold">Add First Expense</Text>
      </TouchableOpacity>
    </View>
  );
}
```

---

### S4-4 · Fix nested ScrollView in Expenses filter (1h)
**File:** `app/(tabs)/expenses.tsx` lines 677–704

Extract the filter date-picker row out of the FlatList `ListHeaderComponent` into a fixed header rendered above the FlatList:

```tsx
// BEFORE: filter inside ListHeaderComponent (nested scroll)
// AFTER:
<View style={{ flex: 1 }}>
  {/* Fixed filter header — outside FlatList entirely */}
  <FilterDatePickerRow ... />
  <FlatList
    data={filteredExpenses}
    // No ListHeaderComponent for filters
    ...
  />
</View>
```

---

## Sprint 5 — Code quality + production observability (ongoing)

---

### S5-1 · Add production crash logging to local SQLite (2h) **[ARCH FIX A5]**

> **[ARCH FIX A5]:** `logger.ts` is imported by virtually every file including `database.ts` itself. A direct import chain `logger → app-log → getDatabase` creates a circular init dependency: `initDatabase` calls `logger.warn`, `logger` imports `app-log`, `app-log` calls `getDatabase()` which throws because the DB isn't initialized yet. **Solution:** use a lazy setter — `logger.ts` exposes an `attachProductionLogHandler()` function called once from `_layout.tsx` AFTER `initDatabase()` completes. `app-log.ts` uses a lazy `import()` inside the async function body (not at module level) to avoid circular module evaluation.

**File:** Create `services/app-log.ts`:
```ts
export async function writeAppLog(level: 'error' | 'warn', message: string, context?: unknown): Promise<void> {
  try {
    // Lazy import — avoids circular dep with logger.ts which is imported by database.ts
    const { getDatabase } = await import("@/database");
    const db = getDatabase();
    await db.runAsync(
      `INSERT INTO app_logs (level, message, context, created_at)
       VALUES (?, ?, ?, datetime('now'));`,
      level, message, context ? JSON.stringify(context) : null
    );
    // Rolling window — keep last 200 rows only
    await db.runAsync(
      `DELETE FROM app_logs WHERE id NOT IN (SELECT id FROM app_logs ORDER BY created_at DESC LIMIT 200);`
    );
  } catch { /* never throw from logger — silent fail */ }
}
```

**File:** Create migration `045_app_logs.ts`:
```ts
import type { SQLiteDatabase } from "expo-sqlite";

export default {
  version: 45,
  name: "app_logs",
  up: async (db: SQLiteDatabase): Promise<void> => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS app_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        context TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  },
};
```

**File:** `utils/logger.ts` — add setter, keep existing `noop` for production by default:
```ts
type LogHandler = (level: 'error' | 'warn', message: string, context?: unknown) => void;
let productionHandler: LogHandler | null = null;

/** Call once after initDatabase() completes to enable production DB logging. */
export function attachProductionLogHandler(handler: LogHandler): void {
  productionHandler = handler;
}

export const logger = {
  error: __DEV__
    ? (msg: string, ctx?: unknown) => console.error(`[Artha] ${msg}`, ctx)
    : (msg: string, ctx?: unknown) => { productionHandler?.('error', msg, ctx); },

  warn: __DEV__
    ? (msg: string, ctx?: unknown) => console.warn(`[Artha] ${msg}`, ctx)
    : (msg: string, ctx?: unknown) => { productionHandler?.('warn', msg, ctx); },

  info: __DEV__
    ? (msg: string, ctx?: unknown) => console.info(`[Artha] ${msg}`, ctx)
    : noop,

  debug: __DEV__
    ? (msg: string, ctx?: unknown) => console.debug(`[Artha] ${msg}`, ctx)
    : noop,
};
```

**File:** `app/_layout.tsx` — after `initDatabase()` succeeds, wire up the handler:
```ts
import { attachProductionLogHandler } from "@/utils/logger";
import { writeAppLog } from "@/services/app-log";

// Inside the init useEffect, immediately after `await initDatabase()`:
if (!__DEV__) {
  attachProductionLogHandler((level, msg, ctx) => writeAppLog(level, msg, ctx).catch(() => {}));
}
```

Add a "View Logs" option in `app/settings/` that reads last 200 rows from `app_logs` and uses `expo-sharing` to export as a `.txt` file.

---

### S5-2 · Audit and prune dead exports from `services/index.ts` (30 min)
**File:** `services/index.ts`

Run: `npx ts-prune --project tsconfig.json | grep "services/index"`

For each symbol flagged as unused, remove from `index.ts`. Focus on symbols referencing removed notification-collector files.

---

### S5-3 · Progressive `any` → typed replacement in critical services (ongoing)
Priority order:
1. `services/loan-accounts.ts` — DB rows should use `LoanScheduleRow` interface
2. `services/balance-source.ts` — `BalanceSourceRow` type  
3. `services/financial-account.ts` — `AccountRow` type
4. `services/onboarding.ts` — migration shape types

Pattern for each:
```ts
// BEFORE:
const rows = await db.getAllAsync<any>(...);

// AFTER:
interface LoanScheduleRow { id: string; due_date: string; amount: number; /* etc */ }
const rows = await db.getAllAsync<LoanScheduleRow>(...);
```

---

### S5-4 · Extract raw SQL from notification-scheduler (1h)
**File:** `services/expense-queries.ts` — add:
- `getYesterdaySpendingSummary(userId, date)` ✓ (done in S2-5)
- `getOverdueEMIsForUser(userId, asOfDate)` → used by `checkAndNotifyLoanEMIs`
- `getMonthlySummary(userId, startDate, endDate)` → used by `sendMonthlySummaryNow`

Each function takes typed params and returns typed row arrays, then is imported into `notification-scheduler.ts` replacing the inline `getDatabase()` calls.

---

### S5-5 · Add feature flag comment standardisation (15 min)
**File:** `services/feature-flags.ts`

For each flag, ensure the comment documents both ON and OFF states:
```ts
// ON: shows advisor card linking to insights page
// OFF: hides advisor card from home (keeps users off Coming Soon dead-end)
v15_advisor_card: false,
```

---

### S5-6 · Verify/remove `users.settings` column from TABLE_SCHEMAS (10 min)
**Runtime check:** Add a one-time dev-only check in `database.ts`:
```ts
if (__DEV__) {
  const cols = await db.getAllAsync<{ name: string }>("PRAGMA table_info(users);");
  const hasSettings = cols.some(c => c.name === 'settings');
  if (!hasSettings) {
    logger.warn("TABLE_SCHEMAS lists users.settings but column does not exist in DB");
  }
}
```
Based on result: either remove `"settings"` from `TABLE_SCHEMAS.users` or add a comment pointing to the migration that creates it.

---

### S5-7 · Seed merchant mappings with version check (30 min)
**File:** `database/database.ts` — wrap `seedMerchantMappings()` call:
```ts
const merchantCount = await db.getFirstAsync<{ c: number }>("SELECT COUNT(*) as c FROM merchant_mappings;");
if (!merchantCount?.c) {
  await seedMerchantMappings();
}
```
Or gate behind `data_bundle_versions` table row like `seedPublicData` does.

---

## Dependency Map & Sprint Order Summary

```
Sprint 1  →  Sprint 2  →  Sprint 3  →  Sprint 4  →  Sprint 5
(Critical)   (Functional)  (Testing)    (UI/UX)      (Quality)

S1-3 (fix migration 042)         must precede  S3-2 (test for it)
S1-2 (add settings to backup)    must precede  S3-3 (backup test)
S2-1 (monthly dedup MMKV)        must precede  S3-4 (test for it)
S2-2 (_layout.tsx change)        must precede  S2-2 (lock.tsx returnTo — same item, 2 files)
S5-1 (migration 045 + app-log)   must precede  S5-1 (logger attachHandler in _layout.tsx)
```

## Architectural Fixes Applied — Quick Reference

| Fix | Item | What Changed |
|-----|------|-------------|
| A1 | S2-3 | Static import for `settingsStorage`, not dynamic |
| A2 | S2-7 | Confirmed safe (WAL already on) — `Promise.all` approved |
| A3 | S2-8 | Cache count only in MMKV, not full `DuplicatePair[]` array |
| A4 | S1-8/S1-9 | `BackHandler.exitApp()` replaces `expo-updates` (not installed) |
| A5 | S5-1 | Lazy DB import in `app-log.ts` + `attachProductionLogHandler` setter pattern |
| A6 | S2-4 | Migration 044 wrapped in `withTransactionAsync` + `PRAGMA foreign_keys = OFF` |
| A7 | S2-10 | JSON import confirmed safe (`expo/tsconfig.base` enables `resolveJsonModule`) |
| B2/B4 | S2-2 | `returnTo` param passed to lock screen; lock screen uses it post-unlock |
| B4 | S4-3 | Empty state gated on `getOnboardingCompletedVersion()`, not data counts |

## Total Effort Estimate

| Sprint | Total Time |
|--------|-----------|
| Sprint 1 | ~3h |
| Sprint 2 | ~4.5h |
| Sprint 3 | ~3h |
| Sprint 4 | ~2h |
| Sprint 5 | ~4h (ongoing) |
| **Total** | **~16.5h** |
