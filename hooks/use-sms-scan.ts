import { useCallback, useState } from "react";
import { runSmsScan, type ScanOutcome } from "@/services/sms";

/**
 * Hook for screens that offer a manual "Scan now" button.
 * Exposes a scanning flag so the UI can show a loader, and a trigger
 * function that bypasses the cooldown (manual scans always run if SMS
 * detection is enabled and permission is granted).
 */
export function useSmsScan() {
  const [scanning, setScanning] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<ScanOutcome | null>(null);

  const scanNow = useCallback(async (): Promise<ScanOutcome> => {
    if (scanning) return { ran: false, created: 0, credits: 0, skipped: 0, totalScanned: 0, reason: "cooldown" };
    setScanning(true);
    try {
      const outcome = await runSmsScan({ manual: true });
      setLastOutcome(outcome);
      return outcome;
    } finally {
      setScanning(false);
    }
  }, [scanning]);

  return { scanning, lastOutcome, scanNow };
}
