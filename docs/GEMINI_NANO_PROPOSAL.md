# On-Device AI (Gemini Nano) — Product Proposal

**Version:** 1.0 | **Date:** November 2026 | **Status:** Draft for review

---

## 1. Problem Statement

Everything "smart" in Arth today is rules, config and templates:

- **SMS reading** — hardcoded bank patterns (`services/sms/bank-patterns.ts`), then user templates. A message neither knows ends up as *unrecognized* in Scan Runs and is never turned into a transaction.
- **Teaching a new format** — `services/sms/template-guess.ts` guesses fields from shape rules and past templates. It works well for common formats and poorly for unusual ones.
- **Categories** — `services/smart-categorizer.ts` uses keyword mappings plus learned corrections. A merchant it has never seen stays uncategorized.
- **Smart Rule suggestions** — `services/rule-suggestions.ts` only spots a habit once the *exact same merchant string* is filed the same way 4+ times. "SWIGGY*BLR" and "Swiggy Instamart" count as two strangers.
- **Merchant names** — `services/merchant-alias.ts` cleans names with fixed rules.

Each of these has a long tail the rules will never cover. A small language model on the phone can handle the tail, without sending anything off the device.

---

## 2. Goals & Non-Goals

**Goals:**
- Use Gemini Nano (built into Android via AICore) to fill the gaps the rules leave
- Keep every rule, template and Smart Rule exactly as it is — AI runs only when they come back empty
- Nothing leaves the phone; no change to the privacy policy or Play data safety
- Every AI result goes through the existing review queue, marked as AI
- Arth works the same as today on phones without Gemini Nano

**Non-Goals (v1):**
- A chat assistant (that was Arth AI, removed in 4.11.0)
- Any cloud model or API key
- AI changing anything without the user approving it
- iPhone support (Apple has its own on-device model; separate proposal if wanted)
- Bundling a model in the app (the model lives in Android, not in Arth)

---

## 3. Platform Facts That Shape the Design

| Fact | Consequence |
|------|-------------|
| Gemini Nano runs through **AICore**, a system service, and only on recent phones (Pixel 9 / 10, some Samsung and vivo models; best on Pixel 10) | AI is a bonus layer. Every feature must check availability and fall back silently. |
| Inference is allowed **only while the app is in the foreground**; background calls (even from a foreground service) are restricted | Background SMS scans can't call the model. They mark items "needs AI" and the queue is processed when Arth is opened. |
| Accessed through ML Kit's **Prompt API** (`com.google.mlkit:genai-prompt`, beta as of July 2026) | API may change; wrap it in one native module so only one place needs updating. Prove quality on a real phone first (Phase 0). |
| The model is downloaded and updated by Android, not by Arth | No APK/AAB size cost beyond a small library. Avoids the Llama mistake (66 MB of native libs + a 0.9–1.9 GB model file). |
| Small model — fast but can make things up | The model only *proposes*; deterministic code checks every answer before it's used. |

---

## 4. Core Principle: The Model Proposes, Code Decides

This is the same stance as `services/ai-suggestions.ts` (replies pasted from chat apps):

1. **Rules first.** AI is only asked when hardcoded parsers, templates, Smart Rules and learned mappings all miss.
2. **Fixed answer shapes.** Each task asks for one small JSON object. Anything that doesn't parse, or has extra fields, is thrown away.
3. **Grounding checks.** An answer is only kept if it can be checked against real data — e.g. the amount must literally appear in the SMS.
4. **Review queue.** AI results are pending items with an "AI" badge. Nothing reaches reports until approved.
5. **Learning goes back into rules.** Approving or editing an AI result feeds the existing learning (`merchant_corrections`, template drafts). Over time, more messages are handled by plain rules and the AI is needed less.

---

## 5. Architecture

```
┌────────────────────────────────────────────────────────────┐
│ Feature code (parser, template guess, categorizer, rules)  │
│   only calls ↓                                             │
├────────────────────────────────────────────────────────────┤
│ services/ai/tasks/*.ts   one file per task:                │
│   prompt + answer schema + validator + fallback            │
├────────────────────────────────────────────────────────────┤
│ services/ai/nano.ts      the only gateway:                 │
│   availability, feature flag + user switch, timeout,       │
│   JSON extraction, result cache, foreground check, logging │
├────────────────────────────────────────────────────────────┤
│ modules/arth-nano/       Expo native module (Kotlin)       │
│   wraps com.google.mlkit:genai-prompt                      │
├────────────────────────────────────────────────────────────┤
│ Android AICore → Gemini Nano                               │
└────────────────────────────────────────────────────────────┘
```

