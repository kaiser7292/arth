import { useEffect, useState } from "react";
import { View, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Button, Card, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { getActiveAccounts, type FinancialAccount } from "@/services/financial-account";
import { DEFAULT_USER_ID } from "@/constants/app";
import { setOnboardingCompletedVersion } from "@/services/settings";
import { getCurrentAppVersion } from "@/services/onboarding";
import { useTheme } from "@/hooks/use-theme";

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
  
  const theme = useTheme();
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
    router.push("/settings/account-add");
  };

  const handleContinue = () => {
    router.push("/(onboarding)/done");
  };

  const handleSkip = () => {
    setOnboardingCompletedVersion(getCurrentAppVersion());
    router.replace("/(tabs)");
  };

  return (
    <ScreenContainer safe padTop>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 32, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-2xl font-bold text-foreground mb-2">
          Your accounts
        </Text>
        <Text className="text-sm text-muted-foreground mb-6 leading-5">
          {loading
            ? "Looking for accounts in your recent SMS..."
            : accounts.length > 0
            ? `We found ${accounts.length} account${accounts.length === 1 ? "" : "s"} from your recent SMS. You can edit or add more later.`
            : "No accounts detected yet. You can add one now or anytime from Settings."}
        </Text>

        {loading && (
          <View className="items-center py-12">
            <ActivityIndicator size="small" color={theme.primary} />
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
                      ? "border-b border-border"
                      : ""
                  }`}
                >
                  <View
                    className="w-10 h-10 rounded-full items-center justify-center mr-3"
                    style={{ backgroundColor: theme.primary + "1F" }}
                  >
                    <Ionicons
                      name={TYPE_ICON[acct.account_type] || "ellipse-outline"}
                      size={18}
                      color={theme.primary}
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-medium text-foreground">
                      {label}
                    </Text>
                    <Text className="text-xs text-muted-foreground mt-0.5">
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
            style={{ borderColor: theme.primary }}
          >
            <Ionicons
              name="add"
              size={18}
              color={theme.primary}
              style={{ marginRight: 6 }}
            />
            <Text
              className="text-sm font-medium"
              style={{ color: theme.primary }}
            >
              Add an account manually
            </Text>
          </Pressable>
        )}
      </ScrollView>

      <View className="px-6 pb-6 pt-2">
        <Button title="Continue" onPress={handleContinue} className="mb-3" />
        <Pressable onPress={handleSkip} className="py-3 items-center">
          <Text className="text-sm text-muted-foreground">
            Skip setup
          </Text>
        </Pressable>
      </View>
    </ScreenContainer>
  );
}
