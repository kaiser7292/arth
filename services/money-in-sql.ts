/**
 * FROM and WHERE for credits that are real money in: not refunds, not your own transfers, not
 * credit-card payments. Takes user id, start date and end date; `e` is the credit.
 */
export const MONEY_IN_FROM = `FROM expenses e
     LEFT JOIN financial_accounts fa ON fa.id = e.account_id
     WHERE e.user_id = ? AND e.date >= ? AND e.date <= ?
       AND e.nature = 'credit' AND e.status = 'approved' AND e.deleted_at IS NULL
       AND (e.reclassified_as_transfer IS NULL OR e.reclassified_as_transfer = 0)
       AND e.refund_of_expense_id IS NULL
       AND COALESCE(e.credit_kind, '') <> 'refund'
       AND COALESCE(e.money_event, '') NOT IN ('self_transfer', 'fd_closure')
       AND COALESCE(fa.account_type, '') <> 'credit_card'`;