### 5.1 Native module — `modules/arth-nano/`

Same structure as `modules/arth-text-reader` (which already uses ML Kit for OCR). Android only; iOS returns "unavailable".

| Function | Returns |
|----------|---------|
| `checkStatus()` | `"available" \| "downloadable" \| "downloading" \| "unavailable"` |
| `download()` | Starts the model download through AICore, emits progress events |
| `warmup()` | Loads the model so the first real answer is quicker |
| `prompt(system, input, { temperature, maxTokens })` | Raw text answer |

Temperature defaults to 0 — we want the same answer every time, not creativity. Needs an R8 keep rule check in a release build (see `plugins/withR8.js`).

### 5.2 Gateway — `services/ai/nano.ts`

- **Availability:** caches `checkStatus()` for the session.
- **Switches:** build-time flag in `services/feature-flags.ts` (`ai_nano`) plus a user setting *Settings → On-device AI* (MMKV key `ai_nano_enabled`, registered in `SETTINGS_REGISTRY`).
- **Foreground check:** refuses calls when `AppState` isn't `active`, so callers never hit the platform restriction by accident.
- **Timeout:** 8 s per call; on timeout the task returns "no answer", never throws.
- **JSON extraction:** forgiving read (code fences, trailing text), strict accept — reuse the helpers in `ai-suggestions.ts`.
- **Cache:** results keyed by `task + hash(input)`, so re-scans never ask the same question twice.
- **No redaction for reading tasks:** `sms-redact.ts` removes balances and last-4 digits — exactly what task 6.1 has to read — so prompts get the raw message (it never leaves the phone). Full prompts are never written to logs.
- **Logging:** every call recorded in the scan log (task, ms taken, accepted / rejected + why), shown in Scan Runs.

### 5.3 The "needs AI" queue

Background scans (`expo-background-fetch`, `services/transaction-alerts.ts`) can't call the model. Instead:

1. Background scan finds an unrecognized SMS → stores it with `ai_status = 'queued'`.
2. App comes to the foreground → `services/ai/queue.ts` works through queued items in small batches (low priority, after the home screen has rendered — same spirit as `home-preload.ts`).
3. Results land as pending items in the review queue; `bumpDataVersion()` refreshes open screens.

Manual scans (the user pulled to refresh) run AI inline, since the app is open.

---

## 6. Tasks (in build order)

### 6.1 Read messages the rules can't — **highest payoff**

- **Hook:** `services/sms/sms-parser.ts`, the branch that today does `result.unrecognized++`.
- **Ask:** `{ isTransaction, type: "debit"|"credit", amount, last4, merchant, balance, date }`.
- **Checks:**
  - `amount` (and `balance` if given) must appear in the SMS text as a number
  - `last4` must appear in the text
  - `type` must agree with money words in the text (`money-signals.ts`)
  - If `isTransaction` is false (OTP, promo, statement reminder) → stays unrecognized
- **Result:** pending expense/credit with `parse_source = 'nano'`, linked to an account via the usual `linkExpenseToAccount`.
- **Bonus:** offer "Teach Arth this format" on approval, pre-filled by 6.2, so next time a template handles it without AI.

### 6.2 Draft a template

- **Hook:** `guessSpans` in `services/sms/template-guess.ts`, as a 4th source after the existing three (only when they leave fields empty).
- **Ask:** character spans for amount / merchant / balance / account / date / ref.
- **Check:** `template-compiler` must compile the spans and the compiled pattern must match the original message *and* the other messages in the same format group.
- **Result:** user still sees the confirmation screen and taps "Looks right".

### 6.3 Pick a category

- **Hook:** `categorizeByMerchant` in `services/smart-categorizer.ts`, after learned mappings, keyword mappings and the brand registry all miss.
- **Ask:** one category name from the user's own list (included in the prompt).
- **Check:** must exactly match an existing category; otherwise leave uncategorized.
- **Result:** category pre-filled on the pending item, marked AI. Corrections flow into `recordCategoryCorrection` as today.

### 6.4 Smarter Smart Rule suggestions

