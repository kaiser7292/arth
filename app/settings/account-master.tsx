import { useState, useCallback, useMemo } from "react";
import { DEFAULT_USER_ID } from "@/constants/app";
import { View, ScrollView, Pressable, TextInput } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card, FAB, FilterChip, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { getAllAccountsWithModes } from "@/services/account-master";
import type { AccountWithModes } from "@/services/account-master";
import { getDematAccountsWithSummary } from "@/services/financial-account";
import type { DematAccountSummary } from "@/services/financial-account";
import { consumeAccountsPreload } from "@/services/home-preload";
import { useTheme } from "@/hooks/use-theme";

const preloaded = consumeAccountsPreload();

const ACCOUNT_TYPE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  savings: "wallet-outline",
  credit_card: "card-outline",
  loan: "document-text-outline",
  wallet: "phone-portrait-outline",
  demat: "trending-up-outline",
  pension: "briefcase-outline",
};

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  savings: "Savings",
  credit_card: "Credit Card",
  loan: "Loan",
  wallet: "Wallet",
  demat: "Demat",
  pension: "Pension",
};

type TypeFilter = "all" | "savings" | "credit_card" | "loan" | "wallet" | "demat" | "pension";

const TYPE_FILTERS: Array<{ key: TypeFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "savings", label: "Savings" },
  { key: "credit_card", label: "Credit Card" },
  { key: "loan", label: "Loan" },
  { key: "wallet", label: "Wallet" },
  { key: "demat", label: "Demat" },
  { key: "pension", label: "Pension" },
];

