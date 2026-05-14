import { useState, useCallback } from "react";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { getFinancialCockpit, type FinancialCockpitData } from "@/services/financial-cockpit";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getCurrentFY } from "@/utils/fiscal-year";
import { getFYStartMonth } from "@/services/settings";

interface CockpitState {
  data: FinancialCockpitData | null;
  loading: boolean;
  error: string | null;
}

export function useCockpitData(): CockpitState {
  const [state, setState] = useState<CockpitState>({
    data: null,
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    try {
      const startMonth = getFYStartMonth();
      const fy = String(getCurrentFY(startMonth));
      const data = await getFinancialCockpit(DEFAULT_USER_ID, fy);
      setState({ data, loading: false, error: null });
    } catch (e) {
      setState({ data: null, loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useDataRefresh(load);

  return state;
}
