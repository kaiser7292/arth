# Motion System — Proposal

**Status:** proposal, not built. **Goal:** every screen in Arth moves the same calm, smooth way — screen changes, tabs, lists, sheets, numbers, charts and state changes — instead of content popping in.

Inspired by [Zajno's AI dashboard shot](https://dribbble.com/shots/23626522-Mobile-app-animation-for-the-AI-powered-marketing-tool-pt-2): numbers that count up, charts that build themselves, cards that arrive in sequence, a selector that glides, choices that fill when picked.

---

## Where Arth is today

| Area | Today |
|---|---|
| Screen to screen (130 screens) | Android's default; only onboarding slides |
| Switching tabs | Instant cut, no transition |
| Loading (66 screens) | Spinner, then everything pops in at once; skeletons on 3 screens only |
| Lists (26 screens) | Rows appear / disappear instantly; approve, delete and filter jump |
| Sheets (45 uses) | Already spring in and out — keep |
| Pop-ups (13 raw `Modal`s) | Android's plain pop-up window, no motion |
| Numbers and charts | Static |
| Old `LayoutAnimation` (5 places) | Legacy API, flaky on Android — replace |
| Catch Up / check-in decks | Swipe animation already — extend |

Already in place and reused: Reanimated 4.1, `MOTION` tokens (140 / 220 / 320 ms + one easing curve), `useReduceMotion()`. **No new libraries; the APK doesn't grow.**

---

## 1. Foundations (built once, used everywhere)

Small building blocks in `components/motion/`, so screens opt in with one line and every screen moves the same way.

| Building block | What it does | Where |
|---|---|---|
| **Motion tokens** | Adds spring presets (`gentle`, `snappy`) and a stagger step (60 ms) to `MOTION` | All animations read these |
| **`<Appear index>`** | Fades and lifts a card in; `index` staggers siblings by 60 ms. First appearance only | Cards on every screen |
| **`<AnimatedNumber>`** | Counts to a value (700 ms); a changed value glides from old to new | Hero totals and balances |
| **`<PressableScale>`** | Presses shrink to 97 % and spring back | Cards, rows, list items, chips |
| **`<SegmentedControl>`** | One selector with a gliding highlight | Spent/Received/Transfer, Investments chips, period tabs, filters |
| **`<Collapse>`** | Smooth expand / collapse | "More options", show SMS, closed accounts, sections |
| **`<CrossFade>`** | Skeleton → content cross-fade instead of spinner → pop | Every loading screen |
| **List transitions** | New rows slide in, removed rows fade out, the rest close the gap | Transactions, review queue, ledgers, templates |
| **Chart entrances** | Lines draw left → right, bands rise, bars grow in sequence, with the existing tap tooltip | TrendLine, StackedArea, TrendBar charts |
| **`ProgressBar` fill** | Bars fill to their value | Budgets, goals, buckets, share bars |
| **`<AnimatedModal>`** | Fade + scale for centred pop-ups | The 13 raw `Modal`s and the alert |

## 2. Navigation

- **Drilling in** (list → detail, card → screen): slide in from the right, the previous screen shifts slightly left. One setting in the shared stack options, so every stack matches onboarding.
- **Opening a task** (add expense, voice entry, pickers): slide up from the bottom, like a sheet.
- **Switching tabs**: a short cross-fade with a slight shift (`animation: 'shift'`). Today it's an instant cut.
- **Swipe pagers** (Home, Budget, Transactions pages): the page indicator glides with the swipe, instead of jumping when it ends.
- **Not now:** card-expands-into-screen (shared element transitions). Still behind a feature flag in Reanimated 4, so not ready for production.

## 3. Screen by screen

| Area | What moves |
|---|---|
| **Home** | Cards arrive in sequence on first open; balance totals count up; the review-queue count ticks; banners slide down; pager dots glide |
| **Transactions** | Rows slide in on first load (first screen only); approve / reject / delete close the gap; filter chips glide; search results cross-fade |
| **Catch Up & check-ins** | Next card rises from behind the current one; Undo slides the card back; the "done" screen counts up the summary; progress bar fills |
| **Budget** | Category bars fill; the spending split draws in; "over budget" gets a single gentle shake; month change cross-fades |
| **Investments** | Total counts up; the stacked chart rises band by band; the chip highlight glides; drilling into a category morphs the bands; share bars fill |
| **Demat & ledgers** | Balance header counts up; day rows slide in; edit opens inline smoothly; a new snapshot slides into place |
| **Goals & loans** | Progress rings and bars fill; health grade counts up; milestones arrive in sequence |
| **Forms & sheets** | Spent / Received / Transfer glides; "More options" expands smoothly; errors fade in under the field; Save shows a check before closing |
| **Pickers** | Picked rows tint and the tick pops; the Continue / Save button wakes up when ready |
| **AI assistant** | "Thinking" dots; replies fade in; suggestion chips arrive in sequence |
| **Onboarding** | Steps slide; choices fill; the welcome screen gets a slow drift of outlined shapes (₹, card, coin) |
| **Settings & Help** | Sections expand / collapse smoothly; toggles stay native; articles cross-fade in |
| **Toasts & alerts** | Toast slides up with a spring and slides away; alert pop-up fades and scales |

## 4. Rules

1. **First appearance only.** Arth reloads data whenever a screen regains focus; replaying entrances then would be tiring. Entrances play once per screen visit, and value changes glide.
2. **Reduce motion is respected everywhere.** With the phone's "Remove animations" on, everything appears instantly (already detected by `useReduceMotion()`; every building block checks it).
3. **Privacy mode never animates amounts.** Masked values stay `₹••••` with no count-up that could hint at size.
4. **Screen readers get the final value immediately**, never intermediate numbers.
5. **Only transform and opacity**, on the UI thread, so it stays smooth on mid-range phones. Long lists animate only the first screenful.
6. **Quick and quiet.** 140 ms for presses, 220 ms for small changes, 320 ms for screens, 700 ms max for count-ups and chart draws. No bounce on money.
7. **Haptics stay paired** with the actions that already have them (approve, reject, undo).

## 5. Rollout

Each phase ships as its own release so it can be felt on the phone before the next.

| Phase | Contents | Release |
|---|---|---|
| **1. Foundations + navigation** | Building blocks; screen, sheet and tab transitions; press feedback | 4.9.0 |
| **2. Home, Investments, Budget, Catch Up** | Count-ups, chart draw-ins, staggered cards, gliding selectors, filling bars, deck polish | 4.10.0 |
| **3. Lists, forms, loading** | List add/remove, skeleton cross-fades on the 66 spinner screens, form and picker feedback, `Modal` replacements | 4.11.0 |
| **4. Everything else** | Goals, loans, ledgers, settings, help, AI assistant, onboarding welcome | 4.12.0 |

**Testing:** each building block gets a preview-harness page (browser) and unit tests for its logic (first-appearance-only, reduce motion, privacy). Every phase is checked on the phone before release, since timing and smoothness can only be judged on a device.
