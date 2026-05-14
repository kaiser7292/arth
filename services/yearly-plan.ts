import { getDatabase } from "@/database";
import { generateUUID } from "@/utils/uuid";
import { getSalaryProfileByFY } from "@/services/salary-profile";
import {
  getMilestonesForFY,
  getMilestoneContributionForFY,
  type LifeMilestone,
} from "@/services/life-milestone";
import { bumpDataVersion } from "@/services/settings";
import {
  computeBonusTax,
  computeCapitalGainsTax,
  calculateSalary,
  getProfessionalTax,
  type CapitalGainsTaxInput,
} from "@/services/tax-engine";

// ─── Yearly Plan ────────────────────────────────────────────

export interface YearlyPlan {
  id: string;
  user_id: string;
  financial_year: string;
  annual_salary_in_hand: number;
  expected_bonus: number;
  salary_hike_pct: number;
  total_planned_expenses: number;
  total_planned_investments: number;
  total_planned_milestones: number;
  savings_rate_target_pct: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateYearlyPlanInput {
  user_id: string;
  financial_year: string;
  annual_salary_in_hand: number;
  expected_bonus?: number;
  salary_hike_pct?: number;
  total_planned_expenses: number;
  total_planned_investments: number;
  total_planned_milestones?: number;
  savings_rate_target_pct: number;
  notes?: string;
}

export interface UpdateYearlyPlanInput {
  annual_salary_in_hand?: number;
  expected_bonus?: number;
  salary_hike_pct?: number;
  total_planned_expenses?: number;
  total_planned_investments?: number;
  total_planned_milestones?: number;
  savings_rate_target_pct?: number;
  notes?: string | null;
}

export async function getYearlyPlans(userId: string): Promise<YearlyPlan[]> {
  const db = getDatabase();
  return db.getAllAsync<YearlyPlan>(
    "SELECT * FROM yearly_plans WHERE user_id = ? ORDER BY financial_year DESC;",
    userId,
  );
}

export async function getYearlyPlanById(
  id: string,
): Promise<YearlyPlan | null> {
  const db = getDatabase();
  return db.getFirstAsync<YearlyPlan>(
    "SELECT * FROM yearly_plans WHERE id = ?;",
    id,
  );
}

export async function getYearlyPlanByFY(
  userId: string,
  financialYear: string,
): Promise<YearlyPlan | null> {
  const db = getDatabase();
  // Normalize: extract start year from "2026-27" or keep "2026" as-is
  const startYear = financialYear.split("-")[0];
  return db.getFirstAsync<YearlyPlan>(
    "SELECT * FROM yearly_plans WHERE user_id = ? AND (financial_year = ? OR financial_year LIKE ?);",
    userId,
    startYear,
    `${startYear}-%`,
  );
}

export async function createYearlyPlan(
  input: CreateYearlyPlanInput,
): Promise<string> {
  const db = getDatabase();
  const id = generateUUID();

  await db.runAsync(
    `INSERT INTO yearly_plans
     (id, user_id, financial_year, annual_salary_in_hand, expected_bonus,
      salary_hike_pct, total_planned_expenses, total_planned_investments,
      total_planned_milestones, savings_rate_target_pct, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    id,
    input.user_id,
    input.financial_year,
    input.annual_salary_in_hand,
    input.expected_bonus ?? 0,
    input.salary_hike_pct ?? 0,
    input.total_planned_expenses,
    input.total_planned_investments,
    input.total_planned_milestones ?? 0,
    input.savings_rate_target_pct,
    input.notes ?? null,
  );

  bumpDataVersion();
  return id;
}

export async function updateYearlyPlan(
  id: string,
  input: UpdateYearlyPlanInput,
): Promise<void> {
  const db = getDatabase();

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (input.annual_salary_in_hand !== undefined) {
    fields.push("annual_salary_in_hand = ?");
    values.push(input.annual_salary_in_hand);
  }
  if (input.expected_bonus !== undefined) {
    fields.push("expected_bonus = ?");
    values.push(input.expected_bonus);
  }
  if (input.salary_hike_pct !== undefined) {
    fields.push("salary_hike_pct = ?");
    values.push(input.salary_hike_pct);
  }
  if (input.total_planned_expenses !== undefined) {
    fields.push("total_planned_expenses = ?");
    values.push(input.total_planned_expenses);
  }
  if (input.total_planned_investments !== undefined) {
    fields.push("total_planned_investments = ?");
    values.push(input.total_planned_investments);
  }
  if (input.total_planned_milestones !== undefined) {
    fields.push("total_planned_milestones = ?");
    values.push(input.total_planned_milestones);
  }
  if (input.savings_rate_target_pct !== undefined) {
    fields.push("savings_rate_target_pct = ?");
    values.push(input.savings_rate_target_pct);
  }
  if (input.notes !== undefined) {
    fields.push("notes = ?");
    values.push(input.notes);
  }

  if (fields.length === 0) return;

  fields.push("updated_at = datetime('now')");
  values.push(id);
  await db.runAsync(
    `UPDATE yearly_plans SET ${fields.join(", ")} WHERE id = ?;`,
    ...values,
  );
  bumpDataVersion();
}

export async function resetYearlyPlan(id: string): Promise<void> {
  const db = getDatabase();
  // Zero all numeric fields but keep the plan shell (id, user_id, financial_year)
  await db.runAsync(
    `UPDATE yearly_plans SET
       annual_salary_in_hand = 0, expected_bonus = 0, salary_hike_pct = 0,
       total_planned_expenses = 0, total_planned_investments = 0,
       total_planned_milestones = 0, savings_rate_target_pct = 0,
       notes = NULL, updated_at = datetime('now')
     WHERE id = ?;`,
    id,
  );
  // Reset all investment buckets under this plan
  await db.runAsync(
    `DELETE FROM investment_contributions
     WHERE investment_bucket_id IN (SELECT id FROM investment_buckets WHERE yearly_plan_id = ?);`,
    id,
  );
  await db.runAsync(
    "UPDATE investment_buckets SET current_contributed = 0 WHERE yearly_plan_id = ?;",
    id,
  );
  bumpDataVersion();
}

export async function deleteYearlyPlan(id: string): Promise<void> {
  const db = getDatabase();
  await db.withTransactionAsync(async () => {
    // Delete child records first (investment contributions → buckets → plan).
    // FKs don't have ON DELETE CASCADE, so order matters.
    await db.runAsync(
      `DELETE FROM investment_contributions
       WHERE investment_bucket_id IN (SELECT id FROM investment_buckets WHERE yearly_plan_id = ?);`,
      id,
    );
    await db.runAsync(
      "DELETE FROM investment_buckets WHERE yearly_plan_id = ?;",
      id,
    );
    await db.runAsync("DELETE FROM yearly_plans WHERE id = ?;", id);
  });
  bumpDataVersion();
}

// ─── Investment Buckets ─────────────────────────────────────

export type BucketType = "investment" | "debt_payoff";

export interface InvestmentBucket {
  id: string;
  yearly_plan_id: string;
  financial_year: string | null;
  user_id: string | null;
  name: string;
  annual_target: number;
  current_contributed: number;
  linked_milestone_id: string | null;
  sort_order: number;
  is_active: number;
  /** v17.3.0 — 'investment' (default) or 'debt_payoff' (credits from loan prepayments). */
  bucket_type: BucketType;
  /** v17.3.0 — when bucket_type='debt_payoff', the loan this bucket tracks. */
  linked_loan_account_id: string | null;
}

export interface CreateInvestmentBucketInput {
  yearly_plan_id?: string;
  financial_year?: string;
  user_id?: string;
  name: string;
  annual_target: number;
  linked_milestone_id?: string | null;
  sort_order?: number;
  bucket_type?: BucketType;
  linked_loan_account_id?: string | null;
}

export interface UpdateInvestmentBucketInput {
  name?: string;
  annual_target?: number;
  current_contributed?: number;
  linked_milestone_id?: string | null;
  sort_order?: number;
  is_active?: number;
  bucket_type?: BucketType;
  linked_loan_account_id?: string | null;
}

export async function getInvestmentBuckets(
  yearlyPlanId: string,
): Promise<InvestmentBucket[]> {
  const db = getDatabase();
  return db.getAllAsync<InvestmentBucket>(
    "SELECT * FROM investment_buckets WHERE yearly_plan_id = ? ORDER BY sort_order ASC;",
    yearlyPlanId,
  );
}

export async function getInvestmentBucketById(
  id: string,
): Promise<InvestmentBucket | null> {
  const db = getDatabase();
  return db.getFirstAsync<InvestmentBucket>(
    "SELECT * FROM investment_buckets WHERE id = ?;",
    id,
  );
}

export async function getBucketsByFY(
  userId: string,
  financialYear: string,
): Promise<InvestmentBucket[]> {
  const db = getDatabase();
  return db.getAllAsync<InvestmentBucket>(
    "SELECT * FROM investment_buckets WHERE user_id = ? AND financial_year = ? AND is_active = 1 ORDER BY sort_order ASC;",
    userId,
    financialYear,
  );
}

/**
 * All active buckets for the user (v17.0.0). Sorted by financial_year DESC then
 * sort_order ASC so the picker shows newest FY first.
 */
export async function getAllActiveBuckets(
  userId: string,
): Promise<InvestmentBucket[]> {
  const db = getDatabase();
  return db.getAllAsync<InvestmentBucket>(
    `SELECT * FROM investment_buckets
     WHERE user_id = ? AND is_active = 1
     ORDER BY financial_year DESC, sort_order ASC;`,
    userId,
  );
}

export async function createInvestmentBucket(
  input: CreateInvestmentBucketInput,
): Promise<string> {
  const db = getDatabase();
  const id = generateUUID();

  // Get next sort_order if not provided
  let sortOrder = input.sort_order;
  if (sortOrder === undefined) {
    const filterClause = input.yearly_plan_id
      ? "yearly_plan_id = ?"
      : "user_id = ? AND financial_year = ?";
    const filterArgs = input.yearly_plan_id
      ? [input.yearly_plan_id]
      : [input.user_id ?? "", input.financial_year ?? ""];
    const maxRow = await db.getFirstAsync<{ max_order: number | null }>(
      `SELECT MAX(sort_order) as max_order FROM investment_buckets WHERE ${filterClause};`,
      ...filterArgs,
    );
    sortOrder = (maxRow?.max_order ?? -1) + 1;
  }

  await db.runAsync(
    `INSERT INTO investment_buckets (id, yearly_plan_id, financial_year, user_id, name, annual_target, linked_milestone_id, sort_order, bucket_type, linked_loan_account_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    id,
    input.yearly_plan_id ?? null,
    input.financial_year ?? null,
    input.user_id ?? null,
    input.name,
    input.annual_target,
    input.linked_milestone_id ?? null,
    sortOrder,
    input.bucket_type ?? "investment",
    input.linked_loan_account_id ?? null,
  );

  bumpDataVersion();
  return id;
}

export async function updateInvestmentBucket(
  id: string,
  input: UpdateInvestmentBucketInput,
): Promise<void> {
  const db = getDatabase();

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (input.name !== undefined) {
    fields.push("name = ?");
    values.push(input.name);
  }
  if (input.annual_target !== undefined) {
    fields.push("annual_target = ?");
    values.push(input.annual_target);
  }
  if (input.current_contributed !== undefined) {
    fields.push("current_contributed = ?");
    values.push(input.current_contributed);
  }
  if (input.linked_milestone_id !== undefined) {
    fields.push("linked_milestone_id = ?");
    values.push(input.linked_milestone_id);
  }
  if (input.sort_order !== undefined) {
    fields.push("sort_order = ?");
    values.push(input.sort_order);
  }
  if (input.is_active !== undefined) {
    fields.push("is_active = ?");
    values.push(input.is_active);
  }
  if (input.bucket_type !== undefined) {
    fields.push("bucket_type = ?");
    values.push(input.bucket_type);
  }
  if (input.linked_loan_account_id !== undefined) {
    fields.push("linked_loan_account_id = ?");
    values.push(input.linked_loan_account_id);
  }

  if (fields.length === 0) return;

  values.push(id);
  await db.runAsync(
    `UPDATE investment_buckets SET ${fields.join(", ")} WHERE id = ?;`,
    ...values,
  );
  bumpDataVersion();
}

export async function resetInvestmentBucket(id: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    "DELETE FROM investment_contributions WHERE investment_bucket_id = ?;",
    id,
  );
  await db.runAsync(
    "UPDATE investment_buckets SET current_contributed = 0 WHERE id = ?;",
    id,
  );
  // Sync linked milestone if any
  await _syncLinkedMilestone(id);
  bumpDataVersion();
}

export async function deleteInvestmentBucket(id: string): Promise<void> {
  const db = getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      "DELETE FROM investment_contributions WHERE investment_bucket_id = ?;",
      id,
    );
    await db.runAsync("DELETE FROM investment_buckets WHERE id = ?;", id);
  });
  bumpDataVersion();
}

