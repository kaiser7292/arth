import { useEffect } from "react";
import { usePathname, useRouter } from "expo-router";
import { useToast } from "@/components/ui";
import { onLabRunFinished, summariseLabRun } from "@/services/ai/lab-runner";

/**
 * Says when the AI lab's background run is done, wherever the user is in Arth. Mounted once
 * inside ToastProvider in app/_layout.tsx; renders nothing.
 */
export function LabRunToaster() {
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(
    () =>
      onLabRunFinished((run) => {
        const s = summariseLabRun(run.rows);
        const message = `AI lab done: ${s.transactions} transactions, ${s.notTransactions} not, ${s.rejected} rejected`;
        if (pathname === "/settings/ai-lab") toast(message);
        else toast(message, { actionLabel: "View", onAction: () => router.push("/settings/ai-lab") });
      }),
    [toast, router, pathname],
  );

  return null;
}
