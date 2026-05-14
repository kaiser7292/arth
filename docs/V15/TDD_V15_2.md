# Artha v15.2.0 — Technical Design (supplement to TDD_V15)

**Target version:** 15.2.0
**Scope:** Biometric app lock + Smart rules.

---

## Biometric lock — architecture

### New files

| File | Purpose |
|---|---|
| `services/biometric-lock.ts` | MMKV-backed settings + `shouldShowLock()` decision tree + `promptUnlock()` wrapper over `expo-local-authentication` |
| `app/(lock)/_layout.tsx` | Stack layout for lock group (gestureEnabled: false) |
| `app/(lock)/lock.tsx` | Lock screen: auto-prompts biometric on mount, replaces to `/(tabs)` on success |
| `app/settings/security.tsx` | Settings screen: toggle, timeout picker, Lock Now button |

### Modified files

| File | Change |
|---|---|
| `app/_layout.tsx` | `useEffect` after dbReady+splashDone: `evaluateLock()` on cold start + every AppState `active` transition → `router.replace('/(lock)/lock')` if `shouldShowLock()` returns true. Added `<Stack.Screen name="(lock)" />` |
| `app/(tabs)/settings.tsx` | New "Security & Privacy" card with App Lock row |
| `app/settings/_layout.tsx` | Registered `security` screen |
| `services/feature-flags.ts` | Added `v15_biometric_lock: true` |
| `package.json` | Added `expo-local-authentication` |

### Decision tree for `shouldShowLock()`
```
if (!isLockEnabled())                      → false
if (getLastUnlockAt() === null)            → true   (cold start with lock on)
if (getLockTimeout() === "never")          → false  (stays unlocked until cold start)
if (now - lastUnlock >= timeoutMs)         → true
else                                       → false
```

### State boundaries
- All state is MMKV. No SQLite touch.
- Lock screen CANNOT read financial data — it uses no DB services, only `biometric-lock.ts` + theme.
- Unlock failure never modifies MMKV — last_unlock_at only advances on success.

### Why AppState and not a timer?
A timer would keep JS alive in background and drain battery. AppState fires exactly when we care: return-from-background. Cold start is caught by the initial `evaluateLock()` call after dbReady.

### Why no rate limiting beyond "try again"?
The biometric subsystem itself imposes native rate limits (Android: too many fails → biometric disabled for 30s by OS; iOS: similar). Our 3-fail warning surfaces the device passcode fallback hint; we don't add app-level rate limiting on top.

---

## Smart rules — architecture

### New files

| File | Purpose |
|---|---|
| `database/migrations/017_smart_rules.ts` | Creates `smart_rules` table + adds `expenses.applied_rule_id` column (idempotent ALTER TABLE guard via PRAGMA table_info) |
| `services/smart-rules.ts` | Types, pure `evaluateRule`/`findFirstMatch`/`materialize` evaluator, CRUD (create/update/delete/list/get), `applyRules` high-level apply, `previewRetroactiveApply` + `runRetroactiveApply` |
| `app/settings/smart-rules/index.tsx` | List screen with summary rows + FAB + delete |
| `app/settings/smart-rules/[id].tsx` | Create/edit form: conditions card + actions card + retroactive-apply card (edit mode only) |

### Modified files

| File | Change |
|---|---|
| `database/migrations/index.ts` | Registered migration 017 |
| `database/TABLE_SCHEMAS.ts` | Added `smart_rules` columns + `applied_rule_id` to `expenses` |
| `services/expense-crud.ts` | `createExpense`: applies rules before INSERT; rule actions never stomp user-set fields; stamps `applied_rule_id`; bumps rule's `apply_count` fire-and-forget |
| `services/sms/sms-to-expense.ts` | Realize path: applies rules; `status='approved'` when `action_mark_auto=1`; stamps `applied_rule_id`. (Credit/refund/forecast paths intentionally NOT rule-gated in v15.2 — scope control) |
| `services/expense-types.ts` | `Expense.applied_rule_id: string \| null` |
| `app/expense/[id].tsx` | "Categorized by rule" badge fetched async via `getRule`; tap → rule detail |
| `services/backup.ts` | Added `smart_rules` to `BACKUP_TABLES` |
| `services/feature-flags.ts` | Added `v15_smart_rules: true` |
| `app/(tabs)/settings.tsx` | New "Smart Rules" row under Data & Import |
| `app/settings/_layout.tsx` | Registered `smart-rules/index` + `smart-rules/[id]` |

