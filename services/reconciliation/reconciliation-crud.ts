import { getDatabase } from "@/database";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReconStatus = "in_progress" | "completed" | "abandoned";
export type ReconItemStatus = "matched" | "unmatched" | "excluded" | "added";
export type MatchConfidence = "auto" | "suggested" | "manual";
export type StmtDirection = "debit" | "credit";
export type ExcludeReason = "cashback" | "bank_charge" | "reward_fee" | "refund" | "pre_arth" | "other";
export type ImportFormat = "pdf" | "xls" | "xlsx";

export interface ReconciliationSession {
  id: string;
  account_id: string;
  stmt_start_date: string;
  stmt_end_date: string;
  stmt_closing_bal: number | null;
  arth_closing_bal: number | null;
  total_stmt_count: number | null;
  matched_count: number | null;
  status: ReconStatus;
  import_format: ImportFormat | null;
  import_filename: string | null;
  created_at: string;
  completed_at: string | null;
  deleted_at: string | null;
}

export interface ReconciliationItem {
  id: string;
  session_id: string;
  stmt_date: string;
  stmt_amount: number;
  stmt_direction: StmtDirection;
  stmt_narration: string | null;
  matched_expense_id: string | null;
  matched_transfer_id: string | null;
  match_confidence: MatchConfidence | null;
  status: ReconItemStatus;
  exclude_reason: ExcludeReason | null;
  sort_order: number | null;
  created_at: string;
  deleted_at: string | null;
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function createSession(input: {
  account_id: string;
  stmt_start_date: string;
  stmt_end_date: string;
  stmt_closing_bal?: number;
  import_format?: ImportFormat;
  import_filename?: string;
}): Promise<string> {
  const db = getDatabase();
  const id = genId("rs");
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO reconciliation_sessions
     (id, account_id, stmt_start_date, stmt_end_date, stmt_closing_bal,
      import_format, import_filename, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'in_progress', ?)`,
    [id, input.account_id, input.stmt_start_date, input.stmt_end_date,
     input.stmt_closing_bal ?? null, input.import_format ?? null,
     input.import_filename ?? null, now],
  );
  return id;
}

export async function getSessions(accountId?: string): Promise<ReconciliationSession[]> {
  const db = getDatabase();
  if (accountId) {
    return db.getAllAsync<ReconciliationSession>(
      `SELECT * FROM reconciliation_sessions
       WHERE deleted_at IS NULL AND account_id = ?
       ORDER BY created_at DESC`,
      [accountId],
    );
  }
  return db.getAllAsync<ReconciliationSession>(
    `SELECT * FROM reconciliation_sessions
     WHERE deleted_at IS NULL
     ORDER BY created_at DESC`,
  );
}

export async function getSession(id: string): Promise<ReconciliationSession | null> {
  const db = getDatabase();
  return db.getFirstAsync<ReconciliationSession>(
    `SELECT * FROM reconciliation_sessions WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
}

export async function updateSession(id: string, patch: Partial<{
  stmt_closing_bal: number;
  arth_closing_bal: number;
  total_stmt_count: number;
  matched_count: number;
  status: ReconStatus;
  completed_at: string;
}>): Promise<void> {
  const db = getDatabase();
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];

  const map: [string, string | number | null | undefined][] = [
    ["stmt_closing_bal", patch.stmt_closing_bal],
    ["arth_closing_bal", patch.arth_closing_bal],
    ["total_stmt_count", patch.total_stmt_count],
    ["matched_count", patch.matched_count],
    ["status", patch.status],
    ["completed_at", patch.completed_at],
  ];

  for (const [col, val] of map) {
    if (val !== undefined) {
      sets.push(`${col} = ?`);
      vals.push(val as string | number | null);
    }
  }
  if (sets.length === 0) return;
  vals.push(id);
  await db.runAsync(
    `UPDATE reconciliation_sessions SET ${sets.join(", ")} WHERE id = ?`,
    vals,
  );
}

