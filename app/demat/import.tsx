import Ionicons from "@expo/vector-icons/Ionicons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";

import { Button, Card, ScreenContainer, SelectSheet, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { linkedAccountFor } from "@/services/broker-history/capture";
import { findTable, guessColumns, parseBrokerFile, parseGenericTrades, type GenericColumns } from "@/services/broker-history/parse";
import { LockedFileError, pickReportFile } from "@/services/broker-history/read-file";
import { saveReport } from "@/services/broker-history/store";
import { HISTORY_BROKER_NAMES, type ApiBroker, type ParsedReport, type Workbook } from "@/services/broker-history/types";
import { formatDisplayDate } from "@/utils/date";
import { formatAmount } from "@/utils/format";

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatAmount(Math.abs(n))}`;
const sumOf = (r: ParsedReport, category: string) => r.gains.filter((g) => g.category === category).reduce((s, g) => s + g.taxable, 0);
const FIELDS: { key: keyof GenericColumns; label: string }[] = [
  { key: "symbol", label: "Stock name" },
  { key: "side", label: "Buy or sell" },
  { key: "quantity", label: "Quantity" },
  { key: "price", label: "Price" },
  { key: "date", label: "Trade date" },
];

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View className="flex-row justify-between py-1 border-t border-border">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="text-sm font-semibold text-foreground" style={color ? { color } : undefined}>{value}</Text>
    </View>
  );
}

/** Pick a past broker report, see what's in it, then upload. It's read on this phone only, and overwrites only its own period. */
export default function ImportBrokerReportScreen() {
  const { accountId } = useLocalSearchParams<{ accountId: string }>();
  const router = useRouter();
  const theme = useTheme();

  const [fileName, setFileName] = useState("");
  const [report, setReport] = useState<ParsedReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // A file Arth doesn't know: the user says which column is which.
  const [unknown, setUnknown] = useState<{ workbook: Workbook; sheet: string; headerRow: number; columns: string[] } | null>(null);
  const [mapping, setMapping] = useState<Partial<GenericColumns>>({});
  const [picking, setPicking] = useState<keyof GenericColumns | null>(null);
  const [skipped, setSkipped] = useState(0);

  const pick = async () => {
    setMessage(null);
    setReport(null);
    setUnknown(null);
    setSkipped(0);
    try {
      const file = await pickReportFile();
      if (!file) return;
      setFileName(file.name);
      const outcome = parseBrokerFile(file.workbook, file.name);
      if (outcome.status === "ok") {
        const r = outcome.report;
        if (r.gains.length + r.trades.length + r.moves.length === 0 && r.kind !== "ledger") {
          setMessage("This report has no entries for its period.");
          return;
        }
        setReport(r);
      } else if (outcome.status === "not_needed") {
        setMessage(outcome.message);
      } else {
        const table = findTable(file.workbook);
        if (!table) {
          setMessage("This doesn't look like a broker report.");
          return;
        }
        setUnknown({ workbook: file.workbook, ...table });
        setMapping(guessColumns(table.columns));
      }
    } catch (e) {
      setMessage(e instanceof LockedFileError ? "This file is locked with a password. Download it again without one, or save an unlocked copy." : e instanceof Error ? e.message : "Couldn't read that file.");
    }
  };

  const useMapping = () => {
    if (!unknown || FIELDS.some((f) => mapping[f.key] === undefined)) return;
    const { report: r, skipped: left } = parseGenericTrades(unknown.workbook[unknown.sheet], unknown.headerRow, mapping as GenericColumns);
    setSkipped(left);
    if (!r || r.trades.length === 0) {
      setMessage("No trades could be read with those columns. Check the matches and try again.");
      return;
    }
    setMessage(null);
    setReport(r);
    setUnknown(null);
  };

  const otherBroker = useMemo(() => {
    if (!report) return null;
    for (const b of ["kite", "angel", "zebpay"] as ApiBroker[]) {
      if (b !== report.broker && linkedAccountFor(b) === accountId) return HISTORY_BROKER_NAMES[b];
    }
    return null;
  }, [report, accountId]);

  const confirm = async () => {
    if (!report || !accountId) return;
    setSaving(true);
    try {
      await saveReport(accountId, report, fileName, { allowOther: report.broker === "other" });
      const toCheck = report.gains.some((g) => g.checkReason);
      if (toCheck) {
        const year = Number(report.periodTo.slice(0, 4));
        const fy = Number(report.periodTo.slice(5, 7)) >= 4 ? year : year - 1;
        router.replace({ pathname: "/demat/gains", params: { accountId, fy: String(fy), check: "1" } });
      } else {
        router.back();
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Couldn't upload that report.");
      setSaving(false);
    }
  };

  const flagged = report?.gains.filter((g) => g.checkReason) ?? [];
  const added = report?.moves.filter((m) => m.direction === "in").reduce((s, m) => s + m.amount, 0) ?? 0;
  const withdrawn = report?.moves.filter((m) => m.direction === "out").reduce((s, m) => s + m.amount, 0) ?? 0;
  const color = (n: number) => (n > 0 ? theme.success : n < 0 ? theme.danger : undefined);

  return (
    <ScreenContainer padTop={false}>
      <Stack.Screen options={{ title: "Upload historic records" }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {!report && !unknown && (
          <>
            <Card className="mb-3">
              <Text className="text-sm font-semibold text-foreground">Reports Arth can read</Text>
              <Text className="text-xs font-semibold text-foreground mt-3">Zerodha, from Console</Text>
              <Text className="text-xs text-muted-foreground mt-0.5">Reports: Tax P&L, Tradebook (equity and mutual funds). Funds: Statement.</Text>
              <Text className="text-xs font-semibold text-foreground mt-3">Angel One</Text>
              <Text className="text-xs text-muted-foreground mt-0.5">Tax P&L, Trades and charges, Ledger.</Text>
              <Text className="text-xs font-semibold text-foreground mt-3">Groww</Text>
              <Text className="text-xs text-muted-foreground mt-0.5">Stocks P&L, F&O P&L, Stocks order history, Balance statement.</Text>
              <Text className="text-xs text-muted-foreground mt-3">
                The Tax P&L gives the gains. The tradebook and ledger add your trades and money in and out. Another broker's tradebook works too: you just match its columns.
              </Text>
            </Card>
            <Button title="Choose a file" onPress={() => void pick()} />
            <View className="flex-row items-center justify-center mt-3">
              <Ionicons name="lock-closed-outline" size={12} color={theme.faintForeground} />
              <Text className="text-xs text-faint-foreground ml-1">Read on this phone. Nothing is uploaded.</Text>
            </View>
          </>
        )}

        {message && (
          <Card className="mt-3" >
            <Text className="text-sm text-foreground">{message}</Text>
          </Card>
        )}

        {unknown && (
          <>
            <Card className="mb-3">
              <Text className="text-sm font-semibold text-foreground">Match the columns</Text>
              <Text className="text-xs text-muted-foreground mt-1 mb-2">
                Arth doesn't know this file, so tell it which column is which. Trades from it are used to work out gains, labelled as calculated.
              </Text>
              {FIELDS.map((f) => (
                <View key={f.key} className="flex-row items-center justify-between py-1.5 border-t border-border">
                  <Text className="text-sm text-muted-foreground">{f.label}</Text>
                  <Button
                    title={mapping[f.key] !== undefined ? unknown.columns[mapping[f.key] as number] || `Column ${(mapping[f.key] as number) + 1}` : "Choose"}
                    variant="ghost"
                    onPress={() => setPicking(f.key)}
                  />
                </View>
              ))}
            </Card>
            <Button title="Continue" onPress={useMapping} disabled={FIELDS.some((f) => mapping[f.key] === undefined)} />
            <Button title="Choose another file" variant="ghost" onPress={() => void pick()} className="mt-1" />
            <SelectSheet
              visible={picking !== null}
              title="Which column?"
              options={unknown.columns.map((c, i) => ({ value: String(i), label: c || `Column ${i + 1}` }))}
              value={picking && mapping[picking] !== undefined ? String(mapping[picking]) : ""}
              onChange={(v) => picking && setMapping((m) => ({ ...m, [picking]: Number(v) }))}
              onClose={() => setPicking(null)}
            />
          </>
        )}

        {report && (
          <>
            <Card className="mb-3">
              <Text className="text-base font-semibold text-foreground">{report.label}</Text>
              <Text className="text-xs text-muted-foreground mt-0.5 mb-2">
                {formatDisplayDate(report.periodFrom)} to {formatDisplayDate(report.periodTo)}
              </Text>
              {report.kind === "gains" && (
                <>
                  <Row label="Sales" value={String(report.gains.length)} />
                  {sumOf(report, "short_term") !== 0 && <Row label="Short-term" value={signed(sumOf(report, "short_term"))} color={color(sumOf(report, "short_term"))} />}
                  {sumOf(report, "long_term") !== 0 && <Row label="Long-term" value={signed(sumOf(report, "long_term"))} color={color(sumOf(report, "long_term"))} />}
                  {sumOf(report, "intraday") !== 0 && <Row label="Intraday" value={signed(sumOf(report, "intraday"))} color={color(sumOf(report, "intraday"))} />}
                  {sumOf(report, "fno") !== 0 && <Row label="F&O" value={signed(sumOf(report, "fno"))} color={color(sumOf(report, "fno"))} />}
                  {report.chargesTotal != null && report.chargesTotal > 0 && <Row label="Charges" value={formatAmount(report.chargesTotal)} />}
                  {report.gainsBasis && <Text className="text-xs text-muted-foreground mt-2">{report.gainsBasis}</Text>}
                </>
              )}
              {report.kind === "tradebook" && <Row label="Trades" value={String(report.trades.length)} />}
              {report.kind === "ledger" && (
                <>
                  <Row label="Added" value={signed(added)} color={added > 0 ? theme.success : undefined} />
                  <Row label="Withdrawn" value={signed(-withdrawn)} color={withdrawn > 0 ? theme.danger : undefined} />
                </>
              )}
              {skipped > 0 && <Text className="text-xs mt-2" style={{ color: theme.warning }}>{skipped} rows couldn't be read and were left out.</Text>}
              {report.warnings.map((w) => (
                <Text key={w} className="text-xs text-muted-foreground mt-2">{w}</Text>
              ))}
            </Card>

            {otherBroker && (
              <Card className="mb-3">
                <Text className="text-sm" style={{ color: theme.warning }}>
                  This account is linked to {otherBroker}, but this is a {HISTORY_BROKER_NAMES[report.broker]} file. Check you're on the right account.
                </Text>
              </Card>
            )}

            {flagged.length > 0 && (
              <Card className="mb-3">
                <Text className="text-sm font-semibold" style={{ color: theme.warning }}>
                  {flagged.length} {flagged.length === 1 ? "sale needs" : "sales need"} your check
                </Text>
                <Text className="text-xs text-muted-foreground mt-1">You can correct {flagged.length === 1 ? "it" : "them"} right after importing.</Text>
                {flagged.slice(0, 5).map((g, i) => (
                  <View key={`${g.symbol}-${i}`} className="py-1.5 border-t border-border mt-1">
                    <Text className="text-sm text-foreground" numberOfLines={1}>{g.symbol}</Text>
                    <Text className="text-xs text-muted-foreground">{g.checkReason}</Text>
                  </View>
                ))}
                {flagged.length > 5 && <Text className="text-xs text-muted-foreground mt-1">and {flagged.length - 5} more</Text>}
              </Card>
            )}

            <Text className="text-xs text-muted-foreground mb-3">
              {report.kind === "gains"
                ? "This overwrites the figures for this period. Everything else stays."
                : report.kind === "ledger"
                  ? "This overwrites money in and out for this period. Everything else stays."
                  : "This overwrites saved trades for this period. Everything else stays."}
            </Text>
            <Button title="Upload" onPress={() => void confirm()} loading={saving} />
            <Button title="Choose another file" variant="ghost" onPress={() => void pick()} className="mt-1" />
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
