import { AiSetupOffer } from "@/components/onboarding/AiSetupOffer";
import { useCallback, useState } from "react";
import { View, ScrollView, Pressable, ActivityIndicator, Switch } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { getActiveAccounts, type FinancialAccount } from "@/services/financial-account";
import {
  batchInvestmentProducts,
  isDematLikeAccount,
  isPensionLikeAccount,
  type InvestmentProduct,
} from "@/services/investment-accounts";
import { DEFAULT_USER_ID } from "@/constants/app";
import { setOnboardingCompletedVersion } from "@/services/settings";
import { getCurrentAppVersion } from "@/services/onboarding";
import { useTheme } from "@/hooks/use-theme";
import { getAccountOrigin, getIgnoredAccountIds, ignoreAccount, keepAccount, type AccountOrigin } from "@/services/account-ignore";
import { findTransferCandidates } from "@/services/transfer-detect";
import { formatDisplayDate } from "@/utils/date";

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

/** "demat"/"pension" resolved through the Phase-2 alias, else the raw account_type. */
function resolvedAccountType(
  account: { id: string; account_type: string },
  investmentProducts: Map<string, InvestmentProduct>,
): string {
  const product = investmentProducts.get(account.id);
  if (isDematLikeAccount(account, product)) return "demat";
  if (isPensionLikeAccount(account, product)) return "pension";
  return account.account_type;
}

