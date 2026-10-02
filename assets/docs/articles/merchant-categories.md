---
title: How Arth picks a category (and how to change it)
slug: merchant-categories
summary: Arth files transactions using built-in rules for 250+ common Indian merchants. See them, change any of them, add your own, or override them with Smart Rules.
tags: [categories, merchants, auto-categorize, built-in, rules, swiggy]
contextKeys: [settings-merchant-categories]
phrasings:
  - Why did Swiggy go to Food?
  - How does Arth choose a category?
  - Change the category for a merchant
  - Stop Arth putting Uber in Travel
  - Built-in merchant categories
  - Add my own merchant
  - Arth keeps choosing the wrong category
  - Undo what Arth learned
  - Merchant categories
---

When a transaction comes in from an SMS, Arth looks at the merchant name and files it into a category for you. You approve it in the review queue, so nothing is final until you say so.

## Built-in merchant rules

Arth ships with rules for **over 250 merchant keywords** common in India, plus about 230 extra spellings that bank SMS use for big brands (for example `PYU*Swiggy` or `AMZN*MKTPLACE`). A few examples:

| Category | Built-in keywords include |
|---|---|
| Food | swiggy, zomato, dominos, kfc, mcdonalds, starbucks |
| Grocery & Supplies | bigbasket, blinkit, zepto, instamart, jiomart, dmart |
| Shopping & Gifts | amazon, flipkart, myntra, ajio, meesho, nykaa |
| Travel & Going Out | uber, ola, rapido, makemytrip, irctc, redbus |
| Car & Vehicles | indian oil, hpcl, bpcl, shell, fastag |
| Subscriptions | netflix, hotstar, prime video, spotify, youtube premium |
| Health & Medicine | apollo, 1mg, pharmeasy, netmeds, practo |
| Rent & Utilities | electricity, bescom, tata power, piped gas, broadband |
| Insurance | lic, hdfc life, star health, acko |
| EMIs | emi, home loan, car loan, bajaj finance |

A rule matches when its keyword appears anywhere in the merchant name, so **swiggy** also matches "SWIGGY BANGALORE". If two rules match, the longer, more specific keyword wins, so **swiggy instamart** beats **swiggy**.

These are just starting points. If you eat out on Swiggy but buy groceries on it too, or you'd rather Uber went under Commute, change it.

## See and change the rules

**Settings → Automation → Merchant Categories** lists every rule:

- **Built-in**: shipped with Arth, unchanged.
- **Edited**: a built-in rule you changed or turned off.
- **Yours**: a merchant you added.
- **Category missing**: the rule points at a category you renamed away or hid. Tap it and pick a new category.

Tap a merchant to **change its category**, **turn the rule off**, or **reset it** to the built-in category. Tap **+** to add your own merchant, for example "kaur's kitchen → Food" or "bescom → Rent & Utilities".

When you change a transaction's category yourself, Arth also asks **"Always file Swiggy as Dining?"**. Tap **Always** and it adds the rule for you.

Renaming a category keeps its merchant rules attached. If you hide or delete a category that merchants still use, Arth offers to move them first.

## What Arth learns on its own

If you change the same merchant to the same category **3 times**, Arth starts filing it that way automatically. These learned habits are listed under the **Learned** filter on the same screen; tap **Forget** to undo one. Setting a rule for a merchant replaces anything Arth learned about it.

## Override everything with Smart Rules

For full control, use **Smart Rules** (Settings → Automation → Smart Rules). A Smart Rule always wins over the built-in rules, your merchant categories and anything Arth learned, and it can do more than set a category: match on amount, account or SMS text, add tags, split with someone, or auto-approve. For example: *IF merchant contains "swiggy" AND amount is over ₹1,000 THEN category is Dining Out*.

## The order Arth checks

1. **Smart Rules** you created
2. **What Arth learned** from your corrections (3 or more)
3. **Merchant categories**: built-in rules and the ones you added or changed
4. **Built-in brand spellings** for SMS codes like `PYU*` or `AMZN*`
5. Nothing matched: the transaction waits in your review queue as **Uncategorised**, so you can pick one
