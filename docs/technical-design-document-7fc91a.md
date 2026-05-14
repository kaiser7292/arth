# Technical & Functional Design Document

Detailed technical and functional specifications for 5 approved features based on user-selected implementation options.

---

## Approved Feature Options

1. **Product Logger** - Option C: Hybrid Smart Exporter with PII redaction
2. **Loan Corrections** - Option E: Hybrid (Latest action + soft restriction + warnings)
3. **Investment Display** - Option A: Simple merge with source badges
4. **Transaction Guards** - Option A+B Hybrid: Block with warning + undo previous + do new action
5. **Settings Rethink** - Option B with 5 sections from Option F
6. **Help Docs** - On hold

---

## Feature 1: Product Logger (Option C - Hybrid Smart Exporter)

### Functional Requirements

#### User Flow
1. User navigates to Settings → Security & Privacy
2. New row: "Export Logs" with subtitle "Share diagnostic data with support"
3. Tapping opens Log Exporter sheet
4. Sheet shows:
   - Time scope selector (Last 24h, 7 days, 30 days, Custom range)
   - Format selector (JSON, Plain Text, Both)
   - Preview of data size estimate
   - "Issue Description" text field (optional)
   - Export button
5. After export:
   - Save to device storage (Downloads folder)
   - Share intent (email, WhatsApp, etc.)
   - Show success message with file path

#### Data Scope
- **App Logs:** `app_logs` table (error + warn levels only)
- **Audit Log:** `audit_log` table (last 100 entries within scope)
- **Device Info:** OS version, app version, device model, build number
- **Time Scope:** Last 7 days default, custom range available

#### PII Redaction Rules
- **Account Numbers:** Show last 4 digits only (e.g., "XXXX1234")
- **Amounts:** Categorize as ranges (<₹1k, ₹1k-10k, >₹10k)
- **Phone Numbers:** Show last 4 digits only
- **Email Addresses:** Show local part + masked domain (e.g., "user@***.com")
- **Merchant Names:** Keep (not PII)
- **Descriptions:** Keep (not PII)
- **Stack Traces:** Keep (no PII in error messages)

### Technical Architecture

#### New Files
```
services/
  log-export.ts          # Log export logic
  pii-redactor.ts        # PII redaction utilities

app/settings/
  log-export-sheet.tsx   # Log export UI sheet
```

#### Database Queries
```typescript
// Fetch app logs within scope
SELECT level, message, context, created_at
FROM app_logs
WHERE created_at >= ?
  AND level IN ('error', 'warn')
ORDER BY created_at DESC;

// Fetch audit log within scope (last 100)
SELECT id, action_type, object_type, object_id, description,
       amount, account_label, date, action_timestamp, source_type
FROM audit_log
WHERE created_at >= ?
ORDER BY created_at DESC
LIMIT 100;
```

#### PII Redaction Implementation
```typescript
// services/pii-redactor.ts
export function redactAccountNumber(fullNumber: string): string {
  if (!fullNumber || fullNumber.length < 4) return "XXXX";
  return "XXXX" + fullNumber.slice(-4);
}

export function redactAmount(amount: number): string {
  if (amount < 1000) return "<₹1k";
  if (amount < 10000) return "₹1k-10k";
  return ">₹10k";
}

export function redactPhoneNumber(phone: string): string {
  if (!phone || phone.length < 4) return "XXXX";
  return "XXXX" + phone.slice(-4);
}

export function redactEmail(email: string): string {
  if (!email || !email.includes('@')) return "redacted@***.com";
  const [local, domain] = email.split('@');
  return `${local}@***.com`;
}

export function redactContext(context: unknown): unknown {
  if (!context) return null;
  if (typeof context === 'string') {
    return context; // Don't redact string context (might be error message)
  }
  if (typeof context === 'object') {
    const obj = context as Record<string, unknown>;
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key.toLowerCase().includes('account') || key.toLowerCase().includes('number')) {
        redacted[key] = typeof value === 'string' ? redactAccountNumber(value) : value;
      } else if (key.toLowerCase().includes('amount')) {
        redacted[key] = typeof value === 'number' ? redactAmount(value) : value;
      } else if (key.toLowerCase().includes('phone') || key.toLowerCase().includes('mobile')) {
        redacted[key] = typeof value === 'string' ? redactPhoneNumber(value) : value;
      } else if (key.toLowerCase().includes('email')) {
        redacted[key] = typeof value === 'string' ? redactEmail(value) : value;
      } else {
        redacted[key] = value;
      }
    }
    return redacted;
  }
  return context;
}
```

