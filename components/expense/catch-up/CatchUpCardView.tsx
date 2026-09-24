import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Card, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import type { Category } from "@/services/category";
import type { CatchUpCard } from "@/services/catch-up";
import { splitDuplicateGroup } from "@/services/catch-up";
import type { Expense } from "@/services/expense";
import type { FinancialAccount } from "@/services/financial-account";
import { formatDateForDisplay } from "@/utils/expense-validation";
import { formatAmount } from "@/utils/format";

interface CatchUpCardViewProps {
  card: CatchUpCard;
  categoryMap: Map<string, Category>;
  accountMap: Map<string, FinancialAccount>;
  /** Category the card will apply on a right swipe (pending / uncategorized only). */
  categoryId: string | null;
  onPickCategory: () => void;
  onOpen: (expenseId: string) => void;
}

function accountText(accountMap: Map<string, FinancialAccount>, id: string | null): string | null {
  if (!id) return null;
  const a = accountMap.get(id);
  if (!a) return null;
  const tail = a.account_identifier ? ` ••${a.account_identifier.slice(-4)}` : "";
  return `${a.account_label || a.bank_name}${tail}`;
}

function title(e: Expense): string {
  return e.merchant_name || e.description || "Bank transaction";
}

const KIND_META: Record<CatchUpCard["kind"], { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  pending: { label: "New transaction", icon: "chatbubble-outline" },
  match: { label: "Matches a forecast", icon: "git-compare-outline" },
  duplicate: { label: "Possible duplicate", icon: "copy-outline" },
  uncategorized: { label: "Needs a category", icon: "help-circle-outline" },
};

export function CatchUpCardView({
  card,
  categoryMap,
  accountMap,
  categoryId,
  onPickCategory,
  onOpen,
}: CatchUpCardViewProps) {
  const theme = useTheme();
  const meta = KIND_META[card.kind];
  const isCredit = (card.kind === "pending" || card.kind === "uncategorized") && card.expense.nature === "credit";
  const kindLabel = card.kind === "pending" && isCredit ? "Money received" : meta.label;

  return (
    <Card className="flex-1 mx-4 py-5">
      <View className="flex-row items-center justify-center mb-4">
        <Ionicons name={meta.icon} size={14} color={theme.mutedForeground} />
        <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground ml-1.5">
          {kindLabel}
        </Text>
      </View>

      {(card.kind === "pending" || card.kind === "uncategorized") && (
        <SingleExpenseBody
          expense={card.expense}
          isCredit={isCredit}
          categoryMap={categoryMap}
          accountMap={accountMap}
          categoryId={categoryId}
          onPickCategory={onPickCategory}
          onOpen={onOpen}
        />
      )}

      {card.kind === "match" && <MatchBody card={card} accountMap={accountMap} />}

      {card.kind === "duplicate" && <DuplicateBody card={card} accountMap={accountMap} />}
    </Card>
  );
}

