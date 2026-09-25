import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { Money, Text } from "@/components/ui";
import { DeckCard } from "@/components/check-in/DeckParts";
import type { FooterAction } from "@/components/check-in/DeckParts";
import { useTheme } from "@/hooks/use-theme";
import type { Category } from "@/services/category";
import type { CatchUpCard } from "@/services/catch-up";
import { splitDuplicateGroup } from "@/services/catch-up";
import type { Expense } from "@/services/expense";
import type { FinancialAccount } from "@/services/financial-account";
import { formatDateForDisplay } from "@/utils/expense-validation";

interface CatchUpCardViewProps {
  card: CatchUpCard;
  categoryMap: Map<string, Category>;
  accountMap: Map<string, FinancialAccount>;
  /** Category the card will apply on a right swipe (pending / uncategorized only). */
  categoryId: string | null;
  onPickCategory: () => void;
  onOpen: (expenseId: string) => void;
  /** Extra actions (Reject, Already captured, Edit details…) as rows at the bottom of the card. */
  actions: FooterAction[];
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
  actions,
}: CatchUpCardViewProps) {
  const theme = useTheme();
  const meta = KIND_META[card.kind];
  const isCredit = (card.kind === "pending" || card.kind === "uncategorized") && card.expense.nature === "credit";
  const kindLabel = card.kind === "pending" && isCredit ? "Money received" : meta.label;

  return (
    <DeckCard actions={actions}>
      <View className="flex-row items-center justify-center mb-3">
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
    </DeckCard>
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
    <View>
      <Pressable onPress={() => onOpen(expense.id)} accessibilityRole="button" accessibilityLabel="Open full details">
        <Money
          value={expense.amount}
          showPlus={isCredit}
          className={`text-title font-bold text-center ${isCredit ? "text-success" : "text-foreground"}`}
        />
        <Text className="text-base font-bold text-foreground text-center mt-1" numberOfLines={2}>
          {title(expense)}
        </Text>
        <Text className="text-sm text-muted-foreground text-center mt-1">
          {[account, formatDateForDisplay(expense.date)].filter(Boolean).join(" · ")}
        </Text>
      </Pressable>

      {!isCredit && (
        <Pressable
          onPress={onPickCategory}
          className="flex-row items-center self-center mt-4 px-4 rounded-full border"
          style={{
            minHeight: 40,
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

      {expense.raw_source_text ? (
        <View className="mt-4">
          <Pressable
            onPress={() => setShowSms((v) => !v)}
            className="flex-row items-center"
            style={{ minHeight: 40 }}
            accessibilityRole="button"
          >
            <Ionicons name={showSms ? "chevron-down" : "chevron-forward"} size={16} color={theme.mutedForeground} />
            <Text className="text-sm font-medium text-muted-foreground ml-1.5">
              {showSms ? "Hide original SMS" : "Show original SMS"}
            </Text>
          </Pressable>
          {showSms && (
            <View className="mt-1 rounded-lg px-3 py-2.5" style={{ backgroundColor: theme.alpha("foreground", 0.04) }}>
              <Text className="text-xs text-muted-foreground">{expense.raw_source_text}</Text>
            </View>
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
        <Money value={expense.amount} className="text-sm font-bold text-foreground" />
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
      <Text className="text-base font-bold text-foreground text-center mb-3">
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
    <View>
      <Text className="text-base font-bold text-foreground text-center mb-1">
        These look like the same transaction
      </Text>
      <Text className="text-xs text-muted-foreground text-center mb-4">{card.group.reason}</Text>
      <MiniRow expense={keep} label="Keep (newest)" labelColor={theme.success} accountMap={accountMap} />
      {reject.map((e) => (
        <MiniRow key={e.id} expense={e} label="Reject" labelColor={theme.danger} accountMap={accountMap} />
      ))}
    </View>
  );
}
