import { useCallback, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, ScreenContainer, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getDatabase } from "@/database";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { formatFrequency, formatLastBackupTime, getBackupScheduleSettings, getLastScheduledBackupAt } from "@/services/backup-schedule";
import { getDismissedDuplicateCount } from "@/services/duplicate-detection";
import { getLastBackupAt } from "@/services/settings";

/**
 * Backups and everything about removing data, together: backup status and restore, importing,
 * the recycle bin, duplicates you chose to keep, and the permanent clean-up.
 * Replaces the Backup & Storage section of the Settings tab.
 */
export default function BackupDataScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [binCount, setBinCount] = useState(0);
  const [keptDupes, setKeptDupes] = useState(0);
  const [last, setLast] = useState<string | null>(null);
  const [schedule, setSchedule] = useState(getBackupScheduleSettings);

  useDataRefresh(
    useCallback(async () => {
      const manual = getLastBackupAt();
      const auto = getLastScheduledBackupAt();
      setLast(!manual ? auto : !auto ? manual : manual > auto ? manual : auto);
      setSchedule(getBackupScheduleSettings());
      setKeptDupes(getDismissedDuplicateCount());
      try {
        const row = await getDatabase().getFirstAsync<{ n: number }>(
          "SELECT COUNT(*) AS n FROM expenses WHERE user_id = ? AND deleted_at IS NOT NULL;",
          DEFAULT_USER_ID,
        );
        setBinCount(row?.n ?? 0);
      } catch {
        setBinCount(0);
      }
    }, []),
  );

  const ageDays = last ? (Date.now() - new Date(last).getTime()) / 86_400_000 : null;
  const stale = ageDays == null || ageDays > 7;

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Card>
          <View className="flex-row items-center">
            <Ionicons
              name={stale ? "warning-outline" : "shield-checkmark-outline"}
              size={22}
              color={stale ? theme.warning : theme.success}
            />
            <View className="flex-1 ml-3">
              <Text className="text-base font-medium text-foreground">
                {last ? `Backed up ${formatLastBackupTime(last).toLowerCase()}` : "Not backed up yet"}
              </Text>
              <Text className="text-xs text-muted-foreground mt-0.5">
                {schedule.enabled ? `Automatic backup ${formatFrequency(schedule.frequencyHours).toLowerCase()}` : "Automatic backup is off"}
                {" · encrypted with your password"}
              </Text>
            </View>
          </View>
          <View className="flex-row mt-3" style={{ gap: 8 }}>
            <Pressable
              onPress={() => router.push("/settings/backup-restore")}
              className="flex-1 items-center py-2.5 rounded-lg"
              style={{ backgroundColor: theme.primary }}
              accessibilityRole="button"
            >
              <Text className="text-sm font-medium text-primary-foreground">Back up or restore</Text>
            </Pressable>
          </View>
        </Card>

        <Card className="mt-3">
          <Row icon="download-outline" title="Import from Excel" subtitle="Bring in past transactions from a spreadsheet" onPress={() => router.push("/settings/import-excel")} first />
          <Row icon="checkmark-done-outline" title="Reconcile statements" subtitle="Match a statement against your Arth ledger" onPress={() => router.push("/settings/reconciliation")} />
        </Card>

        <Label>Deleted and kept</Label>
        <Card>
          <Row
            icon="trash-bin-outline"
            title="Recycle bin"
            subtitle={binCount > 0 ? `${binCount} deleted item${binCount === 1 ? "" : "s"} · restore within 30 days` : "Nothing deleted recently"}
            onPress={() => router.push("/settings/recycle-bin")}
            first
          />
          <Row
            icon="copy-outline"
            title="Duplicates you kept"
            subtitle={keptDupes > 0 ? `${keptDupes} group${keptDupes === 1 ? "" : "s"} marked "not a duplicate"` : "None yet"}
            onPress={() => router.push("/settings/dismissed-duplicates")}
          />
        </Card>

        <Label>Clean up</Label>
        <Card>
          <Row
            icon="trash-outline"
            danger
            title="Permanently delete data"
            subtitle="Pick a date range and what to remove. This can't be undone."
            onPress={() => router.push("/settings/clean-up")}
            first
          />
        </Card>
      </ScrollView>
    </ScreenContainer>
  );
}

function Label({ children }: { children: string }) {
  return <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-5 mb-2 px-1">{children}</Text>;
}

function Row({
  icon,
  title,
  subtitle,
  onPress,
  first,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
  first?: boolean;
  danger?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center py-3"
      style={first ? undefined : { borderTopWidth: 1, borderTopColor: theme.border }}
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={19} color={danger ? theme.danger : theme.mutedForeground} />
      <View className="flex-1 ml-3 mr-2">
        <Text className="text-sm font-medium" style={{ color: danger ? theme.danger : theme.foreground }}>{title}</Text>
        <Text className="text-xs text-muted-foreground mt-0.5">{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />
    </Pressable>
  );
}