// ─── Investment Contributions ───────────────────────────────

export interface InvestmentContribution {
  id: string;
  investment_bucket_id: string;
  month: string;
  amount: number;
  notes: string | null;
  date: string;
  source: "manual" | "email_auto";
  status: "approved" | "pending_review" | "rejected";
  raw_source_text: string | null;
  /**
   * If this contribution was created by a transfer into a demat account (via
   * the Add-Transfer → demat target sheet flow), points back at that transfer
   * row so the UI can render "From transfer · tap to view". Null for
   * manually-entered contributions.
   */
  linked_transfer_id: string | null;
  /** Source transfer's destination account id — lets the cross-link navigate
   *  to the right account ledger. */
  linked_transfer_account_id: string | null;
  /** Source transfer's date — used to scope the ledger to the right month. */
  linked_transfer_date: string | null;
}

export interface CreateInvestmentContributionInput {
  investment_bucket_id: string;
  month: string;
  amount: number;
  date: string;
  notes?: string;
}

export async function getInvestmentContributions(
  bucketId: string,
): Promise<InvestmentContribution[]> {
  const db = getDatabase();
  // LEFT JOIN account_transfers so contributions that came from a demat
  // transfer carry the source transfer id + destination account id + date
  // — the ledger UI needs all three to navigate to the right account's
  // month view and flash-highlight the row.
  return db.getAllAsync<InvestmentContribution>(
    `SELECT c.*,
            t.id AS linked_transfer_id,
            t.to_account_id AS linked_transfer_account_id,
            t.date AS linked_transfer_date
     FROM investment_contributions c
     LEFT JOIN account_transfers t
       ON t.linked_contribution_id = c.id AND t.deleted_at IS NULL
     WHERE c.investment_bucket_id = ? AND c.status != 'rejected'
     ORDER BY c.date DESC;`,
    bucketId,
  );
}

