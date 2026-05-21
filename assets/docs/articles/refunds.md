---
title: Recording refunds
slug: refunds
summary: Log money that came back for a past expense. Refunds reduce the expense in your budget, insights, and totals.
tags: [refunds, credits, money-back, returns, refund-expense]
contextKeys: [expense-detail, refund-target-sheet]
phrasings:
  - How do I record a refund?
  - Money came back for an expense
  - Return from Amazon
  - Refund credited to a different account
  - Partial refund
  - Does a refunded expense still count in my budget?
  - Refund for a credit card purchase
  - Link a refund to an expense
  - Where do refunds show up?
---

A refund is money that came back for a past expense — a return from a shop, a service fee reversed, a duplicate charge refunded. Arth lets you log the refund against the original expense so everything stays linked.

## Why this matters

Refunded expenses don't count the same as normal spending:

- **Fully refunded** — treated as ₹0 in your budget, insights, category totals, yearly plan, and YoY comparisons. Still visible in your ledger, tagged with a green **Refunded** pill and the amount struck through.
- **Partially refunded** — only the remaining (unrefunded) amount counts. A ₹2,000 expense with a ₹500 refund counts as ₹1,500. Tagged with an amber **Partial Refund** pill.

This is automatic once the refund is linked. No config needed.

## Record a refund

1. Open the **original expense** — Transactions tab → tap it.
2. Scroll down to the **Record a Refund** action.
3. Arth asks **where the refund landed**:
   - **Same account** — credited back to the original card or wallet (common for card purchases).
   - **Different account** — refund came into a different account (e.g. original paid on credit card, refund went to savings).
4. If "Different", pick the target account from the picker.
5. The Add Expense screen opens, **pre-filled**:
   - **Amount** = original expense amount (edit down for a partial refund).
   - **Merchant** = same merchant.
   - **Description** = "Refund for: [original description]".
   - **Account** = your chosen destination.
   - **Category** = same category as the original.
6. Adjust the amount if partial. Tap **Save**.

The refund is saved as a `credit` row linked to the original expense. On the original, you'll see a **Refund of** line in the metadata and the Refunded / Partial Refund pill.

## Where refunds show up

- **On the original expense** — hero card shows the original amount struck through and the net cost below; metadata has a "Refund of" link.
- **Transactions tab** — the original row shows the pill + struck-through amount; the refund itself is a separate row with a green amount and a "+" prefix.
- **Budget / Insights / Yearly plan** — the effective amount (original − refunded) is what counts. Zero impact if fully refunded.
- **Account ledger** — both the debit (original) and credit (refund) appear; the running balance nets out correctly.

## Multiple refunds

You can record more than one refund against the same expense. Their amounts sum. If total refunds ≥ the original amount, the expense is treated as fully refunded.

## Common situations

**Amazon refunded ₹500 of a ₹2,500 order.** Record Refund → Same account (gift card or credit card used for the order) → change amount to 500 → Save. Original now shows as **Partial Refund**; ₹2,000 counts in your totals.

**I got a refund but the original expense isn't in Arth yet.** Log the original first (manually, or wait for its SMS), then record the refund against it. A refund without a linked original is technically possible but loses the pills and budget subtraction.

**Refund came to a different account (cashback moved to savings).** Record Refund → Different account → pick savings → Save. The credit row hits savings; budget still correctly subtracts from the original expense's category.

**The refund is going to inflate my savings balance — is that right?** Yes — that's what the bank did. The ledger math matches your real account balances. The budget / insights math is what subtracts the refund from spending totals.

**I accidentally linked the wrong refund.** Open the refund expense → Edit → change the "Refund of" target, or delete the refund entirely and re-record. Deleting the refund bounces the original back to its full amount in totals.

## Related

- [The review queue](review-queue)
- [Setting and tracking a budget](budget)
- [Reconciling a ledger](reconciliation)
