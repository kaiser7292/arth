import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

/**
 * v2.4.0 — Integer paise migration.
 *
 * Converts all monetary amount columns from REAL (rupees) to INTEGER (paise)
 * by multiplying every value by 100. After this migration, every stored amount
 * is an integer number of paise (1 rupee = 100 paise). The display layer
 * divides by 100 at render time; write paths multiply by 100 before storing.
 *
 * Non-monetary numeric columns (rates, percentages, counts, IDs) are
 * intentionally left unchanged.
 *
 * The `monthly_overrides` JSON field in `salary_profiles` stores per-month
 * salary amounts as a plain JS object. It is handled by the app layer
 * (reads divide ÷100, writes multiply ×100) rather than SQL, because SQLite
 * cannot atomically transform every value inside an arbitrary JSON object.
 */
const migration: Migration = {
  version: 60,
  name: "060_paise",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      -- ── Core transactions ──────────────────────────────────────────
      UPDATE expenses SET
        amount               = ROUND(amount * 100),
        split_original_amount = CASE WHEN split_original_amount IS NOT NULL
                                     THEN ROUND(split_original_amount * 100) END,
        split_exact_amount   = CASE WHEN split_exact_amount IS NOT NULL
                                    THEN ROUND(split_exact_amount * 100) END,
        convenience_fee      = ROUND(COALESCE(convenience_fee, 0) * 100),
        fee_absorbed         = ROUND(COALESCE(fee_absorbed, 0) * 100);

      -- ── Balance chain ──────────────────────────────────────────────
      UPDATE account_month_balances SET
        opening_balance = ROUND(opening_balance * 100);

      UPDATE account_transfers SET
        amount = ROUND(amount * 100);

      UPDATE account_credits SET
        amount = ROUND(amount * 100);

      -- ── Budgets ────────────────────────────────────────────────────
      UPDATE budgets SET
        amount = ROUND(amount * 100);

      UPDATE budget_breakdowns SET
        amount = ROUND(amount * 100);

      -- ── Goals / Yearly plan ────────────────────────────────────────
      UPDATE yearly_plans SET
        annual_salary_in_hand      = ROUND(COALESCE(annual_salary_in_hand, 0) * 100),
        expected_bonus             = ROUND(COALESCE(expected_bonus, 0) * 100),
        total_planned_expenses     = ROUND(COALESCE(total_planned_expenses, 0) * 100),
        total_planned_investments  = ROUND(COALESCE(total_planned_investments, 0) * 100),
        total_planned_milestones   = ROUND(COALESCE(total_planned_milestones, 0) * 100);

      UPDATE investment_buckets SET
        annual_target       = ROUND(COALESCE(annual_target, 0) * 100),
        current_contributed = ROUND(COALESCE(current_contributed, 0) * 100);

      UPDATE investment_contributions SET
        amount = ROUND(amount * 100);

      UPDATE life_milestones SET
        target_amount                = ROUND(COALESCE(target_amount, 0) * 100),
        current_saved                = ROUND(COALESCE(current_saved, 0) * 100),
        monthly_contribution_planned = ROUND(COALESCE(monthly_contribution_planned, 0) * 100);

      UPDATE milestone_contributions SET
        amount = ROUND(amount * 100);

      -- ── Financial accounts ─────────────────────────────────────────
      UPDATE financial_accounts SET
        credit_limit       = CASE WHEN credit_limit IS NOT NULL THEN ROUND(credit_limit * 100) END,
        last_known_balance = CASE WHEN last_known_balance IS NOT NULL THEN ROUND(last_known_balance * 100) END,
        total_due          = CASE WHEN total_due IS NOT NULL THEN ROUND(total_due * 100) END,
        min_due            = CASE WHEN min_due IS NOT NULL THEN ROUND(min_due * 100) END,
        nach_amount        = CASE WHEN nach_amount IS NOT NULL THEN ROUND(nach_amount * 100) END,
        fund_balance       = CASE WHEN fund_balance IS NOT NULL THEN ROUND(fund_balance * 100) END,
        min_balance        = CASE WHEN min_balance IS NOT NULL THEN ROUND(min_balance * 100) END;

      -- ── Hisaab ─────────────────────────────────────────────────────
      UPDATE hisaab_persons SET
        initial_balance = ROUND(COALESCE(initial_balance, 0) * 100);

      UPDATE hisaab_entries SET
        amount = ROUND(amount * 100);

      UPDATE expense_splits SET
        amount = ROUND(amount * 100);

      -- ── Loans ──────────────────────────────────────────────────────
      UPDATE loan_accounts SET
        principal_sanctioned           = ROUND(COALESCE(principal_sanctioned, 0) * 100),
        principal_disbursed            = ROUND(COALESCE(principal_disbursed, 0) * 100),
        emi_amount                     = ROUND(COALESCE(emi_amount, 0) * 100),
        processing_fee                 = ROUND(COALESCE(processing_fee, 0) * 100),
        stamp_duty                     = ROUND(COALESCE(stamp_duty, 0) * 100),
        insurance_premium              = ROUND(COALESCE(insurance_premium, 0) * 100),
        foreclosure_waiver_min_amount  = CASE WHEN foreclosure_waiver_min_amount IS NOT NULL
                                              THEN ROUND(foreclosure_waiver_min_amount * 100) END,
        last_sms_reminder_amount       = CASE WHEN last_sms_reminder_amount IS NOT NULL
                                             THEN ROUND(last_sms_reminder_amount * 100) END;

      UPDATE loan_schedule_entries SET
        opening_principal   = ROUND(COALESCE(opening_principal, 0) * 100),
        emi_amount          = ROUND(COALESCE(emi_amount, 0) * 100),
        principal_component = ROUND(COALESCE(principal_component, 0) * 100),
        interest_component  = ROUND(COALESCE(interest_component, 0) * 100),
        closing_principal   = ROUND(COALESCE(closing_principal, 0) * 100),
        paid_amount         = CASE WHEN paid_amount IS NOT NULL THEN ROUND(paid_amount * 100) END;

      UPDATE loan_prepayments SET
        amount             = ROUND(COALESCE(amount, 0) * 100),
        prepayment_charge  = ROUND(COALESCE(prepayment_charge, 0) * 100),
        gst_on_charge      = ROUND(COALESCE(gst_on_charge, 0) * 100);

      UPDATE loan_corrections SET
        outstanding_principal = ROUND(COALESCE(outstanding_principal, 0) * 100),
        emi_amount            = ROUND(COALESCE(emi_amount, 0) * 100);

      -- ── Simulator ──────────────────────────────────────────────────
      UPDATE simulation_entries SET
        amount = ROUND(COALESCE(amount, 0) * 100);

      UPDATE simulation_hisaab_inclusions SET
        amount = ROUND(COALESCE(amount, 0) * 100);

      -- ── Demat snapshots ────────────────────────────────────────────
      UPDATE demat_portfolio_snapshots SET
        portfolio_value = ROUND(COALESCE(portfolio_value, 0) * 100);

      UPDATE demat_fund_snapshots SET
        fund_value = ROUND(COALESCE(fund_value, 0) * 100);

      -- ── SMS scan (display cache) ────────────────────────────────────
      UPDATE sms_scan_details SET
        parsed_amount = CASE WHEN parsed_amount IS NOT NULL THEN ROUND(parsed_amount * 100) END;

      -- ── Automation / rules ─────────────────────────────────────────
      UPDATE recurring_transactions SET
        amount = ROUND(COALESCE(amount, 0) * 100);

      UPDATE expense_classifications SET
        amount_range_low  = CASE WHEN amount_range_low IS NOT NULL THEN ROUND(amount_range_low * 100) END,
        amount_range_high = CASE WHEN amount_range_high IS NOT NULL THEN ROUND(amount_range_high * 100) END;

      UPDATE recurring_expense_rules SET
        amount = CASE WHEN amount IS NOT NULL THEN ROUND(amount * 100) END;

      -- ── Links / analytics ──────────────────────────────────────────
      UPDATE expense_loan_links SET
        amount = CASE WHEN amount IS NOT NULL THEN ROUND(amount * 100) END;

      UPDATE expense_investment_links SET
        contribution_amount = CASE WHEN contribution_amount IS NOT NULL
                                   THEN ROUND(contribution_amount * 100) END;

      -- ── Unavoidable baselines ──────────────────────────────────────
      UPDATE unavoidable_baselines SET
        monthly_amount = ROUND(COALESCE(monthly_amount, 0) * 100);

      -- ── Reconciliation ─────────────────────────────────────────────
      UPDATE reconciliation_sessions SET
        stmt_closing_bal = CASE WHEN stmt_closing_bal IS NOT NULL THEN ROUND(stmt_closing_bal * 100) END,
        arth_closing_bal = CASE WHEN arth_closing_bal IS NOT NULL THEN ROUND(arth_closing_bal * 100) END;

      UPDATE reconciliation_items SET
        stmt_amount = ROUND(COALESCE(stmt_amount, 0) * 100);

      -- ── Salary profiles ────────────────────────────────────────────
      -- Note: monthly_overrides (JSON field) is handled in the app layer.
      -- Percentages (basic_pct, hra_pct, etc.) are intentionally excluded.
      UPDATE salary_profiles SET
        annual_ctc                = CASE WHEN annual_ctc IS NOT NULL THEN ROUND(annual_ctc * 100) END,
        vpf_monthly               = ROUND(COALESCE(vpf_monthly, 0) * 100),
        professional_tax_annual   = ROUND(COALESCE(professional_tax_annual, 0) * 100),
        deductions_80c            = ROUND(COALESCE(deductions_80c, 0) * 100),
        deductions_80d            = ROUND(COALESCE(deductions_80d, 0) * 100),
        hra_exemption_annual      = ROUND(COALESCE(hra_exemption_annual, 0) * 100),
        home_loan_interest        = ROUND(COALESCE(home_loan_interest, 0) * 100),
        other_deductions          = ROUND(COALESCE(other_deductions, 0) * 100),
        expected_capital_gains    = ROUND(COALESCE(expected_capital_gains, 0) * 100),
        expected_bonus            = ROUND(COALESCE(expected_bonus, 0) * 100),
        capital_gains_equity_ltcg = ROUND(COALESCE(capital_gains_equity_ltcg, 0) * 100),
        capital_gains_equity_stcg = ROUND(COALESCE(capital_gains_equity_stcg, 0) * 100),
        capital_gains_debt        = ROUND(COALESCE(capital_gains_debt, 0) * 100),
        capital_gains_fd          = ROUND(COALESCE(capital_gains_fd, 0) * 100),
        capital_gains_gold        = ROUND(COALESCE(capital_gains_gold, 0) * 100),
        capital_gains_real_estate = ROUND(COALESCE(capital_gains_real_estate, 0) * 100),
        computed_monthly_in_hand  = ROUND(COALESCE(computed_monthly_in_hand, 0) * 100),
        computed_annual_tax       = ROUND(COALESCE(computed_annual_tax, 0) * 100),
        manual_monthly_in_hand    = ROUND(COALESCE(manual_monthly_in_hand, 0) * 100),
        manual_basic              = ROUND(COALESCE(manual_basic, 0) * 100),
        manual_hra                = ROUND(COALESCE(manual_hra, 0) * 100),
        manual_special            = ROUND(COALESCE(manual_special, 0) * 100),
        manual_employer_epf       = ROUND(COALESCE(manual_employer_epf, 0) * 100),
        manual_gratuity           = ROUND(COALESCE(manual_gratuity, 0) * 100);

      -- ── SMS-reported account balances (not in backup, still in DB) ─
      UPDATE account_balance_sms SET
        balance = ROUND(COALESCE(balance, 0) * 100);

      -- ── Smart rules — legacy fixed-column amounts ──────────────────
      UPDATE smart_rules SET
        match_min_amount = CASE WHEN match_min_amount IS NOT NULL THEN ROUND(match_min_amount * 100) END,
        match_max_amount = CASE WHEN match_max_amount IS NOT NULL THEN ROUND(match_max_amount * 100) END;
    `);

    // ── Smart rules — dynamic conditions JSON ─────────────────────────────
    // The `conditions` column stores JSON arrays like:
    //   [{"field":"amount","operator":"greater_than","value":1000}, ...]
    // For amount conditions the value is a rupee number (or [low,high] for
    // "between"). We must multiply those by 100 to match paise storage.
    try {
      const rules = await db.getAllAsync<{ id: string; conditions: string | null }>(
        "SELECT id, conditions FROM smart_rules WHERE conditions IS NOT NULL;",
      );
      for (const rule of rules) {
        if (!rule.conditions) continue;
        let conditions: Array<{ field: string; operator: string; value: unknown }>;
        try {
          conditions = JSON.parse(rule.conditions);
        } catch {
          continue;
        }
        let changed = false;
        const updated = conditions.map((cond) => {
          if (cond.field !== "amount") return cond;
          if (Array.isArray(cond.value)) {
            changed = true;
            return { ...cond, value: (cond.value as number[]).map((v) => Math.round(v * 100)) };
          }
          if (typeof cond.value === "number") {
            changed = true;
            return { ...cond, value: Math.round(cond.value * 100) };
          }
          return cond;
        });
        if (changed) {
          await db.runAsync(
            "UPDATE smart_rules SET conditions = ? WHERE id = ?;",
            JSON.stringify(updated),
            rule.id,
          );
        }
      }
    } catch {
      // smart_rules may not exist on very old DBs — safe to skip
    }
  },
};

export default migration;