- **Hook:** `getRuleSuggestions` in `services/rule-suggestions.ts`.
- **Ask:** group merchant strings that are the same business ("SWIGGY*BLR", "Swiggy Instamart" → Swiggy); propose a keyword.
- **Check:** the proposed rule is run against the last 180 days of real transactions; it's only shown if it matches at least `MIN_OCCURRENCES` and hits the same category at least `MIN_SHARE` of the time — the same bar as today's suggestions.
- **Result:** the existing suggestion card, with a longer list of merchants it would cover.

### 6.5 Clean merchant names

- **Hook:** `cleanMerchantName` in `services/merchant-alias.ts`, when the rule-based clean-up leaves something obviously raw (all caps, `*`, trailing codes).
- **Ask:** a display name.
- **Check:** must be made only of words from the original (no new words), shorter or equal length.
- **Result:** display name only — never touches amount, date or account.

### 6.6 Knowing your accounts — relationships, not just fields

Reading amount / account / merchant isn't enough for the cases rules don't cover yet. The first Pixel run showed it: "A/C XXXXX903667 has a debit by transfer of Rs 30,155 … Avl Bal Rs 0.00" looks like a ₹30,155 spend, but it was an SBI FD being closed with the proceeds going back to savings. Counted as an expense, it would be wrong twice: a fake spend, plus an FD still showing in net worth.

**Design: Nano labels and points, code does the bookkeeping.**

1. **A short "money map" goes into the prompt.** One line per account, built from `financial_accounts` and `investment_products`, e.g. `A3 | FD | SBI | ••3667 | funded from A1` or `A1 | savings | SBI | ••4821`. Names and digits only, never balances or history. Gemini Nano takes about 4,000 tokens per prompt, so the map stays under ~25 lines (most recently active first).
2. **Nano picks one event from a fixed list:** `spend`, `income`, `refund`, `own_transfer`, `fd_open`, `fd_close`, `card_payment`, `loan_emi`, `investment`, `wallet_topup`, `not_txn`. It also names the accounts involved by their map id (`from: "A3", to: "A1"`), or `new` when the account isn't in the map.
3. **Code checks and books it through flows that already exist.**
   - The account digits must match the SMS (same check as today).
   - `fd_close` and `fd_open` go through the existing FD handling (`detectFdEvent`, `investment_products`).
   - `own_transfer` and `card_payment` become `account_transfers`, not expenses.
   - Everything still lands in the review queue, worded as the event: "SBI FD ••3667 closed, ₹30,155 back to savings ••4821".
4. **Pairing is code's job, not Nano's.** One event often arrives as two or three SMS: the FD debit to zero, the "account closed" notice, and the savings credit. Code pairs them when the amount matches within ±2 days on the two accounts the map links. Nano labels each message on its own, which small models do reliably. Following a chain across messages is where they slip.
5. **Unknown account → a suggestion, never a silent guess.** `new` turns into a review card: "Looks like an FD at SBI ending 3667 was closed. Add it so your net worth is right?"

**Why this split:** Nano is good at reading the *meaning* of a message it has never seen. It's weak at arithmetic, remembering across messages, and anything it can make up (it invented "9096" in the first run). So it gets the judgement calls, and Arth's code keeps the money logic it already does correctly.

**Test before building:** add the event label and the money map to the lab, re-run the 50 messages on the Pixel, and check the labels. Then build it in Phase 1 alongside reading unrecognised messages.

### Later ideas (not v1)

- Spotting subscriptions / recurring payments from free text
- Explaining an odd month in the monthly summary ("Food up 40% — mostly 3 Zomato orders on weekends")
- Reading payment screenshots shared into Arth (needs the image input API)

---

## 7. Data Changes

One migration, following the Database Changes Checklist in `CLAUDE.md`:

