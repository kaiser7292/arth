# Artha v15.2.0 — Product Requirements (supplement to PRD_V15)

**Version target:** 15.2.0
**Release date:** 2026-04-29
**Theme:** Biometric app lock + Smart rules for auto-categorization.

---

## Why this release

Two user-requested quality-of-life features that both improve the day-to-day friction of Artha without changing its 100%-local architecture:

1. **Biometric app lock** — Artha holds sensitive financial data. Until now, anyone with the unlocked phone could open it. Many users asked for an app-level gate.
2. **Smart rules** — categorizing every SMS-detected expense by hand is repetitive. Pattern-based rules ("every Swiggy debit → Food, right-spend=true") save that effort and let SMS-based auto-approval be opt-in per-rule.

Multi-currency was also requested but is explicitly deferred — it's a cross-cutting data-model change that needs its own major release (v16.0.0). Bundling it here would put biometric lock + smart rules at risk.

---

## Feature 1: Biometric app lock

### Goal
Optional lock screen that requires Face ID / fingerprint / device passcode before showing any data.

### Functional spec
| Area | Behavior |
|---|---|
| Enablement | Settings → Security → App Lock toggle. Biometric prompt must succeed before turning on. |
| Disablement | Biometric prompt required before turning off — prevents a casual attacker from toggling it off from an unlocked session. |
| Timeout options | Immediately / 1 min / 5 min / 15 min / Never. "Never" still locks on cold start. |
| Lock triggers | Cold start (always), AppState becomes `active` after timeout elapsed, "Lock Now" button. |
| Unlock flow | Auto-prompt on lock-screen mount. Fallback to device passcode via native `authenticateAsync`. Retry allowed. |
| Edge cases | No biometric hardware → toggle disabled, clear message. No biometric enrolled → toggle disabled, clear message. 3 consecutive fails → suggest device passcode fallback. |
| Storage | All state in MMKV (device-local). Never part of backup file (security + portability). |
| Deep links | Notification deep-links still require unlock. No bypass. |

### Acceptance
- [x] Toggling on prompts biometric and verifies before flipping the flag
- [x] Cold start with lock enabled shows lock screen before any tab
- [x] Background > timeout → re-lock on return
- [x] Disabling the lock also requires biometric
- [x] Lock prefs NOT included in backup file (verified via BACKUP_TABLES omission)
- [x] 22 unit tests pass with mocked expo-local-authentication

---

## Feature 2: Smart rules

### Goal
User-defined rules that auto-apply a category, payment mode, tag, or right-spend flag to incoming expenses based on matchers on merchant, amount, account, payment mode, or raw SMS body.

### Data model
```
smart_rules (migration 017)
  id, user_id, name, priority, is_active

  match_merchant_contains      — case-insensitive substring
  match_merchant_regex         — raw JS regex, compiled with `i` flag
  match_min_amount             — inclusive lower bound
  match_max_amount             — inclusive upper bound
  match_account_id             — exact financial_account id
  match_payment_mode           — enum slug
  match_sms_keyword            — case-insensitive substring on raw SMS body

  action_category_id           — set expense.category_id
  action_payment_mode          — set expense.payment_mode
  action_tag_ids               — JSON array of tag_id strings
  action_is_right_spend        — override flag
  action_mark_auto             — if 1, bypass review queue for SMS-detected

  apply_count, last_applied_at — stats (updated by apply path)

  created_at, updated_at

expenses
  + applied_rule_id (plain column, nullable)
```

### Functional spec
| Area | Behavior |
|---|---|
| Condition semantics | AND (all configured conditions must match). At least one condition required at CRUD. |
| Action semantics | Actions apply to expenses BUT never stomp user-set fields. If the user explicitly set category, rule skips category. |
| Evaluation order | `is_active=1` rules ordered by `priority ASC, created_at ASC`. First match wins. No re-evaluation on edit. |
| Invalid regex | CRUD validation blocks save. Running evaluator with bad stored regex returns no-match gracefully. |
| Auto-approve | Default OFF per rule. When ON for SMS-detected: `status='approved'` instead of `pending_review`. |
| Retroactive apply | Rule detail → "Apply to past expenses" → preview (90-day window, show matching/wouldOverwrite/wouldSkip) → confirm → run. Idempotent; skips already-categorized unless user opts in to overwrite. |
| Deletion | Clears `expenses.applied_rule_id` stamps; doesn't un-apply past categorizations. |
| Badge | Expense detail shows "Categorized by rule: <name>" with tap-to-open. Tap navigates to rule detail. |

### Acceptance
- [x] Create / edit / delete rules via Settings → Smart Rules
- [x] Manual `createExpense` applies first-matching rule to blank fields
- [x] SMS realize path applies rule + optionally auto-approves
- [x] Retroactive apply previews accurately, applies idempotently
- [x] `applied_rule_id` stored and displayed as badge
- [x] Deletion clears stamps on historical expenses (but categorization stays)
- [x] Smart rules included in `BACKUP_TABLES` → survives backup/restore
- [x] 22 evaluator unit tests pass

---

## Non-goals for v15.2.0

- OR semantics for rule conditions (AND only in v1)
- Rule templates / presets (user authors from scratch in v1)
- Multiple actions per rule beyond the fixed set above
- Category creation from within the rule detail screen
- Rule simulation / dry-run replay across months
- Multi-currency support → v16.0.0

---

## Risk mitigation

| Risk | Mitigation |
|---|---|
| User loses phone + has biometric only → locked out | Fallback to device passcode is always enabled (`disableDeviceFallback: false` unless explicitly opted out) |
| Broken rule silently mis-categorizes many expenses | Preview shown before retroactive apply; `action_mark_auto` defaults to OFF |
| Rule with malformed regex | CRUD rejects at save; evaluator silently no-matches (never throws) |
| Backup/restore on new device | Rules survive; lock prefs don't (by design — user must re-enable lock on new device) |

---

## Flags

| Flag | Default | Effect |
|---|---|---|
| `v15_biometric_lock` | ON | Master switch for the lock gate in `_layout.tsx`. Flip off to disable without removing code. |
| `v15_smart_rules` | ON | Master switch for `applyRules()` + `getActiveRules()`. Flip off to disable auto-apply without breaking CRUD. |
