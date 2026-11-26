# On-device AI, Phase 2: seven more jobs for Gemini Nano

**Status:** proposal, Nov 2026. Nothing here is built.
**Builds on:**
- `docs/GEMINI_NANO_PROPOSAL.md`: Phase 1 reads unrecognised messages and helps onboarding.
- Branch `claude/nano-onboarding`: the queue, the "Read by AI" mark, and one model call at a time.

---

## 0. The rules every job follows

Phase 1 settled these. Each job below keeps them, so none is repeated per job.

1. **The model proposes, code decides.**
   - Every answer is checked against something Arth already has: the message, the picture's text, your category list, your transactions.
   - An answer that fails a check is dropped.
   - Nothing the AI suggests changes money, categories or settings until you tap.
2. **Only in front.** Android runs the model only while Arth is on screen, so the jobs are of two kinds:
   - **Queued:** waiting work in `pending_sms` or in the new `ai_jobs` table (§0.1). It runs in the same lane as the Phase 1 queue.
   - **Live:** you're waiting on screen (voice, search, picture). A hard time limit applies, and the screen works without the AI if it runs out.
3. **One call at a time.** Every job goes through `askNano`, which already queues calls behind each other.
4. **Short prompts.** The model takes about 4,000 tokens per prompt. Prompts carry names and amounts, never history dumps.
5. **The same switch.** Settings → On-device AI gets one row per job, so each can be turned off on its own. Phones without Gemini Nano see none of it.
6. **Tests:**
   - Each job's checking function is pure and unit-tested with made-up data. Real SMS details are never used: the repo is public.
   - Each job is tried in the AI lab on your own data before it's switched on.

### 0.1 One new table: `ai_jobs`

Several jobs need "work waiting for the model" that isn't a message. That covers jobs 1, 2, 4 and 7, and job 3's template drafts. Instead of one column per job:

| column | |
|---|---|
| `id`, `user_id` | |
| `kind` | `category`, `merchant_merge`, `context`, `template`, `month_note` |
| `ref_id` | what it's about: an expense id, a merchant name, a month |
| `status` | `queued`, `done`, `rejected`, `error`, `retry` (same meaning as `pending_sms.ai_status`) |
| `result` | the checked answer as JSON, for the suggestion card |
| `created_at`, `done_at` | |

- Migration 099 creates it, with the full checklist: TABLE_SCHEMAS, BACKUP_TABLES, cascade on expense delete, and the coverage guard.
- `reading-queue.ts` becomes the runner for both: messages first, then `ai_jobs` by kind priority.
- Suggestions the person hasn't answered yet show as cards on the screens below. Nothing is applied by the runner.

---

## 1. Categories at scan time

**What you see:** a new transaction from a message, picture or AI read that no learned mapping, keyword rule or brand covers no longer arrives uncategorised. Catch Up shows the AI's pick as a chip: "Food? · on-device AI". One tap keeps it, another picks something else.

**Flow:**
1. `sms-to-expense.ts` and the picture flow call `categorizeByMerchant` as now.
2. When it returns `none` and the transaction is a spend, queue an `ai_jobs` row: `kind='category'`, `ref_id=<expense id>`.
3. The runner groups up to 8 waiting merchants per prompt, using the prompt from `tasks/merchant-category.ts` (already built and tested in onboarding).
4. **Check:** the answer must be one of your category names exactly; "unsure" is dropped.
5. The result is stored on the job, not on the expense. Catch Up and the review list read it and show the chip on uncategorised cards.
6. When you tap the chip, it goes through the existing category-correction path (`recordCategoryCorrection`). After 3 of the same, the learned mapping takes over and the AI is no longer asked for that merchant.

**Why a chip and not filling it in:** the uncategorised section is how you find what needs a look. A silent AI category would hide mistakes there.

**Effort:** small. The prompt and its check exist; the work is the job row, the runner hook and the chip.

---

## 2. Spotting merchant variants

**What you see:** a "Same place?" card in Settings → Merchants and in Fix my data, for example:
- "Neos Group, Neos and Dhakam look like Bluecopa Office Cafeteria. Merge them?"
- buttons: **Merge** / **Not the same**

**Flow:**
1. **Candidates come from code, not the model.** Pairs of merchant names are compared with:
   - `merchantFuzzyScore` just below the auto-learn threshold
   - names sharing a first word ("Swiggy", "Swiggy Instamart")
   - names paid from the same UPI ID or VPA, read from `raw_source_text` and picture text
   - names paid on the same account, same day of week, similar amounts, both small ticket. This is weak on its own and only counts alongside one of the above.
2. Up to 20 candidate pairs a week go to the model, a few per prompt: "Are these the same business? same / different / unsure".
3. **Check:**
   - only `same` survives
   - the pair must still be two different canonical names
   - neither name may be one you separated before. "Separate" records a `merchant_merge` job with `result='different'`, which is never asked again.
