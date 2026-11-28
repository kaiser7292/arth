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
  "components/insights/MerchantsTab.tsx",
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
  "components/expense/PickerSheet.tsx",
  "components/ui/ChoiceField.tsx",
  "app/settings/ai-suggestions.tsx",
  "app/settings/ai.tsx",
  "app/settings/ai-history.tsx",
  "app/settings/ai-request.tsx",
  "app/settings/angel-connect-credentials.tsx",
  "app/settings/clean-up.tsx",
  "app/settings/kite-connect-api-key.tsx",
  "app/settings/payment-mode-edit.tsx",
  "app/settings/sms-templates/new.tsx",
  "app/settings/sms-templates/tag.tsx",
  "app/settings/sms-templates/unrecognised.tsx",
  "app/settings/zebpay-connect-credentials.tsx",
  "app/(tabs)/settings.tsx",
  "components/home/pages/InsightsPage.tsx",
  "components/home/pages/VaultPage.tsx",
  "components/home/pages/SimulatorPage.tsx",
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
  "app/settings/account-master.tsx",
  "app/settings/account-add.tsx",
  "components/budget/BudgetPeriodView.tsx",
  "app/insights/where-it-goes.tsx",
  "components/insights/SpendCalendar.tsx",
  "components/insights/BillsSummaryCard.tsx",
  "components/ui/Amount.tsx",
  "app/insights/cash-flow.tsx",
  "app/insights/compare.tsx",
  "app/insights/export-for-ai.tsx",
  "app/insights/filtered.tsx",
  "app/insights/forecast.tsx",
  "app/insights/index.tsx",
  "app/insights/insight-detail.tsx",
  "components/insights/MerchantsTab.tsx",
  "components/insights/RegularsTab.tsx",
  "app/goals/financial-health.tsx",
  "app/goals/loan-payoff.tsx",
  "app/goals/retirement.tsx",
  "app/investments/add-fd.tsx",
  "app/investments/add.tsx",
  "app/investments/index.tsx",
  "app/investments/projections.tsx",
  "app/investments/sync-review.tsx",
  "app/simulator/[id].tsx",
  "app/simulator/[id]/entry.tsx",
  "app/simulator/index.tsx",
  "app/simulator/projections.tsx",
  "app/vault/[entryId].tsx",
  "app/vault/add.tsx",
  "app/vault/index.tsx",
  "components/insights/PeriodBar.tsx",
  "components/simulator/HisaabInclusionSheet.tsx",
  "components/simulator/StaleEntryResolveSheet.tsx",
  "app/settings/ai-assisted-setup.tsx",
  "app/settings/angel-connect.tsx",
  "app/settings/backup-data.tsx",
  "app/settings/backup-restore.tsx",
  "app/settings/budget-config.tsx",
  "app/settings/calendar-sync.tsx",
  "app/settings/customise.tsx",
  "app/settings/data-health-issue.tsx",
  "app/settings/dismissed-duplicates.tsx",
  "app/settings/duplicate-accounts.tsx",
  "app/settings/fix-my-data.tsx",
  "app/settings/help/index.tsx",
  "app/settings/help/[slug].tsx",
  "app/settings/household/categories.tsx",
  "app/settings/household/index.tsx",
  "app/settings/household/invite.tsx",
  "app/settings/household/join.tsx",
  "app/settings/household/share.tsx",
  "app/settings/household/start.tsx",
  "app/settings/image-template.tsx",
  "app/settings/image-templates.tsx",
  "app/settings/import-excel.tsx",
  "app/settings/iphone-bank-messages.tsx",
  "app/settings/kite-connect.tsx",
  "app/settings/licenses.tsx",
  "app/settings/merchant-categories.tsx",
  "app/settings/merchant-detail.tsx",
  "app/settings/merchants.tsx",
  "app/settings/notifications.tsx",
  "app/settings/payment-modes.tsx",
  "app/settings/reconciliation/index.tsx",
  "app/settings/reconciliation/link-extra.tsx",
  "app/settings/reconciliation/manual-link.tsx",
  "app/settings/reconciliation/new.tsx",
  "app/settings/reconciliation/[sessionId].tsx",
  "app/settings/recurring-rules.tsx",
  "app/settings/region.tsx",
  "app/settings/security.tsx",
  "app/settings/smart-rules/applications/[id].tsx",
  "app/settings/smart-rules/index.tsx",
  "app/settings/smart-rules/[id].tsx",
  "app/settings/sms-disclosure.tsx",
  "app/settings/sms-scan-runs.tsx",
  "app/settings/sms-templates/confirm.tsx",
  "app/settings/sms-templates/index.tsx",
  "app/settings/sms-templates/matches/[id].tsx",
  "app/settings/sms-templates/[id].tsx",
  "app/settings/start-date.tsx",
  "app/settings/tags.tsx",
  "app/settings/transaction-messages.tsx",
  "app/settings/transfer-review.tsx",
  "app/settings/update-balances.tsx",
  "app/settings/voice-input.tsx",
  "app/settings/zebpay-connect.tsx",
  "components/settings/AppUpdateRow.tsx",
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
