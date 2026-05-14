---
title: Split-tender purchases
slug: split-tender
summary: One purchase paid across up to three payment methods. Artha keeps all legs linked as one purchase.
tags: [split-tender, purchase, multi-card, checkout, multi-payment]
contextKeys: [expense-add, expense-detail, split-tender]
phrasings:
  - How do I record a purchase split across two cards?
  - Paid partly with gift card and partly with credit card
  - Multi-card checkout
  - Amazon order with two payment methods
  - Group expenses that belong to one purchase
  - Unlink a split-tender leg
  - Edit one leg of a split purchase
  - Convert standalone expense to split-tender
---

Split-tender is when **one purchase** was paid using more than one method. Classic examples: ₹600 of a ₹1,500 Amazon order with a gift card + the rest on a credit card. Or ₹2,000 paid on credit card + ₹500 in cash at a restaurant.

Artha treats each payment leg as its own expense but keeps them linked — you can see "this is one purchase across 3 payments" whenever you open any leg.

**Cap:** 3 legs per purchase.

## Where you'd use this

On any purchase where the total shown on the receipt was paid from more than one source.

## Create a split-tender

1. Tap **+** → **Add Expense**.
2. Enter the first leg's amount, account, payment mode.
3. Tap **+ Add payment method** (below the payment mode row).
4. Add leg 2's amount, account, payment mode.
5. Optionally add a 3rd leg the same way.
6. The running total shows the combined purchase amount.
7. Fill shared fields (merchant, category, description, date) — these apply to all legs.
8. Tap **Save Purchase**.

Each leg becomes a separate expense row in your Transactions list, but they share a **purchase group**. The list shows a small **Split** pill on each leg.

## Convert an existing expense to split-tender

If you already logged a ₹1,500 expense on one card but meant to split it:
1. Open the expense.
2. Tap **Edit**.
3. Tap **+ Add payment method**.
4. Enter the second leg's amount/account/mode.
5. Artha auto-subtracts from the first leg: if original was ₹1,500 and you entered a ₹500 second leg, the first leg becomes ₹1,000.
6. Tap **Update Purchase**.

## Open / edit a leg

1. Tap any leg in the expense list.
2. See **Siblings** card at the top — lists all legs of the same purchase.
3. Tap **Edit**. The save button reads **Update Purchase**.
4. Edits to shared fields (merchant, category, date, description) **propagate to all siblings** automatically.
5. Edits to leg-specific fields (amount, account, payment mode) stay on this leg only.

## Add a 4th leg — not allowed

Cap is 3. Adding a 4th errors. If you really need 4 sources, unlink one leg and log it as a separate expense.

## Unlink a leg

Turn a leg into a standalone expense:
1. Open the leg.
2. Edit → **Unlink from purchase**.
3. The group may now have 1 leg — if so, the purchase-group bookkeeping is automatically cleared.

## Delete a leg

Same as deleting any expense. The remaining siblings stay linked.

## Common situations

**"Amazon order with gift card + credit card — what to put?"**
Leg 1: gift card balance used, account = gift card wallet. Leg 2: card payment, account = the card. Merchant = Amazon. Category = whatever you're buying.

**"Can I split across hisaab + payment method?"**
No. Split-tender is for multi-payment, same-purchase. Hisaab-split is for shared spend with someone. An expense can be one but not both at once — pick the model that matches what actually happened.

**"Does each leg count in the budget?"**
Yes — each leg has its own amount and category. They sum to the total purchase amount; the budget sees each leg in whichever category you tagged them.

**"Duplicate detection flagged my legs as duplicates."**
Shouldn't happen — split-tender siblings are explicitly excluded from duplicate detection. If you see this, check that they all have the same `purchase_group_id` (open any leg and it should list siblings).

## Related
- Splitting with a person (different concept): [Hisaab — shared accounts](hisaab)
- How duplicate detection treats purchase groups: [Duplicate expenses](duplicate-detection)
