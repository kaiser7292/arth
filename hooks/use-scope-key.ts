import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { useCustomisation } from "@/hooks/use-customisation";
import { customiseVersion } from "@/services/customise";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * The skip key for a tab's DataRefreshScope (hooks/use-data-refresh.ts): it changes when anything
 * a tab shows could have changed without a save. That covers a new day, the app coming back to the
 * front (permissions or settings changed outside Arth), something switched on or off in Customise,
 * and whatever the caller adds (the viewed month).
 */
export function useScopeKey(extra = ""): string {
  useCustomisation();
  const [resumes, setResumes] = useState(0);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") setResumes((n) => n + 1);
    });
    return () => sub.remove();
  }, []);
  return `${today()}|${resumes}|${customiseVersion()}|${extra}`;
}
