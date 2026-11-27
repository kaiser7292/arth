# Faster screens, and voice that works

**Status:** proposal, Nov 2026. Nothing here is built.
**From:** a code audit of every screen loader and of voice input, plus online research (sources at the end).

---

## Part 1: Speed

### 1.1 Why Arth feels slow

**The main cause:** Arth remembers almost nothing between visits. When you leave a report, Android closes that screen completely. Opening it again starts from zero, even when nothing has changed:
- a spinner first
- then every database query runs again

Arth already has the right tool. A counter (the "data version") goes up every time anything is saved. Only a few places use it to skip work today:
- Year in review
- Year over year
- the balance sheet
- net-worth history

Everything else recomputes on every open:
- 74 screens and cards reload their data each time they come into view
- only 2 of them (the Budget and Goals tabs) skip the reload when nothing changed

**Other causes:**
- **One shared database line.** The phone database is used one query at a time. In the first seconds after opening Arth, about 25 start-up jobs join that line at once:
  - the Home preload
  - the message scan
  - the AI reading queue
  - repairs and calendar sync

  A screen you open then waits behind all of them.
- **Account balances re-walk history.** An account without a starting balance replays every month since its first transaction, 5 queries per month, one after another. That's about 180 queries for three years. It runs from about 20 places, including Home.
- **Money in and out builds months one at a time.** Insights runs 6 months of it each time it comes into view; its own screen runs up to 12.
- **Background saves reset everything.** The AI reader counts as a change every 10 messages, so every open screen reloads again and again during a scan.

What isn't the problem: the database already has the right indexes. Adding more wouldn't help.

### 1.2 The fixes, best value first

