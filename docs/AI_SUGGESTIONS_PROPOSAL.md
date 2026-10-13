# AI Suggestions and AI Setup — Product Proposal

**Version:** 1.0 | **Date:** October 2026 | **Status:** Quick version built, not yet released

> **As built (quick version).** One release, no new database table. Differences from the sections below:
> - **One button.** "Share with AI" builds the file and opens the share sheet. The request is written inside the file and copied to the clipboard; there is no separate Copy prompt step.
> - **Merchant categories come first.** A `merchant_category` suggestion files a merchant's past and future entries. `recategorise` is for single exceptions and `add_rule` only for patterns a merchant category cannot express.
> - **Bank messages go as received**, behind a switch, with one-time codes skipped. No masking. The assistant quotes the text of each part; Arth finds the quotes in the message, builds the template with its own compiler and tests it on the unread messages.
> - **Tick and apply.** Suggestions live only while the review screen is open (no `ai_suggestions` table, no per-item editing). Paste again to see them again.
> - **Setup** reuses the same export with unreviewed entries included; there is no separate setup pack.
> - **v4.15.0:** the feature is named **AI Assisted Setup** and lives in Settings; Insights keeps Export for AI Insights for analysis only. "Set up everything" adds four suggestion types - `set_income`, `set_savings_target`, `add_investment_bucket`, `add_milestone` - which start unticked on the review screen. The file tells the assistant to ask the user a few questions in the chat first, and never to choose goals or targets itself.
> - **Not built:** sending the request as message text in the same share (needs a native sharing library and a phone to test on), and Arth appearing in the assistant's share menu.

Builds on Export for AI Insights (v4.12.0, `docs/AI_EXPORT_PROPOSAL.md`). No live connector (MCP) in this proposal.

---

## 1. Summary

Today the user can send their data to an AI assistant and read its answers. Nothing comes back into Arth.

This proposal closes the loop with files, in two parts:

- **Part A — AI Suggestions (existing users).** The assistant replies with a small suggestions file. Arth imports it and shows every item for approve / edit / reject. Example: "put these 40 Swiggy entries under Food", "set a ₹12,000 grocery budget", "make a rule for rent".
- **Part B — AI Setup (new users).** After the first SMS scan, Arth hands the assistant a "setup pack": the accounts it found, merchants it could not categorise, and bank messages it could not read, with the personal parts masked. The assistant replies with categories, rules, budgets and SMS templates, and the user approves them in one sitting.

Arth still never contacts an AI service. The user carries a file out and a reply back.

---

## 2. Goals & Non-Goals

**Goals:**
- The user never has to explain a format to the assistant. Arth's file does it.
- Nothing the assistant suggests changes the books or the settings without the user approving that item.
- A wrong or malicious reply cannot damage data: fixed menu of suggestion types, no deletes, everything validated.
- Setup that takes an evening by hand (templates, rules, categories, budgets) takes one review pass.
- Works with Claude, ChatGPT and Gemini; no account linking.

**Non-Goals:**
- Live connector (MCP) or any network call from Arth
- The assistant acting without review ("auto-apply")
- Deleting or editing amounts and dates of existing transactions
- Replacing the Excel/CSV import; it stays as it is

---

## 3. How the assistant gets its instructions

The user should not need to know there is a format. Three pieces make that work.

1. **Instructions travel in Arth's file.** The export already opens with a plain-English guide the assistant reads first. A new section is added: *"If the user asks you to prepare changes for Arth, reply with a file in exactly this format"*, followed by the allowed suggestion types, one example of each, and the rules in section 5.
2. **A ready-made prompt.** The screen has a **Copy prompt** button. It puts a request on the clipboard for the user to paste next to the upload. There are a few to pick from:
   - "Tidy my categories" — re-categorise what looks wrong, suggest rules so it stays fixed
   - "Suggest a budget" — budgets per category from the last few months
   - "Find what's missing" — recurring payments that stopped appearing
   - "Set up Arth for me" — the onboarding prompt (Part B)
3. **Two ways to bring the reply back.**
   - **File:** Claude and ChatGPT can return a downloadable `arth-suggestions.json`. The user opens it with Arth, or picks it in Arth.
   - **Paste:** the assistant prints the reply in a code block, the user taps copy, and Arth's **Paste from clipboard** button reads it. On a phone this is usually the easier path, so it gets equal weight.

Arth accepts the reply wrapped in a code block or with text around it, and pulls out the JSON itself.

---

## 4. The experience

### Part A — AI Suggestions (existing user)

