import { adjustAccountAvailable } from "@/services/account-balance";
import { reclassifyCreditAsTransfer } from "@/services/account-transfer";
import { applySuggestions, type Suggestion } from "@/services/ai-suggestions";
import { deleteExpense, linkCreditAsRefund, updateExpense } from "@/services/expense-crud";
import { linkExpenseToBucket } from "@/services/expense-investment-link";
import { updateAccountType } from "@/services/financial-account";
import { updateLifeMilestone } from "@/services/life-milestone";
import { setMoneyEvent } from "@/services/money-events";
import { bumpDataVersion } from "@/services/settings";
import { convertDebitToTransfer } from "@/services/transfer-detect";
import { logger } from "@/utils/logger";
import { APPLY_ORDER, GROUP_LABELS, SHARED_TYPES, type FixType, type SharedType } from "./format";
import { diffMetrics, measure, type MetricChange } from "./impact";
import type { Fix } from "./read";
import { addFixHistory, takeSnapshot } from "./snapshot";

/**
 * Applies the corrections the user left ticked (docs/AI_CORRECTIONS_DESIGN.md):
 *   1. measures the app's figures,
 *   2. snapshots everything, for Undo,
 *   3. applies in dependency order, each through the service the app's own screens use, so its
 *      side effects (balance chain, links, bucket totals, edit history) happen as they would by hand,
 *   4. measures again and reports what moved.
 * One correction failing is listed and the rest still apply.
 */

export interface CorrectionsProgress {
  done: number;
  total: number;
  doing: string;
}

export interface CorrectionsResult {
  applied: number;
  byGroup: { label: string; count: number }[];
  failed: { title: string; reason: string }[];
  changes: MetricChange[];
}

const DOING: Partial<Record<FixType | SharedType, string>> = {
  set_account_type: "Fixing account types",
  mark_duplicate: "Removing duplicates",
  mark_transfer: "Turning payments into transfers",
  link_refund: "Linking refunds",
  move_account: "Moving transactions to the right account",
  set_merchant: "Fixing merchant names",
  set_payment_mode: "Fixing payment modes",
  set_spend_type: "Marking unavoidable and discretionary",
  set_income_type: "Fixing income types",
  mark_redemption: "Sorting money back from investments",
  link_to_bucket: "Linking investments",
  adjust_balance: "Matching balances to the bank",
  update_goal: "Updating goals",
};

async function applyOne(userId: string, f: Fix): Promise<void> {
  switch (f.type) {
    case "set_account_type":
      return updateAccountType(f.accountId, f.accountType);
    case "mark_duplicate":
      return deleteExpense(f.expenseId);
    case "mark_transfer":
      if (f.isCredit) await reclassifyCreditAsTransfer(f.expenseId, f.otherAccountId);
      else await convertDebitToTransfer(userId, f.expenseId, f.otherAccountId);
      return;
    case "link_refund":
      return linkCreditAsRefund(f.creditId, f.purchaseId);
    case "move_account":
      return updateExpense(f.expenseId, { account_id: f.accountId });
    case "set_merchant":
      return updateExpense(f.expenseId, { merchant_name: f.merchant });
    case "set_payment_mode":
      return updateExpense(f.expenseId, { payment_mode_id: f.modeId });
    case "set_spend_type":
      return updateExpense(f.expenseId, { is_right_spend: f.unavoidable ? 1 : 0 });
    case "set_income_type":
      return updateExpense(f.expenseId, { credit_kind: f.incomeType });
    case "mark_redemption":
      return setMoneyEvent(f.expenseId, "investment_withdrawal");
    case "link_to_bucket":
      await linkExpenseToBucket(f.expenseId, f.bucketId, "Fix my data");
      return;
    case "adjust_balance":
      await adjustAccountAvailable({ accountId: f.accountId, userId, actualAvailable: f.balance, description: "Matched to the bank (Fix my data)" });
      return;
    case "update_goal":
      return updateLifeMilestone(f.milestoneId, {
        ...(f.targetAmount !== null ? { target_amount: f.targetAmount } : {}),
        ...(f.targetDate !== null ? { target_date: f.targetDate } : {}),
      });
    default:
      throw new Error("Not a correction Arth applies here");
  }
}

const isShared = (f: Fix): f is Fix & { type: SharedType; suggestion: Suggestion } =>
  (SHARED_TYPES as readonly string[]).includes(f.type);

export async function applyCorrections(
  userId: string,
  fixes: Fix[],
  onProgress?: (p: CorrectionsProgress) => void,
): Promise<CorrectionsResult> {
  const total = fixes.length;
  onProgress?.({ done: 0, total, doing: "Measuring your figures" });
  const before = await measure(userId);
  onProgress?.({ done: 0, total, doing: "Saving a copy so this can be undone" });
  await takeSnapshot();

  const failed: CorrectionsResult["failed"] = [];
  const counts = new Map<string, number>();
  let done = 0;

  for (const type of APPLY_ORDER) {
    const group = fixes.filter((f) => f.type === type);
    if (group.length === 0) continue;
    if ((SHARED_TYPES as readonly string[]).includes(type)) {
      onProgress?.({ done, total, doing: GROUP_LABELS[type] });
      try {
        const r = await applySuggestions(userId, group.filter(isShared).map((f) => f.suggestion));
        const ok = Object.values(r.applied).reduce((s, n) => s + (n ?? 0), 0);
        counts.set(type, ok);
        for (const reason of r.failed) failed.push({ title: GROUP_LABELS[type], reason });
      } catch (e) {
        logger.warn(`Fix my data: ${type} failed`, e);
        for (const f of group) failed.push({ title: f.title, reason: e instanceof Error ? e.message : "Couldn't be applied" });
      }
      done += group.length;
      continue;
    }
    for (const f of group) {
      onProgress?.({ done, total, doing: DOING[type] ?? "Applying" });
      try {
        await applyOne(userId, f);
        counts.set(type, (counts.get(type) ?? 0) + 1);
      } catch (e) {
        logger.warn(`Fix my data: ${type} failed for ${f.title}`, e);
        failed.push({ title: f.title, reason: e instanceof Error ? e.message : "Couldn't be applied" });
      }
      done++;
    }
  }

  bumpDataVersion();
  onProgress?.({ done: total, total, doing: "Measuring what changed" });
  const after = await measure(userId);
  const applied = [...counts.values()].reduce((s, n) => s + n, 0);
  const byGroup = APPLY_ORDER.filter((t) => (counts.get(t) ?? 0) > 0).map((t) => ({ label: GROUP_LABELS[t], count: counts.get(t) ?? 0 }));
  const changes = diffMetrics(before, after);
  addFixHistory({
    kind: "ai",
    at: new Date().toISOString(),
    title: `${applied} correction${applied === 1 ? "" : "s"} from your AI`,
    changes: applied,
    groups: byGroup,
    moved: changes.map((c) => ({ label: c.label, before: c.before, value: c.value, unit: c.unit })),
    failed: failed.length,
  });
  return { applied, byGroup, failed, changes };
}
