---
title: Fixing merchant names
slug: merchant-aliases
summary: Rename cryptic SMS merchant strings into friendly names. Renaming once applies to future SMS and optionally to history.
tags: [merchants, aliases, cleanup, normalization, rename]
contextKeys: [expense-detail, merchant-aliases-list, review-queue]
phrasings:
  - Why does the merchant look weird?
  - What is PYU Swiggy Food?
  - AMZN MKTPLACE looks strange
  - Rename a merchant
  - Clean up merchant names
  - Make Swiggy show as Swiggy not the long string
  - Group same merchant under one name
  - Apply rename to past expenses
  - Merchant alias is not sticking
  - How do I see all my aliases?
---

Bank SMS often encode merchant names with payment-processor codes — `PYU*Swiggy Food`, `AMZN*MKTPLACE`, `InfoEBA*IPO LLOPP`, `PAYU-1234-MERCHANT`. These are ugly to read AND they break category learning, because every variant looks like a different merchant to Artha.

**Merchant aliases** map the raw string → a clean name you choose.

## Where to find aliases

- **Settings tab → Automation → Merchant Aliases** — the full list. Search, edit, delete.
- On any expense, tap the **Merchant** row to rename that expense's merchant directly.

## Rename from an expense

1. Tap an expense to open it.
2. Tap the **Merchant** row.
3. Type the clean name (e.g. "Swiggy").
4. Tap **Save**.
5. Artha asks: **"Apply to past expenses from the same source?"**
   - **Yes** — cleans your history in one go.
   - **No** — keep history as-is; only rename future SMS from this source.

The mapping is saved. Next time the same raw string arrives via SMS, it's renamed automatically.

## How automatic matching works

- Artha ships with **~200 pre-loaded aliases** for common Indian merchants (Swiggy, Zomato, Uber, Amazon, Netflix, Flipkart, Myntra, etc.).
- Your first rename seeds a user-level alias that **overrides built-ins** if they conflict.
- **Fuzzy matching** catches variants — `Swiggy Ltd`, `SWIGGY LIMITED`, `Swiggy Food Pvt Ltd` all resolve to the same canonical name.
- The raw text is stored separately (`raw_merchant_name`) so the original SMS content is never lost.

## Manage the alias list

**Settings tab → Automation → Merchant Aliases:**

- Search by clean name or raw source.
- Tap a row to edit the clean name.
- Tap the trash icon to delete an alias — future SMS from that source will show the raw string until you rename again.
- Use **Apply to past** from the row menu to back-apply an alias to every expense that matched the raw pattern.

## Common situations

**Amazon Pay showing as two separate merchants.** Uber sends both `UBER*rides` and `UBER*food` — these are different *services*, so you usually want them distinct. Rename one to "Uber Rides" and the other to "Uber Eats". Each gets its own clean name + category history.

**Rename didn't apply to my old expenses.** You tapped "No" on the apply-to-past prompt. Go to **Settings tab → Automation → Merchant Aliases → tap the alias → Apply to past** to back-fill now.

**Merchant is renamed but the category is still wrong.** Renaming is independent from category. After renaming, correct the category too. After **three** category corrections for the same merchant, Artha learns and auto-categorizes future expenses from that merchant.

**I want two merchants with the same raw string categorized differently.** Not supported — the alias is 1:1 (raw → clean). If you need different categories for the same merchant, use per-expense category correction or a smart rule with a sharper condition (e.g. `amount > 500`).

## Related

- [Categories and how they're decided](categories)
- [The review queue](review-queue)
