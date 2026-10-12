import { useEffect, useState } from "react";
import { getPickerBalances } from "@/services/account-picker-balance";
import type { FinancialAccount } from "@/services/financial-account";
import { logger } from "@/utils/logger";

/**
 * Balances for an account picker (see getPickerBalances). Loads when `enabled` turns true —
 * pass the picker's open state so closed dropdowns cost nothing — and again each time it reopens.
 * A failed load just leaves the picker without balances.
 */
export function useAccountBalances(
  accounts: FinancialAccount[],
  enabled = true,
): Record<string, number | null> {
  const [balances, setBalances] = useState<Record<string, number | null>>({});
  const key = accounts.map((a) => a.id).join(",");

  useEffect(() => {
    if (!enabled || accounts.length === 0) return;
    let cancelled = false;
    getPickerBalances(accounts)
      .then((b) => {
        if (!cancelled) setBalances(b);
      })
      .catch((e) => logger.error("Account picker balances failed", e));
    return () => {
      cancelled = true;
    };
    // Keyed on the ids: callers often pass a freshly filtered array each render.
  }, [key, enabled]);

  return balances;
}
