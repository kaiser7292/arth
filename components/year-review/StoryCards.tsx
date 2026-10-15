import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useState } from "react";
import { Card, Text } from "@/components/ui";
import { DonutChart } from "@/components/charts/DonutChart";
import { useTheme } from "@/hooks/use-theme";
import { formatAmount, formatCompact } from "@/utils/format";
import { monthName, type YearReview } from "@/services/reports/year-review";

/** One page of the story: eyebrow, big headline, then whatever the page shows. */
export function StoryPage({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className="mx-4 flex-1">
      <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{eyebrow}</Text>
      <Text className="text-2xl font-bold text-foreground mt-2">{title}</Text>
      {subtitle ? <Text className="text-sm text-muted-foreground mt-1.5 leading-5">{subtitle}</Text> : null}
      {children ? <View className="mt-5">{children}</View> : null}
    </Card>
  );
}

function StatRow({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  const theme = useTheme();
  return (
    <View className="flex-row justify-between items-center py-2 border-b border-border">
      <Text className="text-sm text-muted-foreground flex-1 mr-3" numberOfLines={1}>{label}</Text>
      <Text
        className="text-sm font-semibold text-foreground"
        style={tone ? { color: tone === "good" ? theme.success : theme.danger } : undefined}
      >
        {value}
      </Text>
    </View>
  );
}

const signedPct = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n)}%`;

export function IntroPage({ r }: { r: YearReview }) {
  const smsPct = r.totals.txCount > 0 ? Math.round((r.totals.smsCount / r.totals.txCount) * 100) : 0;
  return (
    <StoryPage
      eyebrow={r.isComplete ? "Your year in review" : "Your year so far"}
      title={r.fyLabel}
      subtitle={`${monthName(r.startDate.slice(0, 7))} to ${monthName(r.endDate.slice(0, 7))}`}
    >
      <StatRow label="Spent" value={formatAmount(r.totals.spent)} />
      {r.totals.moneyIn > 0 && <StatRow label="Money in" value={formatAmount(r.totals.moneyIn)} />}
      <StatRow label="Transactions" value={r.totals.txCount.toLocaleString("en-IN")} />
      {r.totals.smsCount > 0 && <StatRow label="Picked up from SMS by Arth" value={`${smsPct}%`} />}
    </StoryPage>
  );
}

export function SavingsPage({ r }: { r: YearReview }) {
  const s = r.savings!;
  const change = s.prevRatePct != null ? s.ratePct - s.prevRatePct : null;
  return (
    <StoryPage
      eyebrow="Savings"
      title={`You saved ${Math.round(s.ratePct)}%`}
      subtitle={
        s.source === "plan"
          ? "of your income, going by your yearly plan."
          : "of the money that came in, after everything you spent."
      }
    >
      <StatRow label="Saved" value={formatAmount(s.saved)} />
      {s.targetPct != null && (
        <StatRow
          label="Your target"
          value={`${Math.round(s.targetPct)}%`}
          tone={s.ratePct >= s.targetPct ? "good" : "bad"}
        />
      )}
      {change != null && (
        <StatRow label="Vs last year" value={`${change > 0 ? "+" : ""}${Math.round(change)} pts`} tone={change >= 0 ? "good" : "bad"} />
      )}
    </StoryPage>
  );
}

function MiniLine({ values, color }: { values: number[]; color: string }) {
  const [w, setW] = useState(0);
  const h = 90;
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const d = values
    .map((v, i) => `${i === 0 ? "M" : "L"} ${(i / (values.length - 1)) * w} ${h - 6 - ((v - min) / span) * (h - 12)}`)
    .join(" ");
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height: h }}>
      {w > 0 && (
        <Svg width={w} height={h}>
          <Path d={d} stroke={color} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        </Svg>
      )}
    </View>
  );
}

export function NetWorthPage({ r }: { r: YearReview }) {
  const theme = useTheme();
  const nw = r.netWorth!;
  const up = nw.change >= 0;
  return (
    <StoryPage
      eyebrow="Net worth"
      title={`${up ? "Up" : "Down"} ${formatCompact(Math.abs(nw.change))}`}
      subtitle={`From ${formatAmount(nw.start)} to ${formatAmount(nw.end)}.`}
    >
      <MiniLine values={nw.points.map((p) => p.netWorth)} color={up ? theme.success : theme.danger} />
    </StoryPage>
  );
}

export function CategoriesPage({ r }: { r: YearReview }) {
  const top = r.categories[0];
  return (
    <StoryPage
      eyebrow="Where it went"
      title={top ? `${top.name} led the way` : "Where it went"}
      subtitle={top ? `${Math.round(top.pct)}% of everything you spent.` : undefined}
    >
      <View className="items-center mb-3">
        <DonutChart
          segments={r.categories.map((c) => ({ label: c.name, value: c.amount, color: c.color }))}
          size={150}
          thickness={22}
          centerLabel="Spent"
          centerValue={formatCompact(r.totals.spent)}
        />
      </View>
    </StoryPage>
  );
}

export function MerchantsPage({ r }: { r: YearReview }) {
  const fav = r.merchants.byVisits[0];
  return (
    <StoryPage
      eyebrow="Your favourite places"
      title={fav ? fav.name : r.merchants.bySpend[0]?.name ?? ""}
      subtitle={fav ? `${fav.count} visits this year.` : "Where most of your money went."}
    >
      {r.merchants.bySpend.map((m, i) => (
        <StatRow key={m.name} label={`${i + 1}. ${m.name}`} value={formatAmount(m.amount)} />
      ))}
    </StoryPage>
  );
}

export function MonthsPage({ r }: { r: YearReview }) {
  const theme = useTheme();
  const max = Math.max(1, ...r.months.map((m) => m.total));
  const big = r.biggestMonth!;
  return (
    <StoryPage
      eyebrow="Month by month"
      title={`${monthName(big.month)} was the big one`}
      subtitle={
        r.quietestMonth
          ? `${formatAmount(big.total)} spent. ${monthName(r.quietestMonth.month)} was the quietest at ${formatAmount(r.quietestMonth.total)}.`
          : `${formatAmount(big.total)} spent.`
      }
    >
      <View className="flex-row items-end" style={{ height: 110 }}>
        {r.months.map((m) => (
          <View key={m.month} className="flex-1 items-center">
            <View
              style={{
                width: "70%",
                height: Math.max(2, (m.total / max) * 90),
                borderRadius: 3,
                backgroundColor: m.month === big.month ? theme.primary : theme.alpha("primary", 0.3),
              }}
            />
            <Text className="text-label text-faint-foreground mt-1">{monthName(m.month).slice(0, 1)}</Text>
          </View>
        ))}
      </View>
    </StoryPage>
  );
}

export function DebtPage({ r }: { r: YearReview }) {
  const d = r.debt!;
  const down = d.reduced >= 0;
  return (
    <StoryPage
      eyebrow="Loans"
      title={down ? `${formatCompact(d.reduced)} of debt paid off` : `${formatCompact(-d.reduced)} borrowed`}
      subtitle={`Loans went from ${formatAmount(d.start)} to ${formatAmount(d.end)}.`}
    />
  );
}

export function InvestedPage({ r }: { r: YearReview }) {
  const inv = r.invested!;
  return (
    <StoryPage
      eyebrow="Investing"
      title={inv.amount > 0 ? `${formatCompact(inv.amount)} invested` : `${inv.fdsOpened} FD${inv.fdsOpened === 1 ? "" : "s"} opened`}
      subtitle="Money you moved into investments, FDs and pension this year."
    >
      {inv.amount > 0 && <StatRow label="Invested" value={formatAmount(inv.amount)} />}
      {inv.fdsOpened > 0 && <StatRow label="Fixed deposits opened" value={String(inv.fdsOpened)} />}
    </StoryPage>
  );
}

export function HisaabPage({ r }: { r: YearReview }) {
  const h = r.hisaab!;
  return (
    <StoryPage
      eyebrow="Hisaab"
      title={h.peopleSettled > 0 ? `Settled up with ${h.peopleSettled} ${h.peopleSettled === 1 ? "person" : "people"}` : "Hisaab"}
      subtitle={
        h.netAtEnd > 0
          ? `People owed you ${formatAmount(h.netAtEnd)} at year end.`
          : h.netAtEnd < 0
            ? `You owed ${formatAmount(-h.netAtEnd)} at year end.`
            : "All square at year end."
      }
    >
      {h.settledAmount > 0 && <StatRow label="Settled" value={formatAmount(h.settledAmount)} />}
    </StoryPage>
  );
}

export function VsLastYearPage({ r }: { r: YearReview }) {
  const v = r.vsLastYear!;
  return (
    <StoryPage
      eyebrow={r.isComplete ? "Vs last year" : "Vs the same point last year"}
      title={
        v.spentChangePct == null
          ? "Compared with last year"
          : `Spending ${v.spentChangePct >= 0 ? "up" : "down"} ${Math.abs(Math.round(v.spentChangePct))}%`
      }
      subtitle={`${formatAmount(v.spentPrev)} last year. The biggest changes:`}
    >
      {v.changes.map((c) => (
        <StatRow
          key={c.name}
          label={c.name}
          value={c.changePct == null ? `new · ${formatCompact(c.curr)}` : signedPct(c.changePct)}
          tone={c.curr <= c.prev ? "good" : "bad"}
        />
      ))}
    </StoryPage>
  );
}
