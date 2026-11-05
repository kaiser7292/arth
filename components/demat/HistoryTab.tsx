import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";

import { Button, Card, Text } from "@/components/ui";
import { LoadFailedBanner } from "@/components/ui/ListToolbar";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { fyOf, getAccountHistory, type AccountHistory, type CaptureStatus } from "@/services/broker-history/history";
import { formatDisplayDate } from "@/utils/date";
import { formatAmount } from "@/utils/format";
import { todayIso } from "@/utils/local-date";

const QUARTERS: { q: 1 | 2 | 3 | 4; label: string }[] = [
  { q: 1, label: "Apr - Jun" },
  { q: 2, label: "Jul - Sep" },
  { q: 3, label: "Oct - Dec" },
  { q: 4, label: "Jan - Mar" },
];

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatAmount(Math.abs(n))}`;

function SectionLabel({ children }: { children: string }) {
  return <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</Text>;
}

function Line({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  return (
    <View className="flex-row items-center justify-between py-1">
      <Text className="text-sm text-muted-foreground flex-1 mr-2">{label}</Text>
      <Text className={`text-sm ${bold ? "font-bold" : "font-semibold"} text-foreground`} style={color ? { color } : undefined}>
        {value}
      </Text>
    </View>
  );
}

function CaptureCard({ capture }: { capture: CaptureStatus }) {
  const theme = useTheme();
  const issues = capture.missingDays.length + capture.differences.length;
  const at = new Date(capture.lastCapturedAt);
  const time = Number.isNaN(at.getTime()) ? "" : at.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  return (
    <View className="py-1.5">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-semibold text-foreground">{capture.brokerName}</Text>
        {capture.savedToday ? (
          <View className="flex-row items-center">
            <Ionicons name="checkmark" size={14} color={theme.success} />
            <Text className="text-xs ml-1" style={{ color: theme.success }}>Saved today, {time}</Text>
          </View>
        ) : (
          <Text className="text-xs" style={{ color: theme.warning }}>Not saved today</Text>
        )}
      </View>
      <Text className="text-xs text-muted-foreground mt-0.5">
        Trades saved since {formatDisplayDate(capture.firstDate)}
        {issues > 0 ? " · " : ""}
        {capture.missingDays.length > 0 && (
          <Text className="text-xs" style={{ color: theme.warning }}>
            {capture.missingDays.length} {capture.missingDays.length === 1 ? "day" : "days"} may be missing
          </Text>
        )}
        {capture.missingDays.length > 0 && capture.differences.length > 0 ? ", " : ""}
        {capture.differences.length > 0 && (
          <Text className="text-xs" style={{ color: theme.warning }}>
            {capture.differences.length} holding{capture.differences.length === 1 ? "" : "s"} changed outside your trades
          </Text>
        )}
      </Text>
    </View>
  );
}

/** The demat page's History: what was saved, gains period by period, and money in and out. */
export function HistoryTab({ accountId }: { accountId: string }) {
  const theme = useTheme();
  const router = useRouter();
  const currentFy = fyOf(todayIso());
  const [fy, setFy] = useState(currentFy);
  const [history, setHistory] = useState<AccountHistory | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setHistory(await getAccountHistory(accountId, fy));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [accountId, fy]);
  useDataRefresh(load);

  const openSales = (params: { quarter?: string; check?: string }) =>
    router.push({ pathname: "/demat/gains", params: { accountId, fy: String(fy), ...params } });
  const openImport = () => router.push({ pathname: "/demat/import", params: { accountId } });

  if (failed) return <LoadFailedBanner onRetry={load} />;
  if (!history) return null;

  const { totals, money, source } = history;
  const nothing = source === "none" && !money.hasRecords && history.mutualFunds.bought === 0 && history.captures.length === 0;
  const color = (n: number) => (n > 0 ? theme.success : n < 0 ? theme.danger : undefined);

  return (
    <View className="mx-4 mb-3">
      {history.captures.length > 0 && (
        <Card className="mb-3 py-2">
          {history.captures.map((c) => (
            <CaptureCard key={c.broker} capture={c} />
          ))}
        </Card>
      )}

      <View className="flex-row items-center justify-center mb-3">
        <Pressable onPress={() => setFy(fy - 1)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Previous year">
          <Ionicons name="chevron-back" size={18} color={theme.mutedForeground} />
        </Pressable>
        <Text className="text-sm font-semibold text-foreground mx-4">
          FY {fy}-{String(fy + 1).slice(2)}
        </Text>
        <Pressable onPress={() => setFy(fy + 1)} disabled={fy >= currentFy} hitSlop={12} accessibilityRole="button" accessibilityLabel="Next year">
          <Ionicons name="chevron-forward" size={18} color={fy >= currentFy ? theme.faintForeground : theme.mutedForeground} />
        </Pressable>
      </View>

      {nothing ? (
        <Card className="mb-3">
          <View className="items-center py-4">
            <Ionicons name="document-text-outline" size={28} color={theme.mutedForeground} />
            <Text className="text-sm font-semibold text-foreground mt-2">No records for this year</Text>
            <Text className="text-xs text-muted-foreground text-center mt-1">
              Upload your broker's past reports to see gains and money moved, period by period.
            </Text>
          </View>
        </Card>
      ) : (
        <>
          {source !== "none" && (
            <Card className="mb-3">
              <View className="flex-row items-center justify-between mb-1">
                <SectionLabel>Gains</SectionLabel>
                <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: theme.alpha(source === "report" ? "primary" : "warning", 0.14) }}>
                  <Text className="text-label font-medium" style={{ color: source === "report" ? theme.primary : theme.warning }}>
                    {source === "report" ? "From broker report" : "Calculated"}
                  </Text>
                </View>
              </View>
              {totals.shortTerm !== 0 && <Line label="Short-term" value={signed(totals.shortTerm)} color={color(totals.shortTerm)} />}
              {totals.longTerm !== 0 && <Line label="Long-term" value={signed(totals.longTerm)} color={color(totals.longTerm)} />}
              {totals.crypto !== 0 && <Line label="Crypto" value={signed(totals.crypto)} color={color(totals.crypto)} />}
              {totals.otherIncome !== 0 && <Line label="Intraday and F&O" value={signed(totals.otherIncome)} color={color(totals.otherIncome)} />}

              <View className="border-t border-border mt-1 pt-1">
                {QUARTERS.filter(({ q }) => history.sales.some((s) => {
                  const m = Number(s.sellDate.slice(5, 7));
                  return (m <= 3 ? 4 : m <= 6 ? 1 : m <= 9 ? 2 : 3) === q;
                })).map(({ q, label }) => (
                  <Pressable key={q} onPress={() => openSales({ quarter: String(q) })} className="flex-row items-center py-1.5" accessibilityRole="link">
                    <Text className="text-sm text-muted-foreground flex-1">{label}</Text>
                    <Text className="text-sm font-semibold mr-1" style={{ color: color(history.byQuarter[q]) ?? theme.foreground }}>
                      {signed(history.byQuarter[q])}
                    </Text>
                    <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />
                  </Pressable>
                ))}
              </View>

              {history.needsCheck > 0 && (
                <Pressable onPress={() => openSales({ check: "1" })} className="flex-row items-center mt-1" accessibilityRole="link">
                  <Text className="text-xs flex-1" style={{ color: theme.warning }}>
                    {history.needsCheck} {history.needsCheck === 1 ? "sale needs" : "sales need"} your check
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color={theme.warning} />
                </Pressable>
              )}
              {history.unmatched.length > 0 && (
                <Text className="text-xs mt-1" style={{ color: theme.warning }}>
                  {history.unmatched.length} {history.unmatched.length === 1 ? "sale has" : "sales have"} no buy on record, so {history.unmatched.length === 1 ? "isn't" : "aren't"} counted. Upload the Tax P&L to include {history.unmatched.length === 1 ? "it" : "them"}.
                </Text>
              )}
              <Text className="text-xs text-muted-foreground mt-2">
                {[
                  history.gainsBasis,
                  history.chargesTotal ? `Charges ${formatAmount(history.chargesTotal)}.` : null,
                  history.coveredUntil && source === "calculated" ? `Report covers up to ${formatDisplayDate(history.coveredUntil)}, the rest is calculated.` : null,
                ].filter(Boolean).join(" ")}
              </Text>
            </Card>
          )}

          {money.hasRecords && (
            <Card className="mb-3">
              <SectionLabel>Money in and out</SectionLabel>
              <View className="mt-1">
                <Line label="Added" value={signed(money.added)} color={money.added > 0 ? theme.success : undefined} />
                <Line label="Withdrawn" value={signed(-money.withdrawn)} color={money.withdrawn > 0 ? theme.danger : undefined} />
              </View>
              {QUARTERS.filter(({ q }) => money.byQuarter[q].added > 0 || money.byQuarter[q].withdrawn > 0).map(({ q, label }) => (
                <View key={q} className="flex-row justify-between pt-1">
                  <Text className="text-xs text-muted-foreground">{label}</Text>
                  <Text className="text-xs text-muted-foreground">
                    {signed(money.byQuarter[q].added)} / {signed(-money.byQuarter[q].withdrawn)}
                  </Text>
                </View>
              ))}
              <Text className="text-xs text-muted-foreground mt-2">
                {money.fromStatement ? "From your broker's statement, and transfers Arth detected for any period it doesn't cover." : "From the transfers Arth detected for this account."}
              </Text>
              {money.unmatched > 0 && (
                <Text className="text-xs mt-2" style={{ color: theme.warning }}>
                  {money.unmatched} {money.unmatched === 1 ? "entry doesn't" : "entries don't"} match your transfers in Arth.
                </Text>
              )}
            </Card>
          )}

          {history.mutualFunds.bought + history.mutualFunds.sold > 0 && (
            <Card className="mb-3">
              <SectionLabel>Mutual funds</SectionLabel>
              <View className="mt-1">
                <Line label="Bought" value={formatAmount(history.mutualFunds.bought)} />
                {history.mutualFunds.sold > 0 && <Line label="Sold" value={formatAmount(history.mutualFunds.sold)} />}
              </View>
              <Text className="text-xs text-muted-foreground mt-1">Paid from your bank, so not in the money added above.</Text>
            </Card>
          )}
        </>
      )}

      <Button title="Upload historic records" variant="outline" onPress={openImport} />
      <Text className="text-xs text-faint-foreground text-center mt-2">
        What Arth saved and detected stays. A report overwrites it only for the period it covers.
      </Text>
    </View>
  );
}
