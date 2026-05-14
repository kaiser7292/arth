/**
 * v15 feature flag surface.
 *
 * Flags are build-time constants — flipping requires a new build. Intentional:
 * we want code and data to ship together so a flag-on run never finds the
 * data it expects missing. Runtime toggles would also need MMKV wiring and
 * an admin UI; not worth it for features that roll out MINOR-by-MINOR.
 *
 * Migrations never read flags — they run unconditionally so the schema
 * progresses even on flag-off builds. Only consumption code (parser,
 * categorizer, onboarding) checks flags.
 */
export const V15_FLAGS = {
  /** Phase 1: run seedPublicData() at init. Safe with no bundles (no-op). */
  v15_public_data_seed: true,
  /** Phase 2: consult merchant_brand_registry after merchant_mappings miss. */
  v15_merchant_brand_lookup: true,
  /** Phase 2: try sms_template_patterns when hardcoded BANK_PATTERNS miss. */
  v15_sms_template_fallback: true,
  /** Phase 2: resolve bank_name from IFSC when SMS carries one. */
  v15_ifsc_bank_resolver: true,
  /** Phase 2: collect reminder_hint SMS matches into reminder_suggestions. */
  v15_reminder_hint_harvest: true,
  /** Phase 4: show first-run onboarding wizard. */
  v15_onboarding_wizard: true,
  /** Phase 5: show in-app help center. */
  v15_help_center: true,
  /** v15.2: biometric app lock (opt-in via Settings → Security). */
  v15_biometric_lock: true,
  /** v15.2: smart rules auto-categorize on expense writes. */
  v15_smart_rules: true,
  /** v15.5: user-authored SMS templates via Settings → Smart SMS Templates. */
  v15_user_sms_templates: true,
  /** v15.5: savings min-balance breach alert on Home. */
  v15_min_balance_alert: true,
  /** v15.8.1: Savings Advisor card on Home. OFF until the feature ships — keeps users off a Coming Soon dead-end. */
  v15_advisor_card: false,
  /** v15.8.1: Reconcile Statements card on Home. OFF — low-use path; still reachable via deep-link when re-enabled. */
  v15_reconcile_card: false,
  /** v17.0.0: expense → investment bucket linking + budget/insights/savings integration. Off = UI hidden, existing links inert. */
  v17_expense_investment_link: true,
  /** v17.0.0: proper loan management (Add Loan wizard, amortization, live outstanding). Off = loans fall back to scalar. */
  v17_loans_v1: true,
} as const;

export type V15FlagName = keyof typeof V15_FLAGS;

export function getFlag(name: V15FlagName): boolean {
  return V15_FLAGS[name];
}
