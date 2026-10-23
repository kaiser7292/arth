import { useCallback, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Switch, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, DateInput, LearnMoreChip, ScreenContainer, SelectSheet, Sheet, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useAlert } from "@/hooks/use-alert";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";
import { invalidateDuplicateScanCache, scanAllDuplicates, scanAllDuplicatesCached } from "@/services/duplicate-detection";
import { getActiveAccounts, type FinancialAccount } from "@/services/financial-account";
import { addSelfName, getSelfNames, removeSelfName } from "@/services/self-names";
import {
  disableSmsDetection,
  getSmsEndDate,
  getSmsScanAccountIds,
  getSmsStartDate,
  isSmsDetectionEnabled,
  runSmsScan,
  setSmsEndDate,
  setSmsScanAccountIds as saveSmsScanAccountIds,
  setSmsScanPresetDays,
  setSmsStartDate,
} from "@/services/sms";
import { getScanRuns, type ScanRunRow } from "@/services/sms/sms-scan-logging";
import { countUnrecognisedSms } from "@/services/sms/user-sms-templates";
import { formatDisplayDate } from "@/utils/date";

const PRESETS = [
  { value: "7", label: "Last 7 days", days: 7 },
  { value: "30", label: "Last 30 days", days: 30 },
  { value: "90", label: "Last 90 days", days: 90 },
  { value: "180", label: "Last 6 months", days: 180 },
  { value: "365", label: "Last year", days: 365 },
  { value: "custom", label: "Custom dates…", days: -1 },
] as const;

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso.replace(" ", "T") + (iso.includes("Z") ? "" : "Z")).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/**
 * Everything about reading transaction messages in one place: on/off, what to scan (dates and
 * accounts), scanning, what needs a hand (unread messages, possible duplicates), how Arth reads
 * them (message templates, your name), and the history of every scan.
 *
 * Replaces the SMS Detection and Duplicate Detection sections on the Settings tab, and the
 * separate "Your Name in Bank SMS" screen (now chips here). Duplicate checking always runs after a scan.
 */