#### Log Export Service
```typescript
// services/log-export.ts
export interface LogExportOptions {
  scope: '24h' | '7d' | '30d' | 'custom';
  customFromDate?: string;
  customToDate?: string;
  format: 'json' | 'text' | 'both';
  issueDescription?: string;
}

export interface LogExportResult {
  jsonPath?: string;
  textPath?: string;
  sizeBytes: number;
  recordCount: number;
}

export async function exportLogs(
  options: LogExportOptions
): Promise<LogExportResult> {
  const db = getDatabase();
  const { fromDate, toDate } = computeDateRange(options);

  // Fetch logs
  const appLogs = await db.getAllAsync<AppLogRow>(
    `SELECT level, message, context, created_at
     FROM app_logs
     WHERE created_at >= ? AND created_at <= ?
       AND level IN ('error', 'warn')
     ORDER BY created_at DESC`,
    fromDate, toDate
  );

  const auditLogs = await db.getAllAsync<AuditLogRow>(
    `SELECT id, action_type, object_type, object_id, description,
            amount, account_label, date, action_timestamp, source_type
     FROM audit_log
     WHERE created_at >= ? AND created_at <= ?
     ORDER BY created_at DESC
     LIMIT 100`,
    fromDate, toDate
  );

  // Redact PII
  const redactedAppLogs = appLogs.map(log => ({
    ...log,
    context: redactContext(log.context)
  }));

  const redactedAuditLogs = auditLogs.map(log => ({
    ...log,
    account_label: log.account_label ? redactAccountNumber(log.account_label) : null,
    amount: log.amount ? redactAmount(log.amount) : null
  }));

  // Build export payload
  const payload = {
    exportedAt: new Date().toISOString(),
    appVersion: getAppVersion(),
    osVersion: Platform.OS + ' ' + Platform.Version,
    deviceModel: Device.modelName || 'Unknown',
    issueDescription: options.issueDescription || null,
    scope: { fromDate, toDate },
    appLogs: redactedAppLogs,
    auditLogs: redactedAuditLogs
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseFileName = `artha_logs_${timestamp}`;

  const result: LogExportResult = {
    sizeBytes: 0,
    recordCount: appLogs.length + auditLogs.length
  };

  // Write files
  if (options.format === 'json' || options.format === 'both') {
    const jsonPath = `${FileSystem.documentDirectory}${baseFileName}.json`;
    await FileSystem.writeAsStringAsync(jsonPath, JSON.stringify(payload, null, 2));
    result.jsonPath = jsonPath;
    result.sizeBytes += (await FileSystem.getInfoAsync(jsonPath)).size || 0;
  }

  if (options.format === 'text' || options.format === 'both') {
    const textPath = `${FileSystem.documentDirectory}${baseFileName}.txt`;
    const textContent = formatLogsAsText(payload);
    await FileSystem.writeAsStringAsync(textPath, textContent);
    result.textPath = textPath;
    result.sizeBytes += (await FileSystem.getInfoAsync(textPath)).size || 0;
  }

  return result;
}

function formatLogsAsText(payload: LogExportPayload): string {
  const lines: string[] = [];
  lines.push('=== ARTHA LOG EXPORT ===');
  lines.push(`Exported: ${payload.exportedAt}`);
  lines.push(`App Version: ${payload.appVersion}`);
  lines.push(`OS: ${payload.osVersion}`);
  lines.push(`Device: ${payload.deviceModel}`);
  if (payload.issueDescription) {
    lines.push(`Issue: ${payload.issueDescription}`);
  }
  lines.push(`Scope: ${payload.scope.fromDate} to ${payload.scope.toDate}`);
  lines.push('');

  lines.push('--- APP LOGS ---');
  for (const log of payload.appLogs) {
    lines.push(`[${log.created_at}] ${log.level.toUpperCase()}: ${log.message}`);
    if (log.context) {
      lines.push(`  Context: ${JSON.stringify(log.context)}`);
    }
  }
  lines.push('');

  lines.push('--- AUDIT LOG ---');
  for (const log of payload.auditLogs) {
    lines.push(`[${log.action_timestamp}] ${log.action_type} - ${log.object_type}`);
    lines.push(`  Description: ${log.description}`);
    if (log.account_label) lines.push(`  Account: ${log.account_label}`);
    if (log.amount) lines.push(`  Amount: ${log.amount}`);
  }

  return lines.join('\n');
}
```

#### UI Component Structure
```typescript
// app/settings/log-export-sheet.tsx
export function LogExportSheet({
  visible,
  onClose,
}: Props) {
  const [scope, setScope] = useState<'24h' | '7d' | '30d' | 'custom'>('7d');
  const [format, setFormat] = useState<'json' | 'text' | 'both'>('both');
  const [issueDescription, setIssueDescription] = useState('');
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<LogExportResult | null>(null);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await exportLogs({ scope, format, issueDescription });
      setResult(res);
    } catch (e) {
      alert('Export Failed', e.message);
    } finally {
      setExporting(false);
    }
  };

  const handleShare = async (path: string) => {
    await Sharing.shareAsync(path);
  };

  // ... UI rendering
}
```

### Database Changes
None required (using existing tables)

### Migration
None required

### Testing Strategy
- Unit tests for PII redaction functions
- Integration tests for log export service
- UI tests for export flow
- Verify redaction doesn't break log readability
- Test file sharing on iOS and Android

