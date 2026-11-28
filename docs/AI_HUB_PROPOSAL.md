# One place for AI in Arth

**Status:** revised after review with the owner, Nov 2026. All five steps of §11 are built (not yet committed or tried on a phone). The old routes come out the release after. See §14.
**Replaces as entry points:** Settings → On-device AI, Settings → AI-assisted setup, the AI half of Settings → Fix my data, About → On-device AI lab (removed), and the Home "AI Assisted Setup" card.
**Keeps:** Nano's queue and jobs, their checks, and the full-history file with its reader and review screen. The setup reply reader is folded into the corrections reader (§4), so there's one reply format and one review screen with Undo.

---

## 1. The problem

Arth has two kinds of AI, and they come in through six doors with four different names.

| Door | Where it is | Which AI | What it does |
|---|---|---|---|
| **On-device AI** | Settings → Data (shown only on phones with Gemini Nano) | On this phone | Model download, reading unknown messages, job switches, formats ready to learn |
| **AI-assisted setup** | Settings → Data | Your assistant (ChatGPT, Gemini, Claude) | Share a file; the reply sets up categories, budgets, rules, income, goals |
| **Fix my data** | Settings → Data | None, then your assistant | Data health (no AI at all), then share the whole history so your assistant can fix it, plus fix history and undo |
| **On-device AI lab** | About (hidden, 7 taps on Version) | On this phone | Testing Nano on your own messages |
| **Export for AI** | Insights → Explore | Your assistant | A file to ask questions about your money; nothing comes back |
| **AI Assisted Setup card** | Home | Your assistant | "Waiting for your reply" after a setup file is shared |

And at first run, onboarding offers three routes: **On this phone**, **AI assisted** and **I'll set it up myself**.

What this does to a person using Arth:

1. **Names that don't say the difference.** "On-device AI" and "AI-assisted setup" both sound like Arth's own AI. Nothing says one is private and automatic and the other means sending a file to ChatGPT.
2. **The same job, two doors.** Setup and Fix my data feel alike because underneath they nearly are (§4). But they're two screens, two files and two reply formats, so a reply pasted into the wrong one fails.
3. **Undo works on one door only.** Fix my data takes a snapshot first and can undo everything. A setup reply can't be undone.
4. **"Fix my data" is mostly not AI.** Its top half, Data health, is Arth's own checks.
5. **Nano's suggestions are scattered.** "Same place?" sits in Merchants, "Formats ready to learn" sits in On-device AI settings, and the AI marks are in Catch Up. Nothing says how many are waiting.
6. **The lab is a second Nano screen** that repeats On-device AI's status and download card.

---

## 2. Decisions from the review

| Question | Decision |
|---|---|
| Do we need the AI lab? | **No. Remove it** (§6). |
| Where do things waiting on you go? | **Catch Up**, as new cards. No new inbox (§3). |
| Do we still need paste, now that Nano runs on the phone? | **Yes, as one request instead of six** (§5). Most phones don't have Nano, and Nano can't see a whole history. |
| Setup and Fix my data feel the same. Merge them? | **Yes: one request, one file, one reply format, one review screen with Undo** (§4). |

---

## 3. Waiting for you lives in Catch Up

Catch Up is already a stack of cards: duplicates, forecast matches, transactions to approve, and entries without a category (`buildCatchUpDeck` in `services/catch-up.ts`). The Catch Up count on Home already tells you how many things are waiting. Three new card kinds join the stack:

| Card | What it shows | Buttons | Comes from |
|---|---|---|---|
| **Your assistant's reply** | "You shared a file with your assistant. Paste its reply here." | Paste reply · Share again · Dismiss | The pending flag set when a file is shared |
| **Learn this format?** | "Arth's AI read 2 messages from this bank the same way. Read this format by itself from now on?" | Yes, read them · Not now | Template offers (`templateOffers()`, `ai_jobs` kind `template`) |
| **Same place?** | Two merchant names that look like one place | Merge · Keep apart | Merge offers (`ai_jobs` kind `merchant_merge`) |

