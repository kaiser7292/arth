import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { Money, Text } from "@/components/ui";
import { DeckCard } from "@/components/check-in/DeckParts";
import { TYPE_ICONS } from "@/constants/icons";
import type { FooterAction } from "@/components/check-in/DeckParts";
import { useTheme } from "@/hooks/use-theme";
import type { Category } from "@/services/category";
import type { CatchUpCard } from "@/services/catch-up";
import { splitDuplicateGroup } from "@/services/catch-up";
import type { Expense } from "@/services/expense";
import type { FinancialAccount } from "@/services/financial-account";
import type { PaymentMode } from "@/services/payment-mode";
import { formatDateForDisplay } from "@/utils/expense-validation";
import { MONEY_EVENT_META } from "../money-event-meta";

interface CatchUpCardViewProps {
  card: CatchUpCard;
  categoryMap: Map<string, Category>;
  accountMap: Map<string, FinancialAccount>;
  paymentModeMap: Map<string, PaymentMode>;
  /** Category the card will apply on a right swipe (pending / uncategorized only). */
  categoryId: string | null;
  onPickCategory: () => void;
  /** Open the merchant / payment mode pickers (pending / uncategorized only). */
  onPickMerchant: () => void;
  onPickPaymentMode: () => void;
  onOpen: (expenseId: string) => void;
  /** Add / change the description right on the card (pending / uncategorized only). */
  onEditDescription: () => void;
  editingDescription: boolean;
  savingDescription: boolean;
  onSaveDescription: (expenseId: string, text: string) => void;
  /** The description being typed, so leaving for the edit screen can save it first. */
  onDescriptionDraft: (expenseId: string, text: string) => void;
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
  paymentModeMap,
  categoryId,
  onPickCategory,
  onPickMerchant,
  onPickPaymentMode,
  onOpen,
  onEditDescription,
  editingDescription,
  savingDescription,
  onSaveDescription,
  onDescriptionDraft,
  actions,
}: CatchUpCardViewProps) {
  const theme = useTheme();
  const meta = KIND_META[card.kind];
  const isCredit = (card.kind === "pending" || card.kind === "uncategorized") && card.expense.nature === "credit";
  const moneyEvent = card.kind === "pending" ? card.expense.money_event ?? null : null;
  const eventMeta = moneyEvent ? MONEY_EVENT_META[moneyEvent] : null;
  const kindLabel = eventMeta ? eventMeta.tag : card.kind === "pending" && isCredit ? "Money received" : meta.label;
  const kindColor = eventMeta ? theme[eventMeta.tone] : theme.mutedForeground;

  return (
    <DeckCard actions={actions}>
      <View className="flex-row items-center justify-center mb-3">
        <Ionicons name={eventMeta?.icon ?? meta.icon} size={14} color={kindColor} />
        <Text
          className="text-xs font-semibold uppercase tracking-wider ml-1.5"
          style={{ color: kindColor }}
        >
          {kindLabel}
        </Text>
      </View>

      {(card.kind === "pending" || card.kind === "uncategorized") && (
        <SingleExpenseBody
          expense={card.expense}
          isCredit={isCredit}
          categoryMap={categoryMap}
          accountMap={accountMap}
          paymentModeMap={paymentModeMap}
          categoryId={categoryId}
          onPickCategory={onPickCategory}
          onPickMerchant={onPickMerchant}
          onPickPaymentMode={onPickPaymentMode}
          onOpen={onOpen}
          onEditDescription={onEditDescription}
          editingDescription={editingDescription}
          savingDescription={savingDescription}
          onSaveDescription={onSaveDescription}
          onDescriptionDraft={onDescriptionDraft}
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
  paymentModeMap,
  categoryId,
  onPickCategory,
  onPickMerchant,
  onPickPaymentMode,
  onOpen,
  onEditDescription,
  editingDescription,
  savingDescription,
  onSaveDescription,
  onDescriptionDraft,
}: {
  expense: Expense;
  isCredit: boolean;
  categoryMap: Map<string, Category>;
  accountMap: Map<string, FinancialAccount>;
  paymentModeMap: Map<string, PaymentMode>;
  categoryId: string | null;
  onPickCategory: () => void;
  onPickMerchant: () => void;
  onPickPaymentMode: () => void;
  onOpen: (id: string) => void;
  onEditDescription: () => void;
  editingDescription: boolean;
  savingDescription: boolean;
  onSaveDescription: (expenseId: string, text: string) => void;
  onDescriptionDraft: (expenseId: string, text: string) => void;
}) {
  const theme = useTheme();
  const [showSms, setShowSms] = useState(false);
  const [draft, setDraft] = useState(expense.description ?? "");
  // A fresh card starts from its own description.
  useEffect(() => {
    setDraft(expense.description ?? "");
  }, [expense.id, expense.description]);
  const category = categoryId ? categoryMap.get(categoryId) : undefined;
  const paymentMode = expense.payment_mode_id ? paymentModeMap.get(expense.payment_mode_id) : undefined;
  const account = accountText(accountMap, expense.account_id);
  const description = expense.description?.trim() || null;
  // With no merchant the title already IS the description — don't repeat it below.
  const showDescriptionText = description != null && !!expense.merchant_name;

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

      <View className="flex-row flex-wrap justify-center mt-4" style={{ gap: 8 }}>
      <Pressable
        onPress={onPickCategory}
        className="flex-row items-center px-4 rounded-full border"
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

      <FieldChip
        icon="storefront-outline"
        text={expense.merchant_name?.trim() || (isCredit ? "Add who paid" : "Add merchant")}
        set={!!expense.merchant_name?.trim()}
        onPress={onPickMerchant}
        accessibilityLabel={
          expense.merchant_name ? `${isCredit ? "Received from" : "Paid to"} ${expense.merchant_name}, tap to change` : "Add merchant"
        }
      />

      {!isCredit && (
        <FieldChip
          icon={paymentMode ? TYPE_ICONS[paymentMode.type] : "card-outline"}
          text={paymentMode?.name ?? "Payment mode"}
          set={!!paymentMode}
          onPress={onPickPaymentMode}
          accessibilityLabel={paymentMode ? `Payment mode ${paymentMode.name}, tap to change` : "Choose payment mode"}
        />
      )}
      </View>

      {editingDescription ? (
        <View className="flex-row items-center mt-3 rounded-lg border px-3" style={{ borderColor: theme.primary, minHeight: 44 }}>
          <TextInput
            value={draft}
            onChangeText={(t) => {
              setDraft(t);
              onDescriptionDraft(expense.id, t);
            }}
            placeholder="Dinner with team, Mom's medicines"
            placeholderTextColor={theme.mutedForeground}
            autoFocus
            maxLength={200}
            returnKeyType="done"
            onSubmitEditing={() => onSaveDescription(expense.id, draft)}
            onBlur={() => onSaveDescription(expense.id, draft)}
            className="flex-1 text-sm text-foreground py-2"
            accessibilityLabel="Description"
          />
          {savingDescription && <ActivityIndicator size="small" color={theme.primary} />}
        </View>
      ) : (
        <Pressable
          onPress={onEditDescription}
          className="flex-row items-center self-center mt-3 px-3"
          style={{ minHeight: 40, maxWidth: "100%" }}
          accessibilityRole="button"
          accessibilityLabel={description ? `Description ${description}, tap to change` : "Add a description"}
        >
          <Ionicons
            name={description ? "create-outline" : "add-circle-outline"}
            size={16}
            color={theme.primary}
          />
          <Text className="text-sm font-medium ml-1.5 flex-shrink" style={{ color: theme.primary }} numberOfLines={2}>
            {showDescriptionText ? description : description ? "Edit description" : "Add description"}
          </Text>
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

/** A tappable field on the card (merchant, payment mode): outlined, muted until it has a value. */
function FieldChip({
  icon,
  text,
  set,
  onPress,
  accessibilityLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  set: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  const color = set ? theme.foreground : theme.mutedForeground;
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center px-4 rounded-full border"
      style={{ minHeight: 40, maxWidth: "100%", borderColor: theme.border }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Ionicons name={icon} size={16} color={color} />
      <Text className="text-sm font-semibold ml-1.5 flex-shrink" style={{ color }} numberOfLines={1}>
        {text}
      </Text>
      <Ionicons name="chevron-down" size={14} color={color} style={{ marginLeft: 4 }} />
    </Pressable>
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
