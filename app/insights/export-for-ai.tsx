import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, ScrollView, Switch, View } from "react-native";

import Ionicons from "@expo/vector-icons/Ionicons";
import * as Sharing from "expo-sharing";

import { Button, Card, DateInput, FilterChip, ScreenContainer, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";
import {
  buildAiExport,
  DEFAULT_AI_EXPORT_SECTIONS,
  resolveAiExportPeriod,
  type AiExportPeriodPreset,
  type AiExportSections,
} from "@/services/ai-export";
import {
  AI_EXPORT_MIME_TYPE,
  deleteAiExportFile,
  writeAiExportFile,
  type AiExportFile,
} from "@/services/ai-export-file";
import { saveToPhone } from "@/services/save-to-phone";
import { toIsoDate } from "@/utils/date";

type Period = AiExportPeriodPreset | "custom";

const PERIODS: { id: Period; label: string }[] = [
  { id: "this_fy", label: "This FY" },
  { id: "last_fy", label: "Last FY" },
  { id: "last_12_months", label: "Last 12 months" },
  { id: "all_time", label: "All time" },
  { id: "custom", label: "Custom" },
];

const SECTIONS: { id: keyof AiExportSections; label: string; hint?: string }[] = [
  { id: "summary", label: "Monthly summary", hint: "Spending, income and savings rate" },
  { id: "transactions", label: "Transactions", hint: "Approved entries only" },
  { id: "accounts", label: "Accounts and balances", hint: "Last 4 digits only" },
  { id: "budgets", label: "Budgets" },
  { id: "loans", label: "Loans" },
  { id: "investments", label: "Investments and goals" },
  { id: "netWorth", label: "Net worth" },
  { id: "notes", label: "Transaction notes", hint: "Free text you typed" },
  { id: "hisaab", label: "Hisaab", hint: "Names other people" },
];

const NEVER_INCLUDED = [
  "Password vault",
  "SMS text and scan logs",
  "Broker and login credentials",
  "Full account numbers",
  "Deleted and unreviewed items",
];

interface Ready {
  file: AiExportFile;
  transactions: number;
  accounts: number;
  skipped: string[];
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function ExportForAiScreen() {
  const theme = useTheme();

  const [period, setPeriod] = useState<Period>("this_fy");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState(toIsoDate(new Date()));
  const [sections, setSections] = useState<AiExportSections>(DEFAULT_AI_EXPORT_SECTIONS);
  const [hidePeopleNames, setHidePeopleNames] = useState(true);
  const [hideMerchantNames, setHideMerchantNames] = useState(false);

  const [building, setBuilding] = useState(false);
  const [ready, setReady] = useState<Ready | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // The file is only as current as the options it was made with: any change throws it away.
  const filePathRef = useRef<string | null>(null);
  const discardFile = useCallback(() => {
    if (filePathRef.current) deleteAiExportFile(filePathRef.current);
    filePathRef.current = null;
    setReady(null);
    setMessage(null);
  }, []);
  useEffect(() => discardFile, [discardFile]);

  const anySection = SECTIONS.some((s) => s.id !== "notes" && sections[s.id]);

  const handleCreate = useCallback(async () => {
    discardFile();
    if (period === "custom" && (!customFrom || !customTo)) {
      setMessage("Pick a start and end date.");
      return;
    }
    if (period === "custom" && customFrom > customTo) {
      setMessage("The start date is after the end date.");
      return;
    }
    setBuilding(true);
    try {
      const range =
        period === "custom"
          ? { from: customFrom, to: customTo }
          : await resolveAiExportPeriod(period, DEFAULT_USER_ID);
      const result = await buildAiExport(DEFAULT_USER_ID, {
        ...range,
        sections,
        hidePeopleNames,
        hideMerchantNames,
      });
      const file = writeAiExportFile(result.data, toIsoDate(new Date()));
      filePathRef.current = file.filePath;
      setReady({
        file,
        transactions: result.counts.transactions,
        accounts: result.counts.accounts,
        skipped: result.skipped,
      });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Couldn't create the file. Try again.");
    }
    setBuilding(false);
  }, [discardFile, period, customFrom, customTo, sections, hidePeopleNames, hideMerchantNames]);

  const handleSave = useCallback(async () => {
    if (!ready) return;
    const result = await saveToPhone({
      sourcePath: ready.file.filePath,
      encoding: "utf8",
      mimeType: AI_EXPORT_MIME_TYPE,
      fileName: ready.file.fileName,
    });
    if (result.cancelled) return;
    setMessage(result.ok ? "Saved to the folder you chose." : `Couldn't save. ${result.error ?? "Try again."}`);
  }, [ready]);

  const handleShare = useCallback(async () => {
    if (!ready) return;
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(ready.file.filePath, {
        mimeType: AI_EXPORT_MIME_TYPE,
        dialogTitle: "Share for AI insights",
      });
    }
  }, [ready]);

  const renderSwitch = (value: boolean, onChange: (v: boolean) => void, label: string) => (
    <Switch
      value={value}
      onValueChange={(v) => {
        discardFile();
        onChange(v);
      }}
      trackColor={{ false: theme.border, true: theme.primary }}
      thumbColor="#FFFFFF"
      accessibilityLabel={label}
    />
  );

  const renderRow = (
    key: string,
    label: string,
    hint: string | undefined,
    right: React.ReactNode,
    last: boolean,
  ) => (
    <View
      key={key}
      className={`flex-row items-center justify-between py-2.5 ${last ? "" : "border-b border-border"}`}
    >
      <View className="flex-1 mr-3">
        <Text className="text-sm text-foreground">{label}</Text>
        {hint && <Text className="text-xs text-muted-foreground mt-0.5">{hint}</Text>}
      </View>
      {right}
    </View>
  );

  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <View className="px-4 pt-2">
          <Text className="text-xs text-muted-foreground leading-5">
            A clean copy of your finances that an AI assistant like Claude can read. You choose what goes in, then
            upload the file to the assistant and ask your questions.
          </Text>

          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-5 mb-2">
            Period
          </Text>
          <View className="flex-row flex-wrap gap-y-2">
            {PERIODS.map((p) => (
              <FilterChip
                key={p.id}
                label={p.label}
                active={period === p.id}
                onPress={() => {
                  discardFile();
                  setPeriod(p.id);
                }}
              />
            ))}
          </View>
          {period === "custom" && (
            <View className="flex-row gap-3 mt-3">
              <DateInput
                label="From"
                value={customFrom}
                onChange={(d) => {
                  discardFile();
                  setCustomFrom(d);
                }}
                containerClassName="flex-1"
              />
              <DateInput
                label="To"
                value={customTo}
                onChange={(d) => {
                  discardFile();
                  setCustomTo(d);
                }}
                containerClassName="flex-1"
              />
            </View>
          )}

          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-5 mb-2">
            Include
          </Text>
          <Card>
            {SECTIONS.map((s, i) =>
              renderRow(
                s.id,
                s.label,
                s.hint,
                renderSwitch(sections[s.id], (v) => setSections((prev) => ({ ...prev, [s.id]: v })), s.label),
                i === SECTIONS.length - 1,
              ),
            )}
          </Card>

          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-5 mb-2">
            Privacy
          </Text>
          <Card>
            {renderRow(
              "people",
              "Hide people's names",
              "Hisaab names become Person 1, Person 2",
              renderSwitch(hidePeopleNames, setHidePeopleNames, "Hide people's names"),
              false,
            )}
            {renderRow(
              "merchants",
              "Hide merchant names",
              "Keeps the category only",
              renderSwitch(hideMerchantNames, setHideMerchantNames, "Hide merchant names"),
              true,
            )}
          </Card>

          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-5 mb-2">
            Never included
          </Text>
          <Card>
            {NEVER_INCLUDED.map((item, i) =>
              renderRow(
                item,
                item,
                undefined,
                <Ionicons name="lock-closed" size={16} color={theme.success} />,
                i === NEVER_INCLUDED.length - 1,
              ),
            )}
          </Card>

          <View className="mt-5 p-3 rounded-lg bg-warning/8 flex-row gap-2">
            <Ionicons name="warning-outline" size={16} color={theme.warning} />
            <Text className="flex-1 text-xs text-muted-foreground leading-5">
              {"Once you share this file with an AI service, it is sent to that company's servers. Arth can't control it after that."}
            </Text>
          </View>

          {message && <Text className="text-xs text-muted-foreground text-center mt-4">{message}</Text>}

          {ready ? (
            <View className="mt-4">
              <Text className="text-xs text-muted-foreground text-center mb-1">
                {ready.transactions.toLocaleString("en-IN")} transactions · {ready.accounts} accounts ·{" "}
                {formatSize(ready.file.sizeBytes)}
              </Text>
              {ready.skipped.length > 0 && (
                <Text className="text-xs text-center mb-1" style={{ color: theme.warning }}>
                  {`Left out because they couldn't be read: ${ready.skipped.join(", ")}`}
                </Text>
              )}
              {Platform.OS === "android" && <Button title="Save to phone" onPress={handleSave} className="mt-2" />}
              <Button
                title="Share"
                onPress={handleShare}
                variant={Platform.OS === "android" ? "outline" : "primary"}
                className="mt-2"
              />
            </View>
          ) : (
            <Button
              title="Create file"
              onPress={handleCreate}
              loading={building}
              disabled={!anySection}
              className="mt-4"
            />
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
