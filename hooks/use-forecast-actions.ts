import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  markForecastAsPaid,
  markExpenseForecastAsPaid,
  markRepaymentAsPaid,
  markForecastPaidExternally,
  realizeForecast,
  rejectExpense,
} from "@/services/expense";
import type { Expense } from "@/services/expense";
import { reclassifyExpenseAsTransfer } from "@/services/account-transfer";
import { logger } from "@/utils/logger";

export function useForecastActions(
  refresh: () => void,
  setForecasts: Dispatch<SetStateAction<Expense[]>>,
) {
  const [accountPickerVisible, setAccountPickerVisible] = useState(false);
  const [pendingRepaymentId, setPendingRepaymentId] = useState<string | null>(null);

  const handleMarkPaid = useCallback(
    async (id: string) => {
      try {
        await markExpenseForecastAsPaid(id);
        setForecasts((prev) => prev.filter((f) => f.id !== id));
        refresh();
      } catch (e) {
        logger.error("Mark forecast as paid failed:", e);
      }
    },
    [setForecasts, refresh],
  );

  const handleRepaymentPaid = useCallback(
    (id: string) => {
      setPendingRepaymentId(id);
      setAccountPickerVisible(true);
    },
    [],
  );

  const handleAccountSelected = useCallback(
    async (fromAccountId: string) => {
      setAccountPickerVisible(false);
      if (!pendingRepaymentId) return;
      try {
        await markRepaymentAsPaid(pendingRepaymentId, fromAccountId);
        setForecasts((prev) => prev.filter((f) => f.id !== pendingRepaymentId));
        refresh();
      } catch (e) {
        logger.error("Mark repayment as paid failed:", e);
      }
      setPendingRepaymentId(null);
    },
    [pendingRepaymentId, setForecasts, refresh],
  );

  const handleAccountPickerClose = useCallback(() => {
    setAccountPickerVisible(false);
    setPendingRepaymentId(null);
  }, []);

  const handlePaidExternally = useCallback(
    async (id: string) => {
      try {
        await markForecastPaidExternally(id);
        setForecasts((prev) => prev.filter((f) => f.id !== id));
        refresh();
      } catch (e) {
        logger.error("Mark forecast paid externally failed:", e);
      }
    },
    [setForecasts, refresh],
  );

  const handleRealise = useCallback(
    async (id: string) => {
      try {
        const today = new Date().toISOString().split("T")[0];
        await realizeForecast(id, today);
        refresh();
      } catch (e) {
        logger.error("Realise forecast failed:", e);
      }
    },
    [refresh],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await rejectExpense(id);
        setForecasts((prev) => prev.filter((f) => f.id !== id));
        refresh();
      } catch (e) {
        logger.error("Delete forecast failed:", e);
      }
    },
    [setForecasts, refresh],
  );

  const handleMarkAsTransfer = useCallback(
    async (expenseId: string, toAccountId: string) => {
      try {
        await reclassifyExpenseAsTransfer(expenseId, toAccountId);
        refresh();
      } catch (e) {
        logger.error("Reclassify as transfer failed:", e);
      }
    },
    [refresh],
  );

  return {
    handleMarkPaid,
    handleRealise,
    handleDelete,
    handleRepaymentPaid,
    handlePaidExternally,
    handleMarkAsTransfer,
    handleAccountSelected,
    handleAccountPickerClose,
    accountPickerVisible,
  } as const;
}
