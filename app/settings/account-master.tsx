import { useState, useCallback, useMemo } from "react";
import { DEFAULT_USER_ID } from "@/constants/app";
import { View, ScrollView, Pressable } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Chip, FAB, GroupHeading, ListToolbar, ScreenContainer, Text } from "@/components/ui";
import { tint } from "@/constants/brand";
import { useListTools } from "@/hooks/use-list-tools";
import type { ListField, ListSort } from "@/utils/list-tools";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { getAllAccountsWithModes } from "@/services/account-master";
import type { AccountWithModes } from "@/services/account-master";
import { getDematAccountsWithSummary } from "@/services/financial-account";
import type { DematAccountSummary } from "@/services/financial-account";
import { consumeAccountsPreload } from "@/services/home-preload";
import { findTransferCandidates } from "@/services/transfer-detect";
import { keepAccount, listIgnoredAccounts, type IgnoredAccount } from "@/services/account-ignore";
import { findDuplicateAccounts } from "@/services/account-duplicates";
import {
  batchInvestmentProducts,
  isDematLikeAccount,
  isPensionLikeAccount,
  type InvestmentProduct,
} from "@/services/investment-accounts";
import { useTheme } from "@/hooks/use-theme";
import { LoadFailedBanner } from "@/components/ui/ListToolbar";
import { GroupSortLine } from "@/components/ui/GroupSortLine";
import { getBalanceSheetColumn } from "@/services/balance-sheet";
import { formatAmount, formatCompact } from "@/utils/format";
import { formatLocalDate } from "@/utils/fiscal-year";

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const preloaded = consumeAccountsPreload();

const ACCOUNT_TYPE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  savings: "business-outline",
  credit_card: "card-outline",
  loan: "home-outline",
  wallet: "phone-portrait-outline",
  demat: "trending-up-outline",
  pension: "shield-checkmark-outline",
  // Phase 2 unified type (account_type='investment') resolved to "fd" below
  // when valuation='contract' — a bare FD otherwise fell through to
  // account_type="investment", which isn't a key here, showing "help-outline".
  fd: "business-outline",
};

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  savings: "Savings",
  credit_card: "Credit Card",
  loan: "Loan",
  wallet: "Wallet",
  demat: "Demat",
  pension: "Pension",
  fd: "Deposit",
};

