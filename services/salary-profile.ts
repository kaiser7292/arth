import { getDatabase } from "@/database";
import { bumpDataVersion } from "@/services/settings";
import { generateUUID } from "@/utils/uuid";

// ─── Types ─────────────────────────────────────────────────

export interface SalaryProfile {
  id: string;
  yearly_plan_id: string | null;
  financial_year: string | null;
  user_id: string | null;
  input_mode: "ctc" | "direct";
  annual_ctc: number | null;
  basic_pct: number;
  hra_pct: number;
  is_metro: number;
  epf_mode: "full_basic" | "restricted";
  epf_in_ctc: number;
  vpf_monthly: number;
  tax_regime: "new" | "old";
  professional_tax_annual: number;
  state: string | null;
  deductions_80c: number;
  deductions_80d: number;
  hra_exemption_annual: number;
  home_loan_interest: number;
  other_deductions: number;
  expected_capital_gains: number;
  expected_bonus: number;
  capital_gains_equity_ltcg: number;
  capital_gains_equity_stcg: number;
  capital_gains_debt: number;
  capital_gains_fd: number;
  capital_gains_gold: number;
  capital_gains_real_estate: number;
  status: "draft" | "complete";
  computed_monthly_in_hand: number;
  computed_annual_tax: number;
  manual_monthly_in_hand: number;
  monthly_overrides: string | null;
  /** Day of month (1-31) when user typically receives salary. Default 25. */
  salary_credit_day: number;
  /** 1 if employer's gratuity is part of quoted CTC (default); 0 if paid on top. */
  gratuity_in_ctc: number;
  /** 'percentage' (default) — use basic_pct/hra_pct; 'manual' — use the manual_* rupee fields. */
  ctc_mode: "percentage" | "manual";
  manual_basic: number;
  manual_hra: number;
  manual_special: number;
  manual_employer_epf: number;
  manual_gratuity: number;
  created_at: string;
  updated_at: string;
}

export interface CreateSalaryProfileInput {
  yearly_plan_id?: string;
  financial_year?: string;
  user_id?: string;
  input_mode: "ctc" | "direct";
  annual_ctc?: number | null;
  basic_pct?: number;
  hra_pct?: number;
  is_metro?: boolean;
  epf_mode?: "full_basic" | "restricted";
  epf_in_ctc?: boolean;
  vpf_monthly?: number;
  tax_regime?: "new" | "old";
  professional_tax_annual?: number;
  state?: string | null;
  deductions_80c?: number;
  deductions_80d?: number;
  hra_exemption_annual?: number;
  home_loan_interest?: number;
  other_deductions?: number;
  expected_capital_gains?: number;
  expected_bonus?: number;
  capital_gains_equity_ltcg?: number;
  capital_gains_equity_stcg?: number;
  capital_gains_debt?: number;
  capital_gains_fd?: number;
  capital_gains_gold?: number;
  capital_gains_real_estate?: number;
  status?: "draft" | "complete";
  computed_monthly_in_hand?: number;
  computed_annual_tax?: number;
  manual_monthly_in_hand?: number;
  monthly_overrides?: string | null;
  salary_credit_day?: number;
  gratuity_in_ctc?: boolean;
  ctc_mode?: "percentage" | "manual";
  manual_basic?: number;
  manual_hra?: number;
  manual_special?: number;
  manual_employer_epf?: number;
  manual_gratuity?: number;
}

export interface UpdateSalaryProfileInput {
  input_mode?: "ctc" | "direct";
  annual_ctc?: number | null;
  basic_pct?: number;
  hra_pct?: number;
  is_metro?: boolean;
  epf_mode?: "full_basic" | "restricted";
  epf_in_ctc?: boolean;
  vpf_monthly?: number;
  tax_regime?: "new" | "old";
  professional_tax_annual?: number;
  state?: string | null;
  deductions_80c?: number;
  deductions_80d?: number;
  hra_exemption_annual?: number;
  home_loan_interest?: number;
  other_deductions?: number;
  expected_capital_gains?: number;
  expected_bonus?: number;
  capital_gains_equity_ltcg?: number;
  capital_gains_equity_stcg?: number;
  capital_gains_debt?: number;
  capital_gains_fd?: number;
  capital_gains_gold?: number;
  capital_gains_real_estate?: number;
  status?: "draft" | "complete";
  computed_monthly_in_hand?: number;
  computed_annual_tax?: number;
  manual_monthly_in_hand?: number;
  monthly_overrides?: string | null;
  salary_credit_day?: number;
  gratuity_in_ctc?: boolean;
  ctc_mode?: "percentage" | "manual";
  manual_basic?: number;
  manual_hra?: number;
  manual_special?: number;
  manual_employer_epf?: number;
  manual_gratuity?: number;
}

// ─── CRUD ──────────────────────────────────────────────────

