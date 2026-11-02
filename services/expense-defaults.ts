/**
 * Defaults a transaction takes from what it's filed under, as SQL for the paths that don't go
 * through the Add and Edit forms (which apply the same rules on screen): bulk category change,
 * categorising by merchant, Catch Up, and SMS or Shortcuts messages.
 */

/**
 * SET clause: a spend follows its category's discretionary / unavoidable setting. Takes the new
 * category id as its one parameter. A flag that differs from the old category's setting was chosen
 * by the user (or a smart rule) and stays. SQLite evaluates this against the row before the update,
 * so `expenses.category_id` is still the old category.
 */
export const FOLLOW_CATEGORY_SQL = `is_right_spend = CASE
    WHEN nature = 'realized' AND (
      is_right_spend IS NULL
      OR is_right_spend = (SELECT is_unavoidable FROM categories WHERE id = expenses.category_id)
    ) THEN (SELECT is_unavoidable FROM categories WHERE id = ?)
    ELSE is_right_spend
  END`;

/**
 * SET clause: a spend with no payment mode takes its account's, when the account has exactly one
 * linked; with several, it's left for the user. Takes the account id twice.
 */
export const FILL_MODE_FROM_ACCOUNT_SQL = `payment_mode_id = CASE
    WHEN payment_mode_id IS NULL AND nature = 'realized'
      AND (SELECT COUNT(*) FROM account_payment_modes WHERE account_id = ?) = 1
    THEN (SELECT payment_mode_id FROM account_payment_modes WHERE account_id = ?)
    ELSE payment_mode_id
  END`;
