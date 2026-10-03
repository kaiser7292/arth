# Smart SMS Templates — Looser, Smarter Proposal

**Status:** Proposal — awaiting owner review. No code written.
**Date:** 2026-10-03

---

## 0. How templates work today (checked in code)

| Piece | Today | Where |
|---|---|---|
| Building a template | Every character between tagged fields is kept **literally**. Only whitespace, links, long alphanumeric IDs, ₹/INR/Rs, commas and case are loosened (normalisation). Text before the first field is also literal; text after the last field is cut to 20 characters. | `compileTemplate()` in `services/sms/template-compiler.ts` |
| Effect | If the bank changes one word anywhere between your fields ("debited" → "spent", "Info:" → "Ref:"), the template stops matching and you need another one. | |
| Type | One fixed type per template: Expense / Credit / Refund. A bank's debit and credit messages need two templates. | `tx_type` on `sms_template_patterns` |
| Fields | Amount, account, merchant, date, balance, ref. No "from/to name" or "other account", so templates can't feed the new FD / own-account / SIP detection. | `FIELD_REGEX` |
| Testing | "Test against recent unrecognised SMS" is a button; last 30 days; no list you can act on. | `testPatternAgainstUnrecognised()` |
| After saving | Only **new** SMS use the template. Messages already sitting in Unrecognised stay there. | (no backlog step) |
| Unrecognised list | Grouped by sender + near-identical body, but each card is one message; no link to an existing template. | `app/settings/sms-templates/unrecognised.tsx` |
| Editing | The original tap positions aren't stored, so a template can't be re-tagged — only deleted and rebuilt. | `sample_sms` stored, spans not |

Templates only run when the built-in bank parsers don't recognise a message, and they're limited to the sender's bank (or the sender pattern you set). That stays.

---

## 1. Flexible matching — keep only the key words

**What you see:** a new **Match** setting on the tag screen: **Flexible (recommended)** / **Exact**. In Flexible, the SMS shows which words are *required* (outlined); everything else is greyed "can change". Long-press any word to make it required or optional.

**Logic** (`compileTemplate(input, { style: "flexible", requiredWords })`):
1. Normalise and map the taps exactly as today.
2. Split each gap of text between fields into words.
3. Keep, in order:
   - the **lead-in**: the last 2 words right before each field ("credited **inr**", "transfer **from**", "on") — they tell the regex where the field starts;
   - for **merchant / name / ref** fields, the **first word after** the field (so the capture knows where to stop);
   - any word you marked **required**.
4. Replace everything else with a bounded gap: `[\s\S]{0,120}?` (anything, up to 120 characters, as few as possible).
5. Drop the text before the first required word and after the last field.
6. Round-trip check against the sample, unchanged.

**Example** — your SBI message, tagged account, amount, date, name:
`Your A/C XXXXX790006 Credited INR 50,079.00 on 30/09/26 -Deposit by transfer from Mr. SOURAVBAID. Avl Bal …`
Today's regex needs every word. Flexible keeps `a/c … credited rs. {amount} on {date} … transfer from {name} .` — so "Credited." vs "Credited", "Deposit by transfer" vs "IMPS transfer", or a missing balance line all still match.