| Step | Where | What the user does |
|------|-------|--------------------|
| 1 | Insights → Explore → Export for AI Insights | Picks period and sections as today |
| 2 | Same screen, new "Ask for suggestions" card | Picks a prompt, taps **Copy prompt**, then **Share** |
| 3 | The assistant's app | Uploads the file, pastes the prompt, gets a reply |
| 4 | Arth → Insights → Explore → **AI Suggestions** (also Settings → Import data) | Taps **Paste from clipboard** or **Choose file** |
| 5 | Import result | Sees "34 suggestions read, 2 could not be used" with the reasons |
| 6 | **Suggestions** list | Reviews by group. Approve all in a group, or open one to edit or reject |
| 7 | Done | Approved transaction items are in the books; approved settings are live |

Suggestions the user has not decided on stay in the list until they do. A badge on the Explore button shows the count.

### Part B — AI Setup (new user)

Today's onboarding: welcome → region → categories → income → SMS permission → first scan → accounts found → budget → protect → done.

AI Setup is **optional** and never blocks finishing onboarding, because the user has to leave the app and come back.

| Step | Where | What the user does |
|------|-------|--------------------|
| 1 | After "accounts found" | Sees **Set up faster with AI** with what it will do and a **Not now** link |
| 2 | Setup pack preview | Sees exactly what will be shared: accounts found, merchants without a category, and a sample of unread bank messages with the personal parts already replaced. Can switch the messages off |
| 3 | Same screen | **Copy prompt** and **Share** |
| 4 | The assistant's app | Uploads, pastes, gets a reply |
| 5 | Back in Arth | A **Finish setup with AI** card waits on Home (and at the end of onboarding). **Paste from clipboard** or **Choose file** |
| 6 | Suggestions list, in setup order | Categories → merchant categories → rules → SMS templates → budgets |
| 7 | After approving templates | Arth re-reads the unread messages with the new templates and sends what it finds to the normal review queue |

If the user taps **Not now**, the same thing is available later from Settings → Import data → Set up with AI.

---

## 5. The suggestions file

One JSON object. The assistant is told to produce nothing else in the file.

```json
{
  "arth_suggestions": 1,
  "based_on": "2026-10-10",
  "suggestions": [
    { "type": "recategorise", "ref": "t1a2b3c4", "date": "2026-09-14", "amount": 482, "category": "Food", "why": "Swiggy order" },
    { "type": "add_transaction", "date": "2026-09-05", "amount": 15000, "kind": "spend", "category": "Rent", "merchant": "Landlord", "account": "a1", "why": "Paid every month, missing in September" },
    { "type": "set_budget", "category": "Groceries", "amount": 12000, "why": "Average of the last 4 months is 11,300" },
    { "type": "add_category", "name": "Pets", "why": "9 vet and pet-shop entries are under Other" },
    { "type": "add_rule", "name": "Swiggy is Food", "when": [{ "field": "merchant", "is": "contains", "value": "swiggy" }], "then": { "category": "Food" }, "why": "41 entries" },
    { "type": "fix_merchant", "from": "AMZN MKTP IN", "to": "Amazon", "why": "Same merchant, 3 spellings" },
    { "type": "sms_template", "sms": "s3", "bank": "Kotak", "kind": "debit", "fields": { "N1": "amount", "N2": "account", "W1": "merchant", "N4": "balance" }, "why": "UPI debit alert" }
  ]
}
```

### Suggestion types

| Type | What it does when approved | Lands in |
|------|---------------------------|----------|
| `recategorise` | Changes the category of one existing transaction | Suggestions list |
| `add_transaction` | Creates a transaction as **pending** | The existing review queue |
| `set_budget` | Sets the monthly budget for a category, from this month to the end of the financial year | Suggestions list |
| `add_category` | Creates a category | Suggestions list |
| `add_rule` | Creates a Smart Rule | Suggestions list |
| `fix_merchant` | Adds a merchant alias so spellings merge | Suggestions list |
| `sms_template` | Creates a Smart SMS Template (Part B) | Suggestions list |

Every item carries a short `why` in plain words, shown to the user under the item.

### Rules the assistant is given, and Arth enforces