4. Merging uses the existing merchant-detail merge (`renameCanonical` + `propagateMerchantRename`), and the merchant-undo toast offers Undo.

**Honest limit:** "Neos Group" vs "Bluecopa Office Cafeteria" have nothing in common in their names. Only the shared UPI ID or account-and-day signal would surface that pair. The model then judges between candidates; it doesn't find matches on its own. Most wins will be the Swiggy-style variants.

**Effort:** medium. The candidate finder is new code; the merge UI exists.

---

## 3. Turning AI-read formats into templates

**What you see:** after you approve the second AI-read message in the same format from the same bank, Catch Up shows a card:
- "Arth can read these HDFC card alerts on its own from now on, instantly and without the AI."
- buttons: **Yes, read them automatically** / **Not now**

**Flow:**
1. On approving an expense with `parse_source='ai'`:
   - work out its format key with `formatKey` from `services/receipt/template-guess.ts`, the same grouping the unrecognised list uses
   - count approved AI reads with that key and sender
2. At 2, draft a template:
   - `guessSpans` places the fields; the AI's checked reading (amount, merchant, account digits, balance) fills the spans `guessSpans` left empty
   - this is task 6.2 in the Phase 1 proposal, with no new prompt: the AI's reading already says where each value is
3. **Check:**
   - `template-compiler` compiles the spans
   - the compiled pattern must match both approved messages
   - it must read the same amount, account and type as the AI did, on both
4. "Yes" saves it through `user-sms-templates.ts` and runs it on the unrecognised backlog with `applyTemplateToBacklog`. Those messages are then read by the template, not queued for the AI.
5. "Not now" is remembered per format key in MMKV, registered in `SETTINGS_REGISTRY`.

**Why it matters:** every format that graduates costs no more AI time, and works on phones without the AI after a backup and restore.

**Effort:** medium. Most parts exist; the work is the approval hook, the draft from AI fields and the card.

---

## 4. What a payment really was

**What you see:**
- Catch Up and transaction detail show one suggestion chip per payment, only when it fits:
  - "Autopay? · Make this recurring"
  - "SIP into Parag Parikh Flexi Cap? · Link to your bucket"
  - "EMI for HDFC Home Loan? · Link to the loan"
  - "Card bill paid? · Count as a transfer"
- Accepting runs the action that already exists for it.

**Flow:**
1. For each new message-read transaction whose context code couldn't settle, queue `kind='context'`:
   - code settles it first: `detectSip`, `detectFdEvent`, `inferCreditKind`, NACH words, `money_event`, a loan EMI match
   - only when code is silent does it go to the AI
2. The prompt is a shorter version of the Phase 1 reading prompt, with the money map and the message, asking only for `event`, `auto`, `scheme` and `channel`. This is the context-only prompt from §6.7 of the Phase 1 proposal.
3. **Checks:** the Phase 1 checks:
   - `scheme` words must be in the message
   - `auto` counts as certain only with an autopay word, otherwise it's a suggestion
   - `event` must agree with debit or credit
   - `loan_emi` needs a loan you have; `sip` needs a bucket or names a fund
4. Each accepted chip calls an existing function:

   | Chip | Existing function |
   |---|---|
   | Make this recurring | the `recurring-rules.ts` create sheet, prefilled |
   | Link to bucket | `expense_investment_links` through the bucket picker sheet |
   | Link to the loan | `LoanPaymentPickerSheet` / `expense_loan_links` |
   | Count as a transfer | the existing reclassify-as-transfer action |

5. **Recurring detection gets a hint:** `recurring-detector.ts` counts an AI-confirmed autopay as one more signal. It doesn't replace the interval check.

**Effort:** medium-large. It touches four existing actions, but each is reused, not rebuilt.

---

## 5. Payment pictures the reader can't place

**What you see:** on the picture screen, when `readReceipt` leaves the amount or merchant empty, a line reads "Asking on-device AI…" for up to 4 seconds, then the fields fill in, marked "Read by AI". If the AI can't do it, the screen is as today.

**Flow:**
1. `from-screenshot.tsx` already has the picture's text lines from the text reader.
2. If `guess.amount` or `guess.party` is missing:
   - send the text lines, joined and capped at about 1,500 characters
   - ask for `{amount, party, date, time, kind: paid|received|transfer, ref}`
3. **Checks:** the same as message reading:
   - the amount must be written in the picture's text
   - the party's words must be in the text
   - the date must parse with `parseDate`
   - the ref must be in the text
   - money in or out must agree with words on the picture ("Paid to", "Received from")