**Guard rails:**
- Must contain at least one required word of 3+ letters that isn't a currency word; otherwise "This would match too many messages — mark one more word as required."
- Flexible templates are always **limited to the sender** they were made from (sender pattern set automatically from the sample's DLT code, e.g. `SBIINB`). You can widen it.
- Existing templates stay Exact; "Make flexible" button on the template screen recompiles them (only possible for templates saved after this change, which store their taps — see §8).

## 2. Learn from two examples

**What you see:** after tagging, **Add another example** — pick from other unrecognised messages from the same sender (or paste one). Arth pre-tags it using your first template; you fix anything wrong. The screen then shows the words both messages share (kept) and the parts that differ (become "can change").

**Logic:**
- Both samples must have the same fields in the same order; if not: "These look like two different message formats — save them as two templates."
- For each gap between fields: longest common sequence of words between sample A's gap and sample B's gap → those words become required; the rest become bounded gaps.
- Result is validated against **both** samples (round-trip on each).
- Up to 3 examples. Stored in `samples` (§8).

## 3. Type from the words ("Auto")

**What you see:** Transaction type gets a new first option: **Auto — from the words** (default for new templates). Expense / Credit / Refund stay for messages without clear words.

**Logic** — new `inferDirection(normalizedBody)` in `services/sms/money-signals.ts`, used by the matcher when `tx_type = 'auto'`:
- Refund: `refund(ed)`, `reversal`, `reversed`, `cashback`.
- Money in: `credited`, `received`, `deposited`, `added to`, `cr\b`, `credit of`.
- Money out: `debited`, `spent`, `sent`, `paid`, `withdrawn`, `purchase`, `txn of`, `dr\b`, `debit of`.
- If both "in" and "out" words appear, the one closest **before the amount** wins ("Rs 500 **debited** from A/c … **credited** to Ramesh" → out).
- If none: treated as money out with confidence 0.3 (it lands in the review queue like every template match — nothing is auto-approved).

## 4. Read the messages you already have

**What you see:**
- While tagging, a live strip under the SMS: **"Reads 11 of 12 unrecognised messages from SBIINB · See list"** (updates half a second after each tap).
- After **Save**: "**Read 11 past messages now?** They'll go to your review queue." → **Read them** / **Not now**.

**Logic:**
- Live count: `testPatternAgainstUnrecognised` widened from 30 to **90 days** and scoped to the template's sender pattern; runs on the compiled pattern after each successful compile (debounced 500 ms).
- New `applyTemplateToBacklog(templateId, excludedSmsIds)` in `services/sms/user-sms-templates.ts`:
  1. Unrecognised `pending_sms` rows (`status = 'failed'`, `error_message = 'unrecognised'`, no expense) from the last 90 days whose sender matches the template.
  2. For each match not excluded: set the row back to `pending`, build the parsed result through the same matcher code as live scans (plus FD / name / SIP signals), then `createExpenseFromSms` — exactly the path a fresh SMS takes.
  3. Returns how many became transactions; all are `pending_review`.
- Runs in batches of 50 with progress, so a few hundred messages don't freeze the screen.

## 5. Start from a sender, grow existing templates

**What you see on Unrecognised:**
- Grouped by **sender** first: "**SBIINB** · 12 messages · newest 30 Sep" with **Teach this sender** and **Send to developer**.
- **Teach this sender** opens the tagger with the newest message and the rest of the group ready as extra examples (§2) and for the live count (§4).
- If you already have a template for that sender that doesn't read these messages: "**Close to your SBI template — add as an example**" → opens that template in add-example mode (§2), re-generalises it, saves over it.

**Logic:** group key = DLT code from the sender (`[A-Z]{4,}` after the prefix, already used by the matcher). "Close to" = a user template exists with the same sender pattern.

## 6. Two more fields

| Field | Captures | Used for |
|---|---|---|
| **From / to name** | "transfer from **Mr. SOURAVBAID**", "linked to mobile …-**SOURAV BAI**" | own-account transfer detection (your name in bank SMS) |
| **Other account** | "To A/c xxxx**0006**" | pairing transfers between your accounts |

Matcher sets `counterpartyName` / `counterpartyAcctLast4` from them, so templated banks get the same FD, own-account and SIP cards as built-in ones (the money-signal step already runs after template matches). "Guess it for me" also proposes them. No database change — fields live in the pattern.

## 7. Preview before saving

**What you see:** **Save** opens a sheet: every message the template would read (last 90 days, this sender), each with amount · name/merchant · date as Arth would read them, and a tick box. Untick wrong ones; if you untick any, Arth suggests "Mark a word as required to tell these apart" and highlights words that appear in the wrong ones but not the right ones.

**Logic:** unticked message ids are passed to `applyTemplateToBacklog` as `excludedSmsIds`. If unticked messages still match the final pattern, a warning stays on the sheet (future messages like them would also be read).

## 8. Data changes

**Migration 081** — `sms_template_patterns`:
| Column | Type | Purpose |
|---|---|---|
| `match_style` | TEXT NULL | `'flexible'` / `'exact'`; NULL = exact (all existing templates) |
| `required_words` | TEXT NULL | JSON array of normalised words you marked required |
| `samples` | TEXT NULL | JSON array of `{ body, spans }` — the examples and taps, so the template can be re-tagged, made flexible, or given more examples later |

Full checklist: migration with `PRAGMA table_info` guard, register in `migrations/index.ts`, `TABLE_SCHEMAS.sms_template_patterns`, test mocks. `tx_type = 'auto'` is a new value in an existing column (added to `TX_TYPE_ALIASES` handling).

## 9. Tests

- Compiler: flexible output for the 8 sample messages from 4.5.0 and the HDFC CC sample; matches a re-worded variant of each; doesn't match another bank's message; refuses a template with no required word; two-example generalisation keeps only shared words.
- `inferDirection` cases, including "debited … credited to" ordering.
- Integration (real SQLite): save → backlog read creates `pending_review` rows, exclusions skipped, FD/name signals applied; live count.
- Existing template tests unchanged (Exact path untouched).

## 10. Release plan

| Release | Contents | Why |
|---|---|---|
| **A** | §1 Flexible, §3 Auto type, §4 Live count + read backlog, §7 Preview, §8 migration | Biggest gain: fewer templates, and teaching one fixes the backlog |
| **B** | §2 Two examples, §5 Sender groups + add example, §6 Name / other-account fields | Builds on A's stored samples |

## Decisions (owner, 2026-10-03)

1. New templates default to **Flexible**.
2. Backlog look-back is a **setting** (30 / 90 / 180 / 365 days, default 90) on the Smart SMS Templates screen; it also sets the Unrecognised list's window.
3. New templates default to **Auto** type.

## Built (differences from the plan)

- `word_rules` replaces `required_words`: JSON `{required, optional}` — users can also free an automatic word, not only require one.
- Direction verbs (credited / debited / received / spent / sent / paid …) are interchangeable in flexible patterns and a joining word after them ("with", "for", "of", "by") is optional — otherwise a template built from a credit message wouldn't read the same bank's debit messages, which defeats Auto.
- Releases A and B shipped together.