| Change | Detail |
|--------|--------|
| `095_ai_provenance.ts` | Adds to `expenses`: `parse_source TEXT` (`hardcoded` / `template` / `nano` / NULL for manual), `ai_fields TEXT` (JSON list of fields the AI filled). Adds to `pending_sms`: `ai_status TEXT` (`queued` / `done` / `rejected` / NULL). |
| `TABLE_SCHEMAS.ts` | Add all new columns — otherwise restore silently drops them. |
| Queries | Any `SELECT` listing expense columns explicitly gets the new ones where needed. |
| Mocks | Test mock objects updated. |
| MMKV | `ai_nano_enabled` (backed up) and the result cache (device-only — it's rebuilt on demand) in `SETTINGS_REGISTRY`. |

---

## 8. UI

- **Settings → On-device AI:** on/off switch, status ("Ready", "Downloading 40%", "Not supported on this phone"), and a short note: *Runs entirely on your phone. Nothing is sent anywhere.*
- **Review queue:** small "AI" badge on items or fields the model filled; tapping shows which fields.
- **Scan Runs:** a new category *Read by AI* alongside hardcoded / template / filtered / unrecognized, with the raw body and the AI's answer.
- **Help center:** one article explaining what the AI does and doesn't do.
- Phones without Gemini Nano see none of this — not even the Settings row.

---

## 9. Privacy & Play Store

- All inference on-device through AICore; Arth sends no data anywhere. Privacy policy wording: add one paragraph saying on-device AI is used and nothing leaves the phone.
- Play data safety: no change (no collection, no sharing).
- Prompts are redacted (`sms-redact.ts`) before use and are never written to logs in full.

---

## 10. Phases

| Phase | Scope | Done when |
|-------|-------|-----------|
| **0 — Prove it** | `arth-nano` module + hidden test screen: paste an SMS, see Nano's JSON and time taken | Owner tests on the Pixel with ~50 real unrecognized messages from Scan Runs. Go/no-go on speed (target < 2 s) and accuracy (target ≥ 90% of answers pass the checks). |
| **1 — Unrecognized SMS** | Gateway, task 6.1, "needs AI" queue, migration 095, review-queue badge, Scan Runs category, Settings screen | Unrecognized count in Scan Runs drops on the owner's phone; no wrong amounts reach approved transactions. |
| **2 — Templates** | Task 6.2 + "Teach Arth this format" after approving an AI-read SMS | New formats taught in one tap more often than today. |
| **3 — Categories & rules** | Tasks 6.3, 6.4 | Fewer uncategorized items; rule suggestions cover merchant variants. |
| **4 — Names** | Task 6.5 | Cleaner merchant names in lists. |

Each phase ships behind the `ai_nano` flag and is tested on a release build on the Pixel before turning on (R8 keep rules — see the 4.10.2 / 4.11.0 lesson).

---

### Phase 0 build notes (Nov 2026)

- **Library pinned to `genai-prompt:1.0.0-beta2`.** beta3–beta5 are compiled with Kotlin 2.3/2.4; Arth (Expo SDK 54) builds with Kotlin 2.1.20, which can't read them. Moving up needs a Kotlin bump (likely with the next Expo SDK).
- **Android 7 still installs Arth.** The Prompt API needs API 26; the module's manifest overrides the library's minSdk and never touches it below Android 8.
- **Google's own logging.** ML Kit pulls in Google's `datatransport` logging libraries (as the text reader already does through Play services). Check what they send before release, and whether the Play data safety form needs a line.
- **Hidden screen:** Settings → tap Version 7 times → *On-device AI lab* (About). "Hide this screen" hides it again. Read-only: nothing is written to the database.

---

## 11. Risks

| Risk | Mitigation |
|------|------------|
| Model invents an amount | Grounding check: amount must appear in the SMS. Review queue as a second check. |
| Prompt API is beta and changes | All calls in one native module; flag can switch it off in one build. |
| Few users have supported phones | Built as a bonus layer; rules remain the main path. |
| Slow on first use / during download | Status in Settings; queue processing never blocks rendering; 8 s timeout. |
| Background restriction tightens further | Already designed around foreground-only use. |
| SMS text tries to steer the model ("ignore instructions…") | Answer shapes are fixed and checked; the model can't trigger any action, only fill fields that are verified. |

---

## 12. Open Questions

1. ~~Default on or off for new installs on supported phones?~~ **Decided (Nov 2026): on by default on supported phones; on phones without Gemini Nano the whole feature is hidden — no Settings row, no badge, nothing.**
2. ~~Should AI-read transactions ever auto-approve?~~ **Decided (Nov 2026): no. Every AI result goes through the review queue; repeat formats become templates instead.**
3. Phase 0 first, or straight to Phase 1? (Proposal: Phase 0 — one day of work, and it decides whether the rest is worth building.)

---

## References

- [ML Kit Prompt API: custom on-device Gemini Nano experiences](https://developer.android.com/blog/posts/ml-kit-s-prompt-api-unlock-custom-on-device-gemini-nano-experiences)
- [Android on-device inference (July 2026)](https://android-developers.googleblog.com/2026/07/android-on-device-inference.html)
- [Overview of the ML Kit GenAI APIs](https://developers.google.com/ml-kit/genai)
- [Gemini Nano / AICore](https://developer.android.com/ai/aicore)