4. Only empty fields are filled; the reader's own values are never overwritten.
5. Everything then goes through the picture flow built today: your merchant names, category, Smart Rules, the add screen.
6. "Teach Arth this layout" (picture templates) stays the way to stop needing the AI for an app's receipts.

**Effort:** small. It's one live call with the existing checks and one place to hook it.

---

## 6. Voice and search in plain words

### 6a. Voice
**What you see:** saying "spent 300 on chai at office yesterday, paid by UPI" fills in amount, merchant, date, payment mode and category.

**Flow:**
1. `utils/voice-parser.ts` runs first, as now.
2. If it leaves the merchant or category empty, or the sentence has words it didn't use, ask the model for `{amount, merchant, date_words, mode, category}`. Your category names and payment mode names go in the prompt.
3. **Checks:**
   - the amount must be a number you said, including spoken words ("three hundred" → 300) via the parser's own number words
   - the merchant's words must be in what you said
   - category and mode must be names from your lists
   - date words go through the existing date parser, not the model's date
4. It fills the add screen; nothing saves until you tap Save. Time limit 3 seconds; the parser's result stands if it runs out.

### 6b. Search
**What you see:** typing "Swiggy last month over 500" or "what did I spend on fuel in October" in search applies filters (merchant Swiggy, October, amount > 500), shown as removable chips.

**Flow:**
1. `global-search.ts` already reads date words (`dateWordsIn`) and amounts (`parseAmountQuery`).
2. Only when the query has 3 or more words and those don't settle it, ask the model to map it onto the filter fields: `merchant`, `category`, `account`, `from`, `to`, `min`, `max`, `type` (debit, credit, transfer).
3. **Checks:**
   - merchant must be one of your merchant names (`closeNames`)
   - category and account must be yours
   - dates come from `dateWordsIn` on the words the model points at
   - amounts must be numbers in the query
4. Results are your normal filtered list. The model never answers with figures itself.

**Effort:** medium. Two small prompts; most of the work is the chips UI in search.

---

## 7. Explaining your month (in Insights)

**Where:** the top of **Insights**, in `components/home/pages/InsightsPage.tsx`. That one component is both the Insights screen (`app/insights/index.tsx`) and the Insights page of the Home swipe-pager, so the card is built once and shows in both. Monthly Summary is unchanged.

**What you see:** a "Your month in words" card above the existing Insights cards, for this month so far, with a **Last month** switch once the month has ended. It holds two or three plain sentences:
- "Food was ₹2,400 more than usual, mostly 3 Zomato orders on weekends."
- "You saved 18%, up from 12%."

Each sentence opens the Insights drill-down it's about (`/insights/insight-detail` for that insight, or Compare for this month against last). Phones without Gemini Nano, or with it switched off, see the same facts written plainly ("Food: ₹2,400 above your 3-month average").

**Flow:**
1. **Code finds the facts**, from what Insights already computes:
   - `getInsights` (`insight-engine.ts`): the biggest category changes, unusual payments, the insights already ranked by severity
   - `getThisVsLastMonthTotals` (`comparison-insights.ts`): this month against last
   - for the top category change, the merchants and weekday pattern behind it, counted in code
   - pick the top 3 facts as numbers and names
2. **The model only writes:** it gets the facts as a short list and returns one sentence per fact.
3. **Check:**
   - every number in a sentence must be a number in the facts, or that number rounded as shown
   - every name must be in the facts
   - otherwise that sentence is dropped, and the fact shows in its plain form
4. **When it's written:**
   - cached as an `ai_jobs` row (`kind='month_note'`, `ref_id='2026-11'`), so opening Insights doesn't ask the model again
   - rebuilt when that month's data changes (data version, debounced), and only while Insights is open
   - the plain form shows at once; the written one replaces it when ready, and never holds up the screen (B1)

**Why so strict:** a wrong number in Insights is worse than no sentence. The model is used only for wording.

**Effort:** small-medium. The facts exist; the work is picking the top 3, the check and the card.

---

## Build order

| Order | Job | Why this order |
|---|---|---|
| 1 | **5. Pictures** | Smallest; reuses message checks and today's picture flow; you hit it this week |
| 2 | **1. Categories** | Prompt already proven; cuts the uncategorised pile every scan |
| 3 | **3. Templates** | Every graduated format saves AI time from then on |
| 4 | **2. Merchant variants** | Needs the candidate finder; pays off with job 1 |
| 5 | **4. What it was** | Biggest; links into loans, buckets and recurring |
| 6 | **7. Month in words (Insights)** | Nice to have, low risk |
| 7 | **6. Voice and search** | Most UI work; the parsers already cover the common cases |

Jobs 1, 2, 4 and 7 need `ai_jobs` (migration 099), so it lands with job 1.

**Before any of it ships:** a release build tested on the Pixel. Phase 1 still needs that test, and it should come first.
