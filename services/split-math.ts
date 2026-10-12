import type { SplitConfig } from "./expense-types";

// Pure split arithmetic, kept free of the database so cards and previews can use it.

/**
 * Compute split amounts from a total and config.
 * Returns what to record in the user's budget and hisaab.
 */
export function computeSplitAmounts(
  totalAmount: number,
  config: SplitConfig,
): {
  myBudgetAmount: number;
  hisaabAmount: number;
  hisaabType: "debit" | "credit";
  splitPct: number;
} {
  let otherPersonShare: number;

  switch (config.splitMode) {
    case "equal":
      otherPersonShare = Math.round((totalAmount / 2) * 100) / 100;
      break;
    case "they_owe_full":
      otherPersonShare = totalAmount;
      break;
    case "i_owe_full":
      otherPersonShare = 0;
      break;
    case "exact":
      // When paidBy==="me": "How much do they owe?" → exactAmount is OTHER person's share
      // When paidBy!=="me": "How much do you owe?"  → exactAmount is MY share
      if (config.paidBy === "me") {
        otherPersonShare = config.exactAmount ?? 0;
      } else {
        otherPersonShare = Math.round((totalAmount - (config.exactAmount ?? 0)) * 100) / 100;
      }
      break;
    case "percentage":
      // When paidBy==="me": "Their share %" → percentage is OTHER person's share
      // When paidBy!=="me": "Your share %"  → percentage is MY share
      if (config.paidBy === "me") {
        otherPersonShare = Math.round(totalAmount * ((config.percentage ?? 0) / 100) * 100) / 100;
      } else {
        otherPersonShare = Math.round(totalAmount * ((100 - (config.percentage ?? 0)) / 100) * 100) / 100;
      }
      break;
  }

  const myShare = Math.round((totalAmount - otherPersonShare) * 100) / 100;
  const splitPct =
    totalAmount > 0 ? Math.round((myShare / totalAmount) * 100) : 100;

  if (config.paidBy === "me") {
    return {
      myBudgetAmount: myShare,
      hisaabAmount: otherPersonShare,
      hisaabType: "debit",
      splitPct,
    };
  } else {
    return {
      myBudgetAmount: myShare,
      hisaabAmount: myShare,
      hisaabType: "credit",
      splitPct,
    };
  }
}