export async function deleteSession(id: string): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE reconciliation_sessions SET deleted_at = ? WHERE id = ?`,
    [now, id],
  );
}

// ─── Items ────────────────────────────────────────────────────────────────────

export async function bulkInsertItems(
  sessionId: string,
  items: {
    stmt_date: string;
    stmt_amount: number;
    stmt_direction: StmtDirection;
    stmt_narration?: string;
    matched_expense_id?: string;
    matched_transfer_id?: string;
    match_confidence?: MatchConfidence;
    status: ReconItemStatus;
    sort_order?: number;
  }[],
): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const id = genId("ri");
      await db.runAsync(
        `INSERT INTO reconciliation_items
         (id, session_id, stmt_date, stmt_amount, stmt_direction, stmt_narration,
          matched_expense_id, matched_transfer_id, match_confidence, status,
          sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, sessionId, item.stmt_date, item.stmt_amount, item.stmt_direction,
          item.stmt_narration ?? null, item.matched_expense_id ?? null,
          item.matched_transfer_id ?? null, item.match_confidence ?? null,
          item.status, item.sort_order ?? i, now,
        ],
      );
    }
  });
}

export async function getItems(sessionId: string): Promise<ReconciliationItem[]> {
  const db = getDatabase();
  return db.getAllAsync<ReconciliationItem>(
    `SELECT * FROM reconciliation_items
     WHERE session_id = ? AND deleted_at IS NULL
     ORDER BY sort_order ASC, stmt_date ASC`,
    [sessionId],
  );
}

export interface ReconciliationItemEnriched extends ReconciliationItem {
  arth_description: string | null;
  arth_account: string | null;
  arth_category: string | null;
  arth_date: string | null;
  arth_amount: number | null;
}

export async function getItemsEnriched(sessionId: string): Promise<ReconciliationItemEnriched[]> {
  const db = getDatabase();
  type Row = ReconciliationItem & {
    exp_desc: string | null;
    exp_acct_label: string | null; exp_bank: string | null; exp_acct_id: string | null;
    exp_cat: string | null; exp_date: string | null; exp_amount: number | null;
    tr_desc: string | null;
    tr_from_label: string | null; tr_from_bank: string | null; tr_from_id: string | null;
    tr_to_label: string | null; tr_to_bank: string | null; tr_to_id: string | null;
    tr_date: string | null; tr_amount: number | null;
  };
  const rows = await db.getAllAsync<Row>(
    `SELECT ri.*,
       COALESCE(e.merchant_name, e.description) AS exp_desc,
       fa.account_label AS exp_acct_label, fa.bank_name AS exp_bank, fa.account_identifier AS exp_acct_id,
       c.name AS exp_cat, e.date AS exp_date,
       COALESCE(e.split_original_amount, e.amount) AS exp_amount,
       t.description AS tr_desc,
       ff.account_label AS tr_from_label, ff.bank_name AS tr_from_bank, ff.account_identifier AS tr_from_id,
       ft.account_label AS tr_to_label, ft.bank_name AS tr_to_bank, ft.account_identifier AS tr_to_id,
       t.date AS tr_date, t.amount AS tr_amount
     FROM reconciliation_items ri
     LEFT JOIN expenses e ON e.id = ri.matched_expense_id AND e.deleted_at IS NULL
     LEFT JOIN financial_accounts fa ON fa.id = e.account_id
     LEFT JOIN categories c ON c.id = e.category_id
     LEFT JOIN account_transfers t ON t.id = ri.matched_transfer_id AND t.deleted_at IS NULL
     LEFT JOIN financial_accounts ff ON ff.id = t.from_account_id
     LEFT JOIN financial_accounts ft ON ft.id = t.to_account_id
     WHERE ri.session_id = ? AND ri.deleted_at IS NULL
     ORDER BY ri.sort_order ASC, ri.stmt_date ASC`,
    [sessionId],
  );
  return rows.map((row) => {
    const {
      exp_desc, exp_acct_label, exp_bank, exp_acct_id, exp_cat, exp_date, exp_amount,
      tr_desc, tr_from_label, tr_from_bank, tr_from_id,
      tr_to_label, tr_to_bank, tr_to_id, tr_date, tr_amount,
      ...base
    } = row;
    let arth_description: string | null = null;
    let arth_account: string | null = null;
    let arth_category: string | null = null;
    let arth_date: string | null = null;
    let arth_amount: number | null = null;
    if (base.matched_transfer_id) {
      arth_description = tr_desc ?? null;
      const from = tr_from_label || (tr_from_bank && tr_from_id ? `${tr_from_bank} ···${tr_from_id.slice(-4)}` : tr_from_bank) || null;
      const to = tr_to_label || (tr_to_bank && tr_to_id ? `${tr_to_bank} ···${tr_to_id.slice(-4)}` : tr_to_bank) || null;
      arth_account = from && to ? `${from} → ${to}` : from ?? to ?? null;
      arth_date = tr_date ?? null;
      arth_amount = tr_amount ?? null;
    } else if (base.matched_expense_id) {
      arth_description = exp_desc ?? null;
      arth_account = exp_acct_label || (exp_bank && exp_acct_id ? `${exp_bank} ···${exp_acct_id.slice(-4)}` : exp_bank) || null;
      arth_category = exp_cat ?? null;
      arth_date = exp_date ?? null;
      arth_amount = exp_amount ?? null;
    }
    return { ...base, arth_description, arth_account, arth_category, arth_date, arth_amount };
  });
}