const ACCOUNT_SORTS: ListSort<AccountWithModes>[] = [
  { id: "default", label: "As listed" },
  { id: "name", label: "Name (A–Z)", compare: (a, b) => (a.account.account_label ?? a.account.bank_name).localeCompare(b.account.account_label ?? b.account.bank_name) },
  { id: "bank", label: "Bank (A–Z)", compare: (a, b) => a.account.bank_name.localeCompare(b.account.bank_name) },
];
const accountSearch = ({ account: a }: AccountWithModes) => ({
  texts: [a.bank_name, a.account_identifier, a.account_label, a.account_number, a.account_type],
});

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
  const [investmentProducts, setInvestmentProducts] = useState<Map<string, InvestmentProduct>>(new Map());
  /** Each account's balance today (what it holds, or what you owe on it), from the Net worth sum. */
  const [balances, setBalances] = useState<Map<string, number>>(new Map());

  /** "demat"/"pension"/"fd" resolved through the Phase-2 alias, else the raw account_type. */
  const resolvedType = useCallback(
    (account: { id: string; account_type: string }): string => {
      const product = investmentProducts.get(account.id);
      if (isDematLikeAccount(account, product)) return "demat";
      if (isPensionLikeAccount(account, product)) return "pension";
      if (account.account_type === "investment" && product?.valuation === "contract") return "fd";
      return account.account_type;
    },
    [investmentProducts],
  );

  const [loadFailed, setLoadFailed] = useState(false);
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

      // Phase 2 (docs/INVESTMENT_ACCOUNTS_PROPOSAL.md section 4) — needed to
      // tell a converted demat/pension account apart from a plain FD when
      // filtering/labeling by type below (all three share account_type='investment').
      const investmentIds = accts.filter((a) => a.account.account_type === "investment").map((a) => a.account.id);
      setInvestmentProducts(await batchInvestmentProducts(investmentIds));
      setLoadFailed(false);
      // Balances are extra: a failure leaves the rows without them, never the list empty.
      try {
        const col = await getBalanceSheetColumn(DEFAULT_USER_ID, formatLocalDate(new Date()), "Today", true, null);
        const m = new Map<string, number>();
        const add = (id: string | undefined, v: number) => {
          if (id) m.set(id, (m.get(id) ?? 0) + v);
        };
        for (const r of col.assets) {
          add(r.accountId, r.amount);
          for (const c of r.children ?? []) add(c.accountId, c.amount);
        }
        for (const r of col.liabilities) add(r.accountId, r.amount);
        setBalances(m);
      } catch (e) {
        console.warn("[accounts] balances failed", e);
      }
    } catch {
      setLoadFailed(true);
      // Database not ready
    }
  }, []);

  // Same card or A/c recorded twice - offered for merging at the top of the list.
  const [duplicateGroups, setDuplicateGroups] = useState(0);
  // Payments counted as spending that went to one of your own accounts or cards.
  const [transferFixes, setTransferFixes] = useState(0);
  const [ignoredAccounts, setIgnoredAccounts] = useState<IgnoredAccount[]>([]);
  useFocusEffect(
    useCallback(() => {
      loadData();
      findDuplicateAccounts()
        .then((g) => setDuplicateGroups(g.length))
        .catch(() => setDuplicateGroups(0));
      listIgnoredAccounts()
        .then(setIgnoredAccounts)
        .catch(() => setIgnoredAccounts([]));
      findTransferCandidates(DEFAULT_USER_ID)
        .then((c) => setTransferFixes(c.length))
        .catch(() => setTransferFixes(0));
    }, [loadData]),
  );

  const accountFields = useMemo<ListField<AccountWithModes>[]>(
    () => [
      {
        id: "type",
        label: "Type",
        keyOf: (item) => resolvedType(item.account),
        labelOf: (k) => ACCOUNT_TYPE_LABELS[k] ?? k,
        group: true,
        filter: true,
      },
      { id: "bank", label: "Bank", keyOf: (item) => item.account.bank_name, group: true, filter: true, searchable: true },
    ],
    [resolvedType],
  );
  const tools = useListTools<AccountWithModes>({
    screen: "account_master",
    noun: { one: "account", many: "accounts" },
    rows: accounts,
    fields: accountFields,
    search: accountSearch,
    searchPlaceholder: "Search accounts",
    sorts: ACCOUNT_SORTS,
  });
  const filteredAccounts = tools.rows;

  const renderAccount = (item: AccountWithModes, divider = false) => {
    const { account, linkedModes } = item;
    // dematSummaries is already the alias-aware set (getDematAccountsWithSummary
    // includes Phase-2-converted investment+valuation='market' accounts too —
    // see docs/INVESTMENT_ACCOUNTS_PROPOSAL.md section 4), so membership here
    // is a cheap, correct stand-in for a fresh account_type check.
    const isDemat = dematSummaries.has(account.id);

    const displayName =
      account.account_label ??
      (isDemat
        ? account.bank_name
        : `${account.bank_name} ****${account.account_identifier}`);

    const typeLabel =
      ACCOUNT_TYPE_LABELS[resolvedType(account)] ?? account.account_type;

    // Type shows only when the list isn't grouped by type; the bank when the name doesn't say it.
    const subtitleParts: string[] = [];
    if (tools.groupBy !== "type") subtitleParts.push(typeLabel);
    if (account.account_label && account.account_type !== "wallet" && !isDemat) subtitleParts.push(account.bank_name);
    const bal = balances.get(account.id);
    const typeNow = resolvedType(account);
    if (account.closed_at) {
      const d = new Date(account.closed_at);
      subtitleParts.push(isNaN(d.getTime()) ? "Closed" : `Closed ${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`);
    } else if (typeNow === "credit_card") {
      subtitleParts.push(bal != null && bal >= 1 ? `Owes ${formatAmount(Math.round(bal))}` : "Nothing due");
    } else if (typeNow === "loan") {
      if (bal != null && bal >= 1) subtitleParts.push(`₹${formatCompact(bal)} left`);
    } else if (bal != null) {
      subtitleParts.push(formatAmount(Math.round(bal)));
    } else if (isDemat) {
      const dematInfo = dematSummaries.get(account.id);
      subtitleParts.push(dematInfo && dematInfo.snapshotCount > 0 ? `${dematInfo.snapshotCount} snapshot${dematInfo.snapshotCount !== 1 ? "s" : ""}` : "No snapshot yet");
    }
    if (linkedModes.length > 0) {
      subtitleParts.push(`${linkedModes.length} mode${linkedModes.length !== 1 ? "s" : ""}`);
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

    const typeKey = resolvedType(account);
    const color = theme.data.accountType[typeKey] ?? theme.data.series[3];
    return (
      <Pressable
        key={account.id}
        onPress={handleTap}
        className={`flex-row items-center px-3.5 ${divider ? "border-t border-border" : ""}`}
        style={{ minHeight: 64, gap: 12, opacity: account.closed_at ? 0.7 : 1 }}
        accessibilityRole="button"
        accessibilityLabel={`${displayName}, ${account.closed_at ? "closed" : "open"}`}
      >
        <View className="w-9 h-9 rounded-control items-center justify-center" style={{ backgroundColor: tint(color, 0.1) }}>
          <Ionicons name={ACCOUNT_TYPE_ICONS[typeKey] ?? "help-outline"} size={17} color={color} />
        </View>
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Text className="text-body font-semibold text-foreground" numberOfLines={1}>
            {displayName}
          </Text>
          <Text className="text-meta text-muted-foreground" numberOfLines={1}>
            {account.account_type === "loan" ? ["Opens loan details", ...subtitleParts].join(" · ") : subtitleParts.join(" · ")}
          </Text>
        </View>
        {/* Open or closed at a glance. */}
        <Chip variant="status" className="self-center" tone={account.closed_at ? "neutral" : "success"} label={account.closed_at ? "Closed" : "Open"} />
      </Pressable>
    );
  };

  const isEmpty = filteredAccounts.length === 0;

  // One card per group: the rows between two headings sit together.
  const blocks: { heading: (typeof tools.grouped)[number] | null; rows: AccountWithModes[] }[] = [];
  for (const row of tools.grouped) {
    if (row.type === "heading") blocks.push({ heading: row, rows: [] });
    else {
      if (blocks.length === 0) blocks.push({ heading: null, rows: [] });
      blocks[blocks.length - 1].rows.push(row.item);
    }
  }

  const banner = (icon: keyof typeof Ionicons.glyphMap, fg: string, bg: string, title: string, sub: string, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      className="flex-row items-center rounded-card px-3.5 py-3 mb-3"
      style={{ backgroundColor: bg, gap: 12 }}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${sub}`}
    >
      <Ionicons name={icon} size={20} color={fg} />
      <View className="flex-1">
        <Text className="text-body font-semibold text-foreground">{title}</Text>
        <Text className="text-meta text-muted-foreground">{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
    </Pressable>
  );

  return (
    <ScreenContainer padTop={false}>
      {loadFailed && <LoadFailedBanner onRetry={loadData} />}
      <View className="flex-1">
        <ListToolbar {...tools.toolbar} />
        <GroupSortLine group={tools.groupChoice} sort={tools.sortChoice} />
        {tools.filterSheet}
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 96, paddingHorizontal: 16, paddingTop: 4 }}>
          {duplicateGroups > 0 &&
            banner(
              "copy-outline",
              theme.warning,
              theme.alpha("warning", 0.08),
              `${duplicateGroups} account${duplicateGroups === 1 ? " looks" : "s look"} recorded twice`,
              "Same bank and last digits · review and merge",
              () => router.push("/settings/duplicate-accounts"),
            )}
          {transferFixes > 0 &&
            banner(
              "swap-horizontal-outline",
              theme.data.transfer,
              tint(theme.data.transfer, 0.08),
              `${transferFixes} payment${transferFixes === 1 ? "" : "s"} between your accounts counted as spending`,
              "Make them transfers",
              () => router.push("/settings/transfer-review"),
            )}


          {isEmpty ? (
            <View className="items-center py-16">
              <Ionicons name="business-outline" size={48} color={theme.faintForeground} />
              <Text className="text-heading font-semibold text-foreground mt-4">{accounts.length > 0 ? "Nothing matches" : "No accounts yet"}</Text>
              <Text className="text-meta text-muted-foreground mt-1 text-center px-8">
                {accounts.length > 0
                  ? "Try another search or filter."
                  : "Tap + Account to add one. Supports savings, credit cards, loans, wallets, and demat accounts."}
              </Text>
            </View>
          ) : (
            blocks.map((b, bi) => (
              <View key={b.heading && b.heading.type === "heading" ? `g-${b.heading.key}` : `b-${bi}`} className="mb-3">
                {b.heading && b.heading.type === "heading" && (
                  <GroupHeading
                    label={b.heading.label}
                    count={b.heading.count}
                    total={0}
                    inset={false}
                    open={b.heading.open}
                    onToggle={b.heading.onToggle}
                    noun={b.heading.noun}
                  />
                )}
                {b.rows.length > 0 && (
                  <View className="rounded-card bg-card border border-border overflow-hidden">{b.rows.map((r, i) => renderAccount(r, i > 0))}</View>
                )}
              </View>
            ))
          )}

          {ignoredAccounts.length > 0 && (
            <View className="mt-1">
              <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-2">Ignored · {ignoredAccounts.length}</Text>
              <View className="rounded-card bg-card border border-border overflow-hidden">
                {ignoredAccounts.map((a, i) => (
                  <View key={a.id} className={`flex-row items-center px-3.5 ${i > 0 ? "border-t border-border" : ""}`} style={{ minHeight: 60, gap: 12 }}>
                    <View className="flex-1">
                      <Text className="text-body font-semibold text-foreground">
                        {a.name} ····{a.digits.slice(-4)}
                      </Text>
                      <Text className="text-meta text-muted-foreground">Its messages are skipped</Text>
                    </View>
                    <Chip
                      label="Track again"
                      on
                      onPress={async () => {
                        await keepAccount(a.id);
                        setIgnoredAccounts((list) => list.filter((x) => x.id !== a.id));
                        loadData();
                      }}
                    />
                  </View>
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      </View>

      <FAB icon="add" label="Account" onPress={() => router.push("/settings/account-add")} accessibilityLabel="Add new account" />
    </ScreenContainer>
  );
}