- **Order in the stack:** the assistant's reply comes first, because the person has just come back from the chat app with it. Then the cards that are there today. Template and merge offers go last: they never block money from being counted.
- **Accepting a format** reads the waiting messages it covers, which can add new transaction cards. Catch Up reloads the stack after that answer, the same way it does after a batch approve.
- **Settings goes back to being only switches.** The template offers come out of On-device AI settings (`components/ai/AiJobsSettings.tsx` keeps only the job switches).
- **"Same place?" stays in Merchants too**, because it makes sense there in context. Both places read the same `ai_jobs` row, so answering in one clears it in the other.
- **The Home "AI Assisted Setup" card goes.** The reply card is in Catch Up, and Home's Catch Up entry counts it.
- **What the AI did** stays in Scan history: every Nano run is already saved there as an AI run, with its answers, the reason any answer was dropped, and how long each one took.

So: things that need your decision are in Catch Up, and the record of what the AI did is in AI runs in Scan history. Nothing new to look in.

---

## 4. Setup and Fix my data become one request

### 4.1 Why they can merge
Most of the merge is already in the code:

- **One file builder.** The setup file (`services/ai-share.ts`) and the Fix my data file (`services/corrections/export.ts`) are both built by `buildAiExport` in `services/ai-export.ts`. Setup takes the last 12 months. Fix my data takes all of it, plus Arth's health findings, merchant spelling tables and each transaction's links.
- **One reader already reads both.** `services/corrections/read.ts` accepts a `"corrections"` or a `"suggestions"` list. It hands the nine shared kinds (`SHARED_TYPES` in `services/corrections/format.ts`: categories, merchant fixes, merchant categories, recategorise, rules, budgets, savings target, buckets, milestones) to the setup reader, and applies them through `applySuggestions`.
- **The real gap is three kinds of change.** Setup can add a missing transaction (`add_transaction`), learn an SMS format (`sms_template`) and set income (`set_income`). Fix my data refuses these today ("Is a setup change Fix my data doesn't make"). Fix my data has 13 kinds of its own (account type, duplicates, transfers, refunds and so on) that setup can't make.

### 4.2 What it becomes
- **One request page**, "Ask your AI assistant", with a **What to focus on** choice:
  - Set up everything
  - Tidy categories
  - Suggest a budget
  - Find what's missing
  - Fix my whole history
  - Read my unread messages (hidden when Nano is reading messages on this phone, see §5)
- **One file.** Always the full-history kind, with health findings and links, because every focus benefits from them. A **Period** option (12 months / all of it) keeps big histories small enough for a chat app. Fix my whole history defaults to all of it, and the others default to 12 months. "Include people's names" and "Include notes" stay as options.
- **One reply format** (`arth-corrections/2`): the corrections format, plus the three setup-only kinds. One set of instructions for the assistant replaces `buildReplyInstructions` and the corrections instructions. The focus only changes the request line at the top of the file.
- **One review screen with Undo.** Every reply goes through Fix my data's review and apply (`services/corrections/apply.ts`), which already takes a snapshot first and writes a history row. **So setup replies get Undo for free.**
- **Old replies keep working.** A reply with `"suggestions"` or `arth-corrections/1` is still read, so an assistant chat started before the update still works.
- **Onboarding's "set up on this phone"** (`services/ai/local-setup.ts`) writes its answers as a reply in the same format and opens the same review screen, so it gets Undo too.

### 4.3 What it takes
| Change | Where |
|---|---|
| Read and apply `add_transaction`, `sms_template`, `set_income` | `services/corrections/read.ts` stops refusing them and hands them to the setup reader. `apply.ts` puts them in `APPLY_ORDER`: income first, new transactions before the fixes that could touch them, formats last |
| One instruction block | Merge `services/ai-reply-format.ts` and `services/corrections/format.ts` into one format file. `AI_REQUESTS` becomes the focus list |
| One file | `buildFixExport` takes `focus` and `period`. `ai-share.ts`'s setup file builder goes |
| One request page | Built from `app/settings/ai-assisted-setup.tsx` and Fix my data's share card |
| One review screen | Fix my data's review screen. `app/settings/ai-suggestions.tsx` redirects to it for one release, then goes |
| Tests | The reader tests gain the three new kinds and an old `"suggestions"` reply. Made-up data only: the repo is public |

