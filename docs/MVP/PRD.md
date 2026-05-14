# Artha (अर्थ) — Product Requirements Document (PRD)

**Version:** 0.1 (Draft)
**Author:** Sourav Baid + Claude
**Date:** 2026-04-12
**Status:** Draft — awaiting user review

---

## 1. Product Vision

**One-liner:** **Artha** — A smart, configurable personal finance app that automatically detects expenses from SMS and email, tracks budgets, sets and tracks financial goals (savings, investments, life milestones), manages family shared accounts ("hisaab"), and gives you a complete picture of where you stand financially — at any moment.

**Problem:** Managing personal finances in Excel spreadsheets is painful — you can't log expenses on the go, formulas break, there's no automation, no alerts, no multi-user access, and no intelligence about your spending patterns.

**Solution:** A mobile app (Android + iOS) that replaces the spreadsheet with:
- Automatic expense detection from bank SMS and emails
- Smart categorization that learns from your corrections
- Real-time budget tracking with alerts
- **Financial goal engine** — set savings targets, investment allocations, and life milestones; track progress in real-time with trajectory analysis and course-correction guidance
- Shared family ledgers ("hisaab") with invite-based access
- Configurable templates so anyone can set it up for their financial life

**Target Users:** Primarily Indian users who:
- Track household and personal expenses
- Share expenses with family members
- Want to replace spreadsheet-based finance tracking
- Have savings and investment goals

---

## 2. User Personas

### Primary: The Finance Tracker (You)
- **Who:** Working professional managing personal + family finances
- **Current tool:** Excel spreadsheets (2 files, 8 sheets, 1000+ rows)
- **Pain points:** Manual entry is tedious, can't update on the go, no automation, formula errors, no alerts
- **Wants:** Auto-detect expenses, real-time budget view, savings goal tracking, clean mobile interface

### Secondary: Family Member (e.g., Tarun, Parents)
- **Who:** Family member who shares expenses with the primary user
- **Current tool:** None — relies on the primary user to track everything
- **Pain points:** No visibility into the running balance, can't verify entries, relies on phone calls to reconcile
- **Wants:** See their hisaab balance, confirm credits/debits, add entries from their side

### Tertiary: New User (General Public)
- **Who:** Anyone wanting to track personal finances
- **Current tool:** Various apps or no system at all
- **Wants:** Easy onboarding with a sensible default template, quick expense logging, budget insights

---

## 3. Feature Set (Phased)

> **Universal Principle — Manual Override on Everything:**
> Every piece of data in the app — whether auto-detected from SMS, email, or entered automatically — MUST support three actions:
> 1. **Manual Add** — User can always create any entry by hand (expense, investment contribution, asset value, hisaab entry, etc.)
> 2. **Edit** — User can edit any auto-detected or manually entered record at any time (amount, category, date, description, any field)
> 3. **Delete** — User can delete any record, including auto-detected ones they approved earlier
>
> Auto-detection is a convenience layer, not a locked system. The user is always in full control. This applies to: expenses, investment contributions, asset values, liability balances, milestone progress, hisaab entries — everything.