export async function getSalaryProfileByPlanId(
  yearlyPlanId: string,
): Promise<SalaryProfile | null> {
  const db = getDatabase();
  return db.getFirstAsync<SalaryProfile>(
    "SELECT * FROM salary_profiles WHERE yearly_plan_id = ?;",
    yearlyPlanId,
  );
}

export async function getSalaryProfileByFY(
  userId: string,
  financialYear: string,
): Promise<SalaryProfile | null> {
  const db = getDatabase();
  return db.getFirstAsync<SalaryProfile>(
    "SELECT * FROM salary_profiles WHERE user_id = ? AND financial_year = ?;",
    userId,
    financialYear,
  );
}

/**
 * Get the user's configured salary-credit day. Falls back to 25 (typical Indian
 * salary-credit date) when no profile exists for the given FY, or when the
 * profile has no explicit value set.
 */
export async function getSalaryCreditDay(
  userId: string,
  financialYear: string,
): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ salary_credit_day: number | null }>(
    "SELECT salary_credit_day FROM salary_profiles WHERE user_id = ? AND financial_year = ? LIMIT 1;",
    userId,
    financialYear,
  );
  return row?.salary_credit_day ?? 25;
}

export async function createSalaryProfile(
  input: CreateSalaryProfileInput,
): Promise<string> {
  const db = getDatabase();
  const id = generateUUID();

  await db.runAsync(
    `INSERT INTO salary_profiles
     (id, yearly_plan_id, financial_year, user_id, input_mode, annual_ctc, basic_pct, hra_pct, is_metro,
      epf_mode, epf_in_ctc, vpf_monthly, tax_regime, professional_tax_annual, state,
      deductions_80c, deductions_80d, hra_exemption_annual, home_loan_interest, other_deductions,
      expected_capital_gains, expected_bonus, computed_monthly_in_hand, computed_annual_tax,
      status, capital_gains_equity_ltcg, capital_gains_equity_stcg, capital_gains_debt,
      capital_gains_fd, capital_gains_gold, capital_gains_real_estate, manual_monthly_in_hand,
      monthly_overrides, salary_credit_day,
      gratuity_in_ctc, ctc_mode, manual_basic, manual_hra, manual_special, manual_employer_epf, manual_gratuity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    id,
    input.yearly_plan_id ?? null,
    input.financial_year ?? null,
    input.user_id ?? null,
    input.input_mode,
    input.annual_ctc ?? null,
    input.basic_pct ?? 40,
    input.hra_pct ?? 50,
    input.is_metro !== false ? 1 : 0,
    input.epf_mode ?? "restricted",
    input.epf_in_ctc !== false ? 1 : 0,
    input.vpf_monthly ?? 0,
    input.tax_regime ?? "new",
    input.professional_tax_annual ?? 2400,
    input.state ?? null,
    input.deductions_80c ?? 0,
    input.deductions_80d ?? 0,
    input.hra_exemption_annual ?? 0,
    input.home_loan_interest ?? 0,
    input.other_deductions ?? 0,
    input.expected_capital_gains ?? 0,
    input.expected_bonus ?? 0,
    input.computed_monthly_in_hand ?? 0,
    input.computed_annual_tax ?? 0,
    input.status ?? "complete",
    input.capital_gains_equity_ltcg ?? 0,
    input.capital_gains_equity_stcg ?? 0,
    input.capital_gains_debt ?? 0,
    input.capital_gains_fd ?? 0,
    input.capital_gains_gold ?? 0,
    input.capital_gains_real_estate ?? 0,
    input.manual_monthly_in_hand ?? 0,
    input.monthly_overrides ?? null,
    input.salary_credit_day ?? 25,
    input.gratuity_in_ctc !== false ? 1 : 0,
    input.ctc_mode ?? "percentage",
    input.manual_basic ?? 0,
    input.manual_hra ?? 0,
    input.manual_special ?? 0,
    input.manual_employer_epf ?? 0,
    input.manual_gratuity ?? 0,
  );

  bumpDataVersion();
  return id;
}

export async function updateSalaryProfile(
  id: string,
  input: UpdateSalaryProfileInput,
): Promise<void> {
  const db = getDatabase();

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (input.input_mode !== undefined) {
    fields.push("input_mode = ?");
    values.push(input.input_mode);
  }
  if (input.annual_ctc !== undefined) {
    fields.push("annual_ctc = ?");
    values.push(input.annual_ctc);
  }
  if (input.basic_pct !== undefined) {
    fields.push("basic_pct = ?");
    values.push(input.basic_pct);
  }
  if (input.hra_pct !== undefined) {
    fields.push("hra_pct = ?");
    values.push(input.hra_pct);
  }
  if (input.is_metro !== undefined) {
    fields.push("is_metro = ?");
    values.push(input.is_metro ? 1 : 0);
  }
  if (input.epf_mode !== undefined) {
    fields.push("epf_mode = ?");
    values.push(input.epf_mode);
  }
  if (input.epf_in_ctc !== undefined) {
    fields.push("epf_in_ctc = ?");
    values.push(input.epf_in_ctc ? 1 : 0);
  }
  if (input.vpf_monthly !== undefined) {
    fields.push("vpf_monthly = ?");
    values.push(input.vpf_monthly);
  }
  if (input.tax_regime !== undefined) {
    fields.push("tax_regime = ?");
    values.push(input.tax_regime);
  }
  if (input.professional_tax_annual !== undefined) {
    fields.push("professional_tax_annual = ?");
    values.push(input.professional_tax_annual);
  }
  if (input.state !== undefined) {
    fields.push("state = ?");
    values.push(input.state);
  }
  if (input.deductions_80c !== undefined) {
    fields.push("deductions_80c = ?");
    values.push(input.deductions_80c);
  }
  if (input.deductions_80d !== undefined) {
    fields.push("deductions_80d = ?");
    values.push(input.deductions_80d);
  }
  if (input.hra_exemption_annual !== undefined) {
    fields.push("hra_exemption_annual = ?");
    values.push(input.hra_exemption_annual);
  }
  if (input.home_loan_interest !== undefined) {
    fields.push("home_loan_interest = ?");
    values.push(input.home_loan_interest);
  }
  if (input.other_deductions !== undefined) {
    fields.push("other_deductions = ?");
    values.push(input.other_deductions);
  }
  if (input.computed_monthly_in_hand !== undefined) {
    fields.push("computed_monthly_in_hand = ?");
    values.push(input.computed_monthly_in_hand);
  }
  if (input.expected_capital_gains !== undefined) {
    fields.push("expected_capital_gains = ?");
    values.push(input.expected_capital_gains);
  }
  if (input.expected_bonus !== undefined) {
    fields.push("expected_bonus = ?");
    values.push(input.expected_bonus);
  }
  if (input.computed_annual_tax !== undefined) {
    fields.push("computed_annual_tax = ?");
    values.push(input.computed_annual_tax);
  }
  if (input.status !== undefined) {
    fields.push("status = ?");
    values.push(input.status);
  }
  if (input.capital_gains_equity_ltcg !== undefined) {
    fields.push("capital_gains_equity_ltcg = ?");
    values.push(input.capital_gains_equity_ltcg);
  }
  if (input.capital_gains_equity_stcg !== undefined) {
    fields.push("capital_gains_equity_stcg = ?");
    values.push(input.capital_gains_equity_stcg);
  }
  if (input.capital_gains_debt !== undefined) {
    fields.push("capital_gains_debt = ?");
    values.push(input.capital_gains_debt);
  }
  if (input.capital_gains_fd !== undefined) {
    fields.push("capital_gains_fd = ?");
    values.push(input.capital_gains_fd);
  }
  if (input.capital_gains_gold !== undefined) {
    fields.push("capital_gains_gold = ?");
    values.push(input.capital_gains_gold);
  }
  if (input.capital_gains_real_estate !== undefined) {
    fields.push("capital_gains_real_estate = ?");
    values.push(input.capital_gains_real_estate);
  }
  if (input.manual_monthly_in_hand !== undefined) {
    fields.push("manual_monthly_in_hand = ?");
    values.push(input.manual_monthly_in_hand);
  }
  if (input.monthly_overrides !== undefined) {
    fields.push("monthly_overrides = ?");
    values.push(input.monthly_overrides);
  }
  if (input.salary_credit_day !== undefined) {
    fields.push("salary_credit_day = ?");
    values.push(input.salary_credit_day);
  }
  if (input.gratuity_in_ctc !== undefined) {
    fields.push("gratuity_in_ctc = ?");
    values.push(input.gratuity_in_ctc ? 1 : 0);
  }
  if (input.ctc_mode !== undefined) {
    fields.push("ctc_mode = ?");
    values.push(input.ctc_mode);
  }
  if (input.manual_basic !== undefined) {
    fields.push("manual_basic = ?");
    values.push(input.manual_basic);
  }
  if (input.manual_hra !== undefined) {
    fields.push("manual_hra = ?");
    values.push(input.manual_hra);
  }
  if (input.manual_special !== undefined) {
    fields.push("manual_special = ?");
    values.push(input.manual_special);
  }
  if (input.manual_employer_epf !== undefined) {
    fields.push("manual_employer_epf = ?");
    values.push(input.manual_employer_epf);
  }
  if (input.manual_gratuity !== undefined) {
    fields.push("manual_gratuity = ?");
    values.push(input.manual_gratuity);
  }

  if (fields.length === 0) return;

  fields.push("updated_at = datetime('now')");
  values.push(id);
  await db.runAsync(
    `UPDATE salary_profiles SET ${fields.join(", ")} WHERE id = ?;`,
    ...values,
  );
  bumpDataVersion();
}

export async function deleteSalaryProfile(id: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync("DELETE FROM salary_profiles WHERE id = ?;", id);
  bumpDataVersion();
}
