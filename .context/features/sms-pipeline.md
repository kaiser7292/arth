# SMS Auto-Detection Pipeline

[← back to Feature Map](../FEATURE_MAP.md)

## In plain English

When you run an SMS scan (manually, or automatically in the background), the app reads your bank/wallet SMS, tries to recognize each one as a transaction, and — if it does — creates a pending expense or credit that waits in the **Review Queue** for your approval. Nothing reaches your reports without you approving it first.

Recognition happens in two layers: first it tries ~25 hardcoded patterns for major Indian banks/PSU banks/EPFO, and only if none of those match does it fall back to checking any custom "Smart SMS Template" you've personally taught it. You can teach the app a new format from **Settings → Smart SMS Templates** by tagging which part of a sample SMS is the amount, merchant, etc.

Every SMS the scanner looks at — recognized, filtered out, unrecognized, or skipped — gets logged. You can review the full history (including the raw SMS text) at **Settings → SMS Scan Runs**, and search inside it. This is the place to look when you suspect an SMS *should* have been caught but wasn't.

## Common symptoms and what they mean

| Symptom | What's actually happening |
|---|---|
| "An SMS-detected credit shows in the Transactions tab but not in any account's ledger" | The SMS was recognized fine, but the app couldn't confidently match it to one of your accounts, so it's sitting with no account assigned. The ledger only shows transactions tied to a specific account. |
| "Teach Arth this SMS" template isn't matching new messages from the same sender | Check the sender match mode (exact/contains/code) and pattern — bank SMS senders sometimes use multiple address variants. |
| "SMS Scan Runs shows no history at all" | The scan likely errored before it could even write a log entry — see Technical below. |
| A pension/EPFO SMS isn't linking to the right account | Pension matching is deliberately loose (last-4-digits OR substring match on the merchant string) because UAN numbers don't fit a clean "last 4 digits" pattern like cards do. |

## Technical

**Pipeline, in order:**
1. `services/sms/sms-reader.ts` — reads raw SMS from the Android inbox in pages of 500. Pagination is driven by the *raw* message count per page, not the filtered count — a page with zero bank SMS in it can still have more pages after it.
2. `services/sms/sms-parser.ts` — tries hardcoded parsers (`services/sms/bank-patterns.ts`) first, then the user-template matcher (`services/public-data/sms-template-matcher.ts`) as fallback. Returns parsed fields plus `unrecognizedSms[]` and `skippedSms[]` for logging.
3. `services/sms/sms-orchestrator.ts` — `runSmsScan({ manual, accountIds })` is the single entry point. Phases: read → parse → account-filter (intentionally happens *after* parsing, so user templates get a chance to match before any account filter is applied) → process into expenses/credits → log the run via `services/sms/sms-scan-logging.ts`.
4. `services/sms/sms-to-expense.ts` — creates the pending rows, calls `linkExpenseToAccount` (loose match: last-4-digits only, ignores bank name/account type), applies Smart Rules.
5. `services/expense-crud.ts` → `approveExpense` — if a credit still has no `account_id` at approval time, retries account discovery with a *stricter* bank+type match (`discoverOrUpdateAccount`), falling back to the same loose match. This is the safety net for accounts created *after* the SMS originally arrived.

**Templates:** `services/sms/user-sms-templates.ts` (CRUD/diagnose/test), `services/sms/template-compiler.ts` (compiles tagged spans → regex), `services/sms/sms-normalize.ts` (9-step normalization, applied identically at compile time and match time — if these two ever drift apart, templates silently stop matching).

**Tables:** `sms_scan_runs` + `sms_scan_details` (one run, N per-SMS detail rows — `sms_body_preview` keeps up to 500 chars of raw text).

**Don't:** forget that *every* exit path in `sms-orchestrator.ts` (read error, no SMS found, exception in the catch block) must still call `saveScanRun` — otherwise the Scan Runs UI shows "no history" even though a scan did run.