export default function OnboardingAccountsPreview() {
  const router = useRouter();
  
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [investmentProducts, setInvestmentProducts] = useState<Map<string, InvestmentProduct>>(new Map());
  /** Accounts switched to Ignore on this screen. */
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  /** "Why is this here?" opened for these, with what was found. */
  const [origins, setOrigins] = useState<Map<string, AccountOrigin | null>>(new Map());
  /** Account digits seen as the other side of transfers, not added yet. */
  const [notAdded, setNotAdded] = useState<{ digits: string; count: number; card: boolean; bank: string; expenseId: string }[]>([]);

  // Reloaded on focus, so an account added from here shows up; ignored ones stay listed (they're
  // no longer active) so their switch can be turned back on.
  useFocusEffect(
    useCallback(() => {
    (async () => {
      try {
        const rows = await getActiveAccounts(DEFAULT_USER_ID);
        setAccounts((prev) => [...rows, ...prev.filter((p) => getIgnoredAccountIds().has(p.id) && !rows.some((x) => x.id === p.id))]);
        findTransferCandidates(DEFAULT_USER_ID)
          .then((list) => {
            const byDigits = new Map<string, { digits: string; count: number; card: boolean; bank: string; expenseId: string }>();
            for (const c of list) {
              if (!c.missingDigits) continue;
              const prev = byDigits.get(c.missingDigits);
              if (prev) prev.count++;
              else
                byDigits.set(c.missingDigits, {
                  digits: c.missingDigits,
                  count: 1,
                  card: c.kind === "card",
                  bank: rows.find((a) => a.id === c.fromAccountId)?.bank_name ?? "",
                  expenseId: c.expenseId,
                });
            }
            setNotAdded([...byDigits.values()].sort((a, b) => b.count - a.count));
          })
          .catch(() => {});
        const investmentIds = rows.filter((a) => a.account_type === "investment").map((a) => a.id);
        setInvestmentProducts(await batchInvestmentProducts(investmentIds));
      } finally {
        setLoading(false);
      }
    })();
  }, []),
  );

  const toggleIgnore = async (id: string, keep: boolean) => {
    setIgnored((prev) => {
      const next = new Set(prev);
      if (keep) next.delete(id);
      else next.add(id);
      return next;
    });
    try {
      if (keep) await keepAccount(id);
      else await ignoreAccount(id);
    } catch {
      // Leave the switch where the user put it; the account list on Settings shows the truth.
    }
  };

  const toggleOrigin = async (id: string) => {
    if (origins.has(id)) {
      setOrigins((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      return;
    }
    setOrigins((prev) => new Map(prev).set(id, null));
    const o = await getAccountOrigin(id).catch(() => null);
    setOrigins((prev) => (prev.has(id) ? new Map(prev).set(id, o) : prev));
  };

  const handleAddManually = () => {
    router.push("/settings/account-add");
  };

  const handleContinue = () => {
    router.push("/(onboarding)/budget");
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
            ? `We found ${accounts.length} account${accounts.length === 1 ? "" : "s"} in your messages. Tap one to see where it came from; switch off any you don't want Arth to track.`
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
              const resolvedType = resolvedAccountType(acct, investmentProducts);
              const sub = `${TYPE_LABEL[resolvedType] || resolvedType} • XX${acct.account_identifier}`;
              return (
                <View
                  key={acct.id}
                  className={`px-4 py-3 ${i < accounts.length - 1 ? "border-b border-border" : ""}`}
                  style={{ opacity: ignored.has(acct.id) ? 0.5 : 1 }}
                >
                  <View className="flex-row items-center">
                    <Pressable
                      onPress={() => void toggleOrigin(acct.id)}
                      className="flex-row items-center flex-1"
                      accessibilityRole="button"
                      accessibilityLabel={`${label}. Where did this come from?`}
                    >
                      <View
                        className="w-10 h-10 rounded-full items-center justify-center mr-3"
                        style={{ backgroundColor: theme.primary + "1F" }}
                      >
                        <Ionicons name={TYPE_ICON[resolvedType] || "ellipse-outline"} size={18} color={theme.primary} />
                      </View>
                      <View className="flex-1">
                        <Text className="text-base font-medium text-foreground">{label}</Text>
                        <Text className="text-xs text-muted-foreground mt-0.5">{sub}</Text>
                        <Text className="text-xs mt-0.5" style={{ color: theme.primary }}>
                          {origins.has(acct.id) ? "Hide where it came from" : "Where did this come from?"}
                        </Text>
                      </View>
                    </Pressable>
                    <View className="items-center ml-2">
                      <Switch
                        value={!ignored.has(acct.id)}
                        onValueChange={(keep) => void toggleIgnore(acct.id, keep)}
                        accessibilityLabel={`Track ${label}`}
                      />
                      <Text className="text-label text-muted-foreground">{ignored.has(acct.id) ? "Ignore" : "Track"}</Text>
                    </View>
                  </View>
                  {origins.has(acct.id) && (
                    <View className="mt-3 rounded-lg p-3" style={{ backgroundColor: theme.alpha("foreground", 0.05) }}>
                      {origins.get(acct.id) == null ? (
                        <ActivityIndicator size="small" color={theme.primary} />
                      ) : origins.get(acct.id)!.messages === 0 ? (
                        <Text className="text-xs text-muted-foreground">Added by you, not from a message.</Text>
                      ) : (
                        <>
                          <Text className="text-xs text-muted-foreground">
                            In {origins.get(acct.id)!.messages} message{origins.get(acct.id)!.messages === 1 ? "" : "s"}
                            {origins.get(acct.id)!.sender ? ` from ${origins.get(acct.id)!.sender}` : ""}
                            {origins.get(acct.id)!.first
                              ? `, ${formatDisplayDate(origins.get(acct.id)!.first!)} to ${formatDisplayDate(origins.get(acct.id)!.last!)}`
                              : ""}
                            . The first one:
                          </Text>
                          <Text className="text-xs text-foreground mt-2" style={{ fontFamily: "monospace" }} numberOfLines={6}>
                            {origins.get(acct.id)!.sample}
                          </Text>
                        </>
                      )}
                    </View>
                  )}
                  {ignored.has(acct.id) && (
                    <Text className="text-xs text-muted-foreground mt-2">
                      Ignored: its messages are skipped and what was found is in the recycle bin. Switch it back on to undo.
                    </Text>
                  )}
                </View>
              );
            })}
          </Card>
        )}

        {!loading && notAdded.length > 0 && (
          <>
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 mt-1">
              Seen in your messages, not added
            </Text>
            <Text className="text-xs text-muted-foreground mb-2 leading-5">
              Money went to these from your accounts. If one is yours, add it so those payments count as transfers, not spending.
            </Text>
            <Card className="p-0 mb-4">
              {notAdded.map((n, i) => (
                <View
                  key={n.digits}
                  className={`flex-row items-center px-4 py-3 ${i < notAdded.length - 1 ? "border-b border-border" : ""}`}
                >
                  <View className="flex-1">
                    <Text className="text-base font-medium text-foreground">
                      {n.card ? "Card" : "Account"} ··{n.digits}
                    </Text>
                    <Text className="text-xs text-muted-foreground mt-0.5">
                      {n.count} payment{n.count === 1 ? "" : "s"} to it
                    </Text>
                  </View>
                  <Button
                    title="Add"
                    variant="outline"
                    onPress={() =>
                      router.push({
                        pathname: "/settings/account-add",
                        params: {
                          presetType: n.card ? "credit_card" : "savings",
                          presetDigits: n.digits,
                          ...(n.card && n.bank ? { presetBank: n.bank } : {}),
                          transferExpenseId: n.expenseId,
                        },
                      })
                    }
                  />
                </View>
              ))}
            </Card>
          </>
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

        {!loading && accounts.length > 0 && <AiSetupOffer />}
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
