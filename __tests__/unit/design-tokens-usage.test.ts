/**
 * @jest-environment node
 *
 * Keeps the transaction screens on the design system (docs/TRANSACTIONS_DESIGN_SYSTEM_PLAN.md).
 *
 * The audit that started this found 178 off-scale text sizes and 59 off-token corners in these
 * files, plus colours made by gluing "14" onto a hex string. They were moved onto the tokens in
 * constants/design-tokens.js; this fails if any come back:
 *
 *   text-xs / sm / base / lg / xl / 2xl / 3xl   -> text-label ... text-hero
 *   rounded-sm / md / lg / xl / 2xl / 3xl        -> rounded-control / card / sheet / pill
 *   fontSize: 14 in a style                      -> a type-scale class
 *   colour + "14"                                -> theme.alpha() or tint()
 *   useColorScheme().colors.*                    -> useTheme()
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");

const FILES = [
  "app/(tabs)/expenses.tsx",
  "app/expense/[id].tsx",
  "app/expense/add.tsx",
  "app/expense/catch-up.tsx",
  "app/expense/just-arrived.tsx",
  "app/expense/review-queue.tsx",
  "app/transfer/[id].tsx",
  "app/settings/audit-log.tsx",
  "app/settings/recycle-bin.tsx",
  "app/budget/transactions.tsx",
  "app/budget/[categoryId].tsx",
  "app/insights/filtered.tsx",
  "app/summary/my-month-rows.tsx",
  "app/together/transactions.tsx",
  "app/reconciliation/account-ledger.tsx",
  "app/hisaab/ledger.tsx",
  "app/settings/recurring-rule-detail.tsx",
  "app/insights/merchants.tsx",
  "app/settings/categories.tsx",
  "app/settings/category-edit.tsx",
  "app/settings/category-organise.tsx",
  "components/home/pages/ReviewQueuePage.tsx",
  "components/ui/ListToolbar.tsx",
  "components/ui/SwipePager.tsx",
  "components/ui/FilterChip.tsx",
  "components/ui/SearchField.tsx",
  "components/ui/SectionHeader.tsx",
  "components/ui/Chip.tsx",
  "components/ui/OptionRows.tsx",
  "components/ui/Segmented.tsx",
  "components/ui/SectionTitle.tsx",
  "components/ui/ActionRow.tsx",
  "components/ui/MoneyChip.tsx",
  "components/ui/FieldRow.tsx",
  "components/ui/FilterSheetParts.tsx",
  // UI revamp (docs/UI_REVAMP_PLAN.md)
  "components/ui/LinkRow.tsx",
  "app/(tabs)/goals.tsx",
  "app/goals/yearly-plan.tsx",
  "app/goals/health-grade.tsx",
  "app/goals/risk-coverage.tsx",
  "app/goals/yoy-comparison.tsx",
  "app/goals/capital-gains-reference.tsx",
  "app/goals/loans.tsx",
  "app/goals/milestones.tsx",
  "app/goals/milestone-detail.tsx",
  "app/loans/[id].tsx",
  "app/loans/add.tsx",
  "app/loans/[id]/prepayment.tsx",
  "app/loans/[id]/correction.tsx",
  "components/loans/ForeclosureQuoteSheet.tsx",
  "components/loans/LinkInstallmentSheet.tsx",
  "components/ui/FormParts.tsx",
  "components/ui/FAB.tsx",
  "components/ui/Input.tsx",
  "app/goals/investment-buckets.tsx",
  "app/goals/investment-detail.tsx",
  "app/goals/balance-sheet.tsx",
  "components/goals/NetWorthTrendCard.tsx",
  "components/goals/HisaabNetWorthSheet.tsx",
  "app/goals/salary-calculator.tsx",
  "components/goals/SalaryInputForm.tsx",
  "components/goals/DeductionsSection.tsx",
  "components/goals/TaxBreakdown.tsx",
  "components/goals/SalarySummary.tsx",
  "components/goals/OtherIncomeSection.tsx",
  "components/goals/BusinessIncomeSection.tsx",
  "components/goals/SalaryChecks.tsx",
  "components/goals/salary-helpers.tsx",
  "app/hisaab/persons.tsx",
  "app/(tabs)/budget.tsx",
  "components/budget/SpendingSplitPage.tsx",
  "components/budget/MonthlySummaryPage.tsx",
];

const DIRS = ["components/expense", "components/expense/catch-up"];

const RULES: { name: string; re: RegExp }[] = [
  { name: "off-scale text class", re: /(^|[^\w-])text-(xs|sm|base|lg|xl|2xl|3xl|4xl)(?![\w-])/ },
  { name: "off-token corner", re: /(^|[^\w-])rounded(-[tblr]{1,2})?-(sm|md|lg|xl|2xl|3xl)(?![\w-])/ },
  { name: "inline fontSize", re: /fontSize:\s*\d/ },
  { name: "hex + alpha suffix", re: /\+\s*"[0-9A-Fa-f]{2}"/ },
  { name: "legacy colors.*", re: /\bcolors\.(text|textSecondary|background|surface|border|tint|icon|tabIconDefault|tabIconSelected|blue)\b/ },
];

function allFiles(): string[] {
  const fromDirs = DIRS.flatMap((d) =>
    fs
      .readdirSync(path.join(ROOT, d))
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => `${d}/${f}`),
  );
  return [...new Set([...FILES, ...fromDirs])];
}

describe("transaction screens stay on the design tokens", () => {
  it.each(RULES.map((r) => [r.name, r.re] as const))("no %s", (_name, re) => {
    const hits: string[] = [];
    for (const rel of allFiles()) {
      const file = path.join(ROOT, rel);
      if (!fs.existsSync(file)) continue;
      fs.readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (re.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(hits).toEqual([]);
  });

  it("covers files that exist", () => {
    for (const rel of FILES) expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
  });
});
