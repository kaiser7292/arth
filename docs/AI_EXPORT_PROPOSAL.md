# Export for AI — Product Proposal

**Version:** 1.1 | **Date:** October 2026 | **Status:** Built in v4.12.0

> **As built:** the feature is named **Export for AI Insights** and lives at Home → Insights → Explore (not Settings). The file layout follows section 5a below. The monthly summary carries spending, income, refunds, investments and loan payments per month; the savings rate is given per financial year, as Arth shows it. Demat snapshot history is not exported (net worth carries the current value).

---

## 1. Problem Statement

Users want to ask an AI assistant (Claude, ChatGPT, Gemini) questions about their own money: "where did my spending go up this year", "can I afford a bigger EMI", "which subscriptions should I cut".

The only file they can hand over today is the plain-JSON auto-backup (Settings → Backup & Restore → share icon). It works badly for this:

- **It is a raw dump of every table.** The numbers Arth shows on screen (closing balances, savings rate, loan outstanding, net worth) are calculated by the app and are not in the file. The AI has to re-derive them and gets them wrong.
- **It contains far more than the AI needs.** Raw SMS text, SMS scan logs, the vault's titles, usernames and notes, every setting, soft-deleted rows, pending and rejected items.
- **It is large.** Reference data and SMS logs make up much of the file and crowd out the conversation.

The on-device AI assistant was removed in 4.11.0, so there is no in-app alternative.

---

## 2. Goals & Non-Goals

**Goals:**
- One button that produces a small, clean file built for an AI to read
- Figures in the file match what Arth shows on screen, because Arth calculates them
- Nothing sensitive beyond the money data itself: no vault, no SMS text, no credentials
- The user sees exactly what is in the file, and what is left out, before it leaves the phone
- The user picks the period and which sections to include

**Non-Goals (v1):**
- Write-back from the AI into Arth (see section 9)
- A live connector (MCP) between Arth and Claude
- Calling any AI service from inside Arth. Arth only writes a file; the user decides where it goes
- Restoring from this file. It is not a backup and Arth will not accept it in Restore

---

## 3. What the user sees

A new row in Settings, **Export for AI**, opens one screen with three parts:

1. **Period** — This financial year (default), Last 12 months, All time, or a custom range.
2. **Include** — a switch per section, all on by default except the two marked off below.
3. **Never included** — a fixed list, shown so the user can trust the file.

Below that, a summary line ("1,284 transactions · 9 accounts · about 310 KB") and two buttons: **Save to phone** and **Share**. Both use the same helpers the backup screen already uses.

A short note above the buttons says, in plain words, that once the file is shared with an AI service it is sent to that company's servers, and Arth has no control over it after that.

---

## 4. What goes in the file

| Section | Contents | Default |
|---------|----------|---------|
| Monthly summary | Per month: income, spending, savings, savings rate | On |
| Transactions | Date, amount, direction (spend / income / refund), category, merchant, account, payment mode, tags | On |
| Accounts and balances | Account name, type, last 4 digits, opening and closing balance for each month | On |
| Budgets | Budget per category per month, with actual spend | On |
| Loans | Lender, principal, rate, EMI, outstanding, end date, prepayments | On |
| Investments and goals | Investment buckets, contributions, life milestones, demat snapshots | On |
| Net worth | Balance sheet totals at the end of the period | On |
| Transaction notes | The free-text note on each transaction | **Off** |
| Hisaab (family ledger) | Per-person balances and entries | **Off** |

Notes and hisaab are off by default because notes are free text (anything could be in them) and hisaab names other people.

Two privacy switches apply across all sections:

- **Hide people's names** — hisaab persons become "Person 1", "Person 2". On by default.
- **Hide merchant names** — merchants become their category only. Off by default, since merchant-level analysis is most of the value.

### Never included

- Password vault (the whole table, including titles and usernames)
- Raw SMS text and SMS scan logs
- Broker and integration credentials
- Full account numbers (last 4 digits only)
- Deleted, pending-review and rejected transactions
- App settings, smart rules, SMS templates, bundled reference data
- Salary profile breakdown (the summary already has income totals)

---

## 5. File format

One `.json` file, named `arth-ai-export_2026-10-10.json`.

The first field is a plain-English guide written for the AI: what each section means, that amounts are in rupees, that the financial year runs April to March, how credit card balances differ from savings balances, and that transfers between the user's own accounts are not spending. This is what stops the AI from misreading the data.

```json
{
  "guide": "This is a personal finance export from the Arth app. Amounts are in INR...",
  "generated_at": "2026-10-10",
  "period": { "from": "2026-04-01", "to": "2026-10-10" },
  "monthly_summary": [
    { "month": "2026-04", "income": 185000, "spending": 92400, "savings": 92600, "savings_rate_pct": 50.1 }
  ],
  "accounts": [
    { "id": "a1", "name": "HDFC Savings", "type": "savings", "last4": "4521",
      "balances": [{ "month": "2026-04", "opening": 212000, "closing": 248300 }] }
  ],
  "transactions": [
    { "date": "2026-04-03", "amount": 1249, "kind": "spend", "category": "Groceries",
      "merchant": "BigBasket", "account": "a1", "mode": "UPI", "tags": [] }
  ],
  "budgets": [],
  "loans": [],
  "investments": {},
  "net_worth": {}
}
```

Transactions refer to accounts by a short id (`a1`), not the database id, so the file stays small and no internal ids leave the phone.