export default function TransactionMessagesScreen() {
  const router = useRouter();
  const alert = useAlert();
  const theme = useTheme();
  const { colors } = useColorScheme();
  const isAndroid = Platform.OS === "android";

  const [enabled, setEnabled] = useState(() => isSmsDetectionEnabled());
  const [from, setFrom] = useState(() => getSmsStartDate());
  const [to, setTo] = useState(() => getSmsEndDate());
  const [accountIds, setAccountIds] = useState<string[]>(() => getSmsScanAccountIds());
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [lastRun, setLastRun] = useState<ScanRunRow | null>(null);
  const [unread, setUnread] = useState(0);
  const [dupGroups, setDupGroups] = useState(0);
  const [names, setNames] = useState<string[]>(() => getSelfNames());
  const [newName, setNewName] = useState("");
  const [addingName, setAddingName] = useState(false);

  const [rangeSheet, setRangeSheet] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);
  const [accountSheet, setAccountSheet] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [scanCreated, setScanCreated] = useState(0);
  const [dupChecking, setDupChecking] = useState(false);
  const [dupResult, setDupResult] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setEnabled(isSmsDetectionEnabled());
    setFrom(getSmsStartDate());
    setTo(getSmsEndDate());
    setAccountIds(getSmsScanAccountIds());
    setNames(getSelfNames());
    getActiveAccounts(DEFAULT_USER_ID).then(setAccounts).catch(() => {});
    getScanRuns(DEFAULT_USER_ID, 1).then((r) => setLastRun(r[0] ?? null)).catch(() => {});
    countUnrecognisedSms().then(setUnread).catch(() => {});
    scanAllDuplicatesCached(DEFAULT_USER_ID).then((r) => setDupGroups(r.duplicateGroupCount)).catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
      // A scan's "Review N" prompt is stale once you've been to the review queue and back.
      setScanResult(null);
      setScanCreated(0);
      setDupResult(null);
    }, [refresh]),
  );

  const toggle = (on: boolean) => {
    if (on) {
      // Play policy: the full-screen disclosure comes before the READ_SMS prompt.
      router.push("/settings/sms-disclosure");
    } else {
      disableSmsDetection();
      setEnabled(false);
    }
  };

  const checkDuplicates = async (silent: boolean) => {
    setDupChecking(true);
    if (!silent) setDupResult(null);
    try {
      invalidateDuplicateScanCache();
      const r = await scanAllDuplicates(DEFAULT_USER_ID);
      setDupGroups(r.duplicateGroupCount);
      if (!silent) {
        setDupResult(
          r.duplicateGroupCount > 0
            ? `${r.duplicateGroupCount} possible duplicate group${r.duplicateGroupCount === 1 ? "" : "s"} in ${r.scannedCount} transactions.`
            : `Checked ${r.scannedCount} transactions. No duplicates.`,
        );
      }
    } catch (e) {
      if (!silent) setDupResult(`Couldn't check: ${e instanceof Error ? e.message : String(e)}`);
    }
    setDupChecking(false);
  };

  const scan = async () => {
    setScanning(true);
    setScanResult(null);
    setScanCreated(0);
    try {
      const o = await runSmsScan({ manual: true, accountIds });
      if (o.reason === "error") setScanResult(`Couldn't scan: ${o.error ?? "something went wrong"}`);
      else if (o.reason === "no_permission") setScanResult("Message permission isn't granted. Allow it in your phone's settings.");
      else if (o.reason === "sms_disabled") setScanResult("Reading messages is off. Turn it on above.");
      else if (o.totalScanned === 0) setScanResult(`No new transaction messages from ${formatDisplayDate(from)} to ${formatDisplayDate(to)}.`);
      else {
        setScanCreated(o.created);
        const parts: string[] = [];
        if (o.created > 0) parts.push(`${o.created} to review`);
        if (o.credits > 0) parts.push(`${o.credits} money in`);
        if (o.skipped > 0) parts.push(`${o.skipped} skipped`);
        setScanResult(`Read ${o.totalScanned} message${o.totalScanned === 1 ? "" : "s"}${parts.length ? `: ${parts.join(", ")}` : ""}.`);
      }
    } catch (e) {
      setScanResult(`Couldn't scan: ${e instanceof Error ? e.message : String(e)}`);
    }
    setScanning(false);
    refresh();
    // Duplicates are always checked after a scan.
    void checkDuplicates(true);
  };

  const pickRange = (v: string) => {
    if (v === "custom") {
      setCustomFrom(from);
      setCustomTo(to);
      setCustomError(null);
      setCustomOpen(true);
      return;
    }
    const days = Number(v);
    const start = daysAgo(days);
    const end = daysAgo(0);
    setSmsStartDate(start);
    setSmsEndDate(end);
    // Saved as "last N days", so it still means that next week.
    setSmsScanPresetDays(days);
    setFrom(start);
    setTo(end);
    setScanResult(null);
  };

  const applyCustom = () => {
    const ok = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
    if (!ok(customFrom) || !ok(customTo)) return setCustomError("Pick both dates.");
    if (customFrom > customTo) return setCustomError("The start date must come before the end date.");
    setSmsStartDate(customFrom);
    setSmsEndDate(customTo);
    setFrom(customFrom);
    setTo(customTo);
    setCustomOpen(false);
    setScanResult(null);
  };

  const toggleAccount = (id: string | null) => {
    const next = id == null ? [] : accountIds.includes(id) ? accountIds.filter((x) => x !== id) : [...accountIds, id];
    setAccountIds(next);
    saveSmsScanAccountIds(next);
  };

  const saveName = () => {
    const n = newName.trim();
    if (n.length >= 2) {
      addSelfName(n);
      setNames(getSelfNames());
    }
    setNewName("");
    setAddingName(false);
  };

  const removeName = (n: string) =>
    alert("Remove this name?", `Messages naming "${n}" will no longer be treated as money moved between your own accounts.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          removeSelfName(n);
          setNames(getSelfNames());
        },
      },
    ]);

  const rangeLabel = to === daysAgo(0) ? `Since ${formatDisplayDate(from)}` : `${formatDisplayDate(from)} – ${formatDisplayDate(to)}`;
  const accountsLabel =
    accountIds.length === 0 ? `All ${accounts.length} accounts` : `${accountIds.length} account${accountIds.length === 1 ? "" : "s"}`;
  const runAdded = lastRun ? lastRun.expense_created_count + lastRun.credit_created_count : 0;

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {isAndroid && (
          <>
            <Card>
              <View className="flex-row items-center">
                <View className="flex-1 mr-3">
                  <Text className="text-base font-medium text-foreground">Read transaction messages</Text>
                  <Text className="text-xs text-muted-foreground mt-0.5">
                    {enabled
                      ? lastRun
                        ? `Last scan ${timeAgo(lastRun.created_at)}`
                        : "On · no scans yet"
                      : "Off. Turn on to add transactions from the messages you receive."}
                  </Text>
                </View>
                <Switch value={enabled} onValueChange={toggle} trackColor={{ false: colors.border, true: theme.primary }} thumbColor="#FFFFFF" />
              </View>
              <View className="mt-3">
                <LearnMoreChip contextKey="sms-settings" label="Is message access safe?" />
              </View>
            </Card>

            {enabled && (
              <>
                <SectionLabel>Scan</SectionLabel>
                <Card>
                  <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                    <Chip icon="calendar-outline" label={rangeLabel} onPress={() => setRangeSheet(true)} />
                    <Chip icon="wallet-outline" label={accountsLabel} onPress={() => setAccountSheet(true)} />
                  </View>
                  {customOpen && (
                    <View className="mt-3">
                      <View className="flex-row">
                        <View className="flex-1 mr-2"><DateInput label="From" value={customFrom} onChange={setCustomFrom} maximumDate={null} /></View>
                        <View className="flex-1"><DateInput label="To" value={customTo} onChange={setCustomTo} maximumDate={null} /></View>
                      </View>
                      {customError && <Text className="text-xs text-danger mt-1">{customError}</Text>}
                      <Pressable onPress={applyCustom} className="py-2 rounded-lg items-center mt-2" style={{ backgroundColor: theme.alpha("primary", 0.12) }}>
                        <Text className="text-sm font-medium" style={{ color: theme.primary }}>Use these dates</Text>
                      </Pressable>
                    </View>
                  )}
                  <Pressable
                    onPress={() => void scan()}
                    disabled={scanning}
                    className="flex-row items-center justify-center py-3 mt-3 rounded-lg"
                    style={{ backgroundColor: theme.primary }}
                    accessibilityRole="button"
                  >
                    {scanning ? (
                      <ActivityIndicator size="small" color={theme.primaryForeground} />
                    ) : (
                      <>
                        <Ionicons name="scan-outline" size={17} color={theme.primaryForeground} />
                        <Text className="text-sm font-medium text-primary-foreground ml-2">Scan now</Text>
                      </>
                    )}
                  </Pressable>
                  {scanResult ? (
                    <View className="mt-2">
                      <Text className="text-xs text-muted-foreground text-center">{scanResult}</Text>
                      {scanCreated > 0 && (
                        <Pressable onPress={() => router.push("/expense/review-queue")} className="flex-row items-center justify-center mt-2 py-2 rounded-lg" style={{ backgroundColor: theme.alpha("success", 0.1) }}>
                          <Ionicons name="checkmark-circle-outline" size={16} color={theme.success} />
                          <Text className="text-sm font-medium ml-1.5" style={{ color: theme.success }}>Review {scanCreated}</Text>
                        </Pressable>
                      )}
                    </View>
                  ) : lastRun ? (
                    <Pressable onPress={() => router.push("/settings/sms-scan-runs")} className="mt-2" accessibilityRole="button">
                      <Text className="text-xs text-muted-foreground">
                        Last run {timeAgo(lastRun.created_at)} · {lastRun.sms_read_count} read · {runAdded} added
                        {lastRun.unrecognized_count > 0 ? ` · ${lastRun.unrecognized_count} unread` : ""}
                        <Text className="text-xs" style={{ color: theme.primary }}>  See run</Text>
                      </Text>
                    </Pressable>
                  ) : null}
                </Card>
              </>
            )}
          </>
        )}

        {((isAndroid && unread > 0) || dupGroups > 0) && (
          <>
            <SectionLabel>Needs you</SectionLabel>
            <Card>
              {isAndroid && unread > 0 && (
                <Row
                  title={`${unread} message${unread === 1 ? "" : "s"} Arth couldn't read`}
                  subtitle="Teach it the format once and it reads them from then on"
                  badge={String(unread)}
                  onPress={() => router.push("/settings/sms-templates/unrecognised")}
                />
              )}
              {dupGroups > 0 && (
                <Row
                  title={`${dupGroups} possible duplicate${dupGroups === 1 ? "" : "s"}`}
                  subtitle="Same amount, account, merchant and day"
                  badge={String(dupGroups)}
                  onPress={() => router.push({ pathname: "/expense/review-queue", params: { filter: "duplicates" } })}
                  first={!(isAndroid && unread > 0)}
                />
              )}
            </Card>
          </>
        )}

        <SectionLabel>How Arth reads them</SectionLabel>
        <Card>
          {isAndroid && (
            <Row
              title="Message templates"
              subtitle="Teach Arth a message format it doesn't know yet"
              onPress={() => router.push("/settings/sms-templates")}
              first
            />
          )}
          <Row
            title="Picture templates"
            subtitle="Payment picture layouts you taught Arth"
            onPress={() => router.push("/settings/image-templates")}
            first={!isAndroid}
          />
          {isAndroid && (
            <View className="py-3" style={{ borderTopWidth: 1, borderTopColor: theme.border }}>
              <Text className="text-sm font-medium text-foreground">Your name in messages</Text>
              <Text className="text-xs text-muted-foreground mt-0.5">
                Spots money moved between your own accounts, so it isn't counted as spending
              </Text>
              <View className="flex-row flex-wrap mt-2" style={{ gap: 6 }}>
                {names.map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => removeName(n)}
                    className="flex-row items-center rounded-md px-2 py-1"
                    style={{ backgroundColor: theme.alpha("primary", 0.1) }}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${n}`}
                  >
                    <Text className="text-xs font-medium" style={{ color: theme.primary }}>{n}</Text>
                    <Ionicons name="close" size={12} color={theme.primary} style={{ marginLeft: 4 }} />
                  </Pressable>
                ))}
                {addingName ? (
                  <TextInput
                    value={newName}
                    onChangeText={setNewName}
                    autoFocus
                    autoCapitalize="characters"
                    placeholder="NAME AS IN MESSAGES"
                    placeholderTextColor={theme.mutedForeground}
                    onSubmitEditing={saveName}
                    onBlur={saveName}
                    returnKeyType="done"
                    className="text-xs text-foreground rounded-md px-2 py-1 border"
                    style={{ borderColor: theme.primary, minWidth: 150 }}
                    accessibilityLabel="Your name as it appears in messages"
                  />
                ) : (
                  <Pressable
                    onPress={() => setAddingName(true)}
                    className="rounded-md px-2 py-1 border border-dashed"
                    style={{ borderColor: theme.border }}
                    accessibilityRole="button"
                  >
                    <Text className="text-xs text-muted-foreground">+ Add a name</Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}
          <View className="py-3" style={isAndroid ? { borderTopWidth: 1, borderTopColor: theme.border } : undefined}>
            <Text className="text-sm font-medium text-foreground">Duplicates</Text>
            <Text className="text-xs text-muted-foreground mt-0.5">
              Arth checks for duplicates after every scan: same amount, account, merchant and day.
            </Text>
            <Pressable onPress={() => void checkDuplicates(false)} disabled={dupChecking} className="mt-2 self-start" accessibilityRole="button">
              {dupChecking ? (
                <ActivityIndicator size="small" color={theme.primary} />
              ) : (
                <Text className="text-sm font-medium" style={{ color: theme.primary }}>Check for duplicates now</Text>
              )}
            </Pressable>
            {dupResult && <Text className="text-xs text-muted-foreground mt-1">{dupResult}</Text>}
          </View>
        </Card>

        {isAndroid && (
          <>
            <SectionLabel>History</SectionLabel>
            <Card>
              <Row title="Scan history" subtitle="Every scan, message by message, and what happened to each" onPress={() => router.push("/settings/sms-scan-runs")} first />
            </Card>
          </>
        )}
      </ScrollView>

      <SelectSheet
        visible={rangeSheet}
        title="Scan messages from"
        options={PRESETS.map((p) => ({ value: p.value, label: p.label }))}
        value={null}
        onChange={pickRange}
        onClose={() => setRangeSheet(false)}
      />

      <Sheet visible={accountSheet} onClose={() => setAccountSheet(false)}>
        <View className="px-4 pb-4">
          <Text className="text-lg font-semibold text-foreground mb-3">Which accounts</Text>
          <ScrollView style={{ maxHeight: 380 }}>
            <AccountOption label="All accounts" sub="Read messages for every account" selected={accountIds.length === 0} onPress={() => toggleAccount(null)} />
            {accounts.map((a) => (
              <AccountOption
                key={a.id}
                label={a.account_label || a.bank_name}
                sub={a.account_identifier ? `••••${a.account_identifier}` : ""}
                selected={accountIds.includes(a.id)}
                onPress={() => toggleAccount(a.id)}
              />
            ))}
          </ScrollView>
          <Pressable onPress={() => setAccountSheet(false)} className="items-center py-3 mt-3 rounded-lg" style={{ backgroundColor: theme.primary }}>
            <Text className="text-sm font-medium text-primary-foreground">Done</Text>
          </Pressable>
        </View>
      </Sheet>
    </ScreenContainer>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-5 mb-2 px-1">{children}</Text>;
}

function Chip({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} className="flex-row items-center rounded-lg border px-3 py-1.5" style={{ borderColor: theme.border }} accessibilityRole="button">
      <Ionicons name={icon} size={13} color={theme.mutedForeground} />
      <Text className="text-xs text-foreground mx-1.5">{label}</Text>
      <Ionicons name="chevron-down" size={12} color={theme.mutedForeground} />
    </Pressable>
  );
}

function Row({ title, subtitle, onPress, badge, first }: { title: string; subtitle?: string; onPress: () => void; badge?: string; first?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center py-3"
      style={first ? undefined : { borderTopWidth: 1, borderTopColor: theme.border }}
      accessibilityRole="button"
    >
      <View className="flex-1 mr-2">
        <Text className="text-sm font-medium text-foreground">{title}</Text>
        {subtitle ? <Text className="text-xs text-muted-foreground mt-0.5">{subtitle}</Text> : null}
      </View>
      {badge ? (
        <View className="rounded-md px-2 py-0.5 mr-1" style={{ backgroundColor: theme.alpha("warning", 0.15) }}>
          <Text className="text-label font-semibold" style={{ color: theme.warning }}>{badge}</Text>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />
    </Pressable>
  );
}

function AccountOption({ label, sub, selected, onPress }: { label: string; sub: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center py-3 px-3 rounded-lg mb-2 border"
      style={selected ? { borderColor: theme.primary, backgroundColor: theme.alpha("primary", 0.08) } : { borderColor: theme.border }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
    >
      <View className="flex-1">
        <Text className="text-sm font-medium text-foreground">{label}</Text>
        {sub ? <Text className="text-xs text-muted-foreground mt-0.5">{sub}</Text> : null}
      </View>
      <Ionicons name={selected ? "checkbox" : "square-outline"} size={20} color={selected ? theme.primary : theme.mutedForeground} />
    </Pressable>
  );
}