- **References must be real.** A `recategorise` item names the transaction by its `ref` **and repeats its date and amount**. Arth rejects the item if they do not match the row. This catches invented references.
- **Names, not ids.** Categories, accounts and payment modes are named as they appear in the export. An unknown category is only accepted if the same file has an `add_category` for it.
- **Rules use a safe subset.** Conditions on merchant, description, amount, account and payment mode with contains / equals / starts with / greater than / less than / between. **No regular expressions** from the assistant. Actions: set category, payment mode, tags, right-spend flag.
- **No deletes, no amount or date edits** to existing transactions. There is no suggestion type for them, so they cannot be expressed.
- **Limits.** At most 500 suggestions and 1 MB per file. Text fields are cut to the same lengths as manual entry.
- **Anything else is ignored**, and reported to the user as "could not be used" with the reason.

### What changes in the export file

- Each transaction gains a short `ref`. The file's shape is otherwise unchanged.
- The guide gains the "how to reply" section. It is only added when the user turns on **Ask for suggestions**, so a plain analysis export stays as small as it is now.

---

## 6. Reviewing suggestions

One new screen, **AI Suggestions**, with the same approve / edit / reject actions as the review queue.

- **Grouped by type**, each group with a count and **Approve all**.
- **Each row** shows what will change in plain words ("Swiggy · ₹482 · 14 Sep: Other → Food") and the assistant's `why`.
- **Rules show their reach before approval:** "Would apply to 41 past transactions" (the existing retroactive preview), with a switch to apply to past entries or new ones only.
- **Edit** opens the normal editor for that thing (category picker, rule editor, budget field, template screen), pre-filled.
- **Duplicates are folded:** a rule or alias that already exists is shown as "already set" and skipped.
- **Undo:** approving a group shows an Undo for a few seconds. After that, each thing is edited or removed in its usual place.

Transactions the assistant wants to add do not appear here. They go to the review queue with a small "AI suggested" label, because that screen already handles duplicates and account linking.

---

## 7. The setup pack (Part B)

A second kind of export, used only for setup. It contains:

| Section | Contents |
|---------|----------|
| Accounts found | Bank, type, last 4 digits, as in the normal export |
| Categories | The user's current category list |
| Merchants without a category | Merchant name, how many entries, total amount |
| Frequent merchants | Top merchants with their current category, so rules can be suggested |
| Monthly spending by category | For budget suggestions |
| Unread bank messages | Masked, one or two examples per format (see below) |

### Masking bank messages

Export for AI Insights promises SMS text never leaves the phone. Templates cannot be taught without showing the message's wording, so the setup pack shares the **shape** of a message and none of its values. This is opt-in, on by default inside AI Setup only, with a switch and a full preview.

How Arth masks, on the phone, before anything is shared:

1. **Group** unread messages by sender and wording, and keep one or two examples per group (at most 40 groups).
2. **Replace every number** with a placeholder: `N1`, `N2`, and so on. Amounts, account digits, balances, dates, reference numbers and phone numbers all go.
3. **Replace every word that varies** between messages of the same group with a placeholder: `W1`, `W2`. Names, merchants and UPI ids are the parts that vary. Web links and email addresses are always replaced.
4. **Keep the fixed wording**: "debited from A/c", "Avl Bal", "UPI Ref".
5. **Replace the sender** with the bank Arth recognises it as, when it does.

A real message such as

> Rs.482.00 debited from A/c XX4521 to SWIGGY on 14-09-26. Avl Bal Rs.38,214.10. UPI Ref 426718890123

is shared as

> Rs.`N1` debited from A/c XX`N2` to `W1` on `N3`. Avl Bal Rs.`N4`. UPI Ref `N5`

The assistant only says what each placeholder is: `N1` is the amount, `N2` the account, `W1` the merchant, `N4` the balance. It never writes a pattern. Arth turns that answer into a normal Smart SMS Template using the original message, which never left the phone.

A group with only one message has nothing to compare against, so every word outside a small built-in list of banking words is masked.

### Testing a template before the user sees it

For each suggested template, Arth:

1. Builds it with the existing template compiler. If it does not build, the item is reported as unusable.
2. Runs it against the unread messages on the phone (`testPatternAgainstUnrecognised`).
3. Shows the result on the suggestion: "Reads 23 of your unread messages", with three real examples and what was read from each (amount, merchant, account).

The user approves knowing what it will do. A template that reads nothing is not offered.

---

## 8. Safety

