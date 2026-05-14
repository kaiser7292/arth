# Deep Feature Planning Analysis

Comprehensive product manager-style analysis for 6 feature areas with multiple implementation options, impact analysis, pros/cons, and real-world scenario considerations.

---

## 1. Product Logger & Log Export

### Current State
- `utils/logger.ts`: Console logging only in dev mode, silent in production
- `services/app-log.ts`: Writes error/warn to `app_logs` table (SQLite), keeps last 200 entries
- `services/audit-log.ts`: User action audit trail (SMS/manual approvals, edits, deletions)
- No user-facing way to export logs for debugging

### Problem Statement
Users encounter errors but have no way to share diagnostic data with support team. Support needs structured logs to reproduce and fix issues.

### Implementation Options

#### Option A: Full-Featured Log Exporter
**Features:**
- Export both app_logs and audit_log
- JSON format (machine-readable) + plain text (human-readable)
- Time scope selector: Last 24h, 7 days, 30 days, custom range
- Save to device storage + share intent (email, WhatsApp, etc.)
- File naming: `artha_logs_YYYYMMDD_HHMMSS.{json|txt}`
- Include device info: OS version, app version, device model

**Pros:**
- Comprehensive diagnostic data
- Flexible sharing options
- Machine-readable JSON for automated analysis
- Human-readable text for quick review
- Device context helps reproduce issues

**Cons:**
- More complex implementation
- Larger file sizes (audit_log can grow large)
- Privacy concerns if logs contain sensitive data
- Need to redact PII (account numbers, merchant names, amounts)

**Effort:** Medium (2-3 days)

#### Option B: Minimal Log Exporter
**Features:**
- Export only app_logs (errors/warns)
- Plain text only
- Fixed scope: Last 7 days
- Save to device + share
- Simple format: timestamp | level | message

**Pros:**
- Simple implementation (1 day)
- Small file sizes
- Less privacy concerns
- Quick to implement and test

**Cons:**
- Limited diagnostic value
- No audit trail context
- No device info
- Not machine-readable
- Fixed scope may miss older relevant logs

**Effort:** Low (1 day)

#### Option C: Hybrid Smart Exporter
**Features:**
- Export app_logs + audit_log (last 7 days)
- JSON + plain text
- Auto-redact PII: account numbers (show last 4), amounts (show ranges), merchant names
- Include device info
- Add "issue description" field for user context
- Direct email to support with pre-filled subject

**Pros:**
- Balanced approach
- Privacy-conscious
- User context included
- Direct support integration
- Machine-readable + human-readable

**Cons:**
- PII redaction logic needs careful testing
- Medium complexity
- Still larger than Option B

**Effort:** Medium (2 days)

### Recommended Scope
**Optimized & Sustainable:**
- Last 7 days (balances relevance vs file size)
- App logs (errors + warnings) + audit log (last 100 entries)
- JSON + plain text formats
- Save to device + share
- Auto-redact: account numbers (last 4 digits), amounts (categorize: <1k, 1k-10k, >10k)
- Include: device info, app version, timestamp

### Privacy Considerations
- **Redact:** Full account numbers, exact amounts, phone numbers, email addresses
- **Keep:** Error messages, stack traces (no PII), timestamps, log levels
- **User consent:** Show preview before sharing

### Real-World Scenarios
1. **User crashes on expense edit:** Export shows error context + last actions
2. **SMS parsing fails:** Audit log shows which SMS failed + error message
3. **Backup restore fails:** App logs show database errors + device info
4. **Performance issue:** Timestamps help identify slow operations

---

## 2. Loan Manual Correction vs Prepayment Conflict

### Current State
- `services/loan-engine.ts`: Manual corrections act as "seeding points" for outstanding calculations
- `components/loans/ManualCorrectionSheet.tsx`: Allows overriding outstanding, EMI, tenure at a date
- `components/loans/PrepaymentSheet.tsx`: Records prepayments with reduce_tenure/reduce_emi strategies
- **Problem:** After manual correction, new prepayment with reduce_emi doesn't affect amortization schedule

### Root Cause Analysis
The loan engine seeds outstanding from the latest correction on-or-before the asOfDate. When a prepayment is added after a correction, the correction's outstanding value is still used as the base, ignoring the prepayment's EMI reduction effect.

### Implementation Options

