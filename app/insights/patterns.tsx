import { useState, useCallback } from "react";
import * as Haptics from "expo-haptics";

import { LoadingState, ScreenContainer, useToast } from "@/components/ui";
import { PatternEditSheet, type PatternEdit } from "@/components/analytics/PatternEditSheet";
import { PatternLibraryView } from "@/components/analytics/PatternLibraryView";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useAlert } from "@/hooks/use-alert";

import type { ExpenseClassificationRow } from "@/services/analytics/classifier";
import {
  confirmPattern,
  correctPattern,
  forgetPattern,
  getPatternLibrary,
  rebuildPatterns,
} from "@/services/analytics/pattern-learner";
import { detectRecurringTransactions } from "@/services/recurring-detector";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getErrorMessage } from "@/utils/error-message";
import { logger } from "@/utils/logger";

/**
 * Insights → Patterns: the regular payments Arth has learned (expense_classifications) — the
 * list the month-end projection counts as bills and the "Monthly bills" check-in asks about.
 * Answers given here are the same answers as there.
 *
 * (This screen used to show the older recurring_transactions list, which the projection
 * doesn't read, so confirming or editing here changed nothing.)
 */
export default function PatternLibraryScreen() {
  const alert = useAlert();
  const toast = useToast();
  const [patterns, setPatterns] = useState<ExpenseClassificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ExpenseClassificationRow | null>(null);
  const [rescanning, setRescanning] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setPatterns(await getPatternLibrary(DEFAULT_USER_ID));
    } catch (e) {
      logger.error("Patterns: load failed", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useDataRefresh(loadData);

  // Every answer bumps the data version, which reloads this list and the projection.
  const answer = useCallback(
    async (write: () => Promise<void>, done: string) => {
      try {
        await write();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        toast(done, { tone: "success" });
      } catch (e) {
        logger.error("Patterns: save failed", e);
        toast("Couldn't save that: " + getErrorMessage(e), { tone: "danger" });
      }
    },
    [toast],
  );

  const handleRescan = useCallback(async () => {
    setRescanning(true);
    try {
      const active = await rebuildPatterns(DEFAULT_USER_ID);
      // The Subscription check still reads the older list; nothing else refreshes it.
      await detectRecurringTransactions(DEFAULT_USER_ID).catch((e) => logger.warn("Subscription re-scan failed:", e));
      await loadData();
      toast(active === 0 ? "No regular payments found" : `${active} regular payment${active !== 1 ? "s" : ""} found`, { tone: "success" });
    } catch (e) {
      alert("Scan failed", getErrorMessage(e));
    } finally {
      setRescanning(false);
    }
  }, [loadData, alert, toast]);

  const handleForget = useCallback(
    (p: ExpenseClassificationRow) => {
      alert(
        "Let Arth decide again?",
        `Your "not a bill" answer for ${p.merchant_normalized} is removed. If it still looks like a regular payment, Arth will ask you again.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Remove answer", onPress: () => answer(() => forgetPattern(p.id), "Answer removed") },
        ],
      );
    },
    [alert, answer],
  );

  if (loading) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState message="Loading patterns..." />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      <PatternLibraryView
        patterns={patterns}
        rescanning={rescanning}
        onRescan={handleRescan}
        onConfirm={(p) => void answer(() => confirmPattern(p.id), `${p.merchant_normalized} counted as a bill`)}
        onNotBill={(p) => void answer(() => correctPattern(p.id, "variable"), `${p.merchant_normalized} treated as everyday spending`)}
        onEdit={setEditing}
        onForget={handleForget}
      />

      {editing && (
        <PatternEditSheet
          visible
          pattern={editing}
          onSave={(edit: PatternEdit) =>
            answer(
              () => correctPattern(editing.id, edit.classification, edit.amountLow, edit.amountHigh, edit.frequency, edit.expectedDay),
              `${editing.merchant_normalized} updated`,
            )
          }
          onNotBill={() => answer(() => correctPattern(editing.id, "variable"), `${editing.merchant_normalized} treated as everyday spending`)}
          onClose={() => setEditing(null)}
        />
      )}
    </ScreenContainer>
  );
}
