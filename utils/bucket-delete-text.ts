import type { InvestmentBucketUsage } from "@/services/yearly-plan";

/** The delete confirmation for an investment bucket: what goes, and what is only unlinked. */
export function describeBucketDelete(name: string, usage: InvestmentBucketUsage | null): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const lines: string[] = [];
  if (usage) {
    if (usage.contributions > 0) lines.push(`• ${plural(usage.contributions, "contribution is", "contributions are")} deleted`);
    if (usage.transfers > 0) lines.push(`• ${plural(usage.transfers, "transfer stays but loses", "transfers stay but lose")} this bucket`);
    if (usage.linkedExpenses > 0)
      lines.push(`• ${plural(usage.linkedExpenses, "linked payment counts", "linked payments count")} as spending again`);
    if (usage.rules > 0) lines.push(`• ${plural(usage.rules, "smart rule stops", "smart rules stop")} linking payments to it`);
    if (usage.fixedDeposits > 0) lines.push(`• ${plural(usage.fixedDeposits, "fixed deposit is", "fixed deposits are")} unassigned`);
  }
  const head = `Delete "${name}"? This cannot be undone.`;
  return lines.length > 0 ? `${head}\n\n${lines.join("\n")}` : head;
}
