---
title: Categories and how they're decided
slug: categories
summary: How Arth auto-picks a category, how to correct it, and how smart rules make it stick.
tags: [categories, auto-categorize, learning, rules, smart-rules]
contextKeys: [expense-detail, categories-list, review-queue]
phrasings:
  - How is the category decided?
  - Why is this expense in the wrong category?
  - Auto-categorization is wrong
  - How do I correct a category?
  - Add a new category
  - Delete a category I don't use
  - Can I rename a category?
  - How does Arth learn my preferences?
  - Why didn't it learn after one correction?
  - Categories not in my list
  - Change category for many expenses at once
---

Categories classify your spending. Every expense can have one. Arth comes with a default set and you can add, rename, recolour, or delete any of them.

## Where to find them

- **Settings tab → Master Data → Categories** — the master list. Add, edit, reorder, delete.
- Individual expenses: tap the expense → tap the **Category** row to change it.

## How auto-categorization works

When an expense arrives (SMS or manual), Arth tries to assign a category:

1. **Smart rules** (Settings tab → Automation → Smart Rules) — user-defined IF/THEN rules. Runs first.
2. **Learned merchant rules** — after you manually set a category for the same merchant **3 times**, Arth remembers and auto-applies for that merchant going forward.
3. **MCC codes** (for SMS-parsed expenses) — merchant category codes embedded in some bank SMSes.
4. **Default bank/merchant mappings** — a small built-in list (e.g. Swiggy → Food, Netflix → Subscriptions).
5. **Fallback** — no category assigned. Expense shows up under "Uncategorized" in the Review Queue.

## Correct a category

1. Open the expense.
2. Tap the **Category** row.
3. Pick the right one → tap **Save**.

After three corrections for the same merchant, Arth stops getting it wrong for that merchant. You can see a "Categorized by rule: …" badge on expenses that a smart rule or learned mapping applied to.

## Bulk-categorize

1. **Home → Review Queue → Uncategorized filter chip** — shows every uncategorized expense.
2. Tap checkbox on each row (or **Select All**).
3. Tap **Assign Category to N Expense(s)** at the bottom.
4. Pick the category → done.

## Manage the category list

**Settings tab → Master Data → Categories:**
- **+** top-right to add. Pick a name, icon, colour.
- Tap a row to rename, change icon/colour, or delete.
- Long-press and drag to reorder.

## Common situations

**"Delete a category I don't use."**
Settings tab → Master Data → Categories → tap it → **Delete**. If any expenses are tagged with it, the delete is blocked. Reassign those expenses to another category first, or use the "Merge into…" option which re-tags them in bulk.

**"Why didn't it learn after one correction?"**
To avoid false learning from one-off merchants, Arth needs three corrections for the same merchant name before learning. Smart rules are the faster path — set an explicit rule once and it applies forever.

**"A merchant has two categories because the name varies (SWIGGY, Swiggy Food, PYU*SWIGGY)."**
Clean this up with merchant aliases: Settings tab → Automation → Merchant Aliases. Link all variants to one clean name. Then categorization learns against the clean name.

**"Import wasn't categorized."**
Excel import doesn't run smart rules by default (adjustable per row). After importing, use the bulk-assign flow in the Review Queue → Uncategorized.

## Related
- Automate with rules: [Auto-categorize with smart rules](smart-rules)
- Clean merchant names: [Fixing merchant names](merchant-aliases)
- Reviewing auto-detected expenses: [The review queue](review-queue)