### 5a. Why JSON, and how it is laid out

Checked against published comparisons and the assistants' own guidance (October 2026):

- **No format wins everywhere, and the gaps are small.** Independent tests put JSON, YAML and XML within a few points of each other; results flip between models. CSV reads worst when an assistant reads it directly, and it cannot hold nested sections such as an account with its monthly balances.
- **Markdown key-value** scored highest in one test but repeats every field name on its own line for every row, which would multiply the file size for a year of transactions.
- **TOON** claims about 40% fewer tokens at similar accuracy, but the figures come from its own authors and it is not a format assistants can load with code.
- **JSON is the one format every assistant both accepts as an upload and can load with code.** For more than a few hundred rows, assistants answer by running code over the file, not by reading it, so this matters more than reading accuracy.

So the file is standard JSON, with these choices taken from the guidance:

1. **A plain-English guide first**, one sentence per line, so the assistant reads what the fields mean before the data.
2. **Ready-made totals before raw rows.** Summary, net worth, budgets and loans come first; the long transaction list is last, so the figures survive if an assistant reads only part of the file.
3. **One record per line, same fields in every row** (null when not applicable). This is the "clear column names, one record per row" shape the assistants ask for.
4. **Full-word field names** (`category`, `merchant`, `full_amount`), no abbreviations or codes.

Sources: [ImprovingAgents table-format test, via Gigazine](https://gigazine.net/gsc_news/en/20251007-ai-table-format) · [TOON benchmarks](https://toonformat.dev/guide/benchmarks) · [critical review of TOON benchmarks](https://dev.to/ikaganacar/toon-benchmarks-a-critical-analysis-of-different-results-5h66) · [LLMs on small tabular datasets (arXiv)](https://arxiv.org/pdf/2508.17391) · [Anthropic long-context tips](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/long-context-tips) · [OpenAI data analysis help](https://help.openai.com/en/articles/8437071-data-analysis-with-chatgpt) · [Claude file uploads](https://support.claude.com/en/articles/8241126-uploading-files-to-claude-ai)

---

## 6. How it is built

| Piece | Location | Notes |
|-------|----------|-------|
| Export service | `services/ai-export.ts` (new) | Builds the object section by section from an options object |
| Screen | `app/settings/export-for-ai.tsx` (new) | `<ScreenContainer padTop={false}>`, `<Card>` sections |
| Settings row | `app/(tabs)/settings.tsx` | One new row near Backup & Restore |
| Help article | `assets/docs/` | What the file contains and the privacy note |

The service reuses existing calculations, never its own SQL for totals:

- Balances: `getMonthBalanceSummary` for seeded accounts, `computeUnseededBalance` otherwise (same branch the account ledger uses)
- Net worth: `getBalanceSheetColumn`
- Loans: outstanding from `services/loan-accounts.ts`
- Transactions: approved rows only, `deleted_at IS NULL`, with category, account and payment-mode names joined in

**The file is built from an allow-list.** Each section names the exact fields it writes. A column added to the database later does not appear in the export until someone adds it on purpose. This is the opposite of the backup, which copies every column.

The file is written to the cache folder and deleted once the user leaves the screen, the same way manual backups are cleaned up.

### Database changes

None. No new tables or columns, so no migration, `TABLE_SCHEMAS` or `BACKUP_TABLES` change.

The screen does not remember the last-used options in v1, so there is no new settings key to register either.

---

## 7. Testing

- **Leak guard:** build the real schema, fill the vault, SMS and credential tables with marker strings, run the export with every section on, and fail if any marker appears anywhere in the output.
- **Allow-list guard:** fail if the output contains a key that is not in the documented field list.
- **Figures match:** for a seeded account, an unseeded account and a credit card, closing balances in the export equal `getMonthBalanceSummary` / `computeUnseededBalance`.
- **Filters:** deleted, pending and rejected rows are absent; transfers between own accounts are not counted as spending.
- **Switches:** each section switch removes its section; "Hide people's names" leaves no hisaab name in the file.
- **On the Pixel:** release build, export a full year, upload to Claude and check three questions against the app's own screens.

---

## 8. Risks

| Risk | Handling |
|------|----------|
| User does not realise the data leaves the phone once shared | Plain-words note above the buttons; help article; "Never included" list always visible |
| File too large for an AI upload on long histories | Show the size before saving; default period is one financial year, not all time |
| Export figures drift from the app after a future change | Figures come from the same service functions the screens use, plus the "figures match" tests |
| A future column leaks by accident | Allow-list plus the leak-guard test |
| Merchant names reveal more than the user expects | "Hide merchant names" switch |

---

## 9. Later: write-back

Out of scope for v1, listed so v1 does not block it.

The AI produces a small "suggestions file" (re-categorise these transactions, add this missing expense, set this budget). Arth imports it and every item lands in the existing review queue for approve / edit / reject. Nothing the AI suggests enters the books without the user approving it. This needs the export to carry a stable reference per transaction, which v1 can add later without changing the file's shape.

A live MCP connector is a further step beyond that and only worth it if the file round-trip proves too clumsy in practice.

---

## 10. Open questions

1. Is "This financial year" the right default period, or "Last 12 months"?
2. Should hisaab stay off by default?
3. Should the salary breakdown (basic, HRA, deductions) be an optional section? It would help tax questions.
4. Where should the Settings row sit: next to Backup & Restore, or under its own "AI" heading?
