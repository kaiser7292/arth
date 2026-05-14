import type * as XLSXType from "xlsx";

let _xlsx: typeof XLSXType | null = null;
function loadXLSX(): typeof XLSXType {
  if (!_xlsx) _xlsx = require("xlsx") as typeof XLSXType;
  return _xlsx;
}
import { getAllCategories } from "./category";
import { upsertBudget } from "./budget";
import {
  getYearlyPlanByFY,
  createYearlyPlan,
  updateYearlyPlan,
  createInvestmentBucket,
} from "./yearly-plan";
import { createLifeMilestone } from "./life-milestone";
import { parseAmount } from "./excel-import";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ForecastSheetConfig {
  sheetName: string;
  financialYear: string; // e.g., "2025" (start year of the FY)
  fyStartMonth: number; // e.g., 4 for April
}

export interface ForecastImportResult {
  budgetsCreated: number;
  categoriesCreated: string[];
  yearlyPlanCreated: boolean;
  investmentBuckets: string[];
  milestones: string[];
  errors: string[];
}

/**
 * A row from the Forecast sheet.
 * Columns are typically: Category | Annual | Apr | May | Jun ... Mar | Balance
 */
interface ForecastRow {
  label: string;
  annual: number | null;
  monthlyValues: (number | null)[]; // 12 months
}

// Common row labels in Estimations Forecast sheets
const SALARY_LABELS = [
  "salary",
  "annual salary",
  "salary in hand",
  "take home",
  "income",
  "annual income",
  "total income",
];
const SAVINGS_RATE_LABELS = [
  "savings rate",
  "savings %",
  "savings target",
  "target savings",
  "savings rate target",
];
const BONUS_LABELS = ["bonus", "expected bonus", "annual bonus"];
const HIKE_LABELS = ["hike", "salary hike", "hike %", "increment"];

// Section headers that separate budget rows from investment/milestone rows
const INVESTMENT_SECTION_LABELS = [
  "investments",
  "investment",
  "investment goals",
  "planned investments",
];
const MILESTONE_SECTION_LABELS = [
  "milestones",
  "milestone",
  "life milestones",
  "goals",
  "life goals",
];
const SKIP_LABELS = [
  "total",
  "grand total",
  "total expenses",
  "total planned",
  "balance",
  "surplus",
  "deficit",
  "left",
  "remaining",
  "unavoidable total",
  "discretionary total",
];

// ---------------------------------------------------------------------------
// Forecast sheet detection
// ---------------------------------------------------------------------------

/**
 * Detect month columns in a Forecast sheet.
 * Returns the column keys that represent months (Apr, May, Jun... or full month names).
 */
export function detectMonthColumns(
  columns: string[],
): { monthColumns: string[]; fyStartMonth: number } | null {
  const MONTH_NAMES_SHORT = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];
  const MONTH_NAMES_FULL = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];

  const monthColumns: string[] = [];
  const monthIndices: number[] = [];

  for (const col of columns) {
    const lower = col.toLowerCase().trim();
    let idx = MONTH_NAMES_SHORT.indexOf(lower);
    if (idx === -1) idx = MONTH_NAMES_FULL.indexOf(lower);
    if (idx !== -1) {
      monthColumns.push(col);
      monthIndices.push(idx + 1); // 1-based month
    }
  }

  if (monthColumns.length < 6) return null; // Need at least 6 months to be a forecast

  // Determine FY start month from the first month column
  const fyStartMonth = monthIndices[0]; // e.g., 4 if first column is Apr

  return { monthColumns, fyStartMonth };
}

/**
 * Detect the FY label column (first non-month, non-numeric column).
 */
function detectLabelColumn(
  columns: string[],
  monthColumns: string[],
): string | null {
  const monthSet = new Set(monthColumns.map((c) => c.toLowerCase()));
  for (const col of columns) {
    const lower = col.toLowerCase().trim();
    if (
      !monthSet.has(lower) &&
      lower !== "annual" &&
      lower !== "total" &&
      lower !== "balance" &&
      lower !== "yearly" &&
      lower !== "left" &&
      lower !== "remaining"
    ) {
      return col;
    }
  }
  return columns[0] ?? null;
}

// ---------------------------------------------------------------------------
// Forecast parsing
// ---------------------------------------------------------------------------

/**
 * Parse a Forecast sheet into structured rows.
 */
