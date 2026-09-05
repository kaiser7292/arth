/**
 * Notification Preferences Screen
 *
 * Toggle switches per notification type. Settings persist via MMKV.
 * Requests notification permission on first enable.
 */

import { useState, useCallback } from "react";
import { View, Text, Switch, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAlert } from "@/hooks/use-alert";
import { ScreenContainer, Card } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { StatusColors } from "@/constants/theme";
import { DEFAULT_USER_ID } from "@/constants/app";
import {
  isNotificationEnabled,
  setNotificationEnabled,
  requestNotificationPermissions,
  hasNotificationPermission,
  type NotificationCategory,
} from "@/services/notifications";
import {
  scheduleSmartDailyDigest,
  syncNotifBackgroundTask,
} from "@/services/notification-scheduler";

interface NotifToggleProps {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  title: string;
  subtitle: string;
  category: NotificationCategory;
  enabled: boolean;
  onToggle: (category: NotificationCategory, value: boolean) => void;
}

function NotifToggle({ icon, iconColor, title, subtitle, category, enabled, onToggle }: NotifToggleProps) {
  const { colors } = useColorScheme();
  return (
    <View className="flex-row items-center justify-between py-3 border-b border-border">
      <View className="flex-row items-center flex-1 mr-3">
        <View
          className="w-7 h-7 rounded-full items-center justify-center mr-3"
          style={{ backgroundColor: iconColor + "14" }}
        >
          <Ionicons name={icon} size={16} color={iconColor} />
        </View>
        <View className="flex-1">
          <Text className="text-sm font-medium text-foreground">
            {title}
          </Text>
          <Text className="text-xs text-muted-foreground mt-0.5">
            {subtitle}
          </Text>
        </View>
      </View>
      <Switch
        value={enabled}
        onValueChange={(val) => onToggle(category, val)}
        trackColor={{ false: "#E5E5E3", true: colors.blue }}
        thumbColor={enabled ? "#FFFFFF" : "#9CA3AF"}
      />
    </View>
  );
}

export default function NotificationPreferencesScreen() {
  const alert = useAlert();
  const { colorScheme } = useColorScheme();
  const [overdue, setOverdue] = useState(() => isNotificationEnabled("overdue_forecast"));
  const [upcoming, setUpcoming] = useState(() => isNotificationEnabled("upcoming_due"));
  const [scheduledBackup, setScheduledBackup] = useState(() => isNotificationEnabled("scheduled_backup"));
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);

  // Check permission on mount
  useState(() => {
    hasNotificationPermission().then(setPermissionGranted);
  });

  const handleToggle = useCallback(async (category: NotificationCategory, value: boolean) => {
    if (value && permissionGranted !== true) {
      const granted = await requestNotificationPermissions();
      setPermissionGranted(granted);
      if (!granted) {
        alert(
          "Permission Required",
          "Notification permission is needed to send alerts. You can enable it in your device settings.",
        );
        return;
      }
    }

    setNotificationEnabled(category, value);
    switch (category) {
      case "overdue_forecast":
        setOverdue(value);
        scheduleSmartDailyDigest(DEFAULT_USER_ID).catch(() => {});
        syncNotifBackgroundTask().catch(() => {});
        break;
      case "upcoming_due":
        setUpcoming(value);
        scheduleSmartDailyDigest(DEFAULT_USER_ID).catch(() => {});
        syncNotifBackgroundTask().catch(() => {});
        break;
      case "scheduled_backup":
        setScheduledBackup(value);
        break;
    }
  }, [permissionGranted, alert]);

  return (
    <ScreenContainer padTop={false}>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="px-4 pt-5 pb-3">
          <Text className="text-lg font-bold text-foreground">
            Notification Preferences
          </Text>
          <Text className="text-xs text-muted-foreground mt-1">
            Choose which alerts you want to receive
          </Text>
        </View>

        {/* Permission Banner */}
        {permissionGranted === false && (
          <View
            className="mx-4 mb-3 p-3 rounded-xl"
            style={{ backgroundColor: StatusColors[colorScheme].warningBg }}
          >
            <View className="flex-row items-center">
              <Ionicons name="warning-outline" size={16} color={StatusColors[colorScheme].warning} />
              <Text
                className="text-xs font-medium ml-2"
                style={{ color: StatusColors[colorScheme].warning }}
              >
                Notification permission not granted. Enable in device settings.
              </Text>
            </View>
          </View>
        )}

        <Card className="mx-4 mb-3">
          <NotifToggle
            icon="alert-circle-outline"
            iconColor={StatusColors[colorScheme].danger}
            title="Overdue Payments"
            subtitle="Daily 9:10 AM digest when payments are overdue"
            category="overdue_forecast"
            enabled={overdue}
            onToggle={handleToggle}
          />

          <NotifToggle
            icon="time-outline"
            iconColor="#F59E0B"
            title="Upcoming Dues"
            subtitle="Daily 9:10 AM digest for payments due within 2 days"
            category="upcoming_due"
            enabled={upcoming}
            onToggle={handleToggle}
          />

          <NotifToggle
            icon="cloud-upload-outline"
            iconColor="#0D9488"
            title="Auto Backup"
            subtitle="Notify when a scheduled backup completes"
            category="scheduled_backup"
            enabled={scheduledBackup}
            onToggle={handleToggle}
          />
        </Card>

        <View className="mx-4 px-3 py-2.5 rounded-xl" style={{ backgroundColor: StatusColors[colorScheme].warningBg }}>
          <Text className="text-xs text-muted-foreground">
            The daily digest fires at 9:10 AM via a system alarm — it works even when the app is closed. Content reflects your data as of the last time Arth was open. No notification is sent if nothing needs your attention.
          </Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