function SingleExpenseBody({
  expense,
  isCredit,
  categoryMap,
  accountMap,
  categoryId,
  onPickCategory,
  onOpen,
}: {
  expense: Expense;
  isCredit: boolean;
  categoryMap: Map<string, Category>;
  accountMap: Map<string, FinancialAccount>;
  categoryId: string | null;
  onPickCategory: () => void;
  onOpen: (id: string) => void;
}) {
  const theme = useTheme();
  const [showSms, setShowSms] = useState(false);
  const category = categoryId ? categoryMap.get(categoryId) : undefined;
  const account = accountText(accountMap, expense.account_id);

  return (
    <View className="flex-1">
      <Pressable onPress={() => onOpen(expense.id)} accessibilityRole="button" accessibilityLabel="Open full details">
        <Text
          className="text-center font-bold"
          style={{ fontSize: 36, lineHeight: 44, color: isCredit ? theme.success : theme.foreground }}
        >
          {isCredit ? "+" : ""}{formatAmount(expense.amount)}
        </Text>
        <Text className="text-lg font-semibold text-foreground text-center mt-1" numberOfLines={2}>
          {title(expense)}
        </Text>
        <Text className="text-sm text-muted-foreground text-center mt-1">
          {[account, formatDateForDisplay(expense.date)].filter(Boolean).join(" · ")}
        </Text>
      </Pressable>

      {!isCredit && (
        <Pressable
          onPress={onPickCategory}
          className="flex-row items-center self-center mt-5 px-4 py-2 rounded-full border"
          style={{
            borderColor: category ? category.color : theme.border,
            backgroundColor: category ? category.color + "14" : "transparent",
          }}
          accessibilityRole="button"
          accessibilityLabel={category ? `Category ${category.name}, tap to change` : "Choose a category"}
        >
          <Ionicons
            name={(category?.icon as keyof typeof Ionicons.glyphMap) ?? "pricetag-outline"}
            size={16}
            color={category?.color ?? theme.mutedForeground}
          />
          <Text
            className="text-sm font-semibold ml-1.5"
            style={{ color: category?.color ?? theme.mutedForeground }}
          >
            {category?.name ?? "Choose category"}
          </Text>
          <Ionicons name="chevron-down" size={14} color={category?.color ?? theme.mutedForeground} style={{ marginLeft: 4 }} />
        </Pressable>
      )}

      <Pressable onPress={() => onOpen(expense.id)} className="self-center mt-3 py-1" hitSlop={6}>
        <Text className="text-xs font-semibold" style={{ color: theme.primary }}>
          Split · Tags · Note · Edit
        </Text>
      </Pressable>

      {expense.raw_source_text ? (
        <View className="mt-4 flex-1">
          <Pressable onPress={() => setShowSms((v) => !v)} className="flex-row items-center py-1">
            <Ionicons name={showSms ? "chevron-down" : "chevron-forward"} size={14} color={theme.mutedForeground} />
            <Text className="text-xs font-semibold text-muted-foreground ml-1">
              {showSms ? "Hide original SMS" : "Show original SMS"}
            </Text>
          </Pressable>
          {showSms && (
            <ScrollView className="mt-2 rounded-lg px-3 py-2" style={{ backgroundColor: theme.alpha("foreground", 0.04), maxHeight: 160 }}>
              <Text className="text-xs text-muted-foreground">{expense.raw_source_text}</Text>
            </ScrollView>
          )}
        </View>
      ) : null}
    </View>
  );
}

function MiniRow({
  expense,
  label,
  labelColor,
  accountMap,
}: {
  expense: Expense;
  label: string;
  labelColor: string;
  accountMap: Map<string, FinancialAccount>;
}) {
  const theme = useTheme();
  const date = expense.nature === "forecast" && expense.due_date ? `Due ${formatDateForDisplay(expense.due_date)}` : formatDateForDisplay(expense.date);
  const account = accountText(accountMap, expense.account_id);
  return (
    <View className="rounded-xl px-4 py-3 mb-2" style={{ backgroundColor: theme.alpha("foreground", 0.04) }}>
      <Text className="text-label font-bold uppercase" style={{ color: labelColor }}>{label}</Text>
      <View className="flex-row items-center justify-between mt-1">
        <View className="flex-1 mr-3">
          <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>{title(expense)}</Text>
          <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={1}>
            {[account, date].filter(Boolean).join(" · ")}
          </Text>
        </View>
        <Text className="text-base font-bold text-foreground">{formatAmount(expense.amount)}</Text>
      </View>
    </View>
  );
}

function MatchBody({
  card,
  accountMap,
}: {
  card: Extract<CatchUpCard, { kind: "match" }>;
  accountMap: Map<string, FinancialAccount>;
}) {
  const theme = useTheme();
  const { forecast, realized } = card.pair;
  return (
    <View>
      <Text className="text-lg font-semibold text-foreground text-center mb-4">
        Is this the payment you were expecting?
      </Text>
      <MiniRow expense={forecast} label="Expected" labelColor={theme.warning} accountMap={accountMap} />
      <MiniRow expense={realized} label="Actual (from SMS)" labelColor={theme.primary} accountMap={accountMap} />
      <Text className="text-xs text-muted-foreground text-center mt-2">
        Swipe right if it's the same payment. The forecast is marked paid and the SMS copy is dropped.
      </Text>
    </View>
  );
}

function DuplicateBody({
  card,
  accountMap,
}: {
  card: Extract<CatchUpCard, { kind: "duplicate" }>;
  accountMap: Map<string, FinancialAccount>;
}) {
  const theme = useTheme();
  const { keep, reject } = splitDuplicateGroup(card.group);
  return (
    <ScrollView>
      <Text className="text-lg font-semibold text-foreground text-center mb-1">
        These look like the same transaction
      </Text>
      <Text className="text-xs text-muted-foreground text-center mb-4">{card.group.reason}</Text>
      <MiniRow expense={keep} label="Keep (newest)" labelColor={theme.success} accountMap={accountMap} />
      {reject.map((e) => (
        <MiniRow key={e.id} expense={e} label="Reject" labelColor={theme.danger} accountMap={accountMap} />
      ))}
    </ScrollView>
  );
}
