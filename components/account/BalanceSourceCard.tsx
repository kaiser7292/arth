import { useCallback, useEffect, useState } from "react";
import { View, Pressable, Modal, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button, Card, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { formatAmount } from "@/utils/format";
import {
  getBalanceSourceInfo,
  findAndApplyLatestBalanceSms,
  type BalanceSourceInfo,
  type AutoApplyResult,
} from "@/services/balance-source";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";

interface BalanceSourceCardProps {
  accountId: string;
  /** Whether the source account is part of a shared-limit pool (affects labeling). */
  isShared?: boolean;
  /** When shared, the identifier of the sibling whose SMS supplied the current balance (for label context). */
  sourceLabel?: string;
  /**
   * v17.5.10 — drives the section label. "Bank-Reported Balance" is wrong for
   * wallets (Paytm/PhonePe aren't banks) and for credit cards where the SMS
   * reports utilized/available, not "balance". Caller passes the account's
   * account_type so the card can pick accurate wording.
   */
  accountType?: string;
}

function formatSmsTimestamp(epochMs: number): string {
  const d = new Date(epochMs);
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatShortDate(yyyymmdd: string): string {
  const d = new Date(yyyymmdd + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function BalanceSourceCard({ accountId, isShared, sourceLabel, accountType }: BalanceSourceCardProps) {
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [info, setInfo] = useState<BalanceSourceInfo | null>(null);
  const [showSourceSms, setShowSourceSms] = useState(false);
  const [showCandidateSms, setShowCandidateSms] = useState(false);
  const [infoSheetOpen, setInfoSheetOpen] = useState(false);
  const [autoApply, setAutoApply] = useState<AutoApplyResult | null>(null);

  const load = useCallback(async () => {
    try {
      // Silently scan for a newer SMS and apply. Runs every time the card
      // re-focuses; most calls are no-op ("no_newer_sms").
      const applyResult = await findAndApplyLatestBalanceSms(accountId);
      const nextInfo = await getBalanceSourceInfo(accountId);
      setAutoApply(applyResult);
      setInfo(nextInfo);
    } catch {
      // DB not ready, or no siblings — leave info null
    }
  }, [accountId]);

  useDataRefresh(load);
  useEffect(() => {
    load();
  }, [load]);

  if (!info) return null;

  const { calculatedBalance, autoDetectedBalance, autoDetectedDate, sourceSms, isStale } = info;
  const hasAutoDetected = autoDetectedBalance != null;
  const mismatch =
    !isStale &&
    hasAutoDetected &&
    calculatedBalance != null &&
    Math.abs(calculatedBalance - (autoDetectedBalance ?? 0)) > 1;

  // v17.5.10 — branch label by account type. Wallets are not banks; CC SMS
  // reports utilized/available, not a "balance".
  const sectionLabel = isShared
    ? "Pool Balance"
    : accountType === "wallet"
      ? "Latest Reported Balance"
      : accountType === "credit_card"
        ? "Latest Reported Usage"
        : "Bank-Reported Balance";
  const sourceSuffix = isShared && sourceLabel ? ` (from ••${sourceLabel})` : "";

  const autoApplyFailedWithCandidate =
    autoApply != null &&
    !autoApply.applied &&
    autoApply.candidateSms != null &&
    autoApply.reason !== "no_newer_sms";

  return (
    <Card className="mb-4">
      {/* Header */}
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
          {sectionLabel}
        </Text>
        <Pressable
          onPress={() => setInfoSheetOpen(true)}
          hitSlop={10}
          accessibilityLabel="About this balance"
        >
          <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>

      {/* Auto-detected row */}
      {hasAutoDetected && (
        <View className="flex-row items-center justify-between py-1">
          <View className="flex-1 pr-2">
            <Text className="text-sm text-foreground">
              Auto-detected{isStale ? " · stale" : ""}
            </Text>
            {autoDetectedDate && (
              <Text className="text-xs text-muted-foreground mt-0.5">
                {formatShortDate(autoDetectedDate)}{sourceSuffix}
              </Text>
            )}
          </View>
          <Text
            className="text-base font-semibold text-foreground"
            style={isStale ? { textDecorationLine: "line-through", color: theme.faintForeground } : undefined}
          >
            {formatAmount(autoDetectedBalance!)}
          </Text>
        </View>
      )}

      {/* Calculated row */}
      {calculatedBalance != null && (
        <View className="flex-row items-center justify-between py-1">
          <View className="flex-1 pr-2">
            <Text className="text-sm font-medium text-foreground">
              Calculated
            </Text>
            <Text className="text-xs text-muted-foreground mt-0.5">
              {!hasAutoDetected || isStale || mismatch ? "Authoritative" : "Matches SMS"}
            </Text>
          </View>
          <Text className="text-base font-bold text-foreground">
            {formatAmount(calculatedBalance)}
          </Text>
        </View>
      )}

      {/* Staleness / mismatch note */}
      {(isStale || mismatch) && (
        <View
          className="mt-3 p-3 rounded-lg"
          style={{ backgroundColor: theme.warning + "14" }}
        >
          <Text className="text-xs leading-4" style={{ color: theme.warning }}>
            {isStale
              ? "New activity recorded after the last balance SMS. Using the Calculated balance."
              : `Auto-detected and Calculated differ by ${formatAmount(Math.abs((calculatedBalance ?? 0) - (autoDetectedBalance ?? 0)))}. An untracked transaction may have occurred.`}
          </Text>
        </View>
      )}

      {/* Auto-apply failure — surfaces a newer SMS that couldn't be applied silently */}
      {autoApplyFailedWithCandidate && autoApply?.candidateSms && (
        <View className="mt-3">
          <View
            className="p-3 rounded-lg mb-2"
            style={{ backgroundColor: theme.warning + "14" }}
          >
            <Text className="text-xs font-medium" style={{ color: theme.warning }}>
              Newer SMS found but couldn't be applied
            </Text>
            <Text className="text-xs mt-1 leading-4" style={{ color: theme.warning }}>
              {formatSmsTimestamp(autoApply.candidateSms.sms_date)}
              {autoApply.reason === "no_balance_in_sms" ? " - no balance in it." :
               autoApply.reason === "parse_failed" ? " - couldn't parse." :
               autoApply.errorMessage ? ` - ${autoApply.errorMessage}` : "."}
            </Text>
          </View>
          <Pressable
            onPress={() => setShowCandidateSms((v) => !v)}
            className="flex-row items-center"
            hitSlop={6}
          >
            <Text className="text-xs font-medium text-muted-foreground">
              {showCandidateSms ? "Hide unapplied SMS" : "View unapplied SMS"}
            </Text>
            <Ionicons
              name={showCandidateSms ? "chevron-up" : "chevron-down"}
              size={14}
              color={colors.textSecondary}
              style={{ marginLeft: 4 }}
            />
          </Pressable>
          {showCandidateSms && (
            <View className="mt-2 p-3 rounded-lg bg-background">
              <Text className="text-xs text-muted-foreground leading-5">
                {autoApply.candidateSms.body}
              </Text>
              <Text className="text-label text-faint-foreground mt-2">
                {autoApply.candidateSms.address}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Source SMS — collapsible, matches the expense-detail "Raw SMS" pattern */}
      {sourceSms && (
        <View className="mt-4 pt-3 border-t border-border">
          <Pressable
            onPress={() => setShowSourceSms((v) => !v)}
            className="flex-row items-center"
            hitSlop={6}
          >
            <Text className="text-xs font-medium text-muted-foreground">
              Source SMS
            </Text>
            <Ionicons
              name={showSourceSms ? "chevron-up" : "chevron-down"}
              size={14}
              color={colors.textSecondary}
              style={{ marginLeft: 4 }}
            />
            <Text className="text-label text-faint-foreground ml-auto">
              {formatSmsTimestamp(sourceSms.sms_date)}
            </Text>
          </Pressable>
          {showSourceSms && (
            <View className="mt-2 p-3 rounded-lg bg-background">
              <Text className="text-xs text-muted-foreground leading-5">
                {sourceSms.body}
              </Text>
              <Text className="text-label text-faint-foreground mt-2">
                {sourceSms.address}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Info bottom sheet */}
      <Modal
        visible={infoSheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setInfoSheetOpen(false)}
      >
        <Pressable
          className="flex-1 bg-black/50 justify-end"
          onPress={() => setInfoSheetOpen(false)}
        >
          <Pressable
            className="rounded-t-2xl bg-card p-5"
            onPress={() => { /* swallow taps so inner taps don't dismiss */ }}
          >
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-base font-bold text-foreground">
                About This Balance
              </Text>
              <Pressable onPress={() => setInfoSheetOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 460 }}>
              <Text className="text-xs font-semibold tracking-wider uppercase text-muted-foreground mb-2">
                Calculated
              </Text>
              <Text className="text-sm text-foreground mb-4 leading-5">
                Derived from your starting balance plus this month's transactions.
                Authoritative - correct even when the bank doesn't send SMS.
              </Text>

              <Text className="text-xs font-semibold tracking-wider uppercase text-muted-foreground mb-2">
                Auto-detected
              </Text>
              <Text className="text-sm text-foreground mb-4 leading-5">
                The latest balance extracted from a bank SMS. Not every SMS contains a
                balance. When new activity (SMS purchase, payment, or credit) is recorded
                after this SMS, auto-detected is marked stale and Calculated becomes the
                source of truth.
              </Text>

              <Text className="text-xs font-semibold tracking-wider uppercase text-muted-foreground mb-2">
                Why they might differ
              </Text>
              <Text className="text-sm text-foreground mb-4 leading-5">
                • The bank sent a transaction SMS without a balance{"\n"}
                • You made a payment that hasn't been SMS'd yet{"\n"}
                • A transaction outside the app happened
              </Text>

              <Text className="text-xs font-semibold tracking-wider uppercase text-muted-foreground mb-2">
                Privacy
              </Text>
              <Text className="text-sm text-foreground leading-5">
                The source SMS is stored locally on your device and never transmitted.
              </Text>
            </ScrollView>
            <Button title="Got it" onPress={() => setInfoSheetOpen(false)} className="mt-4" />
          </Pressable>
        </Pressable>
      </Modal>
    </Card>
  );
}