export function parseForecastSheet(
  workbook: XLSXType.WorkBook,
  sheetName: string,
): {
  rows: ForecastRow[];
  monthColumns: string[];
  fyStartMonth: number;
  labelColumn: string;
} | null {
  const XLSX = loadXLSX();
  const sheet = workbook.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
  });

  if (json.length === 0) return null;

  const columns = Object.keys(json[0] as Record<string, unknown>);
  const monthDetection = detectMonthColumns(columns);
  if (!monthDetection) return null;

  const { monthColumns, fyStartMonth } = monthDetection;
  const labelColumn = detectLabelColumn(columns, monthColumns);
  if (!labelColumn) return null;

  const rows: ForecastRow[] = [];

  for (const rawRow of json) {
    const row = rawRow as Record<string, unknown>;
    const label = String(row[labelColumn] ?? "").trim();
    if (!label) continue;

    // Try to find annual column
    const annualCol = columns.find(
      (c) =>
        c.toLowerCase() === "annual" ||
        c.toLowerCase() === "yearly" ||
        c.toLowerCase() === "total",
    );
    const annual = annualCol ? parseAmount(row[annualCol]) : null;

    const monthlyValues = monthColumns.map((col) => parseAmount(row[col]));

    rows.push({ label, annual, monthlyValues });
  }

  return { rows, monthColumns, fyStartMonth, labelColumn };
}

// ---------------------------------------------------------------------------
// Forecast import
// ---------------------------------------------------------------------------

/**
 * Import a Forecast sheet: creates budgets per category/month,
 * yearly plan with salary/savings/investments, and investment buckets.
 */
