import { useCallback, useState } from "react";
import { useAlert } from "@/hooks/use-alert";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import {
  getFixHistory,
  getUndoable,
  undoChangesSince,
  undoLastCorrection,
  type FixHistoryEntry,
} from "@/services/corrections/snapshot";
import { formatDisplayDate, toIsoDate } from "@/utils/date";

/** A history timestamp (UTC ISO) as the phone's own date, "YYYY-MM-DD". */
export function localDay(iso: string): string {
  return toIsoDate(new Date(iso));
}

/**
 * What AI changed (Settings → AI): the history of applied AI fixes and bank matches, and Undo for
 * the latest AI fix. Undo says first what it would also take away, as Fix my data does.
 */
export function useFixUndo() {
  const alert = useAlert();
  const [history, setHistory] = useState<FixHistoryEntry[]>(getFixHistory);
  const [undoable, setUndoable] = useState<FixHistoryEntry | null>(getUndoable);
  const [undoing, setUndoing] = useState(false);

  const refresh = useCallback(() => {
    setHistory(getFixHistory());
    setUndoable(getUndoable());
  }, []);
  useDataRefresh(useCallback(async () => refresh(), [refresh]));

  const undo = useCallback(async () => {
    const target = getUndoable();
    if (!target) return;
    // Undo restores the copy taken before the fix: say exactly what that would also take away.
    const since = await undoChangesSince(target.at).catch(() => ({ added: 0, changed: 0 }));
    const lost =
      since.added + since.changed === 0
        ? "Nothing has been added or changed since, so nothing else is lost."
        : `Since then, ${[
            since.added ? `${since.added} transaction${since.added === 1 ? " was" : "s were"} added` : null,
            since.changed ? `${since.changed} ${since.changed === 1 ? "was" : "were"} edited` : null,
          ]
            .filter(Boolean)
            .join(" and ")}. Those go too; new bank messages come back on the next scan.`;
    alert(`Undo "${target.title}"?`, `Your data goes back to how it was on ${formatDisplayDate(localDay(target.at))}, just before it. ${lost}`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Undo",
        style: "destructive",
        onPress: async () => {
          setUndoing(true);
          try {
            await undoLastCorrection();
          } catch (e) {
            alert("Couldn't undo", e instanceof Error ? e.message : "Try again.");
          } finally {
            setUndoing(false);
            refresh();
          }
        },
      },
    ]);
  }, [alert, refresh]);

  return { history, undoable, undoing, undo, refresh };
}

/** "26 Nov · can be undone" under a history row. */
export function historyLine(e: FixHistoryEntry, canUndo: boolean): string {
  const status = e.undoneAt
    ? ` · undone ${formatDisplayDate(localDay(e.undoneAt))}`
    : canUndo
      ? " · can be undone"
      : e.kind === "ai"
        ? " · can't be undone now"
        : "";
  return `${formatDisplayDate(localDay(e.at))}${status}${e.failed > 0 ? ` · ${e.failed} couldn't be applied` : ""}`;
}
