import { NetWorthTrendCard } from "@/components/goals/NetWorthTrendCard";
import type { NetWorthPoint } from "@/services/net-worth-history";
import { Frame } from "../preview-kit/Frame";

/** Website screenshot: Net worth over the year. Invented data. */
const MONTHS = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];
const zero = { saved: 0, marketGains: 0, loansPaidDown: 0, other: 0 };
const POINTS: NetWorthPoint[] = MONTHS.map((month, i) => {
  const liquidCash = 180000 + i * 21000;
  const investments = 1150000 + i * 38000 + (i % 3 === 1 ? -22000 : 0);
  const receivables = 24000 - i * 1500;
  const cards = 18000 + (i % 2) * 6000;
  const loans = 820000 - i * 14500;
  const payables = 6000;
  const netWorth = liquidCash + investments + receivables - cards - loans - payables;
  return {
    month,
    asOfDate: `${month}-28`,
    savings: liquidCash,
    market: investments,
    cards,
    loans,
    hisaab: receivables - payables,
    liquidCash,
    investments,
    receivables,
    payables,
    netWorth,
    estimated: false,
    change: i === 0 ? zero : { saved: 21000 + 9000, marketGains: i % 3 === 1 ? -22000 : 8000, loansPaidDown: 14500, other: -1500 },
  } as unknown as NetWorthPoint;
});

export default function ShotNetWorth() {
  return (
    <Frame title="Net worth" back icons={["search-outline"]}>
      <NetWorthTrendCard points={POINTS} fyStartMonth="2026-04" />
    </Frame>
  );
}
