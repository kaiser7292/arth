---
title: Export for AI Insights
slug: export-for-ai
summary: Make a clean copy of your finances to upload to an AI assistant like Claude, with no passwords, SMS text or full account numbers in it.
tags: [AI, export, Claude, ChatGPT, Gemini, insights, analysis, privacy, JSON, share]
contextKeys: [export-for-ai, insights-export-ai]
phrasings:
  - Use Arth with Claude
  - Use Arth with ChatGPT
  - Ask an AI about my spending
  - Export my data for AI
  - Is it safe to share my data with AI?
  - What is in the AI export file?
  - Are my passwords in the AI export?
  - Where did the AI assistant go?
  - Analyse my finances with AI
  - Share my transactions with an assistant
---

Export for AI Insights makes one small file with your finances in it, written so an AI assistant can read it properly. You upload the file to the assistant (Claude, ChatGPT, Gemini or another) and ask your questions there.

Arth itself never contacts an AI service. It only makes the file; you decide where it goes.

## Where to find it

**Home tab → Insights page → Explore → Export for AI Insights.**

## How to use it

1. Pick a **period** - this financial year, last financial year, the last 12 months, all time, or your own dates.
2. Switch the **sections** you want on or off.
3. Tap **Create file**. Arth shows how many transactions and accounts are in it and how big it is.
4. Tap **Save to phone** or **Share**, then upload the file in your AI assistant's chat and ask away.

Change any option and Arth throws the old file away, so the file you share always matches what's on screen.

## Let the AI suggest changes

Under **What do you want from the AI?** pick something other than "Just answer my questions" - tidy categories, suggest a budget, find missing payments, or read unread bank messages.

1. Tap **Share with AI** and pick your assistant's app. The file carries your request and tells the assistant exactly how to reply, so there is nothing to type. (Your request is also copied, in case the assistant's message box opens empty: long-press and paste.)
2. Send it. The assistant replies with a grey code block. Tap **copy** on it.
3. Back in Arth, tap **Paste AI reply**.
4. Arth lists what the assistant suggested, ticked. Untick anything you don't want, then tap **Apply**.

Nothing changes until you tap Apply. What Arth accepts is limited on purpose:

| Suggestion | What happens when you apply it |
|---|---|
| New category | The category is created |
| Merchant name | Different spellings of one merchant are merged |
| Merchant category | That merchant's past and future entries go to the category - the main tool |
| Single entry | One transaction is re-categorised, as an exception |
| Rule for exceptions | A Smart Rule, for patterns a merchant category can't express (such as an amount limit) |
| Budget | Set from this month to the end of the financial year |
| SMS template | Built on your phone from the parts the assistant pointed out, and tested on your unread messages first. Arth shows how many it reads; one that reads none isn't offered |
| Missing transaction | Sent to your review queue, never straight into your books |

The assistant cannot delete anything, or change the amount or date of a transaction. Anything Arth can't use is listed under **Why were some left out?** with the reason.

**Unread bank messages** are only shared if you switch that on. They go as received (one-time codes are skipped), because an assistant needs the real wording to work out the format.

## Setting up with AI

When you first set up Arth, the "Your accounts" step offers **Set up faster with AI**. It shares everything found so far, including entries still waiting for review. A **Finish setup with AI** card then waits on Home for the reply.

## What goes in

| Section | What it holds |
|---|---|
| Monthly summary | Spending, income, refunds, investments and loan payments for each month, plus your savings rate for the year |
| Transactions | Approved entries: date, amount, category, merchant, account, payment mode and tags |
| Accounts and balances | Account names, last 4 digits, month-by-month opening and closing balance, and transfers between your own accounts |
| Budgets | Budget against actual spend, by category and by month |
| Loans | Lender, rate, EMI, amount still owed, end date and prepayments |
| Investments and goals | Investment buckets, contributions and life milestones |
| Net worth | Assets and liabilities at the end of the period |
| Transaction notes | The notes you typed on entries - **off** unless you switch it on |
| Hisaab | Balances and entries with friends and family - **off** unless you switch it on |

The numbers are the ones Arth already shows you, so the assistant's answers should match the app.

## What never goes in

- The password vault
- SMS scan logs, and SMS text unless you switch on "Include unread bank messages"
- Broker and login credentials
- Full account numbers (only the last 4 digits)
- Deleted items, and anything still waiting in the review queue

## Privacy switches

- **Hide people's names** - Hisaab names become "Person 1", "Person 2". On by default.
- **Hide merchant names** - leaves only the category on each transaction. Off by default, because merchant names are what make most spending questions answerable.

> Once you share the file with an AI service, it is sent to that company's servers. Arth can't control it after that. Share only what you're comfortable with.

## Common situations

- **The file is too big for the assistant.** Pick a shorter period, or switch off sections you don't need.
- **The assistant's total doesn't match Arth.** Ask it to use the monthly summary figures in the file instead of adding up transactions. Refunds, investments and transfers between your own accounts are easy to double-count.
- **Can I restore from this file?** No. It is not a backup. Use [Backup and restore](backup-restore) for that.

An AI assistant's answers are not financial advice.

## Related

- [Insights and analytics](insights)
- [Reports](reports)
- [Your data stays on your phone](privacy-offline)
- [Backup and restore](backup-restore)
