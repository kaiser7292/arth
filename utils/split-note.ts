import type { Expense } from "@/services/expense";
import type { HisaabPerson } from "@/services/hisaab";
import { formatAmount } from "@/utils/format";

/**
 * One line under a split transaction saying what part of it counts as yours ("Your half of ₹800",
 * "Paid for Rahul · ₹0 counted"). Null for an expense that isn't split. Shared by the Insights and
 * Budget transaction lists.
 */
export function buildSplitNote(
  expense: Expense,
  personMap: Map<string, HisaabPerson>,
): string | null {
  // No split at all
  if (!expense.split_original_amount && !expense.split_person_id) return null;

  const personName = expense.split_person_id
    ? (personMap.get(expense.split_person_id)?.name ?? null)
    : null;

  const original = expense.split_original_amount;

  switch (expense.split_mode) {
    case "they_owe_full":
      return personName
        ? `Paid for ${personName} · ₹0 counted (they owe you)`
        : "Paid for someone · ₹0 counted";

    case "i_owe_full":
      return personName
        ? `${personName} paid · full amount counted`
        : "Full amount counted (you owed)";

    case "equal":
      return original
        ? `Your half of ${formatAmount(original)}`
        : "Your half";

    case "percentage":
      return original && expense.split_pct != null
        ? `Your ${expense.split_pct}% of ${formatAmount(original)}`
        : null;

    case "exact":
      return original && original !== expense.amount
        ? `Your ${formatAmount(expense.amount)} of ${formatAmount(original)}`
        : null;

    default:
      // Legacy rows (pre-migration-024): reconstruct from amounts
      if (original && original !== expense.amount) {
        const pct = original > 0 ? Math.round((expense.amount / original) * 100) : null;
        return pct != null
          ? `Your ${pct}% of ${formatAmount(original)}`
          : `Your share of ${formatAmount(original)}`;
      }
      return null;
  }
}