**Database:** none. The snapshot and history already exist (`services/corrections/snapshot.ts`).
**Backup:** the "reply waiting" setting (`ai_setup_pending`) changes from true/false to the focus it's waiting for. `SETTINGS_REGISTRY` gets the new type, the guard test checks it, and the reader still accepts the old `true`/`false` from older backups.

---

## 5. Is the assistant round trip still worth it?

**What paste is for:** not SMS. Arth makes a file of your money data and you share it with ChatGPT, Gemini or Claude. The assistant writes back a block of instructions, and you paste that block into Arth. Arth checks each change and shows it, and applies only what you tick.

**Why it stays now that Nano is on the phone:**
- **Most phones don't have Gemini Nano.** Arth hides On-device AI entirely on those phones, so for most people the assistant is the only AI there is.
- **Nano sees a little at a time.** About 4,000 tokens per prompt, so it gets a few merchant names, never the history. It can't find duplicates, transfers and refunds across months, set budgets from a year of spending, or set up income, savings targets and goals. The assistant can.

**Where Nano wins:** reading unrecognised messages. On a phone where Nano is reading messages, the "Read my unread messages" focus is hidden, because Nano already does that privately and automatically. It stays on phones without Nano.

**How it shows:** one entry, "Ask your AI assistant", instead of six request buttons.

---

## 6. The AI lab is removed

**Why:**
- **Scan history already keeps what the lab showed.** Every real Nano run is saved as an AI run, with the AI's answer (`aiResult`), why it was dropped, and how long it took (`aiMs`). The normal queue builds these rows with the same function the lab uses.
- **Real reading covers the rest.** Settings → On-device AI reads waiting messages for real, and "Read older messages too" goes back 90 days.
- **What only the lab did is small:** reading one message pasted by hand, any date range, and the "Use my accounts" switch. None of it is something a person using Arth needs.
- **The lab only ever tested message reading.** It can't test the other six jobs (categories, merges, what a payment was, formats, the month headline, voice and search), so the rule "each job is tried in the lab first" was only ever true for one job.

**What goes:** `app/settings/ai-lab.tsx`, `services/ai/ai-lab.ts`, `components/ai/LabResultRow.tsx`, `components/ai/LabRunToaster.tsx`, the lab's screen entry in `app/settings/_layout.tsx`, and the 7-taps-on-Version unlock and lab row in `app/(tabs)/settings.tsx`.

**What stays:** `services/ai/reading-queue.ts` imports `labRowToDetail` and `RunRow` from `lab-runner.ts`. Those move into the queue (or `services/sms/sms-scan-logging.ts`) first, and then `lab-runner.ts` goes. The `ai_lab_unlocked` setting is deleted on start and comes out of `SETTINGS_REGISTRY`. Old AI runs the lab saved in Scan history stay readable.

**The Phase 2 rule changes.** `docs/ON_DEVICE_AI_PHASE2_PROPOSAL.md` §0 rule 6 currently says each job is tried in the AI lab before it's switched on. It becomes: *a new job ships behind its own switch, is tried on the owner's phone first, and what it did is checked in Scan history (for message reading) or on the screen where it shows (for the other jobs).* That edit is made in that file when this is built.

---

## 7. The AI screen: settings only

One row in Settings, **AI**, opens one screen with two halves. Each half has the same name everywhere in the app, onboarding included:

- **On this phone**: Gemini Nano. It works by itself, nothing leaves the phone, and it's only on some phones.
- **With your AI assistant**: ChatGPT, Gemini, Claude or any chat app. You share a file and paste the reply back. It can do more, but your data goes to that assistant.

