import { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Button, Card } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac } from "@/utils/accent";
import { getActiveAccounts, type FinancialAccount } from "@/services/financial-account";
import { DEFAULT_USER_ID } from "@/constants/app";
import { setOnboardingCompletedVersion } from "@/services/settings";
import { getCurrentAppVersion } from "@/services/onboarding";

const TYPE_LABEL: Record<string, string> = {
  savings: "Savings",
  credit_card: "Credit Card",
  loan: "Loan",
  wallet: "Wallet",
  demat: "Demat",
  pension: "Pension",
};

const TYPE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  savings: "wallet-outline",
  credit_card: "card-outline",
  loan: "document-text-outline",
  wallet: "phone-portrait-outline",
  demat: "trending-up-outline",
  pension: "business-outline",
};

export default function OnboardingAccountsPreview() {
  const router = useRouter();
  const { accent, colorScheme } = useColorScheme();
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const rows = await getActiveAccounts(DEFAULT_USER_ID);
        setAccounts(rows);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleAddManually = () => {
    router.push("/settings/account-add" as never);
  };

  const handleContinue = () => {
    router.push("/(onboarding)/done" as never);
  };

  const handleSkip = () => {
    setOnboardingCompletedVersion(getCurrentAppVersion());
    router.replace("/(tabs)" as never);
  };

  return (
    <ScreenContainer safe padTop>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 32, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-2xl font-bold text-text-primary dark:text-text-dark-primary mb-2">
          Your accounts
        </Text>
        <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mb-6 leading-5">
          {loading
            ? "Looking for accounts in your recent SMS..."
            : accounts.length > 0
            ? `We found ${accounts.length} account${accounts.length === 1 ? "" : "s"} from your recent SMS. You can edit or add more later.`
            : "No accounts detected yet. You can add one now or anytime from Settings."}
        </Text>

        {loading && (
          <View className="items-center py-12">
            <ActivityIndicator size="small" color={ac(accent, colorScheme, 500, 200)} />
          </View>
        )}

        {!loading && accounts.length > 0 && (
          <Card className="p-0 mb-4">
            {accounts.map((acct, i) => {
              const label = acct.account_label || acct.bank_name;
              const sub = `${TYPE_LABEL[acct.account_type] || acct.account_type} • XX${acct.account_identifier}`;
              return (
                <View
                  key={acct.id}
                  className={`flex-row items-center px-4 py-3 ${
                    i < accounts.length - 1
                      ? "border-b border-border-light dark:border-border-dark"
                      : ""
                  }`}
                >
                  <View
                    className="w-10 h-10 rounded-full items-center justify-center mr-3"
                    style={{ backgroundColor: ac(accent, colorScheme, 500, 200) + "1F" }}
                  >
                    <Ionicons
                      name={TYPE_ICON[acct.account_type] || "ellipse-outline"}
                      size={18}
                      color={ac(accent, colorScheme, 500, 200)}
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-medium text-text-primary dark:text-text-dark-primary">
                      {label}
                    </Text>
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
                      {sub}
                    </Text>
                  </View>
                </View>
              );
            })}
          </Card>
        )}

        {!loading && (
          <Pressable
            onPress={handleAddManually}
            className="flex-row items-center justify-center py-3 border border-dashed rounded-xl"
            style={{ borderColor: ac(accent, colorScheme, 500, 200) }}
          >
            <Ionicons
              name="add"
              size={18}
              color={ac(accent, colorScheme, 500, 200)}
              style={{ marginRight: 6 }}
            />
            <Text
              className="text-sm font-medium"
              style={{ color: ac(accent, colorScheme, 500, 200) }}
            >
              Add an account manually
            </Text>
          </Pressable>
        )}
      </ScrollView>

      <View className="px-6 pb-6 pt-2">
        <Button title="Continue" onPress={handleContinue} className="mb-3" />
        <Pressable onPress={handleSkip} className="py-3 items-center">
          <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">
            Skip setup
          </Text>
        </Pressable>
      </View>
    </ScreenContainer>
  );
}