> **Realized vs Forecast:**
> Inspired by cash management principles, every expense in the app has a **nature**: either **realized** (the transaction has happened — money has moved) or **forecast** (the transaction is expected but hasn't happened yet). Examples of forecasts: upcoming EMI due dates, credit card amount due reminders, standing instruction reminders. Forecasts are created automatically from reminder SMS messages and are visible separately from realized expenses. They do NOT count toward budget actuals. When the actual debit SMS arrives, the corresponding forecast is automatically matched and converted to realized. Users can also manually create, edit, or delete forecasts.

> **Unknown Category Fallback:**
> When the smart categorizer cannot match a merchant to any category, the expense is assigned to an **"Unknown"** category (visible with a distinct icon). This ensures no expense is invisible or category-less. Users can correct the category at any time — after 3 corrections for the same merchant, the system learns and auto-categorizes future transactions for that merchant.

### Phase 1: MVP — Smart Expense Tracking + Budget

| Feature | Description | Priority |
|---------|-------------|----------|
| **F1: Manual Expense Entry** | Quick-add expense with: amount, reason, category, payment mode. Swipe gestures for common entries. | P0 |
| **F2: SMS Auto-Detection (Android)** | Read bank/UPI transaction SMS, parse amount + merchant + date, create pending expense entry. | P0 |
| **F3: Email Auto-Detection** | OAuth connect to Gmail, scan for: (a) **Expenses** — bank transaction alerts, payment receipts, booking confirmations, subscription renewals; (b) **Investment data** — mutual fund NAV statements (CAMS/KFintech), SIP confirmations, brokerage trade confirmations (Zerodha/Groww/Angel), dividend credit alerts, FD maturity notices; (c) **Liability data** — credit card statements, loan EMI reminders. All auto-detected entries go to the review queue. User can always manually add, edit, or delete any entry. | P0 |
| **F4: Approve/Reject Queue** | Auto-detected expenses appear in a review queue. User can: approve as-is, edit (change category, amount, reason), or reject. | P0 |
| **F5: Smart Categorization** | Rule-based + ML categorization. "Swiggy" -> Food, "Shell" -> Car/Petrol, "Apollo Pharmacy" -> Medicine. User corrections improve accuracy over time. | P0 |
| **F6: Category-wise Monthly Budget** | Set monthly budget per category. Default template from existing Excel setup. Fully customizable. | P0 |
| **F7: Actuals vs Budget Dashboard** | Real-time view of spending per category vs budget. Color-coded (green/yellow/red). Shows "days left" and "per-day budget remaining." | P0 |
| **F8: Expense History** | Searchable, filterable list of all expenses. Filter by date range, category, payment mode, amount range. | P0 |
| **F9: Budget Alerts** | Push notification when: approaching 80% of category budget, exceeded category budget, weekly spending summary. | P1 |
| **F10: "Right Spend" Tagging** | Flag each expense as "Right Spend" yes/no (like your Excel column). Helps track unnecessary spending. | P1 |
| **F11: Configurable Categories** | Add/edit/delete expense categories. Custom icons and colors. Reorder priority. | P1 |
| **F12: Payment Modes** | Track which payment method was used (ICICI CC, AXIS CC, UPI, Cash, etc.). Configurable list. | P1 |
| **F13: Monthly Summary Report** | End-of-month summary: total spend, top categories, budget compliance, "right spend" ratio, comparison to last month. | P1 |
| **F13a: Full Backup & Restore** | Create a complete backup of ALL app data — expenses, budgets, goals, investments, milestones, hisaab, categories, payment modes, templates, settings, SMS/email parsing rules, merchant-category mappings. Backup is a single encrypted file (e.g., `.accmgr` or `.zip`) saved to device storage / Google Drive / iCloud Files. User can restore from backup on the same or a **different device** — this is the device migration path. No cloud sync needed; backup is the user's portable data. Supports: manual backup on demand, scheduled auto-backup (daily/weekly), backup to external storage (SD card, cloud drive as file — not cloud sync). | P0 |
| **F13b: Template Save & Share** | Users can save their current setup (categories, budget amounts, budget breakdowns, payment modes, unavoidable/discretionary classifications, investment bucket structure) as a **named template**. Templates can be: (a) saved locally for personal reuse, (b) exported as a shareable file (`.accmgr-template`) that another user can import into their app. The app ships with a default "Indian Professional" template, but users can create unlimited custom templates and switch between them. Use case: "I set up my finance structure perfectly — now I want my spouse/friend to use the same setup without configuring from scratch." | P1 |
| **F13c: Import from Excel** | Import existing Excel data (ACCOUNTS MANAGER + Estimations files) into the app. This bootstraps the user with 1+ year of expense history, budget structures, and goal data instead of starting from zero. Supports: (a) **Daily Expenses sheet** → creates Expense records with date, amount, category, payment mode, right spend flag; (b) **Forecast sheets** → populates budget amounts and investment bucket targets; (c) **Actuals sheets** → creates actuals entries if importing mid-year; (d) **Non Personal Expenses** → imports hisaab balances as initial balances. Format: user exports their Excel as `.xlsx`, app parses using a mapping wizard that lets user confirm column-to-field mappings before import. | P0 |
| **F13d: Fiscal Year Configuration** | Define the fiscal year for the app. Default: **Indian FY (April 1 - March 31)**. Configurable for other countries (Jan-Dec, Jul-Jun, etc.). All yearly plans, savings rates, YoY comparisons, and annual reports are tied to the configured fiscal year. Displayed as "FY 2026-27" format. | P0 |

### Phase 1B: Financial Goal Engine

This is the **strategic layer** — the "why" behind all the expense tracking. In your Excel, the entire Estimations file is essentially this: "Given my salary, my expenses, and my goals — am I on track?"

| Feature | Description | Priority |
|---------|-------------|----------|
| **F14: Yearly Financial Plan** | Set up an annual plan tied to the **fiscal year** (default: Indian FY, April 1 - March 31). Inputs: total yearly salary (in-hand), expected bonus, salary hike %, total planned expenses, planned investments, planned milestones. The app calculates: "Left After Complete Spend", surplus/deficit, and whether your goals are achievable. Supports multiple fiscal years — user can view FY 2025-26 actuals alongside FY 2026-27 plan. This is the master dashboard that ties everything together. | P0 |
| **F15: Savings Rate Goal** | Set a savings target as % of in-hand salary (e.g., 25%). App tracks your actual savings rate in real-time. Shows: target amount, actual saved so far, trajectory (on track / off track), and "extra savings per month needed to course correct" — exactly like your Excel's trajectory calculation. | P0 |
| **F16: Investment Goals** | Define investment allocation buckets with annual targets. Examples from your setup: Emergency Fund + FD (Rs 4.2L), Mutual Funds (Rs 72K), Precious Metals (Rs 1L), Equity (Rs 65K). Each bucket tracks: Goal / Done / Left. Contributions can be: (a) **auto-detected** from email (SIP confirmations, brokerage contract notes, CAMS/KFintech statements auto-populate the "Done" amount), or (b) **manually entered** by the user. All auto-detected contributions go through the review queue before counting. User can edit or delete any contribution at any time. Progress bar per bucket. | P0 |
| **F17: Life Milestone Goals** | Long-term goals that may span years: Engagement Ring (Rs 2L), Car Down Payment (Rs 7L), House Down Payment (Rs 38L), etc. Each has: target amount, amount accumulated, target date (optional), monthly contribution needed to hit target. Visual progress tracker. | P0 |
| **F18: Monthly Budget Compliance** | Real-time answer to: "If I continue spending at this rate for the rest of the month/year, what's my projected end state?" Calculates: projected total spend, projected savings, projected surplus/deficit. "Budget Left %" like your Excel. | P0 |
| **F19: Course Correction Alerts** | When trajectory goes off track, the app tells you: "You're Rs 21,337 behind your savings target. To get back on track, you need to save Rs X extra per month for the remaining Y months." Push notification when trajectory shifts significantly. | P1 |
| **F20: Unavoidable vs Discretionary Split** | Classify your monthly expenses as "unavoidable" (rent, electricity, food, EMIs = Rs 86.5K in your setup) vs "discretionary" (shopping, travel, gifts). Shows: monthly unavoidable baseline, discretionary budget available, max possible savings. | P1 |
| **F21: Year-over-Year Comparison** | Compare this FY's plan vs last FY's actuals. Shows growth in income, changes in expense patterns, whether savings rate improved. Helps with next year's forecast. | P2 |
| **F22: Goal Dashboard** | Single screen showing ALL goals at a glance: savings rate (gauge chart), investment buckets (progress bars), milestones (timeline view), yearly plan status (on track / off track). The "am I winning?" screen. | P0 |
| **F22a: Investment-Milestone Linking** | Link an investment bucket to a life milestone. Example: "House Fund" bucket (annual target Rs 7.6L) feeds the "House Down Payment" milestone (Rs 38L total). When a contribution is added to a linked bucket, the milestone's progress auto-updates. Milestone detail shows: direct contributions + contributions via linked buckets. Dashboard shows the linkage visually. A bucket can link to at most one milestone; a milestone can receive from multiple buckets. | P1 |

### Phase 1D: Income & Tax Planning

This phase adds salary/CTC breakdown and tax calculation — essential context for the yearly financial plan. Two modes: (1) CTC → in-hand calculator for salaried employees, (2) direct in-hand input for freelancers/business owners or those who just want to skip the tax math.

| Feature | Description | Priority |
|---------|-------------|----------|
| **F14a: Salary & Tax Calculator** | Two modes: **Mode 1 (CTC → In-Hand):** User enters annual CTC. App breaks it down: Basic (configurable % of CTC, default 40%), HRA (50% of Basic for metro, 40% non-metro), Special Allowance (remainder), Employer EPF (12% of Basic or restricted to Rs 1,800/month), Gratuity (4.81% of Basic). Then calculates taxable income under **both** New Tax Regime (default, FY 2025-26 slabs with Rs 75K standard deduction, Section 87A rebate up to Rs 60K) and Old Tax Regime (Rs 50K standard deduction, 80C/80D/HRA deductions). Shows side-by-side comparison. Adds surcharge (if applicable) + 4% Health & Education Cess. Subtracts Employee EPF + Professional Tax. Final output: monthly in-hand salary. **Mode 2 (Direct Input):** User enters monthly in-hand salary + annual bonus directly — no tax calculation, just stores the values. Both modes feed into the Yearly Financial Plan (F14). | P0 |
| **F14b: EPF Configuration** | Configure EPF calculation: (a) Full Basic — 12% of actual basic salary, or (b) Restricted — 12% of Rs 15,000 (= Rs 1,800/month statutory minimum). Toggle whether employer EPF is part of CTC or additional. VPF (Voluntary PF) optional input. Shows: employee contribution, employer contribution (EPF 3.67% + EPS 8.33%), total PF. | P1 |
| **F14c: Professional Tax & State** | Select state of employment. App applies correct professional tax rate (e.g., Maharashtra Rs 2,500/year, Karnataka Rs 2,400/year, Delhi Rs 0). Deducted from monthly in-hand. | P1 |
| **F14d: Capital Gains Reference** | Informational reference for investment tracking: LTCG on equity 12.5% (above Rs 1.25L exempt), STCG on equity 20%, debt MFs taxed at slab rate (post-Apr 2023). Not a calculator — just reference data shown on investment screens and used in future Phase 4 asset tracking. | P2 |

### Phase 2: Family Hisaab (Local)

| Feature | Description | Priority |
|---------|-------------|----------|
| **F23: Family Hisaab Ledger** | Running account with each family member. Shows all debits (you paid for them) and credits (they paid you back). Running balance. All data stored locally — primary user manages all entries. | P0 |
| **F24: Hisaab Export & Share** | Export a person's hisaab as a clean PDF or formatted text. Share via WhatsApp/email so the family member can see their running balance and verify entries. This replaces cloud-based "invite" — the primary user shares a snapshot, family member reviews and flags discrepancies via chat. | P0 |
| **F25: Shared House Expenses** | Track shared household expenses (electricity, broadband, etc.). Split rules (equal, percentage, fixed amounts). Auto-calculate each person's share. | P1 |
| **F26: Credit/Settlement Tracking** | When family member sends money back, log it as a credit. GPay/bank transfer confirmation can auto-detect credits (via SMS/email). Manual add/edit/delete always available. | P1 |
| **F27: Hisaab Reminders** | Local reminders: "Tarun's balance is Rs 15,000 — send a summary?" Monthly hisaab summary generation. No push to other devices (local only). | P2 |

### Phase 3: Assets, Liabilities & Net Worth

| Feature | Description | Priority |
|---------|-------------|----------|
| **F28: Asset Tracker** | Track all assets in one place. **Auto-populated from email:** mutual fund portfolio values (CAMS/KFintech statements), brokerage holdings (Zerodha/Groww/Angel contract notes), FD maturity values, dividend credits. **Manual entry required for:** bank account balances, cash on hand, digital wallet balances (Paytm, Amazon Pay), real estate, lent cash, physical assets. Each asset supports: manual add, edit, delete, and value history over time. Auto-detected values go through review queue before updating. | P1 |
| **F29: Liability Tracker** | Track credit card dues, loans (like your AXIS PL). **Auto-populated from email:** CC statement summaries (total due, min due, due date, utilization %), loan EMI reminders (outstanding principal, next EMI date). **Manual entry for:** informal debts, advances, or liabilities without email trails. All values editable and deletable. Auto-detected values go through review queue. Shows: outstanding amount, credit limit, utilization %. | P1 |
| **F30: Net Worth Dashboard** | Total assets - total liabilities. Trend over time. Monthly snapshot. Breakdown by asset/liability type. | P1 |

### Phase 4: Advanced Intelligence

| Feature | Description | Priority |
|---------|-------------|----------|
| **F31: Spending Insights** | AI-generated insights: "You spent 40% more on Food this month compared to last month." "Your Travel spending is trending above budget." | P2 |
| **F32: Forecast Engine** | Based on spending history, predict end-of-month spend per category. Alert if on track to exceed budget. | P2 |
| **F33: Recurring Expense Detection** | ~~Phase 4~~ **Moved to Phase 2 Task 11.7** (SMS-based detection from expense patterns). Phase 4 adds email-based and amount-pattern detection enhancements. | P2 |
| **F34: Multi-Currency Support** | Log expenses in foreign currency (USD, MYR, OMR) with auto-conversion to INR. Markup/GST tracking. | P2 |
| **F35: Export to Excel** | Export all data back to Excel format for users who want it. | P3 |
| ~~**F36: Import from Excel**~~ | **Moved to Phase 1 as F13c.** | — |

### Phase 5: Wedding & Special Events (Future)

| Feature | Description | Priority |
|---------|-------------|----------|
| **F37: Event Budget Planner** | Template-based budget for events (wedding, trip, etc.) with component-wise tracking. | P3 |
| **F38: Shared Event Budget** | Multiple contributors to an event budget (Sourav's side + Aastha's side). | P3 |

---

## 4. Screen Inventory (MVP)

### 4.1 Onboarding Screens
1. **Welcome Screen** — App intro with key value props
2. **Template Selection** — Choose a default template or start blank
3. **Permission Request** — SMS permission (Android), Email OAuth, Notification permission
4. **Category Setup** — Review/customize default categories
5. **Budget Setup** — Set monthly budgets per category (pre-filled from template)
6. **Payment Mode Setup** — Add your cards, UPI handles, wallets

### 4.2 Main App Screens
7. **Home Dashboard** — Month summary: total spent, budget remaining, category breakdown donut chart, recent transactions, quick-add button
8. **Expense List** — Chronological list of all expenses. Filters: date, category, mode, amount. Search bar.
9. **Add Expense (Manual)** — Amount, reason/description, category (smart suggestions), payment mode, date, "right spend" toggle
10. **Review Queue** — Auto-detected expenses awaiting approval. Swipe right to approve, left to reject, tap to edit.
11. **Budget View** — Category-wise budget vs actuals. Progress bars. Tap into a category to see its transactions.
12. **Category Detail** — All transactions in one category for the current month. Monthly trend chart.

### 4.3 Goal Screens
13. **Goal Dashboard** — The "am I winning?" screen. Shows at a glance: savings rate gauge (actual vs target), investment bucket progress bars, milestone timeline, yearly plan status (on track / off track / how far off).
14. **Yearly Financial Plan Setup** — Input: annual salary, expected bonus, hike %, then define investment allocations and milestone allocations. App calculates: total available, total planned, surplus/deficit.
15. **Investment Goal Detail** — One investment bucket (e.g., Emergency Fund). Shows: target amount, contributed so far, remaining, monthly contribution history, projected completion date.
16. **Milestone Detail** — One life milestone (e.g., Car Down Payment). Shows: target amount, saved so far, % complete, monthly contribution needed, projected completion.
17. **Savings Rate Tracker** — Monthly view: target savings % vs actual savings %. Trend chart. Course correction calculation: "Save Rs X extra/month to get back on track."
18. **Unavoidable vs Discretionary** — Pie chart showing baseline unavoidable costs vs discretionary spending vs savings. Helps answer: "How much can I actually control?"

### 4.4 Settings & Configuration
19. **Settings** — Profile, notifications, permissions, data export, dark mode
20. **Categories Management** — Add/edit/delete categories, set icons/colors
21. **Payment Modes** — Add/edit payment methods
22. **Budget Configuration** — Edit monthly budgets with granular breakdown support
23. **SMS/Email Configuration** — Manage connected email accounts, SMS parsing rules
24. **Template Management** — Save current setup as named template, export as `.accmgr-template` file for sharing, import templates from file, switch between templates
25. **Backup & Restore** — Create full backup (encrypted `.accmgr` file), choose storage location (device/Google Drive/iCloud Files), restore from backup file, auto-backup schedule (daily/weekly), backup history

### 4.5 Phase 2 Screens (Hisaab)
26. **Hisaab List** — All family members with their running balance
27. **Hisaab Detail** — Ledger view for one person (all debits and credits, running total). Edit/delete any entry.
28. **Add Hisaab Entry** — Log an expense on someone's behalf or record a credit received
29. **Hisaab Export** — Generate PDF or formatted summary for a person's hisaab. Share via WhatsApp/email.

---

## 5. Data Model

### 5.1 Core Entities

```
User
  - id (UUID)
  - name
  - email
  - phone
  - created_at
  - settings (JSON: currency, theme, notification preferences, fiscal_year_start_month [default: 4 for April])

Category
  - id (UUID)
  - user_id (FK)
  - name (e.g., "Food", "Car & Vehicles", "Medicine")
  - icon
  - color
  - sort_order
  - is_active (boolean)

PaymentMode
  - id (UUID)
  - user_id (FK)
  - name (e.g., "ICICI CC", "AXIS CC", "Cash", "GPay")
  - type (enum: credit_card, debit_card, upi, cash, wallet, bank_transfer)
  - is_active (boolean)

Expense
  - id (UUID)
  - user_id (FK)
  - amount (decimal)
  - currency (default INR)
  - fx_rate (nullable, for foreign expenses)
  - reason / description
  - category_id (FK)
  - payment_mode_id (FK)
  - date
  - is_right_spend (boolean, nullable)
  - source (enum: manual, sms_auto, email_auto)
  - status (enum: approved, pending_review, rejected)
  - nature (enum: realized, forecast — default: realized)
  - due_date (date, nullable — only set for forecast entries, the date the payment is expected)
  - account_id (FK to FinancialAccount, nullable — auto-linked from SMS card/account info)
  - refund_of_expense_id (FK to Expense, nullable — links refund to original expense)
  - raw_source_text (nullable — the original SMS or email snippet)
  - created_at
  - updated_at

FinancialAccount
  - id (UUID)
  - user_id (FK)
  - account_identifier (last 4 digits of card/account — "3001", "7249")
  - bank_name ("ICICI Bank", "HDFC Bank", etc.)
  - account_type (enum: savings, credit_card, loan, wallet)
  - account_label (user-editable nickname, nullable)
  - credit_limit (CC only, nullable)
  - last_known_balance (last available balance from SMS)
  - last_balance_date (when balance was last updated)
  - total_due (CC: total amount due)
  - min_due (CC: minimum amount due)
  - due_date (CC: payment due date)
  - is_active (boolean)
  - discovered_from_sms (boolean)
  - has_nach_mandate (boolean — auto-debit mandate detected)
  - nach_merchant (merchant name for NACH mandate)
  - nach_amount (amount for NACH mandate)
  - created_at
  - updated_at

RecurringTransaction
  - id (UUID)
  - user_id (FK)
  - merchant_normalized (normalized merchant name)
  - amount (typical recurring amount)
  - frequency (enum: weekly, monthly, quarterly, yearly)
  - category_id (FK, nullable)
  - account_id (FK to FinancialAccount, nullable)
  - last_seen_date
  - next_expected_date (predicted next occurrence)
  - occurrence_count (how many times detected)
  - is_active (boolean)
  - is_confirmed (user-confirmed as recurring)
  - created_at
  - updated_at

Budget
  - id (UUID)
  - user_id (FK)
  - category_id (FK)
  - month (YYYY-MM)
  - amount (decimal)
  - notes (nullable — for breakdown details)

BudgetBreakdown (for granular first-principles budgets)
  - id (UUID)
  - budget_id (FK)
  - line_item (e.g., "Petrol Cost", "Car Wash", "Service")
  - formula / calculation (text description)
  - amount (decimal)
```

### 5.2 Hisaab Entities (Phase 2)

```
HisaabPerson
  - id (UUID)
  - owner_user_id (FK — who created this hisaab)
  - name
  - phone (nullable)
  - email (nullable)
  - linked_user_id (FK, nullable — if they've joined the app)
  - initial_balance (decimal — to import historical balance)

HisaabEntry
  - id (UUID)
  - hisaab_person_id (FK)
  - amount (decimal, positive = they owe you, negative = credit/repayment)
  - reason / description
  - date
  - status (enum: confirmed, pending, disputed)
  - created_by_user_id (FK)
  - confirmed_by_user_id (FK, nullable)
  - created_at

HouseholdExpense (shared expenses)
  - id (UUID)
  - user_id (FK)
  - description (e.g., "Godown Electricity")
  - amount (decimal)
  - month (YYYY-MM)
  - category (e.g., "electricity", "broadband", "maintenance")
```

### 5.3 Goal Engine Entities (Phase 1B)

```
YearlyPlan
  - id (UUID)
  - user_id (FK)
  - financial_year (e.g., "2026-27")
  - annual_salary_in_hand (decimal)
  - expected_bonus (decimal, nullable)
  - salary_hike_pct (decimal, nullable — for next-year projection)
  - total_planned_expenses (decimal — sum of all monthly budgets * 12)
  - total_planned_investments (decimal — sum of all investment bucket targets)
  - total_planned_milestones (decimal — sum of milestone contributions for the year)
  - savings_rate_target_pct (decimal — e.g., 25.0)
  - notes (text, nullable)
  - created_at
  - updated_at

InvestmentBucket
  - id (UUID)
  - yearly_plan_id (FK)
  - name (e.g., "Emergency Fund + FD", "Mutual Funds", "Precious Metals", "Equity")
  - annual_target (decimal — goal amount for the year)
  - current_contributed (decimal — sum of all contributions so far)
  - linked_milestone_id (FK, nullable — links to LifeMilestone; contributions auto-update milestone progress)
  - sort_order (int)
  - is_active (boolean)

InvestmentContribution
  - id (UUID)
  - investment_bucket_id (FK)
  - month (YYYY-MM)
  - amount (decimal)
  - notes (nullable)
  - date

LifeMilestone
  - id (UUID)
  - user_id (FK)
  - name (e.g., "Car Down Payment", "House Down Payment", "Engagement Ring")
  - target_amount (decimal)
  - current_saved (decimal)
  - target_date (date, nullable)
  - monthly_contribution_planned (decimal — calculated or user-set)
  - is_completed (boolean)
  - completed_date (date, nullable)
  - sort_order (int)

MilestoneContribution
  - id (UUID)
  - life_milestone_id (FK)
  - month (YYYY-MM)
  - amount (decimal)
  - date

UnavoidableBaseline
  - id (UUID)
  - user_id (FK)
  - category_id (FK)
  - monthly_amount (decimal — e.g., Rent = 26150, EMI = 0)
  - is_unavoidable (boolean — true = unavoidable, false = discretionary)
  - notes (nullable)

SalaryProfile (Phase 1D)
  - id (UUID)
  - yearly_plan_id (FK)
  - input_mode (enum: ctc, direct — "ctc" = CTC breakdown, "direct" = in-hand input)
  - annual_ctc (decimal, nullable — only for ctc mode)
  - basic_pct (decimal, default 40 — % of CTC allocated to Basic)
  - hra_pct (decimal, default 50 — % of Basic for HRA; 50 metro, 40 non-metro)
  - is_metro (boolean, default true — affects HRA exemption in old regime)
  - epf_mode (enum: full_basic, restricted — "full_basic" = 12% of actual Basic, "restricted" = 12% of Rs 15,000)
  - epf_in_ctc (boolean, default true — employer EPF is part of CTC)
  - vpf_monthly (decimal, default 0 — voluntary PF per month)
  - tax_regime (enum: new, old — default "new")
  - professional_tax_annual (decimal, default 2400)
  - state (text, nullable — e.g., "Maharashtra", "Karnataka", "Delhi")
  - deductions_80c (decimal, default 0 — only for old regime)
  - deductions_80d (decimal, default 0 — health insurance, old regime)
  - hra_exemption_annual (decimal, default 0 — calculated or user-input, old regime)
  - home_loan_interest (decimal, default 0 — Section 24b, old regime)
  - other_deductions (decimal, default 0 — old regime catch-all)
  - computed_monthly_in_hand (decimal — calculated output)
  - computed_annual_tax (decimal — calculated output)
  - created_at
  - updated_at
```

**Goal Trajectory Calculations (computed, not stored):**
- `actual_savings_rate` = (income_received - total_expenses) / income_received * 100
- `savings_on_track` = actual_savings_rate >= savings_rate_target_pct
- `course_correction_per_month` = (target_savings - actual_saved) / remaining_months
- `projected_year_end_savings` = actual_saved + (avg_monthly_savings * remaining_months)
- `budget_left_pct` = (total_planned_expenses - total_actual_expenses) / total_planned_expenses * 100

### 5.4 Financial Tracking Entities (Phase 3)

```
Asset
  - id (UUID)
  - user_id (FK)
  - name (e.g., "ZERODHA PORTFOLIO", "SBI SAVINGS A/C")
  - type (enum: brokerage, mutual_fund, bank_account, cash, wallet, deposit, lent_cash, other)
  - current_value (decimal)
  - linked_investment_bucket_id (FK, nullable — links to InvestmentBucket for goal tracking)
  - last_updated

Liability
  - id (UUID)
  - user_id (FK)
  - name (e.g., "AXIS PL", "ICICI CC")
  - type (enum: credit_card, personal_loan, home_loan, car_loan, other)
  - outstanding_amount (decimal)
  - credit_limit (nullable — for CCs)
  - last_updated
```

---

## 6. Auto-Detection Architecture

### 6.1 SMS Parsing (Android Only)

**How it works:**
1. App requests SMS read permission on Android
2. Background service monitors incoming SMS
3. SMS parser identifies bank/UPI transaction messages using regex patterns
4. Parses: amount, merchant name, card/account, transaction type (debit/credit), date
5. Creates a pending `Expense` record (status: `pending_review`)
6. Sends push notification: "New expense detected: Rs 500 at Swiggy via ICICI CC"

**Indian bank SMS patterns to support:**
- ICICI: "INR 500.00 debited from A/c **1234 on 12-Apr-26 to VPA sourav@upi"
- HDFC: "Rs.500.00 has been debited from account **1234 for VPA sourav@upi"
- SBI: "Your a/c X1234 debited by Rs.500.00 on 12Apr"
- Axis: "INR 500 spent on Axis Bank Credit Card **1234 at SWIGGY"
- UPI: "Rs.500 debited from A/c linked to VPA sourav@upi"
- Paytm/PhonePe/GPay notification patterns

**Key challenge:** Each bank has a different SMS format. We'll need a library of regex patterns + a fallback general parser.

**Forecast Detection from SMS:**
Not all bank SMS represent completed transactions. Some are reminders about future payments:
- Standing instruction reminders ("Payment of INR 199.00 towards NETFLIX is due by 09/04/2026")
- Credit card amount due notices ("Amount Due Rs.937 on HDFC Bank Credit Card 8957. Pay by 21/APR/2026")
- EMI due reminders ("EMI of INR 22317.00 for Axis Bank Loan A/c XX7249 is due on 10-04-26")

These create **forecast** entries (nature: forecast) with the parsed due_date. When the corresponding actual debit SMS arrives later, the app auto-matches and converts the forecast to a realized expense.

OTP messages continue to be skipped (never create any entry).

**Bank Pattern Coverage:**
The SMS parser supports 50+ regex patterns across 20+ Indian banks and payment platforms:
- **Major banks:** ICICI, HDFC, SBI, Axis, Kotak, IDFC First, Federal, Citi, HSBC, AU Small Finance, RBL, Amex, PNB, Bank of Baroda, Yes Bank, IndusInd
- **UPI/Wallets:** Google Pay, PhonePe, Paytm
- **Transaction types (14):** debit, credit, emi, standing_instruction, payment_received, standing_instruction_reminder, emi_reminder, amount_due_reminder, refund, nach_debit, nach_bounce, upi_credit, upi_debit, balance_inquiry

**Financial Account Discovery from SMS:**
Every parsed SMS that includes a card/account identifier (last 4 digits) and bank name automatically creates or updates a `FinancialAccount` entry. This builds a registry of the user's accounts over time — purely from SMS, no manual setup needed. For credit cards, the parser also extracts credit limit and available limit from balance/limit alert SMS. For bank accounts, available balance is captured from transaction confirmation SMS.

**Refund Detection:**
Refund SMS (e.g., "Refund of Rs.500 credited to Card XX3001") creates a realized expense with negative semantic. The system searches recent expenses (30 days) for the same amount + card to link the refund to the original debit via `refund_of_expense_id`.

**NACH/Auto-Pay Detection:**
NACH debit SMS ("NACH debit of Rs.X from A/c XX1234 towards MERCHANT") creates a realized expense and updates the account's NACH mandate info. NACH bounce SMS are flagged but don't create expenses.

**Recurring Transaction Detection:**
After a user approves expenses, the system periodically scans approved expenses grouped by normalized merchant + approximate amount. When 2+ occurrences are found with consistent intervals, a `RecurringTransaction` entry is created with predicted next occurrence date. Users can confirm or dismiss detected recurring transactions.

### 6.2 Email Parsing

**How it works:**
1. User connects Gmail via OAuth 2.0
2. App periodically checks for new emails (or uses Gmail push notifications)
3. Email parser identifies **three types of financial data:**

**Type A — Expense Detection (creates pending Expense):**
- Bank transaction alerts
- Credit card statements (itemized spend)
- Booking confirmations (MakeMyTrip, Cleartrip, Airbnb, etc.)
- Subscription renewal emails (Netflix, YouTube Premium, etc.)
- Delivery/payment confirmations (Amazon, Swiggy, Zomato)

**Type B — Investment & Portfolio Detection (creates pending InvestmentContribution or updates Asset):**
- **CAMS / KFintech consolidated MF statements** — monthly/quarterly portfolio snapshots with fund-wise NAV, units held, current value. Parsed into: fund name, units, NAV, current value, gain/loss
- **SIP confirmation emails** — "Your SIP of Rs 6,000 in HDFC Flexi Cap Fund has been processed." Parsed into: amount, fund name, date → creates InvestmentContribution entry
- **Brokerage trade confirmations** — Zerodha/Groww/Angel contract notes. Parsed into: stock/MF name, quantity, buy/sell, amount
- **Dividend credit alerts** — "Dividend of Rs 500 credited to your account from XYZ Fund." Parsed into: amount, source, date
- **FD maturity / renewal notices** — "Your FD of Rs 2,00,000 is maturing on 15-May-26." Parsed into: amount, maturity date, bank

**Type C — Liability Detection (creates pending Liability update):**
- Credit card statement summaries — total due, minimum due, due date, credit limit, utilization
- Loan EMI reminders — EMI amount, outstanding principal, next due date

4. All auto-detected entries go to the **review queue** (same approve/edit/reject flow as expenses)
5. User can always manually add, edit, or delete any entry — auto-detection is a convenience, not a lock

**Supported email sources (initial):**

| Category | Sources |
|----------|---------|
| **Bank transactions** | ICICI, HDFC, SBI, Axis transaction alerts |
| **Credit cards** | CC statement emails (all major banks) |
| **UPI** | UPI payment confirmations |
| **E-commerce** | Amazon, Flipkart order confirmations |
| **Food delivery** | Swiggy, Zomato |
| **Travel** | MakeMyTrip, Cleartrip, IRCTC, airline bookings |
| **Mutual Funds** | CAMS, KFintech consolidated statements, AMC SIP confirmations |
| **Brokerage** | Zerodha, Groww, Angel One contract notes |
| **Dividends** | Dividend credit notifications from banks/AMCs |
| **Fixed Deposits** | FD maturity/renewal alerts from banks |
| **Loans/EMIs** | EMI reminders, loan statement emails |

**What email CAN'T capture (needs manual entry):**
- Current bank account balances (no email for this — must enter manually or via bank API in future)
- Cash transactions
- Wallet balances (Paytm, Amazon Pay)
- Real estate / physical asset values
- Lent cash or informal loans

### 6.3 Smart Categorization

**Approach: Hybrid (Rules + Learning)**

**Layer 1 — Rule-based (immediate):**
- Merchant keyword mapping: "Swiggy" -> Food, "Shell" -> Car/Petrol, "Apollo" -> Medicine
- Pre-built rules for 200+ common Indian merchants/services
- User can add custom rules

**Layer 2 — User-trained (over time):**
- Every time user corrects a category, the correction is stored
- After N corrections for a merchant, the auto-categorization updates
- Essentially: merchant -> category mapping that learns

**Layer 3 — Pattern-based (future):**
- Amount-based hints: Rs 200-500 UPI = likely Food, Rs 31,500 monthly = likely Rent
- Time-based: morning UPI = likely breakfast/coffee
- This is Phase 4 territory

**Unknown Category Fallback:**
When neither rule-based nor learned mappings produce a match, the expense is assigned to the "Unknown" category. This ensures every expense is visible and categorized — there are no "invisible" uncategorized expenses. The Unknown category has a distinct icon (help-circle) and gray color to draw attention. Users are encouraged to correct Unknown expenses, which feeds back into Layer 2 learning.

### 6.4 Approve/Reject Flow (Universal — All Data Types)

The review queue is **not just for expenses**. Any auto-detected data — expenses, investment contributions, asset updates, liability changes — follows the same flow:

```
[SMS or Email received]
      |
      v
[Parser identifies data type:]
  (A) Expense — amount, merchant, date, payment mode
  (B) Investment — SIP/trade amount, fund/stock name, date
  (C) Asset update — portfolio value, FD amount, dividend
  (D) Liability update — CC due, outstanding balance, EMI
      |
      v
[Categorizer assigns: category + target entity (with confidence score)]
      |
      v
[Create pending record: status = pending_review]
  → Expense (pending)
  → InvestmentContribution (pending) — linked to matching bucket
  → Asset value update (pending)
  → Liability value update (pending)
      |
      v
[Push notification: "Detected: SIP Rs 6,000 in HDFC Flexi Cap Fund" or
                     "Detected: Rs 500 at Swiggy via ICICI CC"]
      |
      v
[User opens Review Queue — grouped by type (Expenses | Investments | Assets | Liabilities)]
      |
      +---> [Approve] -> status = approved, saved to respective entity
      |
      +---> [Edit & Approve] -> user changes any field -> saved
      |
      +---> [Reject] -> status = rejected, not counted anywhere
```

**Post-approval, the user retains full control:**
- **Edit** any approved record at any time (change amount, category, date, description, linked bucket — anything)
- **Delete** any record at any time (auto-detected or manually entered — no distinction)
- **Manually add** any record at any time, bypassing auto-detection entirely

This "detect → review → approve/edit/reject → always editable/deletable" pattern is the **universal standard** for all data in the app.

**Forecast Lifecycle:**
```
[Reminder SMS received]
      |
      v
[Parser identifies as forecast type (SI reminder, Amount Due, EMI due)]
      |
      v
[Create forecast expense: nature='forecast', due_date=parsed due date, status='pending_review']
      |
      v
[User reviews forecast in queue — can approve, edit, or reject]
      |
      v  (later, when actual debit SMS arrives)
[System auto-matches debit to open forecast by amount + card + date window]
      |
      v
[Forecast converted to realized: nature='realized', date=actual debit date]
```

Forecasts that pass their due date without being realized are flagged as "overdue" in the UI. The user can manually dismiss (reject) or convert (realize) them from the review queue. Stale forecasts are NOT auto-deleted.

**Extended Dues from SMS:**
Beyond the initial 3 forecast types (SI reminder, Amount Due, EMI reminder), the parser detects dues from 10+ banks including:
- ICICI CC: min due + total due
- HDFC CC: payment due alerts
- Axis CC: total outstanding
- Kotak CC: payment reminders
- SBI CC: statement generated (total due, min due, due date)
- IDFC First CC: payment due
- Citi CC: amount due
- Amex: payment due
- RBL CC: due reminder

All due SMS update the corresponding `FinancialAccount` record's due fields AND create forecast expenses.

---

## 7. Tech Stack

### Frontend (Mobile App)
- **Framework:** React Native + Expo
- **Navigation:** Expo Router (file-based)
- **Styling:** NativeWind (Tailwind CSS for React Native) or StyleSheet
- **State Management:** Zustand or TanStack React Query
- **Storage (local):** expo-sqlite or react-native-mmkv (for offline-first)
- **Charts:** react-native-chart-kit or Victory Native

### Data & Storage (100% Local — No Cloud)
- **Database:** expo-sqlite (SQLite on device) — all data lives on the user's phone, nothing leaves the device
- **Key-value store:** react-native-mmkv — for settings, preferences, fast caches
- **No cloud backend.** No Supabase, no Firebase, no server. The user owns their data completely.
- **Backup/Restore:** Full database export as encrypted file (`.accmgr`). Saved to:
  - Device storage (Downloads folder)
  - Google Drive / iCloud Files (as a file — not cloud sync, just file storage the user controls)
  - SD card (Android)
- **Device migration:** Restore a backup file on any new device to get all data back
- **Auto-backup:** Optional scheduled backup (daily/weekly) to user's chosen storage location

### SMS/Email Integration
- **SMS Reading (Android):** `expo-sms` or `react-native-get-sms-android`
- **Email (Gmail):** Gmail API via OAuth 2.0 (read-only scope — app reads emails, never sends or modifies)
- **Background tasks:** `expo-task-manager` + `expo-background-fetch`
- **Push notifications:** `expo-notifications` (local notifications only — no push server needed)

### Development Tools & Claude Code Skills
- **Testing:** Jest + React Native Testing Library (unit), Maestro (E2E)
- **Build:** EAS Build (Expo Application Services), `codora-app-build` for one-command APK
- **Delivery:** APK emailed to Android phone for manual testing (see [DEVOPS.md](DEVOPS.md))

**Claude Code Skills (8 selected for our SDLC):**

| # | Skill | Purpose | SDLC Phase |
|---|-------|---------|------------|
| 1 | `buivietphi/skill-mobile-mt` | Master mobile engineer — architecture, coding, bug detection, UI/UX | Build |
| 2 | `vlad-ko/claude-wizard` | 8-phase development workflow — TDD, self-review, quality gates | All phases |
| 3 | `Daniel4SE/codora-app-build` | One-command APK builds (`/build android`) | Package |
| 4 | `agamm/claude-code-owasp` | OWASP security best practices, auto-activates during coding | Build + Review |
| 5 | `YangKuoshih/security-audit` | Secret scanning + vulnerability detection (60 patterns) | Review |
| 6 | `eagleisbatman/maestro-skill` | Generate Maestro E2E test flows from specs | Test |
| 7 | `art9mid/arc-skill` | Architecture scaffolding — project init, theme, API layer | Plan + Build |
| 8 | `devsemih/appstore-review-skill` | App Store/Play Store guideline checker | Package |

Full details: [DEVOPS.md — Section 4](DEVOPS.md)

### Companion Documents

| Document | What It Covers |
|----------|---------------|
| [Technical Design (TDD.md)](TDD.md) | Architecture, component design, SQLite schema, service layer, data flows |
| [DevOps & SDLC (DEVOPS.md)](DEVOPS.md) | Development lifecycle, skills per phase, APK build workflow, feedback loop, git strategy |
| [Test Strategy (TEST_STRATEGY.md)](TEST_STRATEGY.md) | Testing pyramid, what to test, tools, coverage targets, manual testing guide |
| [Security (SECURITY.md)](SECURITY.md) | OWASP Mobile Top 10, threat model, encryption, permissions, audit checklist |

---

## 8. Phased Roadmap

### Phase 1: MVP — Manual Finance Tracker + Goals (Weeks 1-10)

**Goal:** Replace BOTH Excel files completely — manual data entry like you do today, but on your phone with a proper UI. No automation yet. All data entered by hand, just like Excel, but easier and mobile.

**What Phase 1 IS:** Your entire Excel workflow — expenses, budgets, goals, investments, milestones — in an app. Everything you type into Excel today, you type into the app instead. Plus: import your existing Excel data so you don't start from zero.

**What Phase 1 is NOT:** No SMS reading, no email parsing, no auto-detection, no approve/reject queue. Those are Phase 2 (automation). Phase 1 proves the app works as a manual tool first.

#### Phase 1A: Core Expense Tracking + Budget (Weeks 1-5)

| Week | Deliverable |
|------|------------|
| 1 | Project setup, Expo skeleton, navigation, basic UI kit, SQLite schema, fiscal year config (default Indian FY: Apr-Mar) |
| 2 | Manual expense entry (amount, description, category, payment mode, date, "right spend" toggle), expense list with search/filters |
| 3 | Category management (add/edit/delete with icons/colors), payment mode management, configurable category list with default "Indian Professional" template pre-loaded |
| 4 | Budget setup per category (with first-principles breakdown support), actuals vs budget dashboard (color-coded progress bars), category detail view |
| 5 | Monthly summary report, settings screen, template save/load (F13b), basic home dashboard |

**Phase 1A Exit Criteria:**
- Can manually add/edit/delete expenses quickly (under 15 seconds per entry)
- Categories and payment modes fully configurable
- Budget vs actuals dashboard shows real-time spending per category
- Monthly summary gives a clear picture of the month
- Default "Indian Professional" template pre-loaded on first launch
- Users can save their setup as a template and load templates
- Works 100% offline (local-only)
- **Testable on your Android phone via APK**

#### Phase 1B: Financial Goal Engine (Weeks 6-8)

| Week | Deliverable |
|------|------------|
| 6 | Yearly Financial Plan setup tied to fiscal year (F14), Savings Rate Goal tracker (F15), Goal Dashboard shell (F22) |
| 7 | Investment Goal buckets with Goal/Done/Left tracking (F16), Life Milestone goals with progress bars (F17), Monthly Budget Compliance projections (F18) |
| 8 | Unavoidable vs Discretionary split (F20), Course Correction Alerts (F19), Year-over-Year Comparison foundation (F21), Goal Dashboard polish (F22) |

**Phase 1B Exit Criteria:**
- Yearly financial plan with salary, expenses, and investment allocations — tied to fiscal year
- Savings rate tracked in real-time against target
- Investment buckets show Goal / Done / Left with manual contribution logging
- Life milestones track progress toward long-term goals
- Course correction: "Save Rs X extra/month to get back on track"
- Goal Dashboard: "am I winning?" in one screen
- **Testable on your Android phone via APK**

#### Phase 1C: Excel Import + Data Bootstrap (Weeks 9-10)

| Week | Deliverable |
|------|------------|
| 9 | Excel import wizard — parse ACCOUNTS MANAGER `.xlsx` (Daily Expenses → Expense records, categories auto-mapped), parse Estimations `.xlsx` (Forecast → budget amounts + investment targets, Actuals → expense actuals) |
| 10 | Import Non Personal Expenses (hisaab initial balances), import Summary Sheet (asset/liability snapshots as starting values), full backup & restore (F13a), polish + end-to-end testing on phone |

**Phase 1C Exit Criteria:**
- Can import your existing ACCOUNTS MANAGER + Estimations Excel files
- 1+ year of expense history imported and visible in the app
- Budget structures and goal targets populated from Excel
- Full backup/restore works (encrypted file, can restore on new device)
- **All of Phase 1 testable and usable on your Android phone**

---

### Phase 2: Smart Auto-Detection (Weeks 11-14)

**Goal:** Add automation — the app starts reading your SMS and emails and auto-detecting expenses, investments, and liabilities. Manual entry still works; auto-detection is a convenience layer on top.

| Week | Deliverable |
|------|------------|
| 11 | SMS auto-detection (Android) — bank/UPI SMS parsing, pending expense creation |
| 12 | Review queue (approve/edit/reject), smart categorization engine (rule-based + learning from corrections) |
| 13 | Email OAuth + email parsing — expense alerts, MF statements (CAMS/KFintech), SIP confirmations, brokerage contract notes, CC statements |
| 14 | Universal review queue for all data types (expenses + investments + assets + liabilities), email parsing polish, push notifications for detected items |

**Phase 2 Exit Criteria:**
- Auto-detects expenses from bank SMS on Android
- Auto-detects expenses, investments, and liabilities from email (both platforms)
- All auto-detected items go through approve/edit/reject queue
- Smart categorization learns from user corrections
- Manual add/edit/delete always available on everything

---

### Phase 3: Family Hisaab (Weeks 15-18)

**Goal:** Replace the Non Personal Expenses sheet (Tarun Hisaab, Other Hisaab) — fully local, no cloud

| Week | Deliverable |
|------|------------|
| 15 | Hisaab ledger (local), add/edit/delete hisaab entries, running balance per person |
| 16 | Shared house expenses with split rules, credit/settlement tracking |
| 17 | Hisaab export (PDF/WhatsApp share), hisaab summary reports |
| 18 | Polish: hisaab reminders (local), monthly summary, updated backup to include hisaab data |

**Note on multi-user without cloud:** Primary user manages all hisaab locally. Family gets visibility via PDF exports shared over WhatsApp. Real-time multi-user sync is a backlog item.

---

### Phase 4: Assets, Liabilities & Net Worth (Weeks 19-21)

**Goal:** Replace the Summary Sheet (Assets, Liabilities, Net Worth)

| Week | Deliverable |
|------|------------|
| 19 | Asset tracker (manual + auto from email), liability tracker (manual + auto from CC statements) |
| 20 | Net worth dashboard, trends over time |
| 21 | Integration with goal engine (link assets to investment goals), polish |

---

### Phase 5: Advanced Intelligence (Weeks 22-24)

**Goal:** Make the app smarter than the spreadsheet

| Week | Deliverable |
|------|------------|
| 22 | Spending insights (AI-generated), spending trends |
| 23 | Forecast engine (predict end-of-month spend), recurring expense detection |
| 24 | Multi-currency support, Excel export |

---

### Phase 6: Events & Polish (Future)
- Wedding/event budget planner
- Shared event budgets
- Widget for home screen (quick add + budget summary)
- Wear OS companion

---

## 9. Default Template (Based on Your Excel)

The app ships with a default template called **"Indian Professional"** that mirrors your current setup:

### Default Categories
| # | Category | Icon | Default Monthly Budget |
|---|----------|------|----------------------|
| 1 | Car & Vehicles | car | Rs 10,056 |
| 2 | Health & Medicine | medical | Rs 3,112 |
| 3 | Travel & Going Out | plane | Rs 17,500 |
| 4 | Rent & Utilities | home | Rs 26,150 |
| 5 | Subscriptions | tv | Rs 1,255 |
| 6 | Grocery & Supplies | cart | Rs 5,000 |
| 7 | Food | utensils | Rs 18,000 |
| 8 | Shopping & Gifts | gift | Rs 10,000 |
| 9 | Miscellaneous | dots | Rs 22,317 |
| 10 | Insurance | shield | Rs 0 |
| 11 | EMIs | bank | Rs 0 |

### Default Payment Modes
| Mode | Type |
|------|------|
| ICICI CC | Credit Card |
| AXIS CC | Credit Card |
| HDFC CC | Credit Card |
| IDFC CC | Credit Card |
| SBI Savings | Bank Account |
| ICICI Savings | Bank Account |
| AXIS Savings | Bank Account |
| Cash | Cash |
| GPay | UPI |
| PhonePe | UPI |
| Amazon Pay | Wallet |

### Default Budget Breakdown (Car example)
```
Car & Vehicles: Rs 10,056/month
  - Petrol: Rs 7,673 (697.5 km / 10 mileage * Rs 110/litre)
  - Service: Rs 1,583 (Rs 9,500 half-yearly / 6)
  - Car Wash: Rs 800
```

---

## 10. Data Privacy & Security

**Core principle: Your data never leaves your device unless YOU explicitly choose to export or back it up.**

This app has **zero cloud dependency**. No servers, no accounts, no sync, no telemetry. Everything runs locally.

| Concern | Approach |
|---------|----------|
| **SMS data** | Read-only, never uploaded anywhere. Parsed locally on device. Raw SMS text stored only in local database. |
| **Email OAuth** | Uses Gmail API with minimal read-only scope. Tokens stored securely in device keychain. Email content is parsed on-device and never sent to any server. |
| **Financial data** | All data stored locally in encrypted SQLite. No cloud database. No server. Period. |
| **Backups** | Backup files are encrypted. Saved wherever the user chooses (device storage, Google Drive as a file, iCloud Files as a file). The app never auto-uploads anywhere. |
| **Templates** | Template files contain only configuration (categories, budgets, structures) — never personal financial data. Safe to share. |
| **No cloud sync** | There is no cloud sync feature. Data portability is via manual backup/restore only. The user controls when and where their data goes. |
| **No ads, no tracking** | No analytics SDKs, no ad networks, no telemetry, no crash reporting that sends data externally. This is a personal tool, not a data business. |
| **Biometric lock** | Optional fingerprint/face lock to open the app. |
| **Device migration** | When changing phones, user creates a backup on old phone → transfers the file (AirDrop, WhatsApp, USB, cloud drive) → restores on new phone. All data carries over. |

---

## 11. Success Metrics (MVP)

| Metric | Target |
|--------|--------|
| Daily expense logging | > 90% of actual expenses captured (auto + manual) |
| Auto-detection accuracy | > 80% of SMS/email transactions correctly parsed |
| Categorization accuracy | > 70% auto-categorized correctly (improving with corrections) |
| Budget compliance visibility | User can see actuals vs budget in < 2 taps |
| Time to log expense (manual) | < 15 seconds |
| App opens per day | 2-3x (morning review + evening log) |

---

## 12. Open Questions — All Resolved

| # | Question | Decision |
|---|----------|----------|
| 1 | Offline-first vs cloud-first? | **DECIDED: 100% local, no cloud.** All data on-device. Backup/restore for device migration. |
| 2 | iOS SMS alternative? | **DECIDED: Email only for iOS.** No SMS reading, no notification reading. iOS users rely on email auto-detection + manual entry. |
| 3 | Import existing data? | **DECIDED: Yes, Phase 1.** Import existing Excel data (ACCOUNTS MANAGER + Estimations) into the app. This bootstraps the user with 1+ year of history. See F13c below. |
| 4 | Monetization? | **DECIDED: Personal first, monetize later.** Architecture should be clean enough to productize eventually (template marketplace, premium features), but no monetization features in the current roadmap. |
| 5 | App name? | **PENDING — see Section 13 for Sanskrit name recommendations.** |
| 6 | Multi-user hisaab without cloud? | **DECIDED: Backlog.** Will revisit when cloud is explored in a future phase. Current local-only hisaab with PDF export is sufficient. |
| 7 | Backup encryption key? | **DECIDED: Simple user-set password.** If user forgets, they simply create a new backup. No recovery mechanism. The app always has the live data — backup is just a safety copy. |

### Fiscal Year Definition

The app uses **Indian Fiscal Year (FY)** by default:
- **FY start:** April 1
- **FY end:** March 31 (next calendar year)
- **Notation:** "FY 2026-27" = April 1, 2026 to March 31, 2027

This affects:
- **Yearly Financial Plans** (F14) — plans are tied to fiscal years, not calendar years
- **Year-over-Year Comparison** (F21) — compares FY to FY
- **Budget periods** — monthly budgets can be viewed per FY or per calendar year
- **Savings Rate** (F15) — tracked per fiscal year

The fiscal year definition is **configurable** — users in other countries can change it in Settings (e.g., Jan-Dec for US/UK, Jul-Jun for Australia).

---

## 13. App Name — Sanskrit Recommendations

The user wants a Sanskrit word that captures the essence of the app: tracking finances, setting goals, knowing where you stand.

| # | Name | Sanskrit | Meaning | Why It Fits |
|---|------|----------|---------|-------------|
| 1 | **Artha** | अर्थ | Wealth, purpose, meaning | The most complete fit — "artha" in Hindu philosophy is one of the four goals of life (dharma, artha, kama, moksha). It means both "wealth" and "purpose/meaning." Your app tracks wealth AND gives it purpose through goals. |
| 2 | **Lakshya** | लक्ष्य | Goal, target, aim | Captures the goal-tracking backbone — savings targets, investment goals, life milestones. "What's your lakshya?" |
| 3 | **Nidhi** | निधि | Treasure, fund, collection | Evokes a personal treasure chest. "Nidhi" is also a common Indian name, making it warm and familiar. |
| 4 | **Kosh** | कोष | Treasury, storehouse | Direct and strong — your personal treasury. Short, easy to remember, easy to spell. |
| 5 | **Vittam** | वित्तम् | Wealth, finance | The most literal "finance" word in Sanskrit. Clean and professional. |
| 6 | **Sampada** | सम्पदा | Wealth, prosperity, abundance | Aspirational — not just tracking money, but building prosperity. |
| 7 | **Arthsaathi** | अर्थसाथी | Financial companion | Compound word: artha (wealth) + saathi (companion). "Your money companion." Warm, relational. |

**Top recommendation: Artha (अर्थ)** — it's short, memorable, meaningful at multiple levels, and captures both the practical (wealth tracking) and the philosophical (purposeful living) essence of the app.

**Runner-up: Lakshya (लक्ष्य)** — if you want to emphasize the goal-tracking angle over the finance-tracking angle.

**DECIDED: Artha (अर्थ)** — Short, meaningful, captures both wealth tracking and purposeful living.

---

## Appendix A: Mapping Excel Sheets to App Features

| Excel Sheet | App Feature (Phase) | What Maps |
|-------------|-------------------|-----------|
| **Daily Expenses** (ACCOUNTS MANAGER) | F1-F5, F8, F10 (Phase 1) | Expense tracking, auto-detect, right spend tagging |
| **Forecast 2025/2026** (Estimations) — Budget rows | F6, F11 (Phase 1) | Category-wise monthly budgets, budget breakdowns |
| **Actuals 2025/2026** (Estimations) — Expense rows | F7, F13 (Phase 1) | Actuals vs budget, monthly summary |
| **Forecast 2025/2026** (Estimations) — Salary, Savings Rate, Investments | F14, F15, F16 (Phase 1B) | Yearly Financial Plan, savings rate goal, investment buckets |
| **Actuals 2025/2026** (Estimations) — Actuals vs Forecast | F18, F19, F21 (Phase 1B) | Budget compliance, course correction, YoY comparison |
| **Forecast 2025/2026** (Estimations) — Life Milestones section | F17 (Phase 1B) | Car/house/engagement milestones with target amounts |
| **Forecast 2025/2026** (Estimations) — Unavoidable baseline | F20 (Phase 1B) | Unavoidable vs discretionary split |
| **Non Personal Expenses** — House Expenses | F25 (Phase 2) | Shared house expenses |
| **Non Personal Expenses** — Tarun Hisaab | F23-F27 (Phase 2) | Family hisaab ledger |
| **Non Personal Expenses** — Other Hisaab | F23-F27 (Phase 2) | Family hisaab ledger |
| **Non Personal Expenses** — Land Contribution | F17 (Phase 1B) | Life milestone (land investment) |
| **Non Personal Expenses** — LT Liabilities | F29 (Phase 3) | Liability tracker |
| **Summary Sheet** (ACCOUNTS MANAGER) | F28-F30 (Phase 3) | Assets, liabilities, net worth |
| **Wedding Forecast** (Estimations) | F37-F38 (Phase 5) | Event budget planner |

### Key Excel Formulas → App Feature Mapping

| Excel Formula / Pattern | App Equivalent |
|------------------------|----------------|
| `=165000-156962.57` (CC balance calculation) | F29: Liability Tracker — auto-calculate outstanding from limit - payments |
| `=MONTH(A2)`, `=YEAR(A2)` (date extraction) | Automatic — app stores full dates and derives month/year |
| `=$C3-SUM($E3,$F3,...$O3)` (yearly balance left) | F14: Yearly Plan — "Left After Complete Spend" |
| `=round(sum(E3:O3)/11,2)` (monthly average) | F18: Budget Compliance — rolling average spend per category |
| `=B3-P3` (forecast vs actuals variance) | F21: Year-over-Year Comparison + F18: Budget Compliance |
| `=If(C16=0,"Time Up",Round(E4/C16,2))` (course correction) | F19: Course Correction Alerts — "Save Rs X extra/month" |
| `=(C14+E13)*E2` (savings target from rate) | F15: Savings Rate Goal — target amount derived from salary * rate |
| `=1500+4081.89+1085+...` (itemized actuals) | F1: Manual Expense Entry — individual entries that auto-sum per category |