```
Settings → AI
┌───────────────────────────────────────────────┐
│ ON THIS PHONE                     ● Ready     │
│   Read messages Arth doesn't know   [switch]  │
│   12 waiting · Read now                       │
│   What else it does              ›            │  ← the per-job switches
├───────────────────────────────────────────────┤
│ WITH YOUR AI ASSISTANT                        │
│   Ask your AI assistant          ›            │  ← one request page (§4)
│   Ask about my money             ›            │  ← Export for AI
├───────────────────────────────────────────────┤
│ WHAT AI CHANGED                               │
│   26 Nov · Fixed 41 entries        Undo       │
│   22 Nov · Set up budgets          Undo       │
└───────────────────────────────────────────────┘
Waiting replies, formats and "same place?" pairs → Catch Up (§3)
```

- **On this phone** is today's On-device AI screen: status, download, the reading switch, the queue, "Read older messages too" and the job switches. The template offers move to Catch Up. Phones without Gemini Nano see one grey line, "This phone doesn't have Gemini Nano", so the AI row is now on every phone.
- **With your AI assistant** has two rows: the one request page (§4), and Ask about my money (Export for AI: a file to chat about, nothing comes back). After sharing, the request page shows a Paste button too, for anyone who'd rather paste there than in Catch Up. Both go to the same reader.
- **What AI changed** is the corrections history, which now also covers setup replies (§4). Merging a "Same place?" pair adds a row that opens Merchants. Nano's one-tap actions, like picking a category in Catch Up, don't add rows: you did each one by hand.

---

## 8. Fix my data becomes **Data health**

The top half of Fix my data was never AI, so it gets its own name and keeps its own row in Settings → Data:

- **Data health**: the tidy score and every problem Arth found, each row opening the screen that fixes it by hand. This is the same as today.
- One new row at the bottom: **"Fix it all with your AI assistant ›"** opens the request page with Fix my whole history picked.
- **Fixes done** moves to What AI changed (§7). Data health shows the last fix with a "See all" link.
- "Possible duplicates" in Settings' "Needs attention" list keeps pointing here.

Later, Nano could fix some health rows itself, such as "merchant names spelled several ways" (the merge job) and "uncategorised entries" (the category job), with "Fix on this phone" buttons on those rows. Out of scope here.

---

## 9. Onboarding uses the same two names

`setup-choice.tsx` keeps its three routes. Only the words change:

| Today | Proposed | Note |
|---|---|---|
| On this phone | **On this phone** (Recommended when Nano is ready) | Unchanged |
| AI assisted | **With your AI assistant** | Subtitle: "ChatGPT, Gemini or Claude. Arth makes a file, you paste the reply back." Opens the request page with Set up everything picked |
| I'll set it up myself | I'll set it up myself | Unchanged |

---

## 10. Names, one list

| Thing | One name used everywhere |
|---|---|
| Gemini Nano features | **On this phone** (section), "Read by AI" (the mark on transactions) |
| ChatGPT/Gemini/Claude round trips | **With your AI assistant**, "Ask your AI assistant" (the request) |
| The Settings row | **AI** |
| Arth's own checks | **Data health** |
| The applied-changes list | **What AI changed** |

"On-device AI", "AI-assisted setup", "AI suggestions", "Fix my data" and "On-device AI lab" stop appearing in the app. Search keeps the first four as keywords (`services/search-catalog.ts`), so typing an old name still finds the new place.

---

## 11. Order of work

1. **Names and the AI screen.** Move On-device AI's content in, and change the Settings rows. Today's setup and Fix my data screens are linked from it for now.
2. **Waiting cards in Catch Up.** The reply, format and merge cards. Template offers leave settings, and the Home card goes.
3. **Remove the lab.** Move `labRowToDetail` first, then delete. Update Phase 2 rule 6.
4. **One request, one format, one review.** §4, including Undo for setup replies and onboarding.
5. **Data health split, help article ("AI in Arth") and search keywords.** Remove the old routes the following release.

Each step ships on its own, and the app makes sense after each one.

---

## 12. Not changing

