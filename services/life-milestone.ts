import { getDatabase } from "@/database";
import { generateUUID } from "@/utils/uuid";
import { bumpDataVersion, getFYStartMonth } from "@/services/settings";
import { round2 } from "@/utils/math";

// ─── Life Milestones ────────────────────────────────────────

export interface LifeMilestone {
  id: string;
  user_id: string;
  name: string;
  target_amount: number;
  current_saved: number;
  target_date: string | null;
  monthly_contribution_planned: number;
  start_financial_year: string | null;
  duration_years: number;
  duration_months: number;
  is_completed: number;
  completed_date: string | null;
  sort_order: number;
}

export interface CreateLifeMilestoneInput {
  user_id: string;
  name: string;
  target_amount: number;
  target_date?: string;
  monthly_contribution_planned?: number;
  start_financial_year?: string;
  duration_years?: number;
  duration_months?: number;
  sort_order?: number;
}

export interface UpdateLifeMilestoneInput {
  name?: string;
  target_amount?: number;
  target_date?: string | null;
  monthly_contribution_planned?: number;
  start_financial_year?: string | null;
  duration_years?: number;
  duration_months?: number;
  is_completed?: number;
  completed_date?: string | null;
  sort_order?: number;
}

export async function getLifeMilestones(
  userId: string,
): Promise<LifeMilestone[]> {
  const db = getDatabase();
  return db.getAllAsync<LifeMilestone>(
    "SELECT * FROM life_milestones WHERE user_id = ? ORDER BY sort_order ASC;",
    userId,
  );
}

export async function getLifeMilestoneById(
  id: string,
): Promise<LifeMilestone | null> {
  const db = getDatabase();
  return db.getFirstAsync<LifeMilestone>(
    "SELECT * FROM life_milestones WHERE id = ?;",
    id,
  );
}

/**
 * Total duration in months for a milestone.
 * Combines duration_years and duration_months. Minimum 1 month.
 */
export function getMilestoneTotalMonths(milestone: LifeMilestone): number {
  const years = milestone.duration_years || 0;
  const months = milestone.duration_months || 0;
  const total = years * 12 + months;
  return total > 0 ? total : 12;
}

/**
 * Number of FYs this milestone spans (for FY-range checks).
 * Ceiling of totalMonths / 12, minimum 1.
 */
function getDurationFYs(milestone: LifeMilestone): number {
  return Math.ceil(getMilestoneTotalMonths(milestone) / 12) || 1;
}

/**
 * Effective "due" date for a milestone — the single source of truth for
 * sorting and for the monthly-savings-required calculation (previously
 * duplicated inconsistently between app/goals/milestones.tsx and
 * app/goals/milestone-detail.tsx, and disconnected from the FY/duration
 * plan model entirely).
 *
 * Prefers `target_date` (an explicit calendar date) when set. Falls back to
 * the end of the FY+duration plan window — the FY's start month plus
 * duration_years/duration_months — when no target_date was given ("take
 * month input" instead, i.e. the Start FY + Duration fields the milestone
 * form collects when the user doesn't pick a specific date). Returns null
 * when neither is available.
 */