/**
 * Recompute a bucket's current_contributed.
 *
 * For investment buckets (default): sum of
 *   1. Approved investment_contributions (demat transfers, manual entries)
 *   2. expense_investment_links joined to non-deleted expenses (v17.0.0+)
 *
 * For debt_payoff buckets (v17.3.0): sum of net prepayments applied to the
 * linked loan within the bucket's FY (or lifetime if FY is null). Prepayments
 * count as net = amount - charge - gst (what actually reduced principal).
 *
 * Call any time a contribution, link, or expense, or prepayment changes.
 */
export async function recomputeBucketContributed(bucketId: string): Promise<void> {
  const db = getDatabase();
  const bucket = await db.getFirstAsync<{
    bucket_type: string | null;
    linked_loan_account_id: string | null;
    financial_year: string | null;
  }>(
    `SELECT bucket_type, linked_loan_account_id, financial_year
     FROM investment_buckets WHERE id = ?;`,
    bucketId,
  );
  if (!bucket) return;

  if (
    bucket.bucket_type === "debt_payoff" &&
    bucket.linked_loan_account_id
  ) {
    // Sum net prepayments on the linked loan within the FY window (if set)
    const fy = bucket.financial_year;
    let startDate = "1900-01-01";
    let endDate = "2999-12-31";
    if (fy) {
      const fyNum = parseInt(fy, 10);
      // Indian FY default April 1 → March 31 (matches getFYRange in utils)
      startDate = `${fyNum}-04-01`;
      endDate = `${fyNum + 1}-03-31`;
    }
    await db.runAsync(
      `UPDATE investment_buckets SET current_contributed = (
         SELECT COALESCE(SUM(amount - prepayment_charge - gst_on_charge), 0)
         FROM loan_prepayments
         WHERE loan_account_id = ?
           AND prepayment_date >= ? AND prepayment_date <= ?
       ) WHERE id = ?;`,
      bucket.linked_loan_account_id,
      startDate,
      endDate,
      bucketId,
    );
    return;
  }

  // investment bucket (default) — link contributions + direct contributions
  await db.runAsync(
    `UPDATE investment_buckets SET current_contributed = (
       SELECT COALESCE(SUM(amount), 0) FROM investment_contributions
        WHERE investment_bucket_id = ? AND status = 'approved'
     ) + (
       SELECT COALESCE(SUM(l.contribution_amount), 0)
         FROM expense_investment_links l
         JOIN expenses e ON e.id = l.expense_id
        WHERE l.investment_bucket_id = ? AND e.deleted_at IS NULL
     ) WHERE id = ?;`,
    bucketId,
    bucketId,
    bucketId,
  );
}

