---
title: Auto-categorize with smart rules
slug: smart-rules
summary: Define IF/THEN rules that tag, categorize, or auto-approve expenses as they land. Runs before every other categorizer.
tags: [smart-rules, automation, categorize, rules, auto-approve]
contextKeys: [settings-smart-rules, smart-rule-detail]
phrasings:
  - What are smart rules?
  - Auto-categorize Swiggy as Food
  - Apply rule to every Amazon transaction
  - Auto-approve some expenses
  - Skip manual review for certain merchants
  - Bulk tag past expenses
  - How do rules differ from learned categorization?
  - Set rule by merchant name
  - Rule by amount range
  - Rule by account
---

Smart rules are explicit "IF this THEN that" rules you define once and Artha applies forever. They run before every other auto-detection — so they always win over learned mappings and built-in merchant aliases.

## Where to find them

**Settings tab → Automation → Smart Rules.** Tap **+** to create, tap a row to edit or delete.

## Anatomy of a rule

**Conditions (AND semantics — all must match):**
- **Merchant contains** — case-insensitive substring (e.g. "swiggy")
- **Merchant pattern** — advanced pattern matching for power users
- **Min amount** / **Max amount** — inclusive bounds
- **Account** — limit to expenses on a specific account
- **Payment mode** — limit to a specific mode (UPI, credit card, etc.)
- **SMS keyword** — only match SMS-parsed expenses whose raw body contains this text

You need at least one condition. Combine any.

**Actions:**
- **Set category** — force the expense's category
- **Set payment mode** — force the payment mode
- **Add tags** — attach tags (multiple allowed)
- **Override right-spend** — mark as unavoidable or discretionary
- **Auto-approve from review queue** — skip Review Queue and go straight into ledger (default: OFF per user safety)

## Create a rule

1. **Settings tab → Automation → Smart Rules → +**.
2. Name the rule (e.g. "Swiggy → Food").
3. Add conditions (at least one).
4. Add actions (at least one).
5. (Optional) **Retroactive apply** — see below.
6. Tap **Save**.

From now on, every new expense that satisfies the conditions has the actions applied. A small badge on the expense — "Categorized by rule: Swiggy → Food" — shows which rule fired.

## Retroactive apply

After saving a rule, you can apply it to existing expenses:
1. On the rule detail → tap **Apply to past 90 days**.
2. **Preview** shows: how many match, how many would be overwritten (already have a category/mode you'd clobber), how many would be skipped.
3. Decide: **Overwrite** (applies to all matches) or **Skip already-set** (only touches blanks).
4. Confirm. Runs in a single transaction.

## Rules vs learned mappings

Artha has two separate systems for auto-categorization. They don't conflict — smart rules run first, then learned mappings.

**Smart rule** — an explicit IF / THEN you write yourself.

- **How it's created** — you write it manually on the Smart Rules screen.
- **When it fires** — immediately on the very next matching expense.
- **What it can do** — set category, set payment mode, add tags, force is-right-spend, auto-approve from review queue.
- **Where to see it** — Settings tab → Automation → Smart Rules. Every rule is listed, editable, and deletable.
- **In backup** — yes, rules travel with your backup file.

**Learned mapping** — an invisible pattern Artha derives from your behaviour.

- **How it's created** — Artha creates one automatically after you correct the **same merchant** to the same category **3 times**.
- **When it fires** — on the 4th and later expenses from that merchant.
- **What it can do** — set category only. Can't touch tags, payment mode, or auto-approval.
- **Where to see it** — not exposed in the UI. It's internal.
- **In backup** — yes (the mapping is a side-effect of expense history, which is backed up).

**When to use which.** Smart rules are the fast path when you already know the pattern ("Netflix = Subscriptions, always"). Learning handles the long tail of merchants you don't bother to write rules for.

## Auto-approve with care

The **Auto-approve from review queue** action is powerful but risky — an auto-detected SMS matching your rule will skip manual review entirely. Default: OFF. Turn it on only for:
- Trusted vendors with stable SMS formats (Netflix, Spotify, a specific landlord)
- Fixed-amount recurrences where the parser can't go wrong

Auto-approval is per-rule. Leave it off for anything you want to eyeball.

## Common situations

**"I want Amazon expenses over ₹5,000 to be tagged 'Big Purchase'."**
Rule: merchant contains "Amazon" + min amount 5000 → action: add tag "Big Purchase".

**"Every UPI to my landlord should be Rent category, auto-approved."**
Rule: merchant pattern matching your landlord's name + payment mode = UPI → action: set category Rent + auto-approve ON.

**"I want to rebuild what Artha 'learned' — can I see it?"**
Learned mappings are internal. Smart rules are the visible, editable layer. Migrate important learned patterns into explicit rules.

**"Delete a rule — what happens to already-categorized expenses?"**
They stay categorized. Deleting a rule clears the "applied_rule_id" stamp on past expenses (so the badge disappears) but doesn't un-apply the categorization. Your historical truth is preserved.

**"Rule stopped working."**
Most common cause: the merchant name changed. Check the raw_merchant_name via **Other Info → Raw SMS** on an expense that should have matched. Update the rule's condition or add a merchant alias to normalize.

## Related
- Base auto-categorization (no rules): [Categories and how they're decided](categories)
- Clean merchant names first: [Fixing merchant names](merchant-aliases)
- Automation vs manual review: [The review queue](review-queue)