export function getMilestoneEffectiveDueDate(
  milestone: LifeMilestone,
  fyStartMonth: number = getFYStartMonth(),
): string | null {
  if (milestone.target_date) return milestone.target_date;
  if (!milestone.start_financial_year) return null;
  const startYear = parseInt(milestone.start_financial_year, 10);
  if (!Number.isFinite(startYear)) return null;
  const totalMonths = getMilestoneTotalMonths(milestone);
  const startMonthIndex = fyStartMonth - 1; // 0-indexed
  // Day 0 of the month AFTER the plan's last month = the last day of the
  // plan's actual last month (JS Date normalises an out-of-range month).
  const endDate = new Date(startYear, startMonthIndex + totalMonths, 0);
  const y = endDate.getFullYear();
  const m = String(endDate.getMonth() + 1).padStart(2, "0");
  const d = String(endDate.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Months remaining until a milestone's effective due date, INCLUSIVE of the
 * current month — e.g. today in March with a June due date is 4 months
 * (Mar, Apr, May, Jun), not the 3 a plain calendar-month diff would give.
 * Returns null when there's no effective due date, or it's already past.
 */
export function getMilestoneMonthsRemaining(
  milestone: LifeMilestone,
  fyStartMonth: number = getFYStartMonth(),
  today: Date = new Date(),
): number | null {
  const due = getMilestoneEffectiveDueDate(milestone, fyStartMonth);
  if (!due) return null;
  const [dueYear, dueMonth] = due.split("-").map(Number);
  const monthsDiff = (dueYear - today.getFullYear()) * 12 + (dueMonth - 1 - today.getMonth());
  const inclusive = monthsDiff + 1;
  return inclusive > 0 ? inclusive : null;
}

/**
 * Monthly saving still required to hit a milestone's target amount, using
 * the inclusive months-remaining count above. Returns null when the target
 * is already met or there's no usable due date (past, or none set at all).
 */
export function getMilestoneMonthlyNeeded(
  milestone: LifeMilestone,
  fyStartMonth: number = getFYStartMonth(),
  today: Date = new Date(),
): number | null {
  const remaining = milestone.target_amount - milestone.current_saved;
  if (remaining <= 0) return null;
  const months = getMilestoneMonthsRemaining(milestone, fyStartMonth, today);
  if (!months) return null;
  return remaining / months;
}

/**
 * Sort comparator: milestones with an effective due date sort soonest-first;
 * milestones with no target_date AND no start_financial_year/duration (so no
 * due date can be derived at all) keep their existing manual sort_order,
 * ordered after every dated milestone.
 */
export function compareMilestonesByDueDate(
  a: LifeMilestone,
  b: LifeMilestone,
  fyStartMonth: number = getFYStartMonth(),
): number {
  const dueA = getMilestoneEffectiveDueDate(a, fyStartMonth);
  const dueB = getMilestoneEffectiveDueDate(b, fyStartMonth);
  if (dueA && dueB) return dueA.localeCompare(dueB);
  if (dueA) return -1;
  if (dueB) return 1;
  return a.sort_order - b.sort_order;
}

/**
 * Get the annual contribution amount for a milestone in a given FY.
 * Uses total months for precise calculation: (target / totalMonths) * 12.
 * If the FY is outside the milestone's active range, returns 0.
 * Legacy milestones (no start_financial_year) are treated as active in all FYs.
 */
export function getMilestoneContributionForFY(
  milestone: LifeMilestone,
  financialYear: string,
): number {
  if (milestone.is_completed) return 0;
  return getPlannedMilestoneContributionForFY(milestone, financialYear);
}

/**
 * Get the PLANNED annual contribution for a milestone in a given FY.
 * Unlike getMilestoneContributionForFY, this includes milestones that are now
 * completed — used for Planned-vs-Actual YoY comparisons where the original
 * plan (before completion) is what matters.
 */
export function getPlannedMilestoneContributionForFY(
  milestone: LifeMilestone,
  financialYear: string,
): number {
  const totalMonths = getMilestoneTotalMonths(milestone);
  // If the milestone fits within one FY, the full target is owed in that FY —
  // annualising (target/months)*12 would double-count for sub-12-month goals.
  const annualContribution =
    totalMonths <= 12
      ? milestone.target_amount
      : (milestone.target_amount / totalMonths) * 12;

  if (!milestone.start_financial_year) {
    return Math.round(annualContribution * 100) / 100;
  }

  const startYear = parseInt(milestone.start_financial_year, 10);
  const targetYear = parseInt(financialYear, 10);
  const durationFYs = getDurationFYs(milestone);
  const endYear = startYear + durationFYs - 1;

  if (targetYear < startYear || targetYear > endYear) return 0;

  return Math.round(annualContribution * 100) / 100;
}

/**
 * Get all milestones that are active (not completed) in a given FY.
 * A milestone is active in an FY if:
 * - It has no start_financial_year (legacy), OR
 * - The FY falls within [start_financial_year, start_financial_year + duration_years - 1]
 */
export async function getMilestonesForFY(
  userId: string,
  financialYear: string,
): Promise<LifeMilestone[]> {
  const db = getDatabase();
  const targetYear = parseInt(financialYear, 10);

  // Get all active milestones for this user
  const all = await db.getAllAsync<LifeMilestone>(
    "SELECT * FROM life_milestones WHERE user_id = ? AND is_completed = 0 ORDER BY sort_order ASC;",
    userId,
  );

  return all.filter((m) => {
    if (!m.start_financial_year) return true; // legacy — always active
    const startYear = parseInt(m.start_financial_year, 10);
    const durationFYs = getDurationFYs(m);
    const endYear = startYear + durationFYs - 1;
    return targetYear >= startYear && targetYear <= endYear;
  });
}

/**
 * Total PLANNED milestone contributions for a user in a given FY.
 * Includes completed milestones that were planned to be active in that FY
 * (e.g., a milestone targeted for FY 2025-26 that completed in Mar 2026 still
 * had a plan of ₹X for that year). Used for Planned-vs-Actual YoY reporting.
 */
export async function getTotalPlannedMilestonesForFY(
  userId: string,
  financialYear: string,
): Promise<number> {
  const db = getDatabase();
  const targetYear = parseInt(financialYear, 10);
  const all = await db.getAllAsync<LifeMilestone>(
    "SELECT * FROM life_milestones WHERE user_id = ?;",
    userId,
  );
  let total = 0;
  for (const m of all) {
    if (!m.start_financial_year) {
      // Legacy milestones with no start_financial_year have no FY scoping;
      // skip them from planned-by-FY (avoids double-counting across every FY).
      continue;
    }
    const startYear = parseInt(m.start_financial_year, 10);
    const durationFYs = getDurationFYs(m);
    const endYear = startYear + durationFYs - 1;
    if (targetYear < startYear || targetYear > endYear) continue;
    total += getPlannedMilestoneContributionForFY(m, financialYear);
  }
  return Math.round(total * 100) / 100;
}

export async function createLifeMilestone(
  input: CreateLifeMilestoneInput,
): Promise<string> {
  const db = getDatabase();
  const id = generateUUID();

  // Get next sort_order if not provided
  let sortOrder = input.sort_order;
  if (sortOrder === undefined) {
    const maxRow = await db.getFirstAsync<{ max_order: number | null }>(
      "SELECT MAX(sort_order) as max_order FROM life_milestones WHERE user_id = ?;",
      input.user_id,
    );
    sortOrder = (maxRow?.max_order ?? -1) + 1;
  }

  await db.runAsync(
    `INSERT INTO life_milestones
     (id, user_id, name, target_amount, target_date, monthly_contribution_planned,
      start_financial_year, duration_years, duration_months, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    id,
    input.user_id,
    input.name,
    round2(input.target_amount),
    input.target_date ?? null,
    round2(input.monthly_contribution_planned ?? 0),
    input.start_financial_year ?? null,
    input.duration_years ?? 0,
    input.duration_months ?? 0,
    sortOrder,
  );

  await bumpDataVersion();
  return id;
}

export async function updateLifeMilestone(
  id: string,
  input: UpdateLifeMilestoneInput,
): Promise<void> {
  const db = getDatabase();

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (input.name !== undefined) {
    fields.push("name = ?");
    values.push(input.name);
  }
  if (input.target_amount !== undefined) {
    fields.push("target_amount = ?");
    values.push(round2(input.target_amount));
  }
  if (input.target_date !== undefined) {
    fields.push("target_date = ?");
    values.push(input.target_date);
  }
  if (input.monthly_contribution_planned !== undefined) {
    fields.push("monthly_contribution_planned = ?");
    values.push(round2(input.monthly_contribution_planned));
  }
  if (input.start_financial_year !== undefined) {
    fields.push("start_financial_year = ?");
    values.push(input.start_financial_year);
  }
  if (input.duration_years !== undefined) {
    fields.push("duration_years = ?");
    values.push(input.duration_years);
  }
  if (input.duration_months !== undefined) {
    fields.push("duration_months = ?");
    values.push(input.duration_months);
  }
  if (input.is_completed !== undefined) {
    fields.push("is_completed = ?");
    values.push(input.is_completed);
  }
  if (input.completed_date !== undefined) {
    fields.push("completed_date = ?");
    values.push(input.completed_date);
  }
  if (input.sort_order !== undefined) {
    fields.push("sort_order = ?");
    values.push(input.sort_order);
  }

  if (fields.length === 0) return;

  values.push(id);
  await db.runAsync(
    `UPDATE life_milestones SET ${fields.join(", ")} WHERE id = ?;`,
    ...values,
  );
  await bumpDataVersion();
}

export async function resetLifeMilestone(id: string): Promise<void> {
  const db = getDatabase();
  // Delete all contributions but keep the milestone structure
  await db.runAsync(
    "DELETE FROM milestone_contributions WHERE life_milestone_id = ?;",
    id,
  );
  // Zero out saved amount and uncomplete
  await db.runAsync(
    "UPDATE life_milestones SET current_saved = 0, is_completed = 0, completed_date = NULL WHERE id = ?;",
    id,
  );
  await bumpDataVersion();
}

export async function deleteLifeMilestone(id: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    "DELETE FROM milestone_contributions WHERE life_milestone_id = ?;",
    id,
  );
  await db.runAsync("DELETE FROM life_milestones WHERE id = ?;", id);
  await bumpDataVersion();
}

// ─── Milestone Contributions ────────────────────────────────

export interface MilestoneContribution {
  id: string;
  life_milestone_id: string;
  month: string;
  amount: number;
  date: string;
}

export interface CreateMilestoneContributionInput {
  life_milestone_id: string;
  month: string;
  amount: number;
  date: string;
}

export async function getMilestoneContributions(
  milestoneId: string,
): Promise<MilestoneContribution[]> {
  const db = getDatabase();
  return db.getAllAsync<MilestoneContribution>(
    "SELECT * FROM milestone_contributions WHERE life_milestone_id = ? ORDER BY date DESC;",
    milestoneId,
  );
}

export async function createMilestoneContribution(
  input: CreateMilestoneContributionInput,
): Promise<string> {
  const db = getDatabase();
  const id = generateUUID();

  await db.runAsync(
    `INSERT INTO milestone_contributions (id, life_milestone_id, month, amount, date)
     VALUES (?, ?, ?, ?, ?);`,
    id,
    input.life_milestone_id,
    input.month,
    round2(input.amount),
    input.date,
  );

  // Update milestone's current_saved
  await db.runAsync(
    `UPDATE life_milestones SET current_saved = (
       SELECT COALESCE(SUM(amount), 0) FROM milestone_contributions
       WHERE life_milestone_id = ?
     ) WHERE id = ?;`,
    input.life_milestone_id,
    input.life_milestone_id,
  );

  await bumpDataVersion();
  return id;
}

export async function updateMilestoneContribution(
  id: string,
  milestoneId: string,
  input: { amount: number; date: string },
): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE milestone_contributions SET amount = ?, date = ?, month = ? WHERE id = ?;`,
    round2(input.amount),
    input.date,
    input.date.slice(0, 7),
    id,
  );

  await db.runAsync(
    `UPDATE life_milestones SET current_saved = (
       SELECT COALESCE(SUM(amount), 0) FROM milestone_contributions
       WHERE life_milestone_id = ?
     ) WHERE id = ?;`,
    milestoneId,
    milestoneId,
  );

  await bumpDataVersion();
}

export async function deleteMilestoneContribution(
  id: string,
  milestoneId: string,
): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    "DELETE FROM milestone_contributions WHERE id = ?;",
    id,
  );

  // Recalculate milestone's current_saved
  await db.runAsync(
    `UPDATE life_milestones SET current_saved = (
       SELECT COALESCE(SUM(amount), 0) FROM milestone_contributions
       WHERE life_milestone_id = ?
     ) WHERE id = ?;`,
    milestoneId,
    milestoneId,
  );
  await bumpDataVersion();
}

