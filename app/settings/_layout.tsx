import { HeaderBackHome } from "@/components/ui/HeaderBackHome";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { Stack } from "expo-router";

export default function SettingsStackLayout() {
  const { colorScheme } = useColorScheme();
  const theme = Colors[colorScheme];

  return (
    <Stack
      screenOptions={{
        headerStyle: {
          backgroundColor: theme.background,
        },
        headerTitleStyle: {
          fontWeight: "700",
          fontSize: 18,
          color: theme.text,
        },
        headerTintColor: theme.tint,
        headerShadowVisible: false,
        headerTitleAlign: "center",
        headerLeft: () => <HeaderBackHome />,
      }}
    >
      <Stack.Screen name="categories" options={{ title: "Categories" }} />
      <Stack.Screen name="category-edit" options={{ title: "Category" }} />
      <Stack.Screen name="payment-modes" options={{ title: "Payment Modes" }} />
      <Stack.Screen name="payment-mode-edit" options={{ title: "Payment Mode" }} />
      <Stack.Screen name="budget-config" options={{ title: "Monthly Budgets" }} />
      <Stack.Screen name="tags" options={{ title: "Tags" }} />
      <Stack.Screen name="import-excel" options={{ title: "Import from Excel" }} />
      <Stack.Screen name="backup-restore" options={{ title: "Backup & Restore" }} />
      <Stack.Screen name="notifications" options={{ title: "Notifications" }} />
      <Stack.Screen name="home-cards" options={{ title: "Home Cards" }} />
      <Stack.Screen name="merchant-aliases" options={{ title: "Merchant Aliases" }} />
      <Stack.Screen name="account-master" options={{ title: "Accounts" }} />
      <Stack.Screen name="account-detail" options={{ title: "Account" }} />
      <Stack.Screen name="account-add" options={{ title: "Add Account" }} />
      <Stack.Screen name="recycle-bin" options={{ title: "Recycle Bin" }} />
      <Stack.Screen name="dismissed-duplicates" options={{ title: "Dismissed Duplicates" }} />
      <Stack.Screen name="recurring-rules" options={{ title: "Reminders" }} />
      <Stack.Screen name="recurring-rule-detail" options={{ title: "Reminder" }} />
      <Stack.Screen name="audit-log" options={{ title: "Audit Log" }} />
      <Stack.Screen name="security" options={{ title: "Security" }} />
      <Stack.Screen name="region" options={{ title: "Region" }} />
      <Stack.Screen name="kite-connect" options={{ title: "Kite Connect" }} />
      <Stack.Screen name="kite-connect-api-key" options={{ title: "Kite API Key" }} />
      <Stack.Screen name="smart-rules/index" options={{ title: "Smart Rules" }} />
      <Stack.Screen name="smart-rules/[id]" options={{ title: "Rule" }} />
      <Stack.Screen name="sms-templates/index" options={{ title: "Smart SMS Templates" }} />
      <Stack.Screen name="sms-templates/new" options={{ title: "Teach Arth" }} />
      <Stack.Screen name="sms-templates/tag" options={{ title: "Tag Fields" }} />
      <Stack.Screen name="sms-templates/[id]" options={{ title: "Template" }} />
      <Stack.Screen name="sms-templates/unrecognised" options={{ title: "Unrecognised SMS" }} />
      <Stack.Screen name="sms-scan-runs" options={{ title: "SMS Scan Runs" }} />
      <Stack.Screen name="reconciliation/index" options={{ title: "Reconcile Accounts" }} />
      <Stack.Screen name="reconciliation/new" options={{ title: "New Reconciliation" }} />
      <Stack.Screen name="reconciliation/[sessionId]" options={{ title: "Reconciliation" }} />
      <Stack.Screen name="reconciliation/manual-link" options={{ title: "Link Transaction" }} />
      <Stack.Screen name="help/index" options={{ title: "Help Center" }} />
      <Stack.Screen name="help/[slug]" options={{ title: "" }} />
    </Stack>
  );
}