export async function updateItem(
  id: string,
  patch: Partial<{
    matched_expense_id: string | null;
    matched_transfer_id: string | null;
    match_confidence: MatchConfidence | null;
    status: ReconItemStatus;
    exclude_reason: ExcludeReason | null;
  }>,
): Promise<void> {
  const db = getDatabase();
  const sets: string[] = [];
  const vals: (string | null)[] = [];

  const map: [string, string | null | undefined][] = [
    ["matched_expense_id", patch.matched_expense_id],
    ["matched_transfer_id", patch.matched_transfer_id],
    ["match_confidence", patch.match_confidence ?? null],
    ["status", patch.status ?? null],
    ["exclude_reason", patch.exclude_reason ?? null],
  ];

  for (const [col, val] of map) {
    if (val !== undefined) {
      sets.push(`${col} = ?`);
      vals.push(val);
    }
  }
  if (sets.length === 0) return;
  vals.push(id);
  await db.runAsync(
    `UPDATE reconciliation_items SET ${sets.join(", ")} WHERE id = ?`,
    vals,
  );
}

export async function getMatchedCount(sessionId: string): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c FROM reconciliation_items
     WHERE session_id = ? AND status = 'matched' AND deleted_at IS NULL`,
    [sessionId],
  );
  return row?.c ?? 0;
}

// Mark all unmatched items with stmt_date < cutoffDate as pre_arth excluded
export async function bulkMarkPreArth(sessionId: string, cutoffDate: string): Promise<number> {
  const db = getDatabase();
  const result = await db.runAsync(
    `UPDATE reconciliation_items
     SET status = 'excluded', exclude_reason = 'pre_arth'
     WHERE session_id = ? AND status = 'unmatched' AND stmt_date < ? AND deleted_at IS NULL`,
    [sessionId, cutoffDate],
  );
  return result.changes;
}

// Revert all pre_arth-excluded items back to unmatched for a session
export async function undoPreArthItems(sessionId: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE reconciliation_items
     SET status = 'unmatched', exclude_reason = NULL
     WHERE session_id = ? AND exclude_reason = 'pre_arth' AND deleted_at IS NULL`,
    [sessionId],
  );
}

// Get the effective pre-Arth cutoff for a session (derived from existing pre_arth items)
export async function getPreArthCutoff(sessionId: string): Promise<string | null> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ max_date: string | null }>(
    `SELECT MAX(stmt_date) as max_date FROM reconciliation_items
     WHERE session_id = ? AND exclude_reason = 'pre_arth' AND deleted_at IS NULL`,
    [sessionId],
  );
  return row?.max_date ?? null;
}

// Check if a session already exists for this account + period (duplicate detection)
export async function findExistingSession(
  accountId: string,
  startDate: string,
  endDate: string,
): Promise<ReconciliationSession | null> {
  const db = getDatabase();
  return db.getFirstAsync<ReconciliationSession>(
    `SELECT * FROM reconciliation_sessions
     WHERE account_id = ? AND stmt_start_date = ? AND stmt_end_date = ?
       AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [accountId, startDate, endDate],
  );
}