### Evaluator is pure + unit-testable

`evaluateRule(rule, target)`, `findFirstMatch(rules, target)`, `materialize(rule)` are all pure functions — no DB, no network, no side effects. This is why the evaluator test file (`__tests__/unit/smart-rules-evaluator.test.ts`) covers 22 cases with no mocking besides the struct factory.

### Why `applied_rule_id` is a plain column, not a FK

Same pattern as `recurring_rule_id` (v14.6) and `fulfills_rule_id` (v14.7). A real FK would create a circular reference risk with future rule-referencing expense queries and complicate ON DELETE semantics. Instead:
- Rule delete clears every stamp via a manual `UPDATE` in `deleteRule`.
- Expense delete naturally removes the stamp (column on the row).

### Precedence rules in `createExpense`

```
user-set field (e.g. category_id passed in input)
    ↓ rule never overrides it
null/blank field
    ↓ rule fills if matched
still null
    ↓ unchanged
```

`userSetCategory = input.category_id !== undefined && input.category_id !== null` — both conditions needed because the manual add-expense form sometimes passes `null` explicitly when the user clears it.

### Auto-approve semantics

When a rule has `action_mark_auto=1` AND the SMS realize path triggers it, the resulting expense row is written with `status='approved'` directly (bypasses the review queue). Without a matching rule, SMS-detected expenses stay `pending_review` as before. This is the ONLY behavioral change in the SMS flow.

### Retroactive apply safety

- Runs in a single `withTransactionAsync` — atomic.
- Skips expenses where `category_id IS NOT NULL` unless `overwriteExisting=true`.
- Preview function returns exact counts (`matching`, `wouldOverwrite`, `wouldSkip`) — user sees the blast radius before confirming.
- Only `category_id` and `payment_mode_id` are applied retroactively — tags and is_right_spend NOT touched. (Safer; tags are additive elsewhere and flipping right-spend retroactively feels surprising.)

---

## Testing summary

| Suite | Tests |
|---|---|
| `biometric-lock.test.ts` | 22 (settings, shouldShowLock decision tree, capability detection, promptUnlock flows with mocked native) |
| `smart-rules-evaluator.test.ts` | 22 (merchant contains, regex, amount bounds, account, payment mode, SMS keyword, AND, priority, materialize) |
| Existing `expense.test.ts` | Updated for new `applied_rule_id` trailing null param |
| Existing `database.test.ts` | Updated for migration 017 counts (execAsync 18→20, schema_migrations inserts 16→17) |
| Full suite | **1151 pass / 0 fail** |

### TypeScript
- Zero new non-test errors from v15.2 code
- Pre-existing `services/backup.ts` AES type noise unchanged (unrelated)

---

## Performance impact

| Path | Added cost |
|---|---|
| `createExpense` | 1 × `SELECT * FROM smart_rules WHERE is_active=1 ORDER BY ...` (usually ≤20 rows). Regex compile per rule. Negligible. |
| SMS realize | Same as above. Fallback gracefully on throw — never blocks SMS import. |
| Retroactive apply | Proportional to expense count in 90-day window, single transaction. User-initiated, not hot-path. |
| Backup | +1 table serialized |

No hot-path regressions observed.

---

## Rollback

Flag-based:
- `v15_biometric_lock: false` → `_layout` skips the lock gate; screen + service remain but unreachable.
- `v15_smart_rules: false` → `applyRules` / `getActiveRules` return empty; CRUD remains but rules are inert.

Data-level rollback would require a migration (smart_rules drop + applied_rule_id drop), deferred until/unless needed.

---

## Open work (not in v15.2.0)

- Tag multi-select UI in rule detail (list of existing tags, multi-select)
- Inline category picker bottom-sheet (currently cycles through list)
- Rule duplication action
- "Test rule against last 10 expenses" live preview in the detail screen
- Multi-currency support → v16.0.0