/**
 * v17.3.0 — Called by loan-accounts.recordPrepayment after a prepayment lands.
 * Finds all debt_payoff buckets linked to this loan and recomputes their
 * current_contributed. Touches milestones via _syncLinkedMilestone.
 */
export async function onLoanPrepayment(loanAccountId: string): Promise<void> {
  const db = getDatabase();
  const buckets = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM investment_buckets
     WHERE linked_loan_account_id = ? AND bucket_type = 'debt_payoff';`,
    loanAccountId,
  );
  // v17.5.2 — parallel per-bucket recompute. Typically 1-2 buckets; each
  // bucket's recompute + milestone sync are independent so parallelize.
  await Promise.all(
    buckets.map(async (b) => {
      await recomputeBucketContributed(b.id);
      await _syncLinkedMilestone(b.id);
    }),
  );
}

export async function createInvestmentContribution(
  input: CreateInvestmentContributionInput,
): Promise<string> {
  const db = getDatabase();
  const id = generateUUID();

  await db.runAsync(
    `INSERT INTO investment_contributions (id, investment_bucket_id, month, amount, notes, date)
     VALUES (?, ?, ?, ?, ?, ?);`,
    id,
    input.investment_bucket_id,
    input.month,
    input.amount,
    input.notes ?? null,
    input.date,
  );

  // Update bucket's current_contributed (links + contributions)
  await recomputeBucketContributed(input.investment_bucket_id);

  // If bucket is linked to a milestone, update milestone's current_saved
  await _syncLinkedMilestone(input.investment_bucket_id);

  bumpDataVersion();
  return id;
}

export async function updateInvestmentContribution(
  id: string,
  bucketId: string,
  input: { amount: number; date: string; notes?: string },
): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE investment_contributions SET amount = ?, date = ?, month = ?, notes = ? WHERE id = ?;`,
    input.amount,
    input.date,
    input.date.slice(0, 7),
    input.notes ?? null,
    id,
  );

  await recomputeBucketContributed(bucketId);

  await _syncLinkedMilestone(bucketId);
  bumpDataVersion();
}

