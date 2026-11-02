import {
  createLifeMilestone,
  deleteLifeMilestone,
  getLifeMilestoneById,
  getPlannedMilestoneContributionForFY,
  updateLifeMilestone,
} from "@/services/life-milestone";
import { createInvestmentBucket, updateInvestmentBucket } from "@/services/yearly-plan";
import { getFYRange } from "@/utils/fiscal-year";

/**
 * A goal with a total amount and a date. An investment bucket only has a yearly target and belongs
 * to one financial year, so the total and date live on a milestone linked to it: milestones already
 * have both, and the plan already knows not to count a linked pair twice.
 *
 * The bucket's yearly target is the milestone's own yearly share. deriveYearlyPlan counts any part
 * of a linked milestone above its bucket's target as extra planned saving, so a different figure
 * here would quietly inflate the plan.
 */

/** Months from `from` to the target date's month, both included. */
export function goalMonths(targetDate: string, from: Date = new Date()): number {
  const [year, month] = targetDate.split("-").map(Number);
  return (year - from.getFullYear()) * 12 + (month - 1 - from.getMonth()) + 1;
}

/** What to put away each month to reach the total by the date, or null if the date has passed. */
export function goalMonthlyNeeded(total: number, saved: number, targetDate: string, from: Date = new Date()): number | null {
  const months = goalMonths(targetDate, from);
  if (months <= 0) return null;
  return Math.max(0, total - saved) / months;
}

export interface SaveDatedGoalInput {
  userId: string;
  name: string;
  total: number;
  targetDate: string;
  financialYear: string;
  fyStartMonth: number;
  yearlyPlanId?: string;
  /** Editing: the bucket and the milestone already behind it. */
  bucketId?: string;
  milestoneId?: string | null;
  today?: Date;
}

export async function saveDatedGoal(input: SaveDatedGoalInput): Promise<void> {
  const today = input.today ?? new Date();
  const fyStart = getFYRange(parseInt(input.financialYear, 10), input.fyStartMonth).start;
  const planFrom = fyStart > today ? fyStart : today;
  const months = Math.max(1, goalMonths(input.targetDate, planFrom));
  const plan = {
    name: input.name,
    target_amount: input.total,
    target_date: input.targetDate,
    monthly_contribution_planned: Math.round(input.total / months),
    start_financial_year: input.financialYear,
    duration_years: Math.floor(months / 12),
    duration_months: months % 12,
  };

  const created = !input.milestoneId;
  const milestoneId = input.milestoneId
    ? (await updateLifeMilestone(input.milestoneId, plan), input.milestoneId)
    : await createLifeMilestone({ user_id: input.userId, ...plan });

  try {
    const milestone = await getLifeMilestoneById(milestoneId);
    if (!milestone) throw new Error("The goal's date couldn't be saved");
    const annualTarget = getPlannedMilestoneContributionForFY(milestone, input.financialYear);
    if (input.bucketId) {
      await updateInvestmentBucket(input.bucketId, { name: input.name, annual_target: annualTarget, linked_milestone_id: milestoneId });
    } else {
      await createInvestmentBucket({
        yearly_plan_id: input.yearlyPlanId,
        financial_year: input.financialYear,
        user_id: input.userId,
        name: input.name,
        annual_target: annualTarget,
        linked_milestone_id: milestoneId,
      });
    }
  } catch (e) {
    // Without its bucket a new milestone would be a stray entry in Milestones.
    if (created) await deleteLifeMilestone(milestoneId).catch(() => {});
    throw e;
  }
}
