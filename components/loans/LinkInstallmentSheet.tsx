import { useCallback, useEffect, useMemo, useState } from "react";

import { Sheet, Text } from "@/components/ui";
import { ActivityIndicator, FlatList,  Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useRouter } from "expo-router";

import { formatAmount } from "@/utils/format";
import {
  getLinkableExpenses,
  linkExpenseToInstallment,
  unlinkExpenseFromInstallment,
  type LoanScheduleEntry,
} from "@/services/loan-accounts";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";

interface Candidate {
  id: string;
  date: string;
  amount: number;
  description: string | null;
  merchant: string | null;
}

interface Props {
  visible: boolean;
  installment: LoanScheduleEntry | null;
  onClose: () => void;
  onLinked: () => void;
}

function prettyDate(ymd: string): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function LinkInstallmentSheet({ visible, installment, onClose, onLinked }: Props) {
  const { colors } = useColorScheme();
  const theme = useTheme();
  const router = useRouter();

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (visible) {
      setSearchQuery("");

    }
  }, [visible]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const loadCandidates = useCallback(async () => {
    if (!installment) return;
    setLoading(true);
    try {
      const rows = await getLinkableExpenses(
        DEFAULT_USER_ID,
        installment.emi_amount,
        installment.due_date,
        60,
      );
      setCandidates(rows);
    } finally {
      setLoading(false);
    }
  }, [installment]);

  useEffect(() => {
    if (visible && installment && installment.status !== "paid" && installment.status !== "prepaid") {
      void loadCandidates();
    }
  }, [visible, installment, loadCandidates]);



  const query = searchQuery.toLowerCase().trim();
  const filtered = useMemo(() => {
    if (!query) return candidates;
    return candidates.filter(
      (c) =>
        (c.merchant ?? "").toLowerCase().includes(query) ||
        (c.description ?? "").toLowerCase().includes(query) ||
        String(c.amount).includes(query),
    );
  }, [candidates, query]);

  if (!visible || !installment) return null;

  const isPaid = installment.status === "paid" || installment.status === "prepaid";

  const handleLink = async (expenseId: string) => {
    if (working) return;
    setWorking(true);
    try {
      await linkExpenseToInstallment(installment.id, expenseId);
      onLinked();
      handleClose();
    } finally {
      setWorking(false);
    }
  };

  const handleUnlink = async () => {
    if (working) return;
    setWorking(true);
    try {
      await unlinkExpenseFromInstallment(installment.id);
      onLinked();
      handleClose();
    } finally {
      setWorking(false);
    }
  };

  const renderCandidate = ({ item: c }: { item: Candidate }) => (
    <Pressable
      onPress={() => handleLink(c.id)}
      className="flex-row items-center py-2.5 px-3 rounded-lg mb-1.5"
      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
    >
      <View className="flex-1">
        <Text className="text-sm font-semibold" style={{ color: colors.text }} numberOfLines={1}>
          {c.merchant || c.description || "Transaction"}
        </Text>
        <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }}>
          {prettyDate(c.date)}
        </Text>
      </View>
      <Text className="text-sm font-bold ml-2" style={{ color: colors.text }}>
        {formatAmount(c.amount)}
      </Text>
    </Pressable>
  );

  return (
    <Sheet visible={visible} onClose={handleClose}>
      <View className="px-5 pb-3">
        <Text className="text-base font-bold" style={{ color: colors.text }}>
          Installment #{installment.installment_num}
        </Text>
        <Text className="text-sm mt-0.5" style={{ color: colors.textSecondary }}>
          {formatAmount(installment.emi_amount)} due {prettyDate(installment.due_date)}
        </Text>
      </View>

      {isPaid ? (
        <View className="px-5 pb-4">
          <View
            className="flex-row items-center px-3 py-3 rounded-xl mb-3"
            style={{ backgroundColor: theme.alpha("primary", 0.1), borderWidth: 1, borderColor: theme.alpha("primary", 0.2) }}
          >
            <Ionicons name="checkmark-circle" size={18} color={theme.primary} />
            <View className="flex-1 ml-2">
              <Text className="text-sm" style={{ color: colors.text }}>
                Paid {installment.paid_amount != null ? formatAmount(installment.paid_amount) : ""}
                {installment.paid_date ? ` on ${prettyDate(installment.paid_date)}` : ""}
              </Text>
              {installment.linked_expense_id && (
                <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }}>
                  Linked to a transaction in your ledger
                </Text>
              )}
            </View>
          </View>
          {installment.linked_expense_id && (
            <Pressable
              onPress={() => {
                handleClose();
                setTimeout(() => {
                  router.push({
                    pathname: "/expense/[id]",
                    params: { id: installment.linked_expense_id! },
                  } as never);
                }, 220);
              }}
              className="flex-row items-center justify-center py-3 rounded-xl mb-2"
              style={{ backgroundColor: theme.primary }}
            >
              <Ionicons name="receipt-outline" size={18} color="#FFFFFF" />
              <Text className="text-sm font-semibold ml-2" style={{ color: "#FFFFFF" }}>
                View expense
              </Text>
            </Pressable>
          )}
          <Pressable
            onPress={handleUnlink}
            disabled={working}
            className="flex-row items-center justify-center py-3 rounded-xl"
            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: theme.danger }}
          >
            <Ionicons name="unlink-outline" size={18} color={theme.danger} />
            <Text className="text-sm font-semibold ml-2" style={{ color: theme.danger }}>
              Unlink
            </Text>
          </Pressable>
          <Text className="text-xs mt-2" style={{ color: colors.textSecondary }}>
            Unlinking will mark this installment as scheduled. Any auto-created prepayment from over-payment will remain - delete it manually if needed.
          </Text>
        </View>
      ) : (
        <View className="px-5 pb-4">
          <View className="flex-row items-center mb-2 border rounded-lg px-3 py-2" style={{ borderColor: colors.border }}>
            <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search by merchant, description, amount..."
              placeholderTextColor={colors.textSecondary}
              className="flex-1 ml-2 text-sm text-foreground"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <Pressable onPress={() => setSearchQuery("")} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
              </Pressable>
            )}
          </View>
          <Text className="text-label mb-1.5" style={{ color: colors.textSecondary }}>
            Showing realized expenses ±60 days from due date, not linked to any loan ({filtered.length}{query ? ` of ${candidates.length}` : ""})
          </Text>

          {loading ? (
            <View className="items-center py-6">
              <ActivityIndicator color={colors.textSecondary} />
            </View>
          ) : filtered.length === 0 ? (
            <Text className="text-sm py-4" style={{ color: colors.textSecondary }}>
              {query ? "No transactions match your search." : "No matching expenses found in the last 60 days."}
            </Text>
          ) : (
            <FlatList
              initialNumToRender={12}
              maxToRenderPerBatch={10}
              windowSize={7}
              data={filtered}
              keyExtractor={(item) => item.id}
              renderItem={renderCandidate}
              style={{ maxHeight: 360 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            />
          )}
        </View>
      )}
    </Sheet>
  );
}