| Risk | Handling |
|------|----------|
| The assistant invents transactions or references | `ref` + date + amount must match; added transactions are only ever pending |
| A reply written to cause harm (a shared "prompt" from the internet) | Fixed menu, no deletes, no regular expressions, size limits, every item reviewed |
| A wrong SMS template reads wrong amounts | Tested on the phone against real messages, results shown before approval |
| A broad rule miscategorises everything | Reach shown before approval ("41 past transactions"); new-only by default |
| Masking misses a personal detail | Full preview of the exact text before sharing; switch to leave messages out |
| User approves 200 items without looking | Groups show a sample and a count; rules and templates cannot be bulk-approved without opening the group |
| Reply is cut off or malformed | Arth reads what is valid, reports the rest, and never half-applies an item |

---

## 9. How it is built

| Piece | Location | Notes |
|-------|----------|-------|
| Reply instructions and `ref` | `services/ai-export.ts` | Add `ref` to transactions; add the reply section to the guide |
| Setup pack | `services/ai-setup-pack.ts` (new) | Built from the allow-list like the export |
| SMS masking | `services/sms/sms-mask.ts` (new) | Pure functions, heavily tested; reuses `sms-normalize.ts` |
| Reading a reply | `services/ai-suggestions-import.ts` (new) | Finds the JSON, validates each item, returns accepted and rejected with reasons |
| Applying an item | `services/ai-suggestions-apply.ts` (new) | One function per type, each calling the existing service (`createRule`, `learnMerchantAlias`, `upsertBudget`, `createUserTemplate`, expense create as pending) |
| Suggestions screen | `app/insights/ai-suggestions.tsx` (new) | Grouped list, approve / edit / reject |
| Setup step | `app/(onboarding)/ai-setup.tsx` (new) | After `accounts-preview`; skippable |
| Home card | `components/home/` | "Finish setup with AI" while suggestions wait |
| Import data screen | `app/settings/import-excel.tsx` | Becomes "Import data" with two doors: Excel/CSV, and AI suggestions |

### Database changes

One new table, `ai_suggestions`, so undecided suggestions survive closing the app.

Columns: `id`, `batch_id`, `type`, `payload` (the validated item as JSON), `status` (pending / approved / rejected), `created_at`, `decided_at`.

The full checklist applies: numbered migration with idempotency guard, registered in `migrations/index.ts`, columns in `TABLE_SCHEMAS.ts`, table in `BACKUP_TABLES`, cleanup path in `data-cleanup.ts`, test mocks. The backup coverage test will fail until all are done.

One new setting key (setup offered / dismissed) goes in `SETTINGS_REGISTRY`.

A new column on `expenses` is **not** needed: the "AI suggested" label on pending transactions can use the existing `source` value with a new value `ai_suggested`. That needs a check of every place `source` is compared.

---

## 10. Testing

- **Masking:** no digit and no word outside the kept wording survives, across a library of real message formats (with invented values). Placeholders map back to the right positions in the original.
- **Import:** each rule in section 5 has a failing case. Invented `ref`, mismatched amount, unknown category, a regular expression in a rule, a delete-shaped item, an oversized file, a reply wrapped in prose and code fences, a cut-off reply.
- **Apply:** each type creates exactly what the manual screen would. Approve then undo leaves no trace.
- **Templates:** a correct labelling compiles and reads the sample; a wrong labelling is caught by the on-phone test and not offered.
- **Round trip:** export → hand-written reply → import → approve, against the real schema.
- **With real assistants:** run each prompt through Claude, ChatGPT and Gemini with the demo data and record how often the reply imports cleanly. The guide wording is tuned until it does reliably.
- **On the Pixel:** release build, full onboarding with AI Setup, before any release.

---

## 11. Order of work

| Phase | Contents | Release |
|-------|----------|---------|
| A1 | `ref` in the export, reply instructions, Copy prompt | 4.13.0 |
| A2 | Import, validation, Suggestions screen, apply for recategorise / budget / category / rule / merchant; added transactions to the review queue | 4.13.0 |
| B1 | Setup pack without messages; onboarding step and Home card | 4.14.0 |
| B2 | Message masking, template suggestions, on-phone testing | 4.14.0 |

Part A is useful on its own and proves the round trip before the riskier template work.

---

## 12. Open questions

1. **Masked messages leaving the phone.** Part B2 depends on this. Without it, setup still covers categories, rules and budgets but not templates.
2. **Where suggestions live.** Proposed: Insights → Explore, next to the export, and Settings → Import data. Is a Home card for waiting suggestions wanted for existing users too, or only during setup?
3. **Rules applying to past transactions.** Proposed default is new entries only, with a switch. Should the default be past and new?
4. **Budgets.** Proposed: a suggested budget applies from this month to the end of the financial year, as Budget Configuration does. Or this month only?
5. **Prompt wording in other languages.** English only to start?