export async function deleteInvestmentContribution(
  id: string,
  bucketId: string,
): Promise<void> {
  const db = getDatabase();

  // Guardrail (v14.8.0): if any transfer holds a stamp pointing at this
  // contribution, clear the stamp FIRST — otherwise we leave the transfer
  // row with an orphan FK pointer + stale demat_target that silently breaks
  // subsequent reverse-delete math. (Stamps are plain TEXT columns with no
  // DB-level FK cascade.)
  await db.runAsync(
    `UPDATE account_transfers
     SET linked_contribution_id = NULL,
         investment_bucket_id = NULL,
         demat_target = NULL,
         updated_at = datetime('now')
     WHERE linked_contribution_id = ?;`,
    id,
  );

  await db.runAsync(
    "DELETE FROM investment_contributions WHERE id = ?;",
    id,
  );

  // Recalculate bucket's current_contributed (links + contributions)
  await recomputeBucketContributed(bucketId);

  // If bucket is linked to a milestone, update milestone's current_saved
  await _syncLinkedMilestone(bucketId);
  bumpDataVersion();
}

/**
 * Get all investment buckets linked to a given milestone.
 */
export async function getLinkedBucketsForMilestone(
  milestoneId: string,
): Promise<InvestmentBucket[]> {
  const db = getDatabase();
  return db.getAllAsync<InvestmentBucket>(
    "SELECT * FROM investment_buckets WHERE linked_milestone_id = ? ORDER BY sort_order ASC;",
    milestoneId,
  );
}

/**
 * Get total contributions from all buckets linked to a given milestone.
 */
