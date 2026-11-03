import { Modal, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, Text } from "@/components/ui";
import { Avatar } from "@/components/household/HouseholdBits";
import { useTheme } from "@/hooks/use-theme";
import { formatAmount, formatDateForDisplay } from "@/utils/expense-validation";
import type { CategoryLook } from "@/services/household/category-look";
import type { StatementRow } from "@/services/household/statement";

const SPLIT_LABEL: Record<string, string> = { equal: "split equally", payer_all: "shared, paid in full", custom: "custom split" };

/**
 * One household transaction, laid out like a row in Transactions: category icon, title and details,
 * amount and date. The line under the details says what it means between you ("you owe ₹1,150").
 * Your own rows open their transaction; anyone else's show the read-only view.
 */
export function StatementRowItem({
  row,
  myMemberId,
  category,
  onView,
}: {
  row: StatementRow;
  myMemberId: string | null;
  category?: CategoryLook | null;
  onView: (row: StatementRow) => void;
}) {
  const router = useRouter();
  const theme = useTheme();
  const { relation: rel } = row;
  const isSettle = rel.kind === "settle";
  const tint = category?.color ?? theme.mutedForeground;
  // It may have come from another phone, so only an icon this build has.
  const own = category && category.icon in Ionicons.glyphMap ? (category.icon as keyof typeof Ionicons.glyphMap) : "receipt-outline";
  const icon = isSettle ? "swap-horizontal-outline" : own;
  const details = [
    row.member.id === myMemberId ? "You" : row.member.name,
    isSettle ? "Settle-up" : rel.kind === "personal" ? "personal" : SPLIT_LABEL[row.split ?? "equal"],
  ].join(" · ");

  return (
    <Pressable
      onPress={() => (row.expenseId ? router.push(`/expense/${row.expenseId}`) : onView(row))}
      accessibilityRole="button"
      className="flex-row items-center px-4 py-3.5 border-b border-border"
    >
      <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: tint + "14" }}>
        <Ionicons name={icon} size={20} color={tint} />
      </View>
      <View className="flex-1 mr-3">
        <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>{row.merchant || row.category || "Shared"}</Text>
        <View className="flex-row items-center mt-0.5">
          <Avatar member={row.member} size={16} />
          <Text className="text-xs text-muted-foreground ml-1.5 shrink" numberOfLines={1}>{details}</Text>
        </View>
        {rel.kind === "you_owe" && (
          <Text className="text-label mt-0.5" numberOfLines={1} style={{ color: theme.danger }}>You owe {formatAmount(rel.amount)}</Text>
        )}
        {rel.kind === "owes_you" && (
          <Text className="text-label mt-0.5" numberOfLines={1} style={{ color: theme.primary }}>{rel.with} owes {formatAmount(rel.amount)}</Text>
        )}
      </View>
      <View className="items-end shrink-0">
        <Text className="text-sm font-bold text-foreground">{formatAmount(row.paid)}</Text>
        <Text className="text-xs text-muted-foreground mt-0.5">{formatDateForDisplay(row.date)}</Text>
      </View>
    </Pressable>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-2 border-b border-border">
      <Text className="text-sm text-muted-foreground mr-3">{label}</Text>
      <Text className="text-sm text-foreground flex-1 text-right">{value}</Text>
    </View>
  );
}

/** A household transaction that isn't yours: everything that was shared, nothing to change. */
export function StatementRowDetail({ row, myMemberId, onClose }: { row: StatementRow | null; myMemberId: string | null; onClose: () => void }) {
  const theme = useTheme();
  const isSettle = row?.relation.kind === "settle";
  return (
    <Modal visible={row !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "center", paddingHorizontal: 16 }}
      >
        <Pressable onPress={() => {}}>
          {row && (
            <Card>
              <Text className="text-base font-semibold text-foreground" numberOfLines={2}>{row.merchant || row.category || "Shared"}</Text>
              <Text className="text-2xl font-bold text-foreground mt-1 mb-2">{formatAmount(row.paid)}</Text>
              <Detail label="Date" value={formatDateForDisplay(row.date)} />
              <Detail label={isSettle ? "From" : "Paid by"} value={row.member.id === myMemberId ? "You" : row.member.name} />
              {row.category && <Detail label="Category" value={row.category} />}
              <Detail label="Type" value={isSettle ? "Settle-up" : row.relation.kind === "personal" ? "Personal" : SPLIT_LABEL[row.split ?? "equal"]} />
              {row.shares.map((share) => (
                <Detail key={share.name} label={share.name === "You" ? "You owe" : `${share.name} owes`} value={formatAmount(share.amount)} />
              ))}
              <Text className="text-xs text-muted-foreground mt-3">
                Only the person who added this can change it.
              </Text>
              <Pressable onPress={onClose} className="mt-3 py-2.5 rounded-lg items-center border border-border" accessibilityRole="button">
                <Text className="text-sm font-semibold" style={{ color: theme.primary }}>Close</Text>
              </Pressable>
            </Card>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