export async function importForecastSheet(
  userId: string,
  workbook: XLSXType.WorkBook,
  config: ForecastSheetConfig,
): Promise<ForecastImportResult> {
  const result: ForecastImportResult = {
    budgetsCreated: 0,
    categoriesCreated: [],
    yearlyPlanCreated: false,
    investmentBuckets: [],
    milestones: [],
    errors: [],
  };

  const parsed = parseForecastSheet(workbook, config.sheetName);
  if (!parsed) {
    result.errors.push(
      "Could not detect month columns in the Forecast sheet.",
    );
    return result;
  }

  const { rows, monthColumns, fyStartMonth } = parsed;

  // Build category lookup
  const categories = await getAllCategories(userId);
  const categoryMap = new Map<string, string>();
  for (const cat of categories) {
    categoryMap.set(cat.name.toLowerCase(), cat.id);
  }

  // State machine: track which section we're in
  let section: "budget" | "investment" | "milestone" = "budget";

  // Plan data we'll accumulate
  let annualSalary = 0;
  let expectedBonus = 0;
  let salaryHikePct = 0;
  let savingsRatePct = 0;
  let totalPlannedExpenses = 0;
  let totalPlannedInvestments = 0;
  let totalPlannedMilestones = 0;

  const investmentBucketInputs: { name: string; target: number }[] = [];
  const milestoneInputs: { name: string; target: number }[] = [];
  const budgetRows: {
    categoryName: string;
    monthlyValues: (number | null)[];
  }[] = [];

  for (const row of rows) {
    const lower = row.label.toLowerCase().trim();

    // Check if this row is a section header or metadata
    if (SKIP_LABELS.some((s) => lower.includes(s))) continue;

    // Detect section changes
    if (INVESTMENT_SECTION_LABELS.some((s) => lower === s || lower.includes(s))) {
      section = "investment";
      continue;
    }
    if (MILESTONE_SECTION_LABELS.some((s) => lower === s || lower.includes(s))) {
      section = "milestone";
      continue;
    }

    // Helper: sum monthly values
    const sumMonthly = () =>
      row.monthlyValues.reduce<number>((acc, v) => acc + (v ?? 0), 0);

    // Extract plan metadata
    if (SALARY_LABELS.some((s) => lower === s || lower.includes(s))) {
      annualSalary = row.annual ?? sumMonthly();
      continue;
    }
    if (BONUS_LABELS.some((s) => lower === s)) {
      expectedBonus = row.annual ?? 0;
      continue;
    }
    if (HIKE_LABELS.some((s) => lower === s)) {
      salaryHikePct = row.annual ?? row.monthlyValues[0] ?? 0;
      continue;
    }
    if (SAVINGS_RATE_LABELS.some((s) => lower === s || lower.includes(s))) {
      savingsRatePct = row.annual ?? row.monthlyValues[0] ?? 0;
      // If it's a whole number like 25, it's already a percent
      // If it's a decimal like 0.25, convert
      if (savingsRatePct > 0 && savingsRatePct < 1) {
        savingsRatePct = savingsRatePct * 100;
      }
      continue;
    }

    // Process data rows based on current section
    const hasValues =
      row.annual || row.monthlyValues.some((v) => v !== null && v > 0);
    if (!hasValues) continue;

    if (section === "budget") {
      const annualTotal = row.annual ?? sumMonthly();
      totalPlannedExpenses += annualTotal;
      budgetRows.push({
        categoryName: row.label,
        monthlyValues: row.monthlyValues,
      });
    } else if (section === "investment") {
      const target = row.annual ?? sumMonthly();
      totalPlannedInvestments += target;
      investmentBucketInputs.push({ name: row.label, target });
    } else if (section === "milestone") {
      const target = row.annual ?? sumMonthly();
      totalPlannedMilestones += target;
      milestoneInputs.push({ name: row.label, target });
    }
  }

  // --- Create/update yearly plan ---
  try {
    let plan = await getYearlyPlanByFY(userId, config.financialYear);
    if (!plan) {
      const planId = await createYearlyPlan({
        user_id: userId,
        financial_year: config.financialYear,
        annual_salary_in_hand: annualSalary,
        expected_bonus: expectedBonus,
        salary_hike_pct: salaryHikePct,
        total_planned_expenses: totalPlannedExpenses,
        total_planned_investments: totalPlannedInvestments,
        total_planned_milestones: totalPlannedMilestones,
        savings_rate_target_pct: savingsRatePct,
        notes: `Imported from Excel: ${config.sheetName}`,
      });
      result.yearlyPlanCreated = true;
      plan = await getYearlyPlanByFY(userId, config.financialYear);

      // Create investment buckets
      for (const bucket of investmentBucketInputs) {
        await createInvestmentBucket({
          yearly_plan_id: planId,
          name: bucket.name,
          annual_target: bucket.target,
        });
        result.investmentBuckets.push(bucket.name);
      }
    } else {
      // Update existing plan with Excel data
      await updateYearlyPlan(plan.id, {
        annual_salary_in_hand: annualSalary || undefined,
        expected_bonus: expectedBonus || undefined,
        total_planned_expenses: totalPlannedExpenses || undefined,
        total_planned_investments: totalPlannedInvestments || undefined,
        total_planned_milestones: totalPlannedMilestones || undefined,
        savings_rate_target_pct: savingsRatePct || undefined,
      });
    }
  } catch (e) {
    result.errors.push(
      `Yearly plan: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // --- Create life milestones ---
  for (const ms of milestoneInputs) {
    try {
      await createLifeMilestone({
        user_id: userId,
        name: ms.name,
        target_amount: ms.target,
      });
      result.milestones.push(ms.name);
    } catch (e) {
      result.errors.push(
        `Milestone "${ms.name}": ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // --- Create budgets per category per month ---
  for (const budgetRow of budgetRows) {
    try {
      // Resolve category
      const catKey = budgetRow.categoryName.toLowerCase();
      let categoryId = categoryMap.get(catKey) ?? null;

      if (!categoryId) {
        // Try fuzzy match
        categoryId = fuzzyFindCategory(catKey, categoryMap);
      }

      if (!categoryId) {
        // Auto-create
        const { createCategory: cc } = await import("./category");
        categoryId = await cc({
          user_id: userId,
          name: budgetRow.categoryName,
        });
        categoryMap.set(catKey, categoryId);
        result.categoriesCreated.push(budgetRow.categoryName);
      }

      // Create budget for each month with a value
      for (let i = 0; i < budgetRow.monthlyValues.length && i < 12; i++) {
        const val = budgetRow.monthlyValues[i];
        if (val === null || val <= 0) continue;

        // Calculate actual month: fyStartMonth + i, wrapping around
        const actualMonth = ((fyStartMonth - 1 + i) % 12) + 1;
        // Determine year: if month < fyStartMonth, it's the next calendar year
        const fyStartYear = parseInt(config.financialYear, 10);
        const year =
          actualMonth >= fyStartMonth ? fyStartYear : fyStartYear + 1;
        const monthStr = `${year}-${String(actualMonth).padStart(2, "0")}`;

        await upsertBudget({
          user_id: userId,
          category_id: categoryId,
          month: monthStr,
          amount: val,
        });
        result.budgetsCreated++;
      }
    } catch (e) {
      result.errors.push(
        `Budget "${budgetRow.categoryName}": ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fuzzyFindCategory(
  needle: string,
  categoryMap: Map<string, string>,
): string | null {
  const normalize = (s: string) =>
    s
      .replace(/&/g, "and")
      .replace(/\s+/g, " ")
      .trim();

  const normalizedNeedle = normalize(needle);

  for (const [existingName, id] of categoryMap) {
    const normalizedExisting = normalize(existingName);

    if (
      normalizedExisting.includes(normalizedNeedle) ||
      normalizedNeedle.includes(normalizedExisting)
    ) {
      return id;
    }

    if (
      normalizedNeedle + "s" === normalizedExisting ||
      normalizedNeedle === normalizedExisting + "s"
    ) {
      return id;
    }
  }

  return null;
}