#### Option A: Timestamp-Based Conflict Resolution
**Logic:**
- Sort all corrections and prepayments by date
- When computing schedule at date D:
  - Find latest action (correction or prepayment) on/before D
  - If correction: use its outstanding as base
  - If prepayment with reduce_emi: recompute from that prepayment
  - If prepayment with reduce_tenure: treat normally
- Add `effective_until` column to corrections (auto-set by next action)

**Pros:**
- Most recent action always wins (user expectation)
- No visual indicator needed (implicit in computation)
- Handles edge cases (same date: most recent action wins)
- Backward compatible (existing data works)

**Cons:**
- Complex logic in loan engine
- Need to recompute entire schedule on every action
- Performance impact for loans with many corrections/prepayments
- Hard to debug which action is "winning"

**Effort:** High (3-4 days)

#### Option B: Restrict Manual Correction to One-Per-Loan
**Logic:**
- Allow only one active manual correction per loan
- When user adds new correction: delete old one + create new one
- Show warning: "This will replace your previous correction"
- Prepayments always respect the single correction (if any)

**Pros:**
- Simple implementation (1 day)
- No conflict resolution needed
- Clear user mental model
- Easy to debug
- Better performance

**Cons:**
- Less flexible (can't have historical corrections)
- Loss of historical context
- Users might want multiple corrections at different dates
- Breaking change for existing users with multiple corrections

**Effort:** Low (1 day)

#### Option C: Correction Hierarchy System
**Logic:**
- Introduce correction "priority": low, medium, high
- Prepayments get implicit priority based on strategy:
  - reduce_emi: high (affects monthly payment)
  - reduce_tenure: medium (affects duration)
- User can manually adjust correction priority
- Higher priority wins when conflicts occur
- Show priority badge in UI

**Pros:**
- Flexible but controlled
- User has explicit control
- Clear visual hierarchy
- Handles complex scenarios
- Can evolve with new strategies

**Cons:**
- More complex UI
- Users need to understand priority system
- Implementation complexity
- May confuse non-technical users

**Effort:** Medium-High (3 days)

#### Option D: Prepayment-First Model
**Logic:**
- Prepayments always take precedence over corrections
- Corrections only used when no prepayment exists on/before date
- Add "override correction" checkbox to prepayment sheet
- If checked, prepayment ignores all corrections

**Pros:**
- Prepayments are more common than corrections
- User intent is clear when they add prepayment
- Simple mental model
- Backward compatible

**Cons:**
- Corrections become less useful
- Doesn't solve the original problem (user wants correction to win sometimes)
- May not match real-world bank behavior

**Effort:** Low (1 day)

#### Option E: Hybrid: Latest Action + Soft Restriction
**Logic:**
- Latest action wins (timestamp-based)
- Allow unlimited corrections but warn if > 3
- Show "active correction" badge on loan detail
- Allow user to "deactivate" old corrections (soft delete)
- Prepayment sheet shows if correction exists and what it does

**Pros:**
- Flexible but guided
- User awareness of conflicts
- Can deactivate without deleting
- Best of both worlds
- Good UX with warnings

**Cons:**
- Medium complexity
- Need UI for deactivation
- Still need conflict resolution logic

**Effort:** Medium (2-3 days)

### Real-World Scenarios

#### Scenario 1: Rate Reset
- Bank changes interest rate mid-loan
- User adds correction with new rate
- Later adds prepayment
- **Expected:** Correction (rate reset) wins, prepayment applies on top

#### Scenario 2: Bank Statement Reconciliation
- User's outstanding doesn't match bank
- User adds correction to match bank
- Later adds prepayment
- **Expected:** Latest wins (if prepayment is after correction)

#### Scenario 3: Multiple Corrections
- User corrects in Jan, Mar, Jun
- Adds prepayment in May
- **Expected:** Jun correction wins (most recent)

#### Scenario 4: Same-Day Actions
- User adds correction and prepayment on same day
- **Expected:** Most recent action wins (within same day)

### Recommendation
**Option E (Hybrid)** with these specifics:
- Latest action wins (timestamp + action order for same day)
- Warn if > 3 corrections
- Show "active correction" badge
- Allow deactivation (soft delete)
- Prepayment sheet shows existing correction context
- Add migration to deactivate old corrections (> 6 months old)

---

## 3. Investment Contribution Display Unification

### Current State
- `app/goals/investment-detail.tsx`: Shows "All Contributions" (manual entries) separately from "Contribution from expense"
- `services/expense-investment-link.ts`: Links expenses to buckets
- `services/demat-transfer.ts`: Links transfers to buckets via investment_contributions
- **Problem:** Two separate sections create confusion - contributions should be unified

### Implementation Options

#### Option A: Simple Merge
**Logic:**
- Remove "Contribution from expense" section
- Add expense-linked contributions to "All Contributions"
- Sort unified list by date (descending)
- Show source badge: "from expense" / "from transfer" / "manual"
- Tap badge to view source (expense detail / transfer detail)

**UI Changes:**
```tsx
// In contribution row:
<View className="flex-row items-center gap-2">
  {source === 'expense' && (
    <Badge label="from expense" onPress={() => router.push(`/expense/${expenseId}`)} />
  )}
  {source === 'transfer' && (
    <Badge label="from transfer" onPress={() => router.push(`/settings/account-detail?account=${accountId}`)} />
  )}
  {source === 'manual' && (
    <Badge label="manual" />
  )}
</View>
```

**Pros:**
- Simple implementation (1 day)
- Clean UI (one section)
- Easy to understand
- Source tracking preserved
- Minimal code changes

**Cons:**
- No filtering by source
- Can't see only manual vs auto contributions
- Badge might clutter UI if many contributions

**Effort:** Low (1 day)

#### Option B: Merge with Filter
**Logic:**
- Same as Option A + filter chips
- Filter options: All, Manual, From Expense, From Transfer
- Default: All
- Persist filter preference

**Pros:**
- Flexibility to view specific sources
- Power users can filter
- Still unified by default
- Clean mental model

**Cons:**
- More UI complexity
- Filter state management
- Slightly more code

**Effort:** Low-Medium (1-2 days)

#### Option C: Grouped by Source
**Logic:**
- Keep sections but rename:
  - "All Contributions" → "Manual Contributions"
  - "Contribution from expense" → "Auto Contributions"
- Add third section: "From Transfer"
- Show total across all sections at top
- Or: Group by source within unified list with section headers

**Pros:**
- Clear source separation
- Can see totals per source
- Familiar pattern (existing UI)

**Cons:**
- Not truly unified (still multiple sections)
- User asked for single section
- More scrolling

**Effort:** Low (1 day)

#### Option D: Smart Merge with Context
**Logic:**
- Merge all contributions sorted by date
- Show source icon instead of badge (less clutter)
- Long-press on row shows source details
- Add "Source" column in contribution list (optional toggle)
- Color-code by source: manual (gray), expense (blue), transfer (green)

**Pros:**
- Clean UI (icons vs badges)
- Rich context on long-press
- Color coding for quick scan
- Optional detail view

**Cons:**
- Long-press gesture might be discoverability issue
- Color coding needs accessibility consideration
- More complex interactions

**Effort:** Medium (2 days)

### Recommendation
**Option A (Simple Merge)** with these specifics:
- Remove "Contribution from expense" section
- Merge into "All Contributions"
- Sort by date descending
- Show source as small badge: "from expense" / "from transfer" / "manual"
- Tap badge to navigate to source
- Keep existing "tap to view" pattern for transfers
- Add expense detail navigation for expense-linked contributions

### Database Changes
None required - data already exists, just UI merge

### Real-World Scenarios
1. **User sees mixed contributions:** Unified list shows all, badges clarify source
2. **User wants to see only manual:** Can't filter (but this is rare use case)
3. **User taps "from expense":** Navigates to expense detail to verify
4. **User taps "from transfer":** Navigates to account ledger to verify

---

## 4. Transaction Action Guard Rails

### Current State
- `services/expense-investment-link.ts`: Links expense to investment bucket
- `services/expense-loan-link.ts`: Links expense to loan (EMI or prepayment)
- `services/account-transfer.ts`: Marks expense as transfer
- `services/expense-crud.ts`: Handles refunds
- **Problem:** No guards - user can mark expense as investment AND loan prepayment AND transfer, creating redundancy

### Current Guards (Existing)
- Investment link: Rejects splits, refunds, credits
- Loan link: Rejects splits, refunds, credits, already-linked expenses
- **Missing:** Cross-action guards (investment + loan, investment + transfer, etc.)

### Action Matrix Analysis

| Action | Can coexist with | Cannot coexist with | Reason |
|--------|----------------|---------------------|--------|
| Investment | Split (partial) | Loan link, Transfer, Refund | Investment is end-state |
| Loan EMI | Split (partial) | Investment, Transfer | EMI is specific payment |
| Loan Prepayment | Split (partial) | Investment, Transfer | Prepayment is specific payment |
| Transfer | - | Investment, Loan link | Transfer is end-state |
| Refund | - | Investment, Loan link, Transfer | Refund reverses expense |
| Split | Investment, Loan (partial) | Refund, Transfer | Split divides amount |

### Implementation Options

#### Option A: Strict Exclusion Matrix
**Logic:**
- Define allowed action combinations in config
- Before performing action, check existing actions
- Block if combination not allowed with clear error message
- Matrix:
  - Investment + Loan: BLOCK
  - Investment + Transfer: BLOCK
  - Loan + Transfer: BLOCK
  - Investment + Split: ALLOW (partial investment)
  - Loan + Split: ALLOW (partial loan payment)
  - Split + Refund: BLOCK (can't refund split legs)

**Error Messages:**
- "This expense is already marked as investment. Unmark it first."
- "This expense is part of a loan payment. Remove that link first."
- "This expense is a transfer. Transfers cannot be linked to loans or investments."

**Pros:**
- Clear rules, no ambiguity
- Prevents user errors
- Simple to understand
- Easy to implement
- Consistent behavior

**Cons:**
- Less flexible
- Some valid use cases blocked (e.g., partial investment + partial hisaab via split)
- Users might feel restricted
- Need to unmark first (extra steps)

**Effort:** Medium (2 days)

#### Option B: Warning + Confirmation
**Logic:**
- Allow any combination but show warning
- Warning: "This expense is already marked as investment. Marking it as loan payment will unlink it from the investment bucket. Continue?"
- User must confirm to proceed
- Auto-unlink previous action on confirmation

**Pros:**
- Flexible (users can do what they want)
- Clear warning of consequences
- Auto-cleanup (unlink previous)
- No blocking

**Cons:**
- Users might not read warnings
- Accidental unlinks possible
- More complex flow
- Still allows questionable combinations

**Effort:** Medium (2 days)

#### Option A+ Hybrid: Strict with Smart Split
**Logic:**
- Strict matrix for most actions (investment + loan, investment + transfer, loan + transfer)
- BUT: Allow investment + split with smart UI
- When splitting investment-linked expense:
  - Show "Investment amount" field (how much to keep as investment)
  - Remaining amount becomes regular expense (can be hisaab, etc.)
  - Update investment link amount accordingly
- Similarly for loan-linked splits

**Pros:**
- Best of both worlds
- Enables partial scenarios
- Prevents full redundancy
- Smart UX for splits
- Clear mental model

**Cons:**
- More complex implementation
- Need split-specific UI
- More edge cases
- Testing complexity

**Effort:** High (3-4 days)

#### Option C: Action State Machine
**Logic:**
- Define expense "state": normal, invested, loan_emi, loan_prepaid, transferred, refunded, split
- Define allowed transitions between states
- Visual state indicator in expense detail
- Show available actions based on current state
- Example: If state = invested, show "Unmark investment" + "Split" (but not "Mark as loan")

**State Transitions:**
```
normal → invested
normal → loan_emi
normal → loan_prepaid
normal → transferred
normal → refunded
normal → split

invested → normal (unmark)
invested → split (partial)

split → invested (partial)
split → loan_emi (partial)
split → loan_prepaid (partial)
split → normal (unsplit)

loan_emi → normal (unlink)
loan_emi → split (partial)

etc.
```

**Pros:**
- Clear mental model (state machine)
- Visual indicator of current state
- Only show relevant actions
- Prevents invalid transitions
- Scalable for new actions

**Cons:**
- Most complex implementation
- Need to manage state transitions
- UI changes to show state
- Breaking change for existing data (need migration)
- Harder to test all transitions

**Effort:** High (4-5 days)

#### Option D: Flexible with Post-Action Validation
**Logic:**
- Allow any action
- After action, run validation
- If validation fails (e.g., expense is both invested AND transferred):
  - Show "Conflict detected" banner in expense detail
  - Explain: "This expense is marked as both investment and transfer. Please remove one."
  - Block further actions until resolved
  - Provide quick action buttons: "Unmark investment" / "Remove transfer"

**Pros:**
- Maximum flexibility
- No blocking during action
- Clear error state
- Quick resolution path
- Easy to implement

**Cons:**
- Allows invalid states temporarily
- Requires user to resolve conflicts
- Might confuse users (why allowed then blocked?)
- More complex error handling

**Effort:** Medium (2-3 days)

### Real-World Scenarios

#### Scenario 1: Partial Investment
- User has ₹10,000 expense
- Wants to invest ₹8,000, add ₹2,000 to hisaab
- **Option A+:** Split expense, set investment amount to ₹8,000, remaining ₹2,000 becomes regular
- **Option B:** Mark as investment (₹10,000), then split, then unmark investment from hisaab leg (complex)
- **Option C:** State: normal → split → invested (partial)
- **Option D:** Mark as investment, split, conflict detected (bad)

#### Scenario 2: Mistaken Action
- User accidentally marks expense as investment
- Realizes mistake, wants to mark as loan EMI instead
- **Option A:** Block with error, must unmark first
- **Option B:** Warning "This will unlink from investment", user confirms
- **Option A+:** Same as A
- **Option C:** State: invested → normal → loan_emi
- **Option D:** Mark as loan, conflict detected, user resolves

#### Scenario 3: Power User Flexibility
- User wants to mark expense as both investment AND hisaab (for tracking purposes)
- **Option A:** Blocked
- **Option B:** Allowed with warning
- **Option A+:** Blocked (use split instead)
- **Option C:** Blocked (use split)
- **Option D:** Allowed, conflict detected

### Recommendation
**Option A+ (Strict with Smart Split)** with these specifics:
- Strict matrix for incompatible actions (investment + loan, investment + transfer, loan + transfer)
- Allow investment + split with "Investment amount" field
- Allow loan + split with "Loan amount" field
- Clear error messages for blocked actions
- Auto-cleanup on split (update link amounts)
- Migration: Check existing data for conflicts, flag for user review

---

## 5. Settings Rethink & Reorganization

### Current State
- `app/(tabs)/settings.tsx`: 8 sections with 25+ settings rows
- Sections: Master Data, Automation, Import & Config, Security & Privacy, Integrations, Backup & Storage, SMS Detection
- **Problems:** Too many sections, some settings buried, no clear hierarchy, navigation fatigue

### Current Settings Inventory

**Master Data (4 items):**
- Categories
- Payment Modes
- Accounts
- Tags

**Automation (5 items):**
- Reminders
- Smart Rules
- Smart SMS Templates
- Merchant Aliases
- Audit Log

**Import & Config (2 items):**
- Budget Configuration
- Import from Excel

**Security & Privacy (1 item):**
- App Lock

**Integrations (1 item):**
- Kite Connect

**Backup & Storage (5 items):**
- Backup & Restore
- Recycle Bin
- Dismissed Duplicates
- Data Cleanup
- (SMS Detection separate on Android)

**SMS Detection (Android only):**
- Enable SMS Reading
- Scan Date Range
- Manual Scan

### Implementation Options

#### Option A: Profile-Based Settings
**Concept:**
- Add user profile icon top-right on home screen
- Profile screen shows: Avatar, Name, Version, Quick Actions
- Settings moves into profile
- Reorganize into 4 main sections:
  1. **My Data** (Master Data + Accounts)
  2. **Automation** (Reminders, Smart Rules, SMS)
  3. **Backup & Security** (Backup, App Lock, Cleanup)
  4. **Advanced** (Audit Log, Integrations, Import)

**Pros:**
- Clean home screen (settings not in tab bar)
- Profile is standard pattern
- Better organization (4 vs 8 sections)
- Personal touch (avatar, name)
- Settings feel more "personal"

**Cons:**
- Changes navigation pattern (breaking change)
- Profile needs avatar/name storage
- Home screen redesign
- Users might miss settings in new location
- Extra tap to access settings

**Effort:** High (3-4 days)

#### Option B: Collapsible Sections
**Concept:**
- Keep settings in tab bar
- Group into 4 collapsible sections
- Default: All sections expanded
- Add "Expand All / Collapse All" button
- Add search bar at top
- Show "Recently Used" section (based on access frequency)

**Sections:**
1. **Data Management** (Categories, Payment Modes, Accounts, Tags, Import)
2. **Automation** (Reminders, Smart Rules, SMS Templates, Merchant Aliases)
3. **Backup & Privacy** (Backup, App Lock, Cleanup, Recycle Bin)
4. **Advanced** (Audit Log, Kite Connect, SMS Detection)

**Pros:**
- Familiar location (tab bar)
- Better organization
- Search functionality
- Recently used (smart)
- Collapsible reduces scrolling

**Cons:**
- Still many items (just grouped better)
- Collapsible state management
- Search implementation complexity
- Still feels "cluttered"

**Effort:** Medium (2-3 days)

#### Option C: Quick Settings + Full Settings
**Concept:**
- Add "Quick Settings" sheet (swipe down from home or tap gear icon)
- Quick Settings: Top 5 most-used settings (based on analytics)
- Full Settings: Current settings screen but reorganized
- Quick Settings items: Categories, Budget, Backup, SMS Toggle, App Lock

**Full Settings Reorganization:**
1. **Essentials** (Categories, Budget, Accounts, Payment Modes)
2. **Automation** (Reminders, Smart Rules, SMS)
3. **Data** (Backup, Cleanup, Recycle Bin, Import)
4. **Advanced** (Audit Log, Integrations, Tags, Aliases)

**Pros:**
- Quick access to common settings
- Full settings still accessible
- Analytics-driven (shows what users actually use)
- Familiar pattern (quick settings)
- Less breaking change

**Cons:**
- Need analytics infrastructure
- Two screens to maintain
- Quick settings might not match user needs
- Still reorganizing full settings

**Effort:** Medium-High (3 days)

#### Option D: Settings Dashboard
**Concept:**
- Transform settings into dashboard with cards
- Each card shows summary + action
- Cards:
  - **Data Health**: Show counts (categories, accounts, etc.) + quick actions
  - **Automation Status**: Reminders active, Smart Rules count, SMS status
  - **Backup Status**: Last backup date, storage used
  - **Security**: App lock status, cleanup needed
- Tap card to see detailed settings

**Pros:**
- Visual, engaging
- Shows status at a glance
- Action-oriented (not just navigation)
- Modern UI pattern
- Can show alerts (backup needed, etc.)

**Cons:**
- Major UI overhaul
- More complex to build
- Might be information overload
- Harder to find specific settings
- Performance (need to compute stats)

**Effort:** High (4-5 days)

#### Option E: Contextual Settings
**Concept:**
- Move settings to where they're used
- Categories: In expense edit sheet
- Budget: In budget screen
- Accounts: In account ledger
- SMS: In home screen (toggle)
- Keep only "global" settings in settings screen:
  - App Lock
  - Backup
  - Cleanup
  - Audit Log
  - Integrations

**Pros:**
- Settings where you need them
- Less navigation
- Contextual relevance
- Settings screen becomes lean

**Cons:**
- Settings scattered (hard to find all)
- Consistency issues (where is X?)
- More places to update
- Breaking pattern
- Hard to discover all settings

**Effort:** High (4-5 days)

#### Option F: Simplified Hierarchy (Minimal Change)
**Concept:**
- Keep current structure but reorganize
- Merge similar sections
- Remove low-value items to sub-sections
- Add search

**New Sections:**
1. **Data** (Categories, Payment Modes, Accounts, Tags, Import)
2. **Automation** (Reminders, Smart Rules, SMS Templates, Merchant Aliases, Audit Log)
3. **Backup & Security** (Backup, App Lock, Cleanup, Recycle Bin, Dismissed Duplicates)
4. **Integrations** (Kite Connect)
5. **SMS** (Android only, keep separate)

**Pros:**
- Minimal change
- Familiar location
- Better organization
- Search added
- Low risk

**Cons:**
- Still feels like "settings page"
- Not a true rethink
- Navigation fatigue remains
- Doesn't solve core problem

**Effort:** Low (1-2 days)

### Recommendation
**Option B (Collapsible Sections)** with these specifics:
- Keep settings in tab bar (familiar)
- Reorganize into 4 collapsible sections
- Add search bar at top
- Add "Recently Used" section (track last 5 accessed)
- Default: All sections expanded
- Add "Expand All / Collapse All" button
- Move SMS Detection into Automation section (unify across platforms)
- Move Dismissed Duplicates into Backup & Security (data management)

**Rationale:**
- Best balance of improvement vs risk
- Familiar navigation pattern
- Search + recently used addresses discoverability
- Collapsible reduces scrolling
- Can implement incrementally

---

## 6. Help Documentation Update

### Current State
- `assets/docs/articles/`: Help articles
- `assets/docs/index.json`: Article index
- `services/docs/index.ts`: Article loading
- **Problem:** New features not documented, customer-facing relevance unclear

### Feature Documentation Audit

#### Recently Introduced Features (Last 6-12 months)
1. **Investment Buckets** (v17.0)
   - What it is, why use it
   - Creating buckets, linking milestones
   - Manual contributions, expense linking, transfer linking
   - Tracking progress
   - **Customer-facing:** HIGH

2. **Loan Management** (v17.0+)
   - Adding loans, schedule generation
   - Manual corrections
   - Prepayments (reduce tenure vs reduce EMI)
   - Linking expenses to loan payments
   - **Customer-facing:** HIGH

3. **Expense Investment Linking** (v17.0)
   - Marking expenses as investments
   - Linking to buckets
   - Budget exclusion
   - **Customer-facing:** MEDIUM (power user feature)

4. **Demat Account Integration** (v14.4)
   - Adding demat accounts
   - Portfolio snapshots
   - Transfer to demat (fund vs portfolio)
   - **Customer-facing:** MEDIUM (investor feature)

5. **Smart Rules** (v15.x)
   - Auto-categorization rules
   - Rule conditions (merchant, amount, account)
   - Investment actions
   - **Customer-facing:** HIGH

6. **Audit Log** (v15.12)
   - Viewing action history
   - Filtering by source, type, action
   - Navigating to records
   - **Customer-facing:** MEDIUM (debugging feature)

7. **Hisaab Enhancements** (various)
   - Settlement tracking
   - Multiple settlements per person
   - Ledger views
   - **Customer-facing:** HIGH

8. **Duplicate Detection** (v15.x)
   - Automatic duplicate scanning
   - Dismissing duplicates
   - Manual review
   - **Customer-facing:** HIGH

#### Existing Documentation Gaps
- Investment buckets: No comprehensive guide
- Loan management: No guide for corrections/prepayments
- Smart rules: Minimal documentation
- Demat integration: No guide
- Audit log: No guide
- Hisaab: Basic guide only
- Duplicate detection: No guide

### Documentation Prioritization

#### Priority 1: Customer-Critical (Must Have)
1. **Investment Buckets Guide**
   - What are investment buckets?
   - Why track investments separately?
   - Creating your first bucket
   - Linking to life milestones
   - Adding contributions (manual, from expense, from transfer)
   - Viewing progress

2. **Loan Management Guide**
   - Adding a loan account
   - Understanding the schedule
   - Recording prepayments
   - Reduce tenure vs reduce EMI (when to use which)
   - Manual corrections (when needed)
   - Linking expenses to EMI payments

3. **Smart Rules Guide**
   - What are smart rules?
   - Creating a rule (merchant, amount, account)
   - Investment actions (auto-mark as investment)
   - Rule examples and best practices

#### Priority 2: High Value (Should Have)
4. **Hisaab Deep Dive**
   - Hisaab basics (existing)
   - Settlements: how they work
   - Multiple settlements per person
   - Ledger views and reconciliation
   - Best practices

5. **Duplicate Detection Guide**
   - How duplicate detection works
   - Reviewing duplicates
   - Dismissing vs merging
   - Troubleshooting

6. **Demat Account Guide**
   - Adding demat accounts
   - Portfolio snapshots
   - Transferring to demat
   - Fund vs portfolio (what's the difference)

#### Priority 3: Power User Features (Nice to Have)
7. **Audit Log Guide**
   - What is the audit log?
   - Filtering and searching
   - Debugging issues with audit log
   - Exporting audit data

8. **Expense Investment Linking**
   - Marking expenses as investments
   - Budget impact
   - When to use this feature

### Article Structure Template

```markdown
# [Feature Name] Guide

## What is [Feature]?
[Brief explanation, user benefit]

## When should I use [Feature]?
[Use cases, scenarios]

## Getting Started
[Step-by-step setup]

## Key Concepts
[Important concepts, terminology]

## Common Tasks
[Task 1: How to...]
[Task 2: How to...]
[Task 3: How to...]

## Tips & Best Practices
[Pro tips, common mistakes]

## Troubleshooting
[FAQ, common issues]
```

### Implementation Options

#### Option A: Full Documentation Suite
**Scope:**
- Write all 8 articles (Priority 1 + 2 + 3)
- Use consistent template
- Add screenshots/diagrams
- Update index.json
- Add in-app help links

**Pros:**
- Comprehensive coverage
- Consistent quality
- One-time effort
- Complete knowledge base

**Cons:**
- Large effort (2-3 weeks)
- Maintenance burden
- Some articles may not be read
- Over-documentation risk

**Effort:** High (2-3 weeks)

#### Option B: Priority 1 Only
**Scope:**
- Write 3 articles (Investment, Loans, Smart Rules)
- Use template
- Add screenshots
- Update index
- Add in-app help links

**Pros:**
- Focus on customer-critical
- Manageable effort (1 week)
- High impact
- Quick wins

**Cons:**
- Missing important guides
- Users may ask for other docs
- Incomplete coverage

**Effort:** Medium (1 week)

#### Option C: Incremental with Analytics
**Scope:**
- Start with Priority 1 (3 articles)
- Add in-app "Was this helpful?" feedback
- Track which articles are read
- Based on usage, prioritize next articles
- Add articles quarterly based on feedback

**Pros:**
- Data-driven prioritization
- Continuous improvement
- Feedback loop
- Flexible scope

**Cons:**
- Need analytics infrastructure
- Slower complete coverage
- Requires ongoing effort
- Uncertain initial scope

**Effort:** Medium (1 week initial + ongoing)

#### Option D: Video Guides + Quick Reference
**Scope:**
- Short 2-3 minute videos for Priority 1 features
- Quick reference cards (checklists)
- In-app video player
- Text guides as supplementary

**Pros:**
- Engaging format
- Better for visual learners
- Quick reference cards are handy
- Modern approach

**Cons:**
- Video production effort
- Hosting/bandwidth costs
- Hard to update videos
- Text still needed for search

**Effort:** High (3-4 weeks)

### Recommendation
**Option B (Priority 1 Only)** with these specifics:
- Write 3 comprehensive guides: Investment Buckets, Loan Management, Smart Rules
- Use consistent template
- Add 2-3 screenshots per guide
- Update index.json
- Add "Help" button in relevant screens (bucket detail, loan detail, smart rules)
- Plan for Priority 2 in next quarter based on user feedback

### Proposed Article List (For Your Review)

**Priority 1 (Customer-Critical):**
1. Investment Buckets: Complete Guide
2. Loan Management: Schedule, Prepayments & Corrections
3. Smart Rules: Auto-Categorization Made Easy

**Priority 2 (High Value):**
4. Hisaab: Settlements & Ledger Deep Dive
5. Duplicate Detection: Finding & Managing Duplicates
6. Demat Accounts: Portfolio Tracking

**Priority 3 (Power User):**
7. Audit Log: Debugging with Action History
8. Expense Investment Linking: Budget-Friendly Investing

---

## Summary & Next Steps

### Effort Estimates (Cumulative)
1. Product Logger: Option C - 2 days
2. Loan Corrections: Option E - 2-3 days
3. Investment Display: Option A - 1 day
4. Transaction Guards: Option A+ - 3-4 days
5. Settings Rethink: Option B - 2-3 days
6. Help Docs: Option B - 1 week

**Total:** ~2-3 weeks for all features (if done sequentially)

### Recommended Implementation Order
1. **Quick Wins First:**
   - Investment Display (1 day) - low risk, high value
   - Product Logger (2 days) - customer support value

2. **Medium Complexity:**
   - Settings Rethink (2-3 days) - improves UX across app
   - Loan Corrections (2-3 days) - fixes real user pain point

3. **High Complexity:**
   - Transaction Guards (3-4 days) - prevents errors, needs testing
   - Help Docs (1 week) - can be done in parallel

### Dependencies
- Transaction Guards depends on understanding current action matrix
- Loan Corrections depends on understanding loan engine
- Settings Rethink is independent
- Help Docs can be done anytime
- Product Logger is independent
- Investment Display is independent

### Please Review & Confirm
1. Which option for each feature do you prefer?
2. Should we implement all features or prioritize?
3. Any additional scenarios or considerations I missed?
4. Approval to proceed with implementation plan?