| # | Fix | What you'd notice | Effort | Risk |
|---|---|---|---|---|
| 1 | **Remember results until something changes.** One small helper caches each heavy report by the data version and its inputs (month, filters, financial year, today's date). Applied to: Insights findings, Your month, Money in and out (each month separately), My Month, Budget vs actual, Compare, Forecast, and the spending rows they share. | Reopening an unchanged report is instant | Low–medium | Low |
| 2 | **Show the last result straight away, refresh quietly.** Screens start from the cached answer; the spinner only shows the very first time. | No spinner on a second visit | Medium | Low |
| 3 | **Home skips work when nothing changed.** Home and its ~15 cards get the same "nothing changed, keep what's showing" key the Budget and Goals tabs have. Same for the Insights, Vault, Spending split and Monthly summary pages. | Going back to Home is instant | Low | Low |
| 4 | **Start-up does Home first, the rest later.** Repairs, maturity checks, calendar sync, broker capture and the AI queue wait until the app is idle; the preload covers only the 3–4 screens people open first. | The first screen after opening is quicker | Low | Low |
| 5 | **Background jobs count as one change, not dozens.** The AI reader marks a change once at the end of a run. | Screens stop reloading during a scan | Low | Low |
| 6 | **Account balances in 5 grouped queries, not 5 per month.** The same maths, grouped by month in one go, then cached. | Home, ledgers and account lists faster, most for older accounts | Medium | Medium: balance maths, checked against the existing ledger tests |
| 7 | **Database settings.** `synchronous = NORMAL` (SQLite's own advice for this mode) and `PRAGMA optimize` once per launch. | Saves a little faster; complex reports pick better plans | Very low | Very low |
| 8 | **Read only the columns a report needs.** Spending reports currently copy every column, including full SMS texts. | Reports with many transactions faster | Low | Low |
| 9 | **Refunds worked out once per query, not once per row.** | Long date ranges faster | Medium | Medium |
| 10 | **The account ledger draws rows as you scroll** (FlashList v2), and runs its independent steps together. | Busy months open faster | Medium | Medium: the ledger is the most delicate screen |
| 11 | **React Compiler** (one setting in `app.json`). It cuts repeated work in screens with lots of state. | Smoother screens | Low to try | Medium: needs a full Pixel test |

**Not recommended:**
- **Freezing screens:** closed screens can't be frozen.
- **`InteractionManager`:** deprecated.
- **A new data library (TanStack Query):** fixes 1 and 2 do the same job using the counter Arth already has.

### 1.3 Measure first, then after

There's no timing anywhere in Arth today. Before and after the fixes:
1. **Time every screen load** inside the one shared loader (`useDataRefresh`): screen name, whether it ran on opening or after a change, and how long it took. That's one edit covering all 72 screens.
2. **Keep the last 200 timings** on the phone only.
3. **Show them on a hidden Diagnostics page:** the slowest and the typical time per screen.
4. **Measure only release builds.** Debug builds are many times slower and mislead.

For deeper digging, there's a release-build profiler (react-native-release-profiler) whose recordings open in Speedscope.

### 1.4 Rules to keep it fast

- Every heavy read is cached by the data version plus its inputs. Treat this like the database checklist.
- Screens show cached data first. Spinners only on a true first load.
- Tabs and pager pages skip reloads when nothing changed, always with the month and today's date in the key.
- No background job marks more than one change per run.
- No query loops month by month or account by account. Group them in one SQL query instead.
- Long lists scroll lazily; only short, fixed content goes in a plain scroll view.

### 1.5 Order

1. Measure (§1.3)
2. Fixes 1, 2, 3 and 5: the big wins at low risk
3. Fixes 4, 7 and 8
4. Measure again
5. Fixes 6, 9 and 10, each checked against tests
6. Fix 11, tested on the Pixel on its own

---

## Part 2: Voice input

### 2.1 Why voice feels poor

**Recognition**
- **No hints.** Arth starts Android's speech engine with almost no settings. It doesn't pass your own words: merchants, categories, banks, payment apps.
- **Nothing on screen while you speak.** You only see the words afterwards, small and faint.
- **One guess only.** Only the engine's single best guess is kept, so "two fifty" against "2:50" can't be compared.
- **Pauses cut you off.** "450 … at Swiggy" ends at the pause.

**Reading a spoken entry**
- **Amounts:** only digits work.
  - "Two fifty", "fifteen hundred", "ek sau" and "dedh sau" give no amount at all.
  - "5 lakh" becomes 5, and "1.5k" becomes 1.5.
  - The first number in the sentence wins, so "on the 5th, 300" reads as 5.
- **Merchant:** only the word after "at" or "from".
  - "Spent 450 on groceries" makes the merchant "Groceries".
  - "DMart" becomes "Dmart", so you get duplicate merchants.
- **Payment app:** GPay, PhonePe and Paytm are recognised, then thrown away.
- **Category:** works only when you say the category's exact name. "Lunch" never becomes Food.
- **Dates:** only "yesterday". Not "last Friday", "on the 5th" or "kal".
- **Trigger words fire too eagerly:**
  - "Done" anywhere in the sentence opens an empty form.
  - "Bus pass" counts as "skip".
  - "Paid by bank transfer" becomes an account-to-account transfer.
- **Too many questions.** The question-by-question interview can ask up to five spoken questions in a row.
- **Errors are silent.** Any error (didn't hear, no network, language pack missing) just stops the mic.

**Voice search**
- **One long text search.** Unless the on-device AI steps in, the whole sentence is searched as one literal text. "Swiggy over 500" looks for the exact words "swiggy over 500" and finds nothing.
- **The AI is never asked.** For short queries like that one, it's skipped.

### 2.2 The plan, best value first

**A. Settings (quick wins)**
1. **Show your words as you speak,** large, live.
2. **Pass your own words as hints:** your top merchants, categories, payment modes, banks and Hisaab names, plus GPay, PhonePe, UPI, lakh, hazaar.
3. **Keep 3–5 guesses,** and use the first one that gives an amount or a known merchant.
4. **Don't cut off at a pause** (Android 13+): keep listening through short pauses, with a Done button.
5. **Say what went wrong:** "Didn't catch that, tap to try again", "Mic busy", "Offline speech not installed". Show "Thinking…" while the AI works.
6. **Try both engines on your Pixel:** on-device English (India) against the online one, and keep the better as the default.

**B. Reading what was said (the biggest accuracy gain: plain code, fully tested)**
1. **An Indian number reader:**
   - English: "two fifty", "fifteen hundred", "1.5k", "2k", "5 lakh", "1.2 crore".
   - Hinglish: ek, do, teen… sau, hazaar, lakh; dedh, dhai, saade, sava, paune.
   - It turns "2:50" into 250 when an amount is expected, prefers the number next to ₹, rupees or k, and ignores dates and card digits.
2. **Match against your own data, forgivingly:**
   - Merchants: "D Mart" = DMart, "blink it" = Blinkit, keeping your spelling.
   - Everyday words to categories: lunch, dinner, chai → Food; petrol → Fuel; Ola, Uber, auto → Travel.
   - Bank names.
3. **Use the payment app said:** GPay, PhonePe, Paytm, CRED and BHIM map to your UPI mode.
4. **Dates:** today, yesterday, kal, parso, "last Friday", "on the 5th", "5th November", "2 days ago".
5. **Trigger words only when they're the whole reply.** "Done", "skip" and "transfer" stop firing mid-sentence.
6. **Voice search:** split the sentence into date + amount ("over 500", "between 200 and 500", "more than 2k") + a forgiving match against your merchants and categories. Only leftover words become a text search.
7. **Over 100 test phrases** (made-up figures) for entry and search.

**C. One sentence, one confirm card**

Replace the five-question interview:
1. Say it once ("450 at Swiggy for lunch, GPay, HDFC, yesterday") and watch the words appear.
2. A card shows what was understood: every field highlighted and tappable to change.
3. **Looks right** saves through the normal Add form.

At most one spoken follow-up remains, and only for a missing amount. Voice transfers end on the same card instead of a spoken "yes".

**D. Rules first, AI for what's left**
- **Rules handle:** amounts, number words, dates, payment modes, known merchants and categories, and search phrases. They're instant, work on every phone, and are tested. Most of today's failures are rule problems the AI can't fix, since it's not allowed to invent an amount.
- **The on-device AI only handles what the rules leave empty:** a category from a description ("medicines for mom" → Health), a merchant from a messy sentence, a long search. It fills fields when its answer arrives and never holds up the card.

### 2.3 Ask Arth: a reply, not a filter (owner, 27 Nov 2026)

Asking a question in Insights (typed or spoken) should feel like asking an assistant that looked into it and answered. It should not just jump to a filtered list. "What did I spend by day 15?" didn't work before, and a filter jump wasn't the answer you wanted anyway.

**How it would work**
1. **Understand the question.** Rules first, as in B: a period ("by day 15", "last week", "in October", "this year so far"), a subject (a merchant, category, account, payment mode, or "everything"), and a measure (spent, earned, saved, how often, biggest, average, against budget, against last month). The on-device AI only fills in what the rules can't place, and only from your own names.
2. **Work out the answer in code,** from the same sums the app's screens use: Your month, Compare, Budget vs actual, Money in and out. The AI never does the arithmetic.
3. **Reply in a sentence,** for example: "By 15 Nov you'd spent ₹48,210, ₹3,900 less than by 15 Oct. Most of it went on Food (₹14,600) and Shopping (₹9,800)." The on-device AI may word it more naturally, checked number by number like the month headline; without it, the plain sentence shows.
4. **Show the working underneath:** a small card with the figures, a tiny chart where it helps, and "See these transactions" for anyone who wants the list.
5. **Keep a short thread.** Follow-ups like "and last month?" or "only Swiggy" keep the context of the previous question.
6. **When Arth can't answer, say so plainly,** with two or three example questions it can answer, instead of an empty list.

**Questions it should answer first:**
- spend by a day of the month
- totals for a period
- a merchant or category over a period
- against last month or last year
- biggest payments
- how often you went somewhere
- what's left in the budget
- what came in

This lives at the top of Insights, and the voice button opens the same thing.

### 2.4 Order

1. A1 and A5 (live words, real errors)
2. B1, B3 and B5 (numbers, payment apps, trigger words)
3. C (one sentence, one card)
4. A2, A3, B2 and B6 (hints, guesses, forgiving matching, search)
5. A4 and A6 (pauses, choosing the engine on your Pixel)
6. D
7. Ask Arth (§2.3), on top of the B parsers

Two things only a test on your Pixel can settle:
- whether Google's engine honours the hint list
- whether on-device English (India) beats online

---

## Sources

**Speed**
- Expo React Compiler: https://docs.expo.dev/guides/react-compiler/
- React Compiler 1.0: https://react.dev/blog/2025/10/07/react-compiler-1
- FlashList v2: https://shopify.engineering/flashlist-v2
- expo-sqlite: https://docs.expo.dev/versions/v54.0.0/sdk/sqlite/
- SQLite WAL and `synchronous`: https://www.sqlite.org/wal.html
- SQLite ANALYZE / optimize: https://sqlite.org/lang_analyze.html
- InteractionManager deprecation: https://reactnative.dev/docs/0.81/interactionmanager
- Hermes profiling: https://reactnative.dev/docs/profile-hermes
- Release profiler: https://github.com/margelo/react-native-release-profiler

**Voice**
- expo-speech-recognition: https://github.com/jamsch/expo-speech-recognition
- Android RecognizerIntent: https://developer.android.com/reference/android/speech/RecognizerIntent
- Hindi-English on-device recognition test: https://hackernoon.com/testing-androids-on-device-speech-recognition-with-hindi-english-code-switching
- Indian English speech-to-text and numbers: https://smallest.ai/blog/indian-english-speech-to-text-accuracy
- Hindi spoken numbers to digits: https://dev.to/tushar9802/whisper-transcribes-spoken-hindi-numbers-as-words-not-digits-so-i-made-a-library-to-convert-them-3m95
- Confirmation in voice dialogs: https://docs.nuance.com/mix/best-practices/dialog-planning/confirm/
- ML Kit GenAI Prompt API: https://developers.google.com/ml-kit/genai/prompt/android