### Edge Cases
- No logs in scope → Show empty state
- Very large logs (>5MB) → Warn user, offer to reduce scope
- File system permissions → Handle permission errors gracefully
- Sharing fails → Provide alternative (save to device only)

---

## Feature 2: Loan Corrections (Option E - Hybrid)

### Functional Requirements

#### User Flow - Manual Correction
1. User opens loan detail screen
2. Taps "Manual Correction"
3. Correction sheet shows current computed values
4. User enters new outstanding, EMI, optional tenure
5. On submit:
   - If > 3 corrections exist: Show warning "You have many corrections. Consider deactivating old ones."
   - Create new correction row
   - Regenerate schedule from correction date
   - Mark new correction as "active"

#### User Flow - Prepayment
1. User opens loan detail screen
2. Taps "Record Prepayment"
3. Prepayment sheet shows current EMI, strategy options
4. User enters amount, date, strategy
5. On submit:
   - Create prepayment row
   - Regenerate schedule from prepayment date
   - If correction exists on/before date: Prepayment takes precedence (latest action wins)
   - Show banner: "This prepayment overrides your manual correction from [date]"

#### User Flow - Deactivate Correction
1. User opens loan detail screen
2. Taps "Corrections" section
3. Shows list of all corrections with "Active" badge
4. Taps "Deactivate" on old correction
5. Confirmation: "This will mark the correction as inactive. The schedule will recompute."
6. On confirm:
   - Soft delete correction (set deleted_at)
   - Regenerate schedule from next action or origin
   - Show success message

#### Conflict Resolution Logic
```typescript
// When computing schedule at date D:
function computeOutstandingAt(loanId: string, asOfDate: string): number {
  // Find all actions on/before asOfDate
  const corrections = await getCorrectionsOnOrBefore(loanId, asOfDate);
  const prepayments = await getPrepaymentsOnOrBefore(loanId, asOfDate);

  // Sort by date descending, then created_at descending
  const allActions = [
    ...corrections.map(c => ({ ...c, type: 'correction' as const })),
    ...prepayments.map(p => ({ ...p, type: 'prepayment' as const }))
  ].sort((a, b) => {
    if (a.effective_date !== b.effective_date) {
      return b.effective_date.localeCompare(a.effective_date);
    }
    return b.created_at.localeCompare(a.created_at);
  });

  // Latest action wins
  const latest = allActions[0];
  if (!latest) {
    // No actions, use original loan parameters
    return computeFromOrigin(loanId, asOfDate);
  }

  if (latest.type === 'correction') {
    // Use correction's outstanding as base
    return latest.outstanding_principal;
  }

  if (latest.type === 'prepayment' && latest.strategy === 'reduce_emi') {
    // Recompute from prepayment
    return computeFromPrepayment(latest, asOfDate);
  }

  // For reduce_tenure or no strategy, use correction if exists
  const latestCorrection = corrections
    .filter(c => c.effective_date <= asOfDate)
    .sort((a, b) => b.effective_date.localeCompare(a.effective_date))[0];

  if (latestCorrection) {
    return latestCorrection.outstanding_principal;
  }

  return computeFromOrigin(loanId, asOfDate);
}
```

### Technical Architecture

#### Database Schema Changes
```sql
-- Add deleted_at to loan_corrections for soft delete
ALTER TABLE loan_corrections ADD COLUMN deleted_at TEXT;

-- Add index for efficient querying
CREATE INDEX idx_loan_corrections_deleted ON loan_corrections(deleted_at);
```