export default function AccountMasterScreen() {
  const router = useRouter();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [accounts, setAccounts] = useState<AccountWithModes[]>(preloaded?.accounts ?? []);
  const [dematSummaries, setDematSummaries] = useState<Map<string, DematAccountSummary>>(() => {
    const m = new Map<string, DematAccountSummary>();
    if (preloaded) for (const d of preloaded.dematSummaries) m.set(d.account.id, d);
    return m;
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  const loadData = useCallback(async () => {
    try {
      const [accts, demats] = await Promise.all([
        getAllAccountsWithModes(DEFAULT_USER_ID),
        getDematAccountsWithSummary(DEFAULT_USER_ID),
      ]);
      setAccounts(accts);
      // Build a lookup for demat snapshot info by account ID
      const dematMap = new Map<string, DematAccountSummary>();
      for (const d of demats) {
        dematMap.set(d.account.id, d);
      }
      setDematSummaries(dematMap);
    } catch {
      // Database not ready
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const filteredAccounts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return accounts.filter((item) => {
      const a = item.account;
      if (typeFilter !== "all" && a.account_type !== typeFilter) return false;
      if (!q) return true;
      return (
        a.bank_name.toLowerCase().includes(q) ||
        a.account_identifier.includes(q) ||
        (a.account_label ?? "").toLowerCase().includes(q) ||
        (a.account_number ?? "").toLowerCase().includes(q) ||
        a.account_type.toLowerCase().includes(q)
      );
    });
  }, [accounts, searchQuery, typeFilter]);

  const renderAccount = (item: AccountWithModes) => {
    const { account, linkedModes } = item;
    const isDemat = account.account_type === "demat";

    const displayName =
      account.account_label ??
      (isDemat
        ? account.bank_name
        : `${account.bank_name} ****${account.account_identifier}`);

    const typeLabel =
      ACCOUNT_TYPE_LABELS[account.account_type] ?? account.account_type;

    const subtitleParts = [typeLabel];
    if (isDemat) {
      if (account.account_number) subtitleParts.push(account.account_number);
      const dematInfo = dematSummaries.get(account.id);
      if (dematInfo && dematInfo.snapshotCount > 0) {
        subtitleParts.push(
          `${dematInfo.snapshotCount} snapshot${dematInfo.snapshotCount !== 1 ? "s" : ""}`,
        );
      }
    } else if (account.account_type !== "wallet") {
      subtitleParts.push(`${account.bank_name} ****${account.account_identifier}`);
    }
    if (linkedModes.length > 0) {
      subtitleParts.push(
        `${linkedModes.length} mode${linkedModes.length !== 1 ? "s" : ""}`,
      );
    }

    const handleTap = async () => {
      // v17.4.0 — loan accounts route to /loans/[id] when a loan_accounts row exists.
      if (account.account_type === "loan") {
        try {
          const { getLoanByFinancialAccountId } = await import("@/services/loan-accounts");
          const loan = await getLoanByFinancialAccountId(account.id);
          if (loan) {
            router.push({ pathname: "/loans/[id]", params: { id: loan.id } });
            return;
          }
        } catch {
          // Fall through to generic account detail
        }
      }
      router.push({
        pathname: "/settings/account-detail",
        params: { accountId: account.id },
      });
    };

    return (
      <Pressable
        key={account.id}
        onPress={handleTap}
        className="mb-2"
      >
        <Card>
          <View className="flex-row items-center">
            <View
              className="w-10 h-10 rounded-full items-center justify-center mr-3"
              style={{ backgroundColor: theme.alpha("primary", 0.08) }}
            >
              <Ionicons
                name={ACCOUNT_TYPE_ICONS[account.account_type] ?? "help-outline"}
                size={20}
                color={colors.blue}
              />
            </View>
            <View className="flex-1 mr-2">
              <Text
                className="text-sm font-semibold text-foreground"
                numberOfLines={1}
              >
                {displayName}
              </Text>
              <Text className="text-xs text-muted-foreground mt-0.5">
                {subtitleParts.join(" · ")}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </View>
        </Card>
      </Pressable>
    );
  };

  const isEmpty = filteredAccounts.length === 0;

  return (
    <ScreenContainer padTop={false}>
      <View className="px-4 flex-1">
      {/* Info card */}
      <Card className="mb-3">
        <View className="flex-row items-center">
          <Ionicons
            name="information-circle-outline"
            size={18}
            color={colors.textSecondary}
          />
          <Text className="text-xs text-muted-foreground ml-2 flex-1">
            Tap an account to view details, edit financial data, and manage
            linked payment modes.
          </Text>
        </View>
      </Card>

      {/* Type filter chips */}
      <View className="mb-3">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingRight: 4, alignItems: "center" }}
        >
          {TYPE_FILTERS.map((f) => (
            <FilterChip
              key={f.key}
              label={f.label}
              active={typeFilter === f.key}
              onPress={() => setTypeFilter(f.key)}
            />
          ))}
        </ScrollView>
      </View>

      {/* Search bar */}
      <View className="flex-row items-center border border-border rounded-lg px-3 py-2 mb-3">
        <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search accounts..."
          placeholderTextColor={colors.textSecondary}
          maxLength={100}
          className="flex-1 ml-2 text-base text-foreground"
        />
        {searchQuery.length > 0 && (
          <Pressable onPress={() => setSearchQuery("")}>
            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>

      {/* Count */}
      <Text className="text-sm text-muted-foreground px-1 mb-2">
        {filteredAccounts.length}
        {filteredAccounts.length !== accounts.length ? ` of ${accounts.length}` : ""}
        {" "}
        {filteredAccounts.length === 1 ? "account" : "accounts"}
      </Text>

      {/* Account list */}
      {isEmpty ? (
        <View className="items-center py-16">
          <Ionicons name="business-outline" size={48} color={colors.textSecondary} />
          <Text className="text-lg font-medium text-foreground mt-4">
            No accounts yet
          </Text>
          <Text className="text-sm text-muted-foreground mt-1 text-center px-8">
            Tap + to add an account. Supports savings, credit cards, loans,
            wallets, and demat accounts.
          </Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 80 }}
        >
          {filteredAccounts.map((item) => renderAccount(item))}
        </ScrollView>
      )}
      </View>

      {/* FAB — Add Account */}
      <FAB
        icon="add"
        onPress={() => router.push("/settings/account-add")}
        accessibilityLabel="Add new account"
      />
    </ScreenContainer>
  );
}
