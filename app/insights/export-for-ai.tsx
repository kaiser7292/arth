import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, ScrollView, Switch, View } from "react-native";

import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";

import { Button, Card, DateInput, FilterChip, ScreenContainer, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";
import {
  DEFAULT_AI_EXPORT_SECTIONS,
  resolveAiExportPeriod,
  type AiExportOptions,
  type AiExportPeriodPreset,
  type AiExportSections,
} from "@/services/ai-export";
import { AI_EXPORT_MIME_TYPE, deleteAiExportFile } from "@/services/ai-export-file";
import { AI_REQUESTS, type AiRequestId } from "@/services/ai-reply-format";
import { createAiFile, shareAiFile, type AiShareResult } from "@/services/ai-share";
import { saveToPhone } from "@/services/save-to-phone";
import { toIsoDate } from "@/utils/date";

type Period = AiExportPeriodPreset | "custom";
/** "answer" = a plain export: the assistant answers questions and suggests nothing back. */
type Ask = AiRequestId | "answer";

const PERIODS: { id: Period; label: string }[] = [
  { id: "this_fy", label: "This FY" },
  { id: "last_fy", label: "Last FY" },
  { id: "last_12_months", label: "Last 12 months" },
  { id: "all_time", label: "All time" },
  { id: "custom", label: "Custom" },
];

const ASKS: { id: Ask; label: string }[] = [
  { id: "answer", label: "Just answer my questions" },
  ...AI_REQUESTS.filter((r) => r.id !== "setup").map((r) => ({ id: r.id as Ask, label: r.label })),
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

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function ExportForAiScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [ask, setAsk] = useState<Ask>("answer");
  const [unreadMessages, setUnreadMessages] = useState(false);
  const [period, setPeriod] = useState<Period>("this_fy");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState(toIsoDate(new Date()));
  const [sections, setSections] = useState<AiExportSections>(DEFAULT_AI_EXPORT_SECTIONS);
  const [hidePeopleNames, setHidePeopleNames] = useState(true);
  const [hideMerchantNames, setHideMerchantNames] = useState(false);

  const [working, setWorking] = useState(false);
  const [ready, setReady] = useState<{ result: AiShareResult; options: AiExportOptions } | null>(null);
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

  const suggesting = ask !== "answer";
  const anySection = SECTIONS.some((s) => s.id !== "notes" && sections[s.id]);

  /** Build the file for the options on screen (or reuse the one already made). */
  const prepare = useCallback(async () => {
    if (ready) return ready;
    if (period === "custom" && (!customFrom || !customTo)) throw new Error("Pick a start and end date.");
    if (period === "custom" && customFrom > customTo) throw new Error("The start date is after the end date.");
    const range =
      period === "custom" ? { from: customFrom, to: customTo } : await resolveAiExportPeriod(period, DEFAULT_USER_ID);
    const options: AiExportOptions = {
      ...range,
      // Suggestions are about transactions and merchants, so those always go along.
      sections: suggesting ? { ...sections, transactions: true } : sections,
      hidePeopleNames,
      hideMerchantNames: suggesting ? false : hideMerchantNames,
      suggest: suggesting ? { request: ask as AiRequestId, includeUnreadMessages: unreadMessages } : undefined,
    };
    const result = await createAiFile(DEFAULT_USER_ID, options);
    filePathRef.current = result.file.filePath;
    const made = { result, options };
    setReady(made);
    return made;
  }, [ready, period, customFrom, customTo, sections, hidePeopleNames, hideMerchantNames, suggesting, ask, unreadMessages]);

  const run = useCallback(
    async (action: (made: { result: AiShareResult; options: AiExportOptions }) => Promise<string | null>) => {
      setWorking(true);
      setMessage(null);
      try {
        setMessage(await action(await prepare()));
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Couldn't create the file. Try again.");
      }
      setWorking(false);
    },
    [prepare],
  );

  const handleShare = () =>
    run(async ({ result, options }) => {
      await shareAiFile(result.file, options);
      return options.suggest
        ? "Send it in your assistant. If its message box is empty, long-press and paste: your request is already copied."
        : null;
    });

  const handleSave = () =>
    run(async ({ result }) => {
      const saved = await saveToPhone({
        sourcePath: result.file.filePath,
        encoding: "utf8",
        mimeType: AI_EXPORT_MIME_TYPE,
        fileName: result.file.fileName,
      });
      if (saved.cancelled) return null;
      return saved.ok ? "Saved to the folder you chose." : `Couldn't save. ${saved.error ?? "Try again."}`;
    });

  const changing = <T,>(setter: (value: T) => void) => (value: T) => {
    discardFile();
    setter(value);
  };

  const renderSwitch = (value: boolean, onChange: (v: boolean) => void, label: string) => (
    <Switch
      value={value}
      onValueChange={changing(onChange)}
      trackColor={{ false: theme.border, true: theme.primary }}
      thumbColor="#FFFFFF"
      accessibilityLabel={label}
    />
  );

  const renderRow = (key: string, label: string, hint: string | undefined, right: React.ReactNode, last: boolean) => (
    <View key={key} className={`flex-row items-center justify-between py-2.5 ${last ? "" : "border-b border-border"}`}>
      <View className="flex-1 mr-3">
        <Text className="text-sm text-foreground">{label}</Text>
        {hint && <Text className="text-xs text-muted-foreground mt-0.5">{hint}</Text>}
      </View>
      {right}
    </View>
  );

  const sectionLabel = "text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-5 mb-2";

  return (
    <ScreenContainer padTop={false}>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="px-4 pt-2">
          <Text className="text-xs text-muted-foreground leading-5">
            A clean copy of your finances for an AI assistant like Claude. Ask it questions, or let it suggest changes
            that you approve back here.
          </Text>

          <Text className={sectionLabel}>What do you want from the AI?</Text>
          <View className="flex-row flex-wrap gap-y-2">
            {ASKS.map((a) => (
              <FilterChip
                key={a.id}
                label={a.label}
                active={ask === a.id}
                onPress={() => {
                  discardFile();
                  setAsk(a.id);
                  if (a.id === "messages") setUnreadMessages(true);
                }}
              />
            ))}
          </View>
          {suggesting && (
            <Card className="mt-3">
              {renderRow(
                "unread",
                "Include unread bank messages",
                "As received, so it can work out how to read them",
                renderSwitch(unreadMessages, setUnreadMessages, "Include unread bank messages"),
                true,
              )}
            </Card>
          )}

          <Text className={sectionLabel}>Period</Text>
          <View className="flex-row flex-wrap gap-y-2">
            {PERIODS.map((p) => (
              <FilterChip key={p.id} label={p.label} active={period === p.id} onPress={() => changing(setPeriod)(p.id)} />
            ))}
          </View>
          {period === "custom" && (
            <View className="flex-row gap-3 mt-3">
              <DateInput label="From" value={customFrom} onChange={changing(setCustomFrom)} containerClassName="flex-1" />
              <DateInput label="To" value={customTo} onChange={changing(setCustomTo)} containerClassName="flex-1" />
            </View>
          )}

          <Text className={sectionLabel}>Include</Text>
          <Card>
            {SECTIONS.map((s, i) =>
              renderRow(
                s.id,
                s.label,
                s.hint,
                renderSwitch(
                  sections[s.id] || (suggesting && s.id === "transactions"),
                  (v) => setSections((prev) => ({ ...prev, [s.id]: v })),
                  s.label,
                ),
                i === SECTIONS.length - 1,
              ),
            )}
          </Card>

          <Text className={sectionLabel}>Privacy</Text>
          <Card>
            {renderRow(
              "people",
              "Hide people's names",
              "Hisaab names become Person 1, Person 2",
              renderSwitch(hidePeopleNames, setHidePeopleNames, "Hide people's names"),
              suggesting,
            )}
            {!suggesting &&
              renderRow(
                "merchants",
                "Hide merchant names",
                "Keeps the category only",
                renderSwitch(hideMerchantNames, setHideMerchantNames, "Hide merchant names"),
                true,
              )}
          </Card>

          <View className="flex-row items-start gap-2 mt-4">
            <Ionicons name="lock-closed" size={14} color={theme.success} style={{ marginTop: 2 }} />
            <Text className="flex-1 text-xs text-muted-foreground leading-5">
              Never included: your password vault, broker and login credentials, full account numbers, deleted items.
            </Text>
          </View>
          <View className="flex-row items-start gap-2 mt-2">
            <Ionicons name="warning-outline" size={14} color={theme.warning} style={{ marginTop: 2 }} />
            <Text className="flex-1 text-xs text-muted-foreground leading-5">
              {"What you share is sent to that AI company's servers. Arth can't control it after that."}
            </Text>
          </View>

          <Button
            title="Share with AI"
            onPress={handleShare}
            loading={working}
            disabled={!anySection && !suggesting}
            className="mt-5"
          />
          {ready && (
            <Text className="text-xs text-muted-foreground text-center mt-2">
              {ready.result.counts.transactions.toLocaleString("en-IN")} transactions · {ready.result.counts.accounts}{" "}
              accounts
              {ready.result.counts.unreadMessages > 0 ? ` · ${ready.result.counts.unreadMessages} bank messages` : ""} ·{" "}
              {formatSize(ready.result.file.sizeBytes)}
            </Text>
          )}
          {ready && ready.result.skipped.length > 0 && (
            <Text className="text-xs text-center mt-1" style={{ color: theme.warning }}>
              {`Left out because they couldn't be read: ${ready.result.skipped.join(", ")}`}
            </Text>
          )}
          {message && <Text className="text-xs text-muted-foreground text-center mt-2">{message}</Text>}
          {Platform.OS === "android" && (
            <Button title="Save to phone instead" variant="ghost" onPress={handleSave} disabled={working} className="mt-1" />
          )}

          <Text className={sectionLabel}>Got a reply with suggestions?</Text>
          <Button
            title="Paste AI reply"
            variant="outline"
            onPress={() => router.push("/insights/ai-suggestions?paste=1")}
          />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
