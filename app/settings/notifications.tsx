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
import {
  isNotificationEnabled,
  setNotificationEnabled,
  requestNotificationPermissions,
  hasNotificationPermission,
  type NotificationCategory,
} from "@/services/notifications";
import { syncNotifBackgroundTask, syncMonthlySummarySchedule } from "@/services/notification-scheduler";

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
  const { colors, colorScheme } = useColorScheme();
  return (
    <View className="flex-row items-center justify-between py-3 border-b border-border-light dark:border-border-dark">
      <View className="flex-row items-center flex-1 mr-3">
        <View
          className="w-7 h-7 rounded-full items-center justify-center mr-3"
          style={{ backgroundColor: iconColor + "14" }}
        >
          <Ionicons name={icon} size={16} color={iconColor} />
        </View>
        <View className="flex-1">
          <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
            {title}
          </Text>
          <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
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
  const { colors, colorScheme } = useColorScheme();
  const [smsScan, setSmsScan] = useState(() => isNotificationEnabled("sms_scan"));
  const [overdue, setOverdue] = useState(() => isNotificationEnabled("overdue_forecast"));
  const [upcoming, setUpcoming] = useState(() => isNotificationEnabled("upcoming_due"));
  const [monthlySummary, setMonthlySummary] = useState(() => isNotificationEnabled("monthly_summary"));
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
      case "sms_scan":
        setSmsScan(value);
        break;
      case "overdue_forecast":
        setOverdue(value);
        break;
      case "upcoming_due":
        setUpcoming(value);
        break;
      case "monthly_summary":
        setMonthlySummary(value);
        break;
    }

    if (category === "overdue_forecast" || category === "upcoming_due") {
      syncNotifBackgroundTask().catch(() => {});
    }
    if (category === "monthly_summary") {
      syncMonthlySummarySchedule().catch(() => {});
    }
  }, [permissionGranted]);

  return (
    <ScreenContainer padTop={false}>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="px-4 pt-5 pb-3">
          <Text className="text-lg font-bold text-text-primary dark:text-text-dark-primary">
            Notification Preferences
          </Text>
          <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-1">
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

        <Card className="mx-4 mb-4">
          <NotifToggle
            icon="scan-outline"
            iconColor={colors.blue}
            title="SMS Scan Results"
            subtitle="When background scan finds new transactions"
            category="sms_scan"
            enabled={smsScan}
            onToggle={handleToggle}
          />

          <NotifToggle
            icon="alert-circle-outline"
            iconColor={StatusColors[colorScheme].danger}
            title="Overdue Payments"
            subtitle="When forecasted payments pass their due date"
            category="overdue_forecast"
            enabled={overdue}
            onToggle={handleToggle}
          />

          <NotifToggle
            icon="time-outline"
            iconColor="#F59E0B"
            title="Upcoming Dues"
            subtitle="Reminders for payments due within 2 days"
            category="upcoming_due"
            enabled={upcoming}
            onToggle={handleToggle}
          />

          <NotifToggle
            icon="calendar-outline"
            iconColor="#8B5CF6"
            title="Monthly Summary"
            subtitle="Spending recap on the 1st of each month at 9 AM"
            category="monthly_summary"
            enabled={monthlySummary}
            onToggle={handleToggle}
          />
        </Card>
      </ScrollView>
    </ScreenContainer>
  );
}