export async function getLinkedBucketContributionsTotal(
  milestoneId: string,
): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT COALESCE(SUM(ic.amount), 0) as total
     FROM investment_contributions ic
     JOIN investment_buckets ib ON ic.investment_bucket_id = ib.id
     WHERE ib.linked_milestone_id = ? AND ic.status = 'approved';`,
    milestoneId,
  );
  return row?.total ?? 0;
}

// ─── Auto-Build & Projection ──────────────────────────────

export interface AutoBuildResult {
  annual_salary_in_hand: number;
  expected_bonus: number;
  total_planned_expenses: number;
  total_planned_investments: number;
  total_planned_milestones: number;
  savings_rate_target_pct: number;
  sources: string[]; // human-readable list of where each value came from
}

/**
 * Gather data from existing app state to pre-fill a yearly plan.
 *
 * Sources checked (in priority order):
 *  - Salary: salary profile (computed_monthly_in_hand * 12) → previous FY plan → 0
 *  - Bonus: previous FY plan → 0
 *  - Expenses: current month budget total * 12
 *  - Investments: sum of investment bucket annual_target from latest plan
 *  - Milestones: sum of active milestone monthly_contribution_planned * 12
 *  - Savings rate: previous FY plan → 0
 */
export async function autoBuildPlanData(
  userId: string,
  targetFY: string,
): Promise<AutoBuildResult> {
  const db = getDatabase();
  const sources: string[] = [];

  let annualSalary = 0;
  let expectedBonus = 0;
  let savingsRate = 0;

  // Try previous FY plan first for salary/bonus/savings baseline
  const prevFY = String(parseInt(targetFY, 10) - 1);
  const prevPlan = await getYearlyPlanByFY(userId, prevFY);

  if (prevPlan) {
    annualSalary = prevPlan.annual_salary_in_hand;
    expectedBonus = prevPlan.expected_bonus;
    savingsRate = prevPlan.savings_rate_target_pct;

    // Apply hike if set
    if (prevPlan.salary_hike_pct > 0) {
      annualSalary = Math.round(annualSalary * (1 + prevPlan.salary_hike_pct / 100));
      sources.push(`Salary: ${prevFY} plan + ${prevPlan.salary_hike_pct}% hike`);
    } else {
      sources.push(`Salary: from ${prevFY} plan`);
    }
    sources.push(`Bonus: from ${prevFY} plan`);
    sources.push(`Savings rate: from ${prevFY} plan`);
  }

  // Override salary from salary profile if it exists on previous plan
  if (prevPlan) {
    const profile = await db.getFirstAsync<{ computed_monthly_in_hand: number }>(
      "SELECT computed_monthly_in_hand FROM salary_profiles WHERE yearly_plan_id = ?;",
      prevPlan.id,
    );
    if (profile && profile.computed_monthly_in_hand > 0) {
      annualSalary = profile.computed_monthly_in_hand * 12;
      if (prevPlan.salary_hike_pct > 0) {
        annualSalary = Math.round(annualSalary * (1 + prevPlan.salary_hike_pct / 100));
        sources[0] = `Salary: salary profile + ${prevPlan.salary_hike_pct}% hike`;
      } else {
        sources[0] = "Salary: from salary profile";
      }
    }
  }

  // Expenses: current month budget total * 12
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const budgetRow = await db.getFirstAsync<{ total: number | null }>(
    "SELECT SUM(amount) as total FROM budgets WHERE user_id = ? AND month = ?;",
    userId,
    currentMonth,
  );
  const monthlyBudget = budgetRow?.total ?? 0;
  const annualExpenses = Math.round(monthlyBudget * 12);
  sources.push(
    monthlyBudget > 0
      ? `Expenses: ${currentMonth} budget * 12`
      : "Expenses: no budget data found",
  );

  // Investments: sum of bucket targets from most recent plan (current FY or previous)
  let annualInvestments = 0;
  const referencePlan = await getYearlyPlanByFY(userId, targetFY) ?? prevPlan;
  if (referencePlan) {
    const bucketRow = await db.getFirstAsync<{ total: number | null }>(
      "SELECT SUM(annual_target) as total FROM investment_buckets WHERE yearly_plan_id = ? AND is_active = 1;",
      referencePlan.id,
    );
    annualInvestments = bucketRow?.total ?? 0;
    sources.push(
      annualInvestments > 0
        ? `Investments: from investment buckets`
        : "Investments: no bucket data found",
    );
  } else {
    sources.push("Investments: no plan with buckets found");
  }

  // Milestones: sum of active milestone monthly_contribution_planned * 12
  const milestoneRow = await db.getFirstAsync<{ total: number | null }>(
    "SELECT SUM(monthly_contribution_planned) as total FROM life_milestones WHERE user_id = ? AND is_completed = 0;",
    userId,
  );
  const monthlyMilestones = milestoneRow?.total ?? 0;
  const annualMilestones = Math.round(monthlyMilestones * 12);
  sources.push(
    monthlyMilestones > 0
      ? `Milestones: active milestone plans * 12`
      : "Milestones: no active milestone plans",
  );

  bumpDataVersion();
  return {
    annual_salary_in_hand: annualSalary,
    expected_bonus: expectedBonus,
    total_planned_expenses: annualExpenses,
    total_planned_investments: annualInvestments,
    total_planned_milestones: annualMilestones,
    savings_rate_target_pct: savingsRate,
    sources,
  };
}

/**
 * Project a plan into the next FY by applying hike and inflation.
 */
export function projectNextFY(
  currentPlan: {
    annual_salary_in_hand: number;
    expected_bonus: number;
    salary_hike_pct: number;
    total_planned_expenses: number;
    total_planned_investments: number;
    total_planned_milestones: number;
    savings_rate_target_pct: number;
  },
  inflationPct: number = 8,
): {
  annual_salary_in_hand: number;
  expected_bonus: number;
  total_planned_expenses: number;
  total_planned_investments: number;
  total_planned_milestones: number;
  savings_rate_target_pct: number;
} {
  const inflationMul = 1 + inflationPct / 100;
  const hikeMul = 1 + currentPlan.salary_hike_pct / 100;

  return {
    annual_salary_in_hand: Math.round(currentPlan.annual_salary_in_hand * hikeMul),
    expected_bonus: Math.round(currentPlan.expected_bonus * hikeMul),
    total_planned_expenses: Math.round(currentPlan.total_planned_expenses * inflationMul),
    total_planned_investments: Math.round(currentPlan.total_planned_investments * inflationMul),
    total_planned_milestones: currentPlan.total_planned_milestones, // keep as-is, specific goals
    savings_rate_target_pct: currentPlan.savings_rate_target_pct,
  };
}

// ─── Derive Yearly Plan (V1) ─────────────────────────────

export interface DerivedPlanSummary {
  financial_year: string;
  // Income
  annual_salary_in_hand: number;
  expected_bonus: number;
  expected_capital_gains: number;
  total_income: number;
  // Outflows
  total_planned_expenses: number;
  total_planned_investments: number;
  total_planned_milestones: number;
  total_outflow: number;
  // Computed
  surplus: number;
  savings_rate: number;
  savings_rate_target_pct: number;
  // Sources
  sources: string[];
  // Cached data (avoids re-fetching downstream)
  _buckets: InvestmentBucket[];
  _milestones: LifeMilestone[];
}

/**
 * Derive a yearly plan entirely from FY-tagged components:
 *  - Income: salary profile (computed_monthly_in_hand * 12 + expected_bonus + expected_capital_gains)
 *  - Investments: SUM of annual_target from FY-tagged buckets
 *  - Milestones: SUM of getMilestoneContributionForFY for active milestones
 *  - Expenses: annualized from budgets (avg monthly budget * 12)
 *
 * Auto-creates or updates the yearly_plans record with derived values.
 */
export async function deriveYearlyPlan(
  userId: string,
  financialYear: string,
): Promise<DerivedPlanSummary> {
  const db = getDatabase();
  const sources: string[] = [];

  // ── Income from salary profile ──
  let annualSalary = 0;
  let expectedBonus = 0;
  let expectedCapitalGains = 0;

  const profile = await getSalaryProfileByFY(userId, financialYear);
  if (profile && profile.computed_monthly_in_hand > 0) {
    annualSalary = profile.computed_monthly_in_hand * 12;

    if (profile.input_mode === "direct") {
      // Direct mode: all amounts are already post-tax
      expectedBonus = profile.expected_bonus ?? 0;
      expectedCapitalGains = profile.expected_capital_gains ?? 0;
    } else {
      // CTC mode: compute post-tax bonus and capital gains
      const grossSalary = profile.annual_ctc
        ? calculateSalary({
            annualCTC: profile.annual_ctc,
            basicPct: profile.basic_pct,
            hraPct: profile.hra_pct,
            isMetro: profile.is_metro === 1,
            epfMode: profile.epf_mode as "full_basic" | "restricted",
            epfInCTC: profile.epf_in_ctc === 1,
            vpfMonthly: profile.vpf_monthly,
            professionalTaxAnnual: getProfessionalTax(profile.state),
            deductions80C: profile.deductions_80c,
            deductions80D: profile.deductions_80d,
            hraExemptionAnnual: profile.hra_exemption_annual,
            homeLoanInterest: profile.home_loan_interest,
            otherDeductions: profile.other_deductions,
          }).ctcBreakdown.grossSalary
        : annualSalary;

      const rawBonus = profile.expected_bonus ?? 0;
      if (rawBonus > 0) {
        const bonusTax = computeBonusTax(grossSalary, rawBonus, profile.tax_regime as "new" | "old");
        expectedBonus = bonusTax.netBonus;
      }

      const cgInput: CapitalGainsTaxInput = {
        equity_ltcg: profile.capital_gains_equity_ltcg ?? 0,
        equity_stcg: profile.capital_gains_equity_stcg ?? 0,
        debt: profile.capital_gains_debt ?? 0,
        fd: profile.capital_gains_fd ?? 0,
        gold: profile.capital_gains_gold ?? 0,
        real_estate: profile.capital_gains_real_estate ?? 0,
      };
      const hasCG = Object.values(cgInput).some((v) => v > 0);
      if (hasCG) {
        const cgTax = computeCapitalGainsTax(cgInput, grossSalary, profile.tax_regime as "new" | "old");
        expectedCapitalGains = cgTax.totalNet;
      }
    }
    sources.push("Income: from salary profile");
  } else {
    // Fallback: try previous FY plan
    const prevFY = String(parseInt(financialYear, 10) - 1);
    const prevPlan = await getYearlyPlanByFY(userId, prevFY);
    if (prevPlan) {
      annualSalary = prevPlan.annual_salary_in_hand;
      expectedBonus = prevPlan.expected_bonus;
      if (prevPlan.salary_hike_pct > 0) {
        annualSalary = Math.round(annualSalary * (1 + prevPlan.salary_hike_pct / 100));
        sources.push(`Income: ${prevFY} plan + ${prevPlan.salary_hike_pct}% hike`);
      } else {
        sources.push(`Income: from ${prevFY} plan`);
      }
    } else {
      sources.push("Income: no salary profile or previous plan found");
    }
  }

  const totalIncome = annualSalary + expectedBonus + expectedCapitalGains;

  // ── Investments from FY-tagged buckets ──
  const buckets = await getBucketsByFY(userId, financialYear);
  const totalInvestments = buckets.reduce((sum, b) => sum + b.annual_target, 0);
  sources.push(
    buckets.length > 0
      ? `Investments: ${buckets.length} bucket(s)`
      : "Investments: no buckets for this FY",
  );

  // ── Milestones from FY-active milestones ──
  // For linked milestones, only count the excess beyond the linked bucket's target
  // to avoid double-counting (bucket target already in totalInvestments).
  const milestones = await getMilestonesForFY(userId, financialYear);
  const linkedBucketTargetByMilestone = new Map<string, number>();
  for (const b of buckets) {
    if (b.linked_milestone_id) {
      const existing = linkedBucketTargetByMilestone.get(b.linked_milestone_id) ?? 0;
      linkedBucketTargetByMilestone.set(b.linked_milestone_id, existing + b.annual_target);
    }
  }

  let totalMilestones = 0;
  for (const m of milestones) {
    const milestoneAnnual = getMilestoneContributionForFY(m, financialYear);
    const linkedBucketTotal = linkedBucketTargetByMilestone.get(m.id) ?? 0;
    totalMilestones += Math.max(0, milestoneAnnual - linkedBucketTotal);
  }
  totalMilestones = Math.round(totalMilestones);

  const linkedCount = [...linkedBucketTargetByMilestone.keys()].length;
  sources.push(
    milestones.length > 0
      ? `Milestones: ${milestones.length} active${linkedCount > 0 ? ` (${linkedCount} linked to buckets)` : ""}`
      : "Milestones: no active milestones for this FY",
  );

  // ── Expenses from budgets (annualized average) ──
  const fyStartYear = parseInt(financialYear, 10);
  const fyStartMonth = `${fyStartYear}-04`; // April
  const fyEndMonth = `${fyStartYear + 1}-03`; // March

  const budgetRow = await db.getFirstAsync<{ total: number | null; months: number }>(
    `SELECT SUM(amount) as total, COUNT(DISTINCT month) as months
     FROM budgets WHERE user_id = ? AND month >= ? AND month <= ?;`,
    userId,
    fyStartMonth,
    fyEndMonth,
  );
  const budgetTotal = budgetRow?.total ?? 0;
  const budgetMonths = budgetRow?.months ?? 0;
  const annualExpenses = budgetMonths > 0
    ? Math.round((budgetTotal / budgetMonths) * 12)
    : 0;
  sources.push(
    budgetMonths > 0
      ? `Expenses: avg of ${budgetMonths} month(s) budget * 12`
      : "Expenses: no budget data for this FY",
  );

  // ── Compute summary ──
  const totalOutflow = annualExpenses + totalInvestments + totalMilestones;
  const surplus = totalIncome - totalOutflow;
  const savingsRate = totalIncome > 0
    ? Math.round(((totalIncome - annualExpenses) / totalIncome) * 100 * 100) / 100
    : 0;

  // ── Get or create yearly plan record ──
  let plan = await getYearlyPlanByFY(userId, financialYear);
  const savingsRateTarget = plan?.savings_rate_target_pct ?? 0;

  if (plan) {
    await updateYearlyPlan(plan.id, {
      annual_salary_in_hand: annualSalary,
      expected_bonus: expectedBonus,
      total_planned_expenses: annualExpenses,
      total_planned_investments: totalInvestments,
      total_planned_milestones: totalMilestones,
    });
  } else {
    await createYearlyPlan({
      user_id: userId,
      financial_year: financialYear,
      annual_salary_in_hand: annualSalary,
      expected_bonus: expectedBonus,
      total_planned_expenses: annualExpenses,
      total_planned_investments: totalInvestments,
      total_planned_milestones: totalMilestones,
      savings_rate_target_pct: 0,
    });
  }

  bumpDataVersion();
  return {
    financial_year: financialYear,
    annual_salary_in_hand: annualSalary,
    expected_bonus: expectedBonus,
    expected_capital_gains: expectedCapitalGains,
    total_income: totalIncome,
    total_planned_expenses: annualExpenses,
    total_planned_investments: totalInvestments,
    total_planned_milestones: totalMilestones,
    total_outflow: totalOutflow,
    surplus,
    savings_rate: savingsRate,
    savings_rate_target_pct: savingsRateTarget,
    sources,
    _buckets: buckets,
    _milestones: milestones,
  };
}

// ─── Internal: Milestone Sync ──────────────────────────────

/**
 * Recalculates a linked milestone's current_saved from:
 *   (direct milestone contributions) + (sum of all linked bucket contributions)
 * Called after any investment contribution create/delete on a linked bucket.
 */
/** @internal — exported for expense-investment-link.ts */
export async function _syncLinkedMilestone(bucketId: string): Promise<void> {
  const db = getDatabase();

  // Check if this bucket is linked to a milestone
  const bucket = await db.getFirstAsync<{ linked_milestone_id: string | null }>(
    "SELECT linked_milestone_id FROM investment_buckets WHERE id = ?;",
    bucketId,
  );

  if (!bucket?.linked_milestone_id) return;

  const milestoneId = bucket.linked_milestone_id;

  // Recalculate: direct contributions + contributions from ALL linked buckets
  // (both investment_contributions and v17.0.0 expense_investment_links)
  await db.runAsync(
    `UPDATE life_milestones SET current_saved = (
       SELECT COALESCE(SUM(amount), 0) FROM milestone_contributions WHERE life_milestone_id = ?
     ) + (
       SELECT COALESCE(SUM(ic.amount), 0)
       FROM investment_contributions ic
       JOIN investment_buckets ib ON ic.investment_bucket_id = ib.id
       WHERE ib.linked_milestone_id = ? AND ic.status = 'approved'
     ) + (
       SELECT COALESCE(SUM(l.contribution_amount), 0)
       FROM expense_investment_links l
       JOIN expenses e ON e.id = l.expense_id
       JOIN investment_buckets ib ON ib.id = l.investment_bucket_id
       WHERE ib.linked_milestone_id = ? AND e.deleted_at IS NULL
     ) WHERE id = ?;`,
    milestoneId,
    milestoneId,
    milestoneId,
    milestoneId,
  );
}