#### Service Updates
```typescript
// services/loan-accounts.ts

export async function recordCorrection(
  loanAccountId: string,
  payload: {
    effective_date: string;
    outstanding_principal: number;
    emi_amount: number;
    tenure_remaining_months?: number;
    reason?: string;
  }
): Promise<string> {
  const db = getDatabase();

  // Check correction count
  const count = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM loan_corrections
     WHERE loan_account_id = ? AND deleted_at IS NULL`,
    loanAccountId
  );

  if (count && count.count >= 3) {
    // Warning handled in UI, proceed anyway
  }

  const id = generateUUID();
  await db.runAsync(
    `INSERT INTO loan_corrections (
       id, loan_account_id, effective_date, outstanding_principal,
       emi_amount, tenure_remaining_months, reason, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    id, loanAccountId, payload.effective_date, payload.outstanding_principal,
    payload.emi_amount, payload.tenure_remaining_months ?? null,
    payload.reason ?? null
  );

  // Regenerate schedule
  await regenerateLoanSchedule(loanAccountId);
  bumpDataVersion();
  return id;
}

export async function deactivateCorrection(correctionId: string): Promise<void> {
  const db = getDatabase();
  const correction = await db.getFirstAsync<{ loan_account_id: string }>(
    "SELECT loan_account_id FROM loan_corrections WHERE id = ?",
    correctionId
  );
  if (!correction) throw new Error("Correction not found");

  await db.runAsync(
    "UPDATE loan_corrections SET deleted_at = datetime('now') WHERE id = ?",
    correctionId
  );

  await regenerateLoanSchedule(correction.loan_account_id);
  bumpDataVersion();
}

export async function getActiveCorrections(loanAccountId: string): Promise<LoanCorrectionRow[]> {
  const db = getDatabase();
  return db.getAllAsync<LoanCorrectionRow>(
    `SELECT * FROM loan_corrections
     WHERE loan_account_id = ? AND deleted_at IS NULL
     ORDER BY effective_date DESC`,
    loanAccountId
  );
}
```

#### UI Updates
```typescript
// components/loans/ManualCorrectionSheet.tsx

// Add warning for > 3 corrections
{correctionCount >= 3 && (
  <View className="p-3 rounded-lg mb-3" style={{ backgroundColor: colors.warning + '20' }}>
    <Text className="text-xs" style={{ color: colors.warning }}>
      You have {correctionCount} corrections. Consider deactivating old ones to keep your loan data clean.
    </Text>
  </View>
)}

// app/loans/[id].tsx

// Add corrections section
<Card title="Corrections" className="mb-4">
  {activeCorrections.length === 0 ? (
    <Text className="text-sm text-text-secondary">No manual corrections</Text>
  ) : (
    activeCorrections.map(correction => (
      <View key={correction.id} className="flex-row items-center justify-between py-2 border-b">
        <View>
          <Text className="text-sm">{formatDate(correction.effective_date)}</Text>
          <Text className="text-xs text-text-secondary">
            Outstanding: {formatAmount(correction.outstanding_principal)}
          </Text>
        </View>
        <Pressable onPress={() => handleDeactivate(correction.id)}>
          <Text className="text-sm text-danger">Deactivate</Text>
        </Pressable>
      </View>
    ))
  )}
</Card>
```

### Migration
```typescript
// database/migrations/XXX_add_correction_deleted_at.ts

export async function up(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    ALTER TABLE loan_corrections ADD COLUMN deleted_at TEXT;
    CREATE INDEX IF NOT EXISTS idx_loan_corrections_deleted
      ON loan_corrections(deleted_at);
  `);
}