- How Nano reads, checks and queues anything. The rules in `docs/ON_DEVICE_AI_PHASE2_PROPOSAL.md` §0 stand, except rule 6's wording (§6).
- The checks each kind of change goes through (`docs/AI_SUGGESTIONS_PROPOSAL.md`, `docs/AI_CORRECTIONS_DESIGN.md`). They move into one reader, unchanged.
- Where AI results show in context: Catch Up marks, "Same place?" in Merchants, Month in words in Insights, and picture, voice and search help.
- Nothing is sent anywhere by Arth itself. The assistant half still means you sharing a file, by choice.

## 13. Still open

1. **The row name:** "AI" alone, or "AI and data health" with Data health inside it? This proposal keeps them apart because Data health works without any AI.
2. **Export for AI in Insights:** keep it there as a shortcut as well as in the AI screen, or only in the AI screen?

## 14. Progress

| Step | Status | What was built |
|---|---|---|
| 1. Names and the AI screen | Built | `app/settings/ai.tsx`: On this phone (status, reading switch, waiting count, link to the job switches), With your AI assistant (set up, fix my whole history, ask about my money, paste when a reply waits), What AI changed (last three, Undo). `app/settings/ai-history.tsx`: every applied fix with the list toolbar (search, filter by kind, undo state and month, sort newest / oldest / most changes, group by kind or month). One **AI** row in Settings replaces On-device AI and AI-assisted setup; Fix my data stays until step 5. Search finds the old names |
| 2. Waiting cards in Catch Up | Built | `services/catch-up-ai.ts` loads them; three card kinds in `services/catch-up.ts` and `CatchUpCardView`. Swipe right: Paste reply / Learn it / Merge. Second answers: Share the file again, Stop waiting for it, Not now, Not the same place. Each is held for Undo like every Catch Up action. Home's Action required card counts them ("from AI to check"); the AI Assisted Setup card is gone. Formats left the job switches page, which now links to Catch Up |
| 3. Remove the lab | Built | Lab screen, its runner, toast, preview page and test deleted. The row helper moved to `services/ai/ai-read-row.ts`. `ai_lab_unlocked` is deleted on start (`services/ai-removal.ts`). Phase 2 rule 6 reworded |
| 4. One request, one format, one review | Built | `app/settings/ai-request.tsx` (Ask your AI assistant): pick a focus (Set up everything, Fix my whole history, Tidy categories, Suggest a budget, Find what's missing, Read my unread messages), period, people's names and notes; share; paste; review; apply with a copy kept; Undo. One file (`buildFixExport` with `focus` and `period`), one format (`arth-corrections/2`: the three setup kinds joined `SHARED_TYPES`, so the corrections reader and apply take them), one instruction block (`buildCorrectionInstructions`, setup lines only when asked for). Old `{"suggestions": …}` replies are still read. Onboarding's AI route and "Set up on this phone" go through the same page, so setup gets Undo. `ai-assisted-setup` and `ai-suggestions` are redirects for one release. Fix my data keeps Data health and Fixes done, with one link to the request. `ai_request_focus` remembers what a waiting reply was asked for. The "Read my unread messages" focus is hidden while on-device AI reads messages |
| 5. Data health split, help article, search | Built | Settings row, screen title and search say **Data health**; it shows the latest fix with Undo and "See all" (What AI changed); the date bug (UTC day) is gone because it uses the shared history hook. Onboarding's route is **With your AI assistant**. New help article `ai-in-arth.md` (linked from the AI screen); `on-device-ai.md` and `export-for-ai.md` name the new places; index rebuilt. Still to do the release after: delete the `ai-assisted-setup` and `ai-suggestions` redirect routes |

Step 4 review fixes: setup files say unreviewed entries are real and keep net worth out; two formats for one bank are no longer merged into one; income, savings target, investments and goals always start unticked; a missing transaction lands on the account its fix_ref names; the done screen says what waits in the review queue; replies can come from a file; Paste reply reads the clipboard on arrival; Undo brings the waiting-reply card back.

Not checked on a phone yet.