// ─── Combined Contributions (direct + linked buckets) ──────

interface CombinedContribution {
  amount: number;
  date: string;
  source: "direct" | "bucket" | "expense_link";
  label: string | null;
}

/**
 * All contributions toward a milestone: direct milestone_contributions +
 * approved investment_contributions from linked buckets +
 * expense_investment_links from linked buckets. Used for monthly history.
 */
export async function getCombinedMilestoneContributions(
  milestoneId: string,
): Promise<CombinedContribution[]> {
  const db = getDatabase();
  return db.getAllAsync<CombinedContribution>(
    `SELECT amount, date, 'direct' as source, NULL as label
       FROM milestone_contributions WHERE life_milestone_id = ?
     UNION ALL
     SELECT ic.amount, ic.date, 'bucket' as source, ib.name as label
       FROM investment_contributions ic
       JOIN investment_buckets ib ON ic.investment_bucket_id = ib.id
       WHERE ib.linked_milestone_id = ? AND ic.status = 'approved'
     UNION ALL
     SELECT l.contribution_amount as amount, e.date, 'expense_link' as source, ib.name as label
       FROM expense_investment_links l
       JOIN expenses e ON e.id = l.expense_id
       JOIN investment_buckets ib ON ib.id = l.investment_bucket_id
       WHERE ib.linked_milestone_id = ? AND e.deleted_at IS NULL
     ORDER BY date DESC;`,
    milestoneId,
    milestoneId,
    milestoneId,
  );
}

