# Hisaab (Family Ledger)

[← back to Feature Map](../FEATURE_MAP.md)

## In plain English

A running tab with each person — usually for shared expenses ("I paid for dinner, you owe me your half") or informal lending. For each person:

```
Running balance = starting balance + everything you paid for them − everything they paid you back − settlements
```

**Positive balance = they owe you. Negative = you owe them.**

When you split an expense with someone (e.g. you paid ₹1000 for a dinner, ₹400 of it was really their share), three things get created together: the expense itself, a "split" record bridging the expense to that person, and the actual hisaab ledger entry. All three travel together — if you ever see a hisaab entry that *looks* linked to an expense but the link is broken, that's the bridge record (see Technical).

## Technical

**Files:**
- `services/hisaab.ts` — person CRUD, entries, settlements, balance calculation.
- `services/expense-splits.ts` (single-person split) / `services/expense-multi-split.ts` (multi-person, per-leg amounts) — create/edit/remove the split + its linked hisaab entry together.
- `services/hisaab-export-pdf.ts` / `hisaab-export-excel.ts` — export.
- `services/hisaab-import.ts` — bulk import.

**Tables:** `hisaab_persons`, `hisaab_entries` (has `linked_expense_id`), `expense_splits` (the bridge: maps one expense → one-or-more persons + each one's share + the resulting `hisaab_entry_id`).

**The recovery path that matters:** after a backup restore, `hisaab_entries.linked_expense_id` can come back empty even though the entry and the expense both restored fine — because the link itself can be reconstructed two ways, and the second is the one that actually matters going forward:
1. From legacy `linked_account_credit_id` (only relevant for very old backups, pre-migration-005).
2. From `expense_splits.expense_id`, when `linked_expense_id` is null but the bridge row exists. **This is the canonical recovery path** — `expense_splits` is more durable across restores than `hisaab_entries.linked_expense_id` directly, so it's always checked second and used to repair the first.

If a split-linked hisaab entry looks disconnected from its expense after a restore, the fix lives in `services/backup.ts`'s post-restore repair SQL, not in `hisaab.ts`.