export async function down(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    DROP INDEX IF EXISTS idx_loan_corrections_deleted;
    -- SQLite doesn't support DROP COLUMN, so recreate table without deleted_at
  `);
}
```

### Testing Strategy
- Unit tests for conflict resolution logic
- Integration tests for correction + prepayment interactions
- UI tests for correction sheet and deactivation flow
- Test scenarios:
  - Correction only
  - Prepayment only
  - Correction then prepayment (same date)
  - Prepayment then correction (same date)
  - Multiple corrections with deactivation
  - Prepayment after correction (different dates)

### Edge Cases
- Same date actions: Use created_at as tiebreaker
- No corrections: Fall back to original loan params
- All corrections deactivated: Recompute from origin
- Prepayment with reduce_tenure: Still respects correction
- Very old corrections: Migration to auto-deactivate (> 6 months)

---

## Feature 3: Investment Display (Option A - Simple Merge)

### Functional Requirements

#### User Flow
1. User opens investment bucket detail screen
2. Shows "All Contributions" section (sorted by date descending)
3. Each contribution row shows:
   - Date
   - Amount
   - Source badge: "from expense" / "from transfer" / "manual"
   - Tap badge to navigate to source
4. "Contribution from expense" section removed
5. All contributions unified in single list

### Technical Architecture

#### Service Updates
```typescript
// app/goals/investment-detail.tsx

// Remove expenseLinks state
// const [expenseLinks, setExpenseLinks] = useState<...>([]);

// Merge all contributions into single list
const allContributions = useMemo(() => {
  const manual: InvestmentContribution[] = contributions.map(c => ({
    ...c,
    source: 'manual' as const,
    sourceId: c.id,
    sourceDate: c.date
  }));

  const fromExpenses: InvestmentContribution[] = expenseLinks.map(el => ({
    id: el.link.id,
    investment_bucket_id: el.link.investment_bucket_id,
    month: el.expense_date.slice(0, 7),
    amount: el.link.contribution_amount,
    date: el.expense_date,
    notes: el.link.notes,
    source: 'expense' as const,
    sourceId: el.link.expense_id,
    sourceDate: el.expense_date
  }));

  const fromTransfers: InvestmentContribution[] = transferLinks.map(tl => ({
    id: tl.contribution_id,
    investment_bucket_id: tl.investment_bucket_id,
    month: tl.transfer_date.slice(0, 7),
    amount: tl.amount,
    date: tl.transfer_date,
    notes: `Auto from transfer (${tl.demat_target})`,
    source: 'transfer' as const,
    sourceId: tl.transfer_id,
    sourceDate: tl.transfer_date
  }));

  return [...manual, ...fromExpenses, ...fromTransfers]
    .sort((a, b) => b.date.localeCompare(a.date));
}, [contributions, expenseLinks, transferLinks]);

// Render unified list
{allContributions.map(contrib => (
  <ContributionRow
    key={`${contrib.source}-${contrib.sourceId}`}
    contribution={contrib}
    onPress={() => handleSourceTap(contrib)}
  />
))}
```

#### Component Updates
```typescript
// ContributionRow component

function ContributionRow({ contribution, onPress }: Props) {
  const { colors } = useColorScheme();

  const handleBadgePress = () => {
    if (contribution.source === 'expense') {
      router.push(`/expense/${contribution.sourceId}`);
    } else if (contribution.source === 'transfer') {
      router.push(`/settings/account-detail?accountId=${contribution.sourceId}`);
    }
  };

  return (
    <View className="flex-row items-center justify-between py-2 border-b">
      <View className="flex-1">
        <Text className="text-sm">{formatDate(contribution.date)}</Text>
        <Text className="text-lg font-bold">{formatAmount(contribution.amount)}</Text>
        {contribution.notes && (
          <Text className="text-xs text-text-secondary">{contribution.notes}</Text>
        )}
      </View>
      {contribution.source !== 'manual' && (
        <Pressable
          onPress={handleBadgePress}
          className="px-2 py-1 rounded bg-blue-100 dark:bg-blue-900"
        >
          <Text className="text-xs text-blue-600 dark:text-blue-300">
            from {contribution.source}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
```

#### Database Changes
None required (data already exists)

#### Migration
None required

### Testing Strategy
- Unit tests for contribution merging logic
- UI tests for unified list rendering
- Test navigation from badges to source
- Verify sorting by date
- Test with mixed sources (manual, expense, transfer)

### Edge Cases
- No contributions: Show empty state
- Same date contributions: Sort by source type (manual > expense > transfer)
- Expense deleted: Handle gracefully (shouldn't happen due to FK)
- Transfer deleted: Handle gracefully

---

## Feature 4: Transaction Guards (Option A+B Hybrid)

### Functional Requirements

#### Conflict Matrix
```
Investment + Loan EMI: BLOCK
Investment + Loan Prepayment: BLOCK
Investment + Transfer: BLOCK
Loan EMI + Transfer: BLOCK
Loan Prepayment + Transfer: BLOCK
Refund + Any: BLOCK
Split + Refund: BLOCK
Investment + Split: ALLOW (partial)
Loan + Split: ALLOW (partial)
```

#### User Flow - Conflict Detected
1. User tries to mark expense as investment
2. System checks: Is expense already linked to loan?
3. If yes: Show warning dialog
   - Title: "Action Conflict"
   - Message: "This expense is already linked to a loan payment. Marking it as investment will unlink it from the loan. Continue?"
   - Buttons: "Cancel", "Unlink & Continue"
4. If user confirms:
   - Unlink from loan (delete expense_loan_links row)
   - If EMI: Revert schedule entry to 'scheduled'
   - If prepayment: Delete prepayment row, regenerate schedule
   - Link to investment bucket
   - Show success: "Unlinked from loan and marked as investment"

#### User Flow - Split with Investment
1. User marks expense as investment
2. User then splits expense
3. Split sheet shows "Investment amount" field
4. User enters investment amount (e.g., ₹8,000 of ₹10,000)
5. On submit:
   - Update investment link amount to ₹8,000
   - Create split: ₹2,000 as regular expense
   - Show success: "Split created: ₹8,000 invested, ₹2,000 as expense"

### Technical Architecture

#### Service Updates
```typescript
// services/expense-investment-link.ts

export async function linkExpenseToBucket(
  expenseId: string,
  bucketId: string,
  notes?: string
): Promise<string> {
  const db = getDatabase();

  // Check for conflicts
  const loanLink = await getLoanLinkForExpense(expenseId);
  if (loanLink) {
    throw new InvestmentLinkError(
      "CONFLICT_LOAN",
      "This expense is linked to a loan payment. Unlink it first or use the conflict resolution flow."
    );
  }

  const transfer = await getTransferForExpense(expenseId);
  if (transfer) {
    throw new InvestmentLinkError(
      "CONFLICT_TRANSFER",
      "This expense is a transfer. Transfers cannot be marked as investments."
    );
  }

  // ... existing validation logic
  // ... create link
}

// New conflict resolution function
export async function resolveAndLinkExpenseToBucket(
  expenseId: string,
  bucketId: string,
  notes?: string
): Promise<string> {
  const db = getDatabase();

  // Check and resolve conflicts
  const loanLink = await getLoanLinkForExpense(expenseId);
  if (loanLink) {
    await unlinkExpenseFromLoan(expenseId);
  }

  // ... create link
  return await linkExpenseToBucket(expenseId, bucketId, notes);
}
```

#### UI Updates
```typescript
// components/expense/InvestmentBucketPickerSheet.tsx

const handleConfirm = async () => {
  try {
    await linkExpenseToBucket(expenseId, bucketId, notes);
    onSuccess();
    onClose();
  } catch (e) {
    if (e instanceof InvestmentLinkError && e.message === "CONFLICT_LOAN") {
      // Show conflict resolution dialog
      alert(
        "Action Conflict",
        "This expense is already linked to a loan payment. Marking it as investment will unlink it from the loan. Continue?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Unlink & Continue",
            style: "destructive",
            onPress: async () => {
              await resolveAndLinkExpenseToBucket(expenseId, bucketId, notes);
              onSuccess();
              onClose();
            }
          }
        ]
      );
    } else {
      alert("Error", e.message);
    }
  }
};
```

#### Split with Investment
```typescript
// services/expense-splits.ts

export async function createSplitWithInvestment(
  expenseId: string,
  splits: Array<{ amount: number; category_id?: string }>,
  investmentAmount?: number,
  investmentBucketId?: string
): Promise<void> {
  const db = getDatabase();

  await db.withTransactionAsync(async () => {
    // If investment amount specified, update the link
    if (investmentAmount && investmentBucketId) {
      const link = await getLinkForExpense(expenseId);
      if (link) {
        await db.runAsync(
          `UPDATE expense_investment_links
           SET contribution_amount = ?, updated_at = datetime('now')
           WHERE expense_id = ?`,
          investmentAmount,
          expenseId
        );
        await recomputeBucketContributed(investmentBucketId);
      }
    }

    // Create split for remaining amount
    const expense = await db.getFirstAsync<{ amount: number }>(
      "SELECT amount FROM expenses WHERE id = ?",
      expenseId
    );
    if (!expense) throw new Error("Expense not found");

    const remainingAmount = expense.amount - (investmentAmount || 0);
    if (remainingAmount > 0) {
      await createSplit(expenseId, splits);
    }
  });

  bumpDataVersion();
}
```

#### UI for Split with Investment
```typescript
// components/expense/SplitSheet.tsx

// Add investment amount field if expense is linked
{investmentLink && (
  <Input
    label="Investment Amount"
    value={investmentAmount}
    onChangeText={setInvestmentAmount}
    keyboardType="numeric"
    placeholder={String(investmentLink.contribution_amount)}
    helperText="Remaining amount will be split as regular expense"
  />
)}
```

### Database Changes
None required (using existing tables)

### Migration
```typescript
// Check for existing conflicts and flag for user review
export async function flagConflictingExpenses(db: SQLiteDatabase): Promise<void> {
  // Find expenses with both investment and loan links
  const conflicts = await db.getAllAsync<{ expense_id: string }>(
    `SELECT DISTINCT eil.expense_id
     FROM expense_investment_links eil
     JOIN expense_loan_links ell ON eil.expense_id = ell.expense_id
     WHERE eil.expense_id = ell.expense_id`
  );

  // Add flag or create cleanup task
  for (const conflict of conflicts) {
    await db.runAsync(
      `INSERT INTO cleanup_tasks (type, entity_id, created_at)
       VALUES ('expense_conflict', ?, datetime('now'))`,
      conflict.expense_id
    );
  }
}
```

### Testing Strategy
- Unit tests for conflict detection
- Integration tests for conflict resolution flow
- UI tests for warning dialogs
- Test split with investment
- Test all conflict matrix combinations
- Verify cleanup after unlink

### Edge Cases
- Multiple conflicts (loan + transfer): Show both in warning
- Split after investment: Update link amount correctly
- Investment amount > expense total: Validate and block
- Concurrent actions: Use transactions

---

## Feature 5: Settings Rethink (Option B with 5 Sections)

### Functional Requirements

#### New Settings Structure (5 Sections)
1. **Data Management**
   - Categories
   - Payment Modes
   - Accounts
   - Tags
   - Import from Excel

2. **Automation**
   - Reminders
   - Smart Rules
   - Smart SMS Templates
   - Merchant Aliases
   - Audit Log
   - SMS Detection (moved from separate section)

3. **Backup & Security**
   - Backup & Restore
   - App Lock
   - Data Cleanup
   - Recycle Bin
   - Dismissed Duplicates

4. **Integrations**
   - Kite Connect

5. **Advanced**
   - Fiscal Year Start
   - Theme
   - Region

#### Additional Features
- Search bar at top
- Collapsible sections (expand/collapse all)
- Recently Used section (last 5 accessed)
- Section badges showing count (e.g., "Automation (5)")

### Technical Architecture

#### UI Component Structure
```typescript
// app/(tabs)/settings.tsx

const [searchQuery, setSearchQuery] = useState('');
const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['data', 'automation', 'backup', 'integrations', 'advanced']));
const [recentlyUsed, setRecentlyUsed] = useState<string[]>([]);

// Settings sections definition
const SETTINGS_SECTIONS = [
  {
    id: 'data',
    title: 'Data Management',
    icon: 'grid-outline',
    items: [
      { key: 'categories', label: 'Categories', subtitle: 'Manage expense categories', route: '/settings/categories' },
      { key: 'payment-modes', label: 'Payment Modes', subtitle: 'Credit cards, UPI, wallets', route: '/settings/payment-modes' },
      { key: 'accounts', label: 'Accounts', subtitle: 'Add & manage account details', route: '/settings/account-master' },
      { key: 'tags', label: 'Tags', subtitle: 'Label and organize expenses', route: '/settings/tags' },
      { key: 'import', label: 'Import from Excel', subtitle: 'Import transactions from .xlsx', route: '/settings/import-excel' },
    ]
  },
  {
    id: 'automation',
    title: 'Automation',
    icon: 'repeat-outline',
    items: [
      { key: 'reminders', label: 'Reminders', subtitle: 'Rent, subscriptions, recurring expenses', route: '/settings/recurring-rules' },
      { key: 'smart-rules', label: 'Smart Rules', subtitle: 'Auto-categorize by merchant, amount, account', route: '/settings/smart-rules' },
      { key: 'sms-templates', label: 'Smart SMS Templates', subtitle: 'Teach Artha to read SMS from any bank', route: '/settings/sms-templates' },
      { key: 'merchant-aliases', label: 'Merchant Aliases', subtitle: 'Clean up SMS merchant names', route: '/settings/merchant-aliases' },
      { key: 'audit-log', label: 'Audit Log', subtitle: 'View all actions on records', route: '/settings/audit-log' },
      { key: 'sms', label: 'SMS Detection', subtitle: 'Detect expenses from SMS', route: '#sms-section' },
    ]
  },
  // ... other sections
];

// Filter items by search
const filteredSections = useMemo(() => {
  if (!searchQuery) return SETTINGS_SECTIONS;
  const query = searchQuery.toLowerCase();
  return SETTINGS_SECTIONS.map(section => ({
    ...section,
    items: section.items.filter(item =>
      item.label.toLowerCase().includes(query) ||
      item.subtitle.toLowerCase().includes(query)
    )
  })).filter(section => section.items.length > 0);
}, [searchQuery]);

// Render
<ScreenContainer>
  <SearchBar value={searchQuery} onChange={setSearchQuery} />
  
  {recentlyUsed.length > 0 && (
    <Card title="Recently Used">
      {recentlyUsed.map(key => renderSettingsItem(key))}
    </Card>
  )}

  {filteredSections.map(section => (
    <Card
      key={section.id}
      title={section.title}
      subtitle={`${section.items.length} items`}
      onToggleExpand={() => toggleSection(section.id)}
      expanded={expandedSections.has(section.id)}
    >
      {expandedSections.has(section.id) && section.items.map(item => renderSettingsItem(item))}
    </Card>
  ))}
</ScreenContainer>
```

#### Recently Used Tracking
```typescript
// services/settings.ts

const RECENTLY_USED_KEY = 'recently_used_settings';

export async function addToRecentlyUsed(key: string): Promise<void> {
  const current = await getRecentlyUsed();
  const filtered = current.filter(k => k !== key);
  const updated = [key, ...filtered].slice(0, 5);
  await AsyncStorage.setItem(RECENTLY_USED_KEY, JSON.stringify(updated));
}

export async function getRecentlyUsed(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(RECENTLY_USED_KEY);
  return raw ? JSON.parse(raw) : [];
}

// Usage in settings screen
const handleNavigate = (route: string, key: string) => {
  router.push(route as never);
  addToRecentlyUsed(key);
};
```

#### Search Implementation
```typescript
// Search bar component
function SearchBar({ value, onChange }: Props) {
  const { colors } = useColorScheme();
  return (
    <View className="mx-4 mb-3">
      <View className="flex-row items-center border rounded-lg px-3 py-2" style={{ borderColor: colors.border }}>
        <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder="Search settings..."
          placeholderTextColor={colors.textSecondary}
          className="flex-1 ml-2 text-sm"
          style={{ color: colors.text }}
        />
        {value && (
          <Pressable onPress={() => onChange('')}>
            <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>
    </View>
  );
}
```

#### Collapsible Section Component
```typescript
// components/ui/CollapsibleCard.tsx

export function CollapsibleCard({
  title,
  subtitle,
  icon,
  expanded,
  onToggle,
  children,
}: Props) {
  const { colors } = useColorScheme();
  return (
    <Card className="mb-4">
      <Pressable onPress={onToggle} className="flex-row items-center py-3">
        <Ionicons name={icon} size={20} color={colors.textSecondary} />
        <View className="flex-1 ml-3">
          <Text className="text-base">{title}</Text>
          {subtitle && (
            <Text className="text-xs text-text-secondary">{subtitle}</Text>
          )}
        </View>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
      </Pressable>
      {expanded && <View className="pt-2">{children}</View>}
    </Card>
  );
}
```

### Database Changes
None required

### Migration
None required

### Testing Strategy
- UI tests for search functionality
- Test collapsible sections expand/collapse
- Test recently used tracking
- Test search filters correctly
- Test navigation from all items
- Verify SMS Detection moved to Automation section

### Edge Cases
- Search matches no items: Show empty state
- Recently used cleared: Handle gracefully
- All sections collapsed: Show "Expand All" button
- Search with special characters: Handle correctly

---

## Implementation Order & Dependencies

### Phase 1: Quick Wins (Week 1)
1. **Investment Display** (1 day) - Independent, low risk
2. **Product Logger** (2 days) - Independent, customer value

### Phase 2: Medium Complexity (Week 2)
3. **Settings Rethink** (2-3 days) - Independent, UX improvement
4. **Loan Corrections** (2-3 days) - Depends on loan engine understanding

### Phase 3: High Complexity (Week 3)
5. **Transaction Guards** (3-4 days) - Depends on action matrix, needs extensive testing

### Parallel Opportunities
- Help Docs can be done in parallel (on hold per user request)
- Testing can be done alongside development

---

## Testing Strategy Overview

### Unit Tests
- PII redaction functions
- Conflict resolution logic
- Contribution merging logic
- Recently used tracking

### Integration Tests
- Log export service
- Loan correction + prepayment interactions
- Transaction guard conflict resolution
- Settings navigation

### UI Tests
- Log export sheet flow
- Correction sheet with warnings
- Investment detail unified list
- Settings search and collapsible sections
- Conflict warning dialogs

### Manual Testing Checklist
- [ ] Export logs in JSON format
- [ ] Export logs in text format
- [ ] Verify PII redaction in exported logs
- [ ] Share logs via email
- [ ] Create manual correction
- [ ] Deactivate old correction
- [ ] Add prepayment after correction
- [ ] Verify latest action wins
- [ ] View unified investment contributions
- [ ] Tap "from expense" badge → navigate to expense
- [ ] Tap "from transfer" badge → navigate to account
- [ ] Try conflicting actions → see warning
- [ ] Confirm conflict resolution → unlink previous
- [ ] Split investment-linked expense
- [ ] Search settings
- [ ] Collapse/expand sections
- [ ] View recently used settings

---

## Migration Strategy

### Database Migrations
1. Add `deleted_at` to `loan_corrections` table
2. Create index on `deleted_at`
3. Run conflict detection migration to flag existing conflicts

### Data Migration
- Auto-deactivate corrections older than 6 months
- Flag existing expense conflicts for user review
- Migrate recently used from old structure (if any)

### Backward Compatibility
- All changes are additive or soft deletes
- Existing data remains valid
- UI changes don't break existing flows

---

## Rollback Plan

### If Issues Arise
1. **Product Logger:** Disable export button, keep code
2. **Loan Corrections:** Revert to old logic (ignore deleted_at)
3. **Investment Display:** Revert to separate sections
4. **Transaction Guards:** Disable conflict checks
5. **Settings:** Revert to old structure

### Rollback Steps
1. Revert database migration (add deleted_at column)
2. Revert UI changes
3. Restore old service logic
4. Test rollback works correctly

---

## Performance Considerations

### Log Export
- Limit audit log to 100 entries to prevent large files
- Redaction happens synchronously but should be fast
- File writing may be slow for large logs - show loading indicator

### Loan Corrections
- Conflict resolution queries should be indexed
- Regenerating schedule on every action may be slow - consider async
- Cache computed outstanding where possible

### Investment Display
- Merging contributions in memory is fast for reasonable data sizes
- Consider pagination if > 1000 contributions

### Settings Search
- Search is client-side, should be instant for 25 items
- Recently used stored in AsyncStorage, fast access

---

## Security Considerations

### Log Export
- PII redaction is critical - must be thoroughly tested
- User must consent before sharing
- Files saved to device - user can delete
- No automatic upload to server

### Loan Corrections
- Soft delete preserves historical data
- No sensitive data exposed in corrections
- Audit trail tracks all changes

### Transaction Guards
- Conflict resolution requires user confirmation
- No automatic unlinking without approval
- Audit log tracks all unlinks

---

## Success Metrics

### Product Logger
- Number of log exports (track usage)
- Support ticket resolution time improvement
- User feedback on log export usefulness

### Loan Corrections
- Reduction in support tickets about loan schedule issues
- Number of corrections deactivated (cleanup)
- User feedback on conflict resolution

### Investment Display
- User engagement with investment bucket details
- Navigation to source from badges (track clicks)
- User feedback on unified view

### Transaction Guards
- Reduction in conflicting expense states
- Number of conflict resolutions (track usage)
- User feedback on warning clarity

### Settings Rethink
- Time to find specific setting (before vs after)
- Search usage statistics
- Recently used section usage
- User feedback on organization

---

## Open Questions

1. **Log Export:** Should we include a "Send to Support" button that emails directly to support@artha.app?
2. **Loan Corrections:** Should we add a "Reset to Original" button that removes all corrections?
3. **Investment Display:** Should we add a filter by source type (even though not requested)?
4. **Transaction Guards:** Should we allow investment + transfer if user explicitly wants both?
5. **Settings:** Should we add a "Reset All Settings" button?

---

## Next Steps

1. **User Approval:** Review this technical design document
2. **Clarify Open Questions:** Resolve any ambiguities
3. **Begin Implementation:** Start with Phase 1 (Investment Display + Product Logger)
4. **Testing:** Write tests alongside implementation
5. **Code Review:** Review each feature before merging
6. **Release:** Bundle features in v17.7.0 release