/**
 * Total actual contributions for a milestone in a date range,
 * including linked bucket contributions. Used for FY breakdown and YoY.
 */
export async function getCombinedMilestoneActualForFY(
  milestoneId: string,
  startDate: string,
  endDate: string,
): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT (
       SELECT COALESCE(SUM(amount), 0) FROM milestone_contributions
       WHERE life_milestone_id = ? AND date >= ? AND date <= ?
     ) + (
       SELECT COALESCE(SUM(ic.amount), 0)
       FROM investment_contributions ic
       JOIN investment_buckets ib ON ic.investment_bucket_id = ib.id
       WHERE ib.linked_milestone_id = ? AND ic.status = 'approved'
         AND ic.date >= ? AND ic.date <= ?
     ) + (
       SELECT COALESCE(SUM(l.contribution_amount), 0)
       FROM expense_investment_links l
       JOIN expenses e ON e.id = l.expense_id
       JOIN investment_buckets ib ON ib.id = l.investment_bucket_id
       WHERE ib.linked_milestone_id = ? AND e.deleted_at IS NULL
         AND e.date >= ? AND e.date <= ?
     ) as total;`,
    milestoneId, startDate, endDate,
    milestoneId, startDate, endDate,
    milestoneId, startDate, endDate,
  );
  return row?.total ?? 0;
}

/**
 * Combined FY actuals for multiple milestones. Used by YoY comparison.
 */
export async function getCombinedMilestoneContributionsForFY(
  milestoneIds: string[],
  fyStartDate: string,
  fyEndDate: string,
): Promise<number> {
  if (milestoneIds.length === 0) return 0;
  let total = 0;
  for (const id of milestoneIds) {
    total += await getCombinedMilestoneActualForFY(id, fyStartDate, fyEndDate);
  }
  return total;
}

/**
 * Combined FY actuals per-milestone (keyed by id). Used by milestones list.
 */
export async function getCombinedMilestoneActualsByIdForFY(
  milestoneIds: string[],
  fyStartDate: string,
  fyEndDate: string,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (milestoneIds.length === 0) return result;
  for (const id of milestoneIds) {
    const total = await getCombinedMilestoneActualForFY(id, fyStartDate, fyEndDate);
    if (total > 0) result.set(id, total);
  }
  return result;
}
