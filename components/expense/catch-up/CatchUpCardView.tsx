import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { Button, Money, Text } from "@/components/ui";
import { DeckCard } from "@/components/check-in/DeckParts";
import { TYPE_ICONS } from "@/constants/icons";
import type { FooterAction } from "@/components/check-in/DeckParts";
import { useTheme } from "@/hooks/use-theme";
import type { Category } from "@/services/category";
import type { CatchUpCard } from "@/services/catch-up";
import { splitDuplicateGroup } from "@/services/catch-up";
import type { Expense, SplitConfig } from "@/services/expense";
import { computeSplitAmounts } from "@/services/split-math";
import type { HisaabPersonWithBalance } from "@/services/hisaab";
import type { FinancialAccount } from "@/services/financial-account";
import type { PaymentMode } from "@/services/payment-mode";
import { formatDateForDisplay } from "@/utils/expense-validation";
import { formatAmount } from "@/utils/format";
import { MONEY_EVENT_META } from "../money-event-meta";

interface CatchUpCardViewProps {
  card: CatchUpCard;
  categoryMap: Map<string, Category>;
  accountMap: Map<string, FinancialAccount>;
  paymentModeMap: Map<string, PaymentMode>;
  /** Category the card will apply on a right swipe (pending / uncategorized only). */
  categoryId: string | null;
  onPickCategory: () => void;
  /** Edit the merchant right on the card; open the payment mode picker (pending / uncategorized only). */
  onPickMerchant: () => void;
  editingMerchant: boolean;
  /** Merchants used before, for suggestions while typing. */
  merchantNames: string[];
  onSaveMerchant: (name: string) => void;
  onCancelMerchant: () => void;
  onPickPaymentMode: () => void;
  onOpen: (expenseId: string) => void;
  /** Add / change the description right on the card (pending / uncategorized only). */
  onEditDescription: () => void;
  editingDescription: boolean;
  savingDescription: boolean;
  onSaveDescription: (expenseId: string, text: string) => void;
  /** The description being typed, so leaving for the edit screen can save it first. */
  onDescriptionDraft: (expenseId: string, text: string) => void;
  /** Split with a Hisaab person right on the card (spending only). */
  persons: HisaabPersonWithBalance[];
  editingSplit: boolean;
  savingSplit: boolean;
  onEditSplit: () => void;
  onCancelSplit: () => void;
  onSaveSplit: (expenseId: string, config: SplitConfig) => void;
  onRemoveSplit: (expenseId: string) => void;
  /** Adds a person to Hisaab; resolves to the new id, or null if it failed. */
  onAddPerson: (name: string) => Promise<string | null>;
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
  editingMerchant,
  merchantNames,
  onSaveMerchant,
  onCancelMerchant,
  onPickPaymentMode,
  onOpen,
  onEditDescription,
  editingDescription,
  savingDescription,
  onSaveDescription,
  onDescriptionDraft,
  persons,
  editingSplit,
  savingSplit,
  onEditSplit,
  onCancelSplit,
  onSaveSplit,
  onRemoveSplit,
  onAddPerson,
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
          editingMerchant={editingMerchant}
          merchantNames={merchantNames}
          onSaveMerchant={onSaveMerchant}
          onCancelMerchant={onCancelMerchant}
          onPickPaymentMode={onPickPaymentMode}
          onOpen={onOpen}
          onEditDescription={onEditDescription}
          editingDescription={editingDescription}
          savingDescription={savingDescription}
          onSaveDescription={onSaveDescription}
          onDescriptionDraft={onDescriptionDraft}
          persons={persons}
          editingSplit={editingSplit}
          savingSplit={savingSplit}
          onEditSplit={onEditSplit}
          onCancelSplit={onCancelSplit}
          onSaveSplit={onSaveSplit}
          onRemoveSplit={onRemoveSplit}
          onAddPerson={onAddPerson}
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
  editingMerchant,
  merchantNames,
  onSaveMerchant,
  onCancelMerchant,
  onPickPaymentMode,
  onOpen,
  onEditDescription,
  editingDescription,
  savingDescription,
  onSaveDescription,
  onDescriptionDraft,
  persons,
  editingSplit,
  savingSplit,
  onEditSplit,
  onCancelSplit,
  onSaveSplit,
  onRemoveSplit,
  onAddPerson,
}: {
  expense: Expense;
  isCredit: boolean;
  categoryMap: Map<string, Category>;
  accountMap: Map<string, FinancialAccount>;
  paymentModeMap: Map<string, PaymentMode>;
  categoryId: string | null;
  onPickCategory: () => void;
  onPickMerchant: () => void;
  editingMerchant: boolean;
  merchantNames: string[];
  onSaveMerchant: (name: string) => void;
  onCancelMerchant: () => void;
  onPickPaymentMode: () => void;
  onOpen: (id: string) => void;
  onEditDescription: () => void;
  editingDescription: boolean;
  savingDescription: boolean;
  onSaveDescription: (expenseId: string, text: string) => void;
  onDescriptionDraft: (expenseId: string, text: string) => void;
  persons: HisaabPersonWithBalance[];
  editingSplit: boolean;
  savingSplit: boolean;
  onEditSplit: () => void;
  onCancelSplit: () => void;
  onSaveSplit: (expenseId: string, config: SplitConfig) => void;
  onRemoveSplit: (expenseId: string) => void;
  onAddPerson: (name: string) => Promise<string | null>;
}) {
  const theme = useTheme();
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
  // Once split, `amount` is your share; the card keeps showing what was actually paid.
  const isSplit = expense.split_original_amount != null;
  const total = expense.split_original_amount ?? expense.amount;
  const canSplit = !isCredit && expense.nature === "realized" && !expense.money_event;
  const splitPerson = expense.split_person_id ? persons.find((p) => p.id === expense.split_person_id) : undefined;
  // The card covers "I paid": half each, they owe it all, or an amount. Anything else
  // (they paid, a percentage, several people) is edited on the full screen.
  const splitOnCard =
    !isSplit ||
    (expense.split_person_id != null && INLINE_SPLIT_MODES.some((m) => m.mode === expense.split_mode));

  return (
    <View>
      <Pressable onPress={() => onOpen(expense.id)} accessibilityRole="button" accessibilityLabel="Open full details">
        <Money
          value={total}
          showPlus={isCredit}
          className={`text-title font-bold text-center ${isCredit ? "text-success" : "text-foreground"}`}
        />
        <Text className="text-base font-bold text-foreground text-center mt-1" numberOfLines={2}>
          {title(expense)}
        </Text>
        <Text className="text-sm text-muted-foreground text-center mt-1">
          {[account, formatDateForDisplay(expense.date)].filter(Boolean).join(" · ")}
        </Text>
        {isSplit && (
          <Text className="text-sm text-muted-foreground text-center mt-1">
            Your share {formatAmount(expense.amount)}
          </Text>
        )}
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

      {canSplit && (
        <FieldChip
          icon="people-outline"
          text={splitPerson ? `Split · ${splitPerson.name}` : "Split"}
          set={isSplit}
          onPress={splitOnCard ? onEditSplit : () => onOpen(expense.id)}
          accessibilityLabel={isSplit ? "Split, tap to change" : "Split with someone"}
        />
      )}
      </View>

      {editingMerchant && (
        <MerchantField
          title={isCredit ? "Received from" : "Paid to"}
          initial={expense.merchant_name ?? ""}
          names={merchantNames}
          onSave={onSaveMerchant}
          onCancel={onCancelMerchant}
        />
      )}

      {canSplit && splitOnCard && editingSplit && (
        <SplitPanel
          expense={expense}
          total={total}
          persons={persons}
          saving={savingSplit}
          onSave={(config) => onSaveSplit(expense.id, config)}
          onRemove={() => onRemoveSplit(expense.id)}
          onCancel={onCancelSplit}
          onAddPerson={onAddPerson}
        />
      )}

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

    </View>
  );
}

type InlineSplitMode = "equal" | "they_owe_full" | "exact";

const INLINE_SPLIT_MODES: { mode: InlineSplitMode; label: string }[] = [
  { mode: "equal", label: "Half each" },
  { mode: "they_owe_full", label: "They owe full" },
  { mode: "exact", label: "Amount" },
];

/** Split with one Hisaab person, set up in place: who, how, and what each side ends up with. */
function SplitPanel({
  expense,
  total,
  persons,
  saving,
  onSave,
  onRemove,
  onCancel,
  onAddPerson,
}: {
  expense: Expense;
  total: number;
  persons: HisaabPersonWithBalance[];
  saving: boolean;
  onSave: (config: SplitConfig) => void;
  onRemove: () => void;
  onCancel: () => void;
  onAddPerson: (name: string) => Promise<string | null>;
}) {
  const theme = useTheme();
  const [personId, setPersonId] = useState<string | null>(expense.split_person_id ?? null);
  const [mode, setMode] = useState<InlineSplitMode>(
    expense.split_mode === "they_owe_full" || expense.split_mode === "exact" ? expense.split_mode : "equal",
  );
  const [exact, setExact] = useState(expense.split_exact_amount != null ? String(expense.split_exact_amount) : "");
  const [addingPerson, setAddingPerson] = useState(persons.length === 0);
  const [newName, setNewName] = useState("");
  const [savingPerson, setSavingPerson] = useState(false);

  const exactValue = parseFloat(exact) || 0;
  const person = persons.find((p) => p.id === personId);
  const config: SplitConfig | null =
    personId && (mode !== "exact" || (exactValue > 0 && exactValue <= total))
      ? { paidBy: "me", splitMode: mode, personId, exactAmount: mode === "exact" ? exactValue : undefined }
      : null;
  const preview = config ? computeSplitAmounts(total, config) : null;

  const addPerson = async () => {
    const name = newName.trim();
    if (!name || savingPerson) return;
    setSavingPerson(true);
    const id = await onAddPerson(name);
    setSavingPerson(false);
    if (!id) return;
    setPersonId(id);
    setNewName("");
    setAddingPerson(false);
  };

  return (
    <View className="mt-3 rounded-lg border px-3 py-3" style={{ borderColor: theme.primary }}>
      <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Split with</Text>
      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        {persons.map((p) => (
          <ChoiceChip key={p.id} label={p.name} selected={p.id === personId} onPress={() => setPersonId(p.id)} />
        ))}
        {!addingPerson && <ChoiceChip label="New person" icon="add" selected={false} onPress={() => setAddingPerson(true)} />}
      </View>
      {addingPerson && (
        <View className="flex-row items-center mt-2 rounded-lg border border-border px-3" style={{ minHeight: 44 }}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="Their name"
            placeholderTextColor={theme.mutedForeground}
            autoFocus
            maxLength={60}
            returnKeyType="done"
            onSubmitEditing={() => void addPerson()}
            className="flex-1 text-sm text-foreground py-2"
            accessibilityLabel="New person's name"
          />
          {savingPerson ? (
            <ActivityIndicator size="small" color={theme.primary} />
          ) : (
            <Pressable onPress={() => void addPerson()} hitSlop={8} accessibilityRole="button">
              <Text className="text-sm font-semibold" style={{ color: newName.trim() ? theme.primary : theme.mutedForeground }}>
                Add
              </Text>
            </Pressable>
          )}
        </View>
      )}

      <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-4 mb-2">How</Text>
      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        {INLINE_SPLIT_MODES.map((m) => (
          <ChoiceChip key={m.mode} label={m.label} selected={m.mode === mode} onPress={() => setMode(m.mode)} />
        ))}
      </View>
      {mode === "exact" && (
        <View className="flex-row items-center mt-2 rounded-lg border border-border px-3" style={{ minHeight: 44 }}>
          <Text className="text-sm text-muted-foreground mr-1">{"\u20B9"}</Text>
          <TextInput
            value={exact}
            onChangeText={setExact}
            placeholder="How much do they owe?"
            placeholderTextColor={theme.mutedForeground}
            keyboardType="decimal-pad"
            className="flex-1 text-sm text-foreground py-2"
            accessibilityLabel="Amount they owe"
          />
        </View>
      )}

      {preview ? (
        <Text className="text-sm text-foreground mt-3">
          Your share {formatAmount(preview.myBudgetAmount)} · {person?.name ?? "They"} owes{" "}
          {formatAmount(preview.hisaabAmount)}
        </Text>
      ) : mode === "exact" && exactValue > total ? (
        <Text className="text-sm mt-3" style={{ color: theme.danger }}>
          That is more than the {formatAmount(total)} paid.
        </Text>
      ) : null}

      <View className="flex-row gap-3 mt-3">
        <View className="flex-1">
          <Button title="Cancel" variant="outline" onPress={onCancel} disabled={saving} />
        </View>
        <View className="flex-1">
          <Button title="Save split" onPress={() => config && onSave(config)} disabled={!config || saving} />
        </View>
      </View>
      {expense.split_original_amount != null && (
        <Pressable
          onPress={onRemove}
          disabled={saving}
          className="items-center justify-center mt-1"
          style={{ minHeight: 40 }}
          accessibilityRole="button"
        >
          <Text className="text-sm font-medium" style={{ color: theme.danger }}>Remove split</Text>
        </Pressable>
      )}
    </View>
  );
}

function ChoiceChip({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const color = selected ? theme.primary : theme.mutedForeground;
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center px-4 rounded-full border"
      style={{
        minHeight: 40,
        maxWidth: "100%",
        borderColor: selected ? theme.primary : theme.border,
        backgroundColor: selected ? theme.alpha("primary", 0.1) : "transparent",
      }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      {icon ? <Ionicons name={icon} size={16} color={color} style={{ marginRight: 4 }} /> : null}
      <Text className="text-sm font-semibold flex-shrink" style={{ color }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
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

/**
 * The merchant, edited right on the card: a text field with up to three merchants you've used
 * before as chips underneath. A chip or Done saves; the cross puts it back as it was.
 */
function MerchantField({
  title,
  initial,
  names,
  onSave,
  onCancel,
}: {
  title: string;
  initial: string;
  names: string[];
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const [text, setText] = useState(initial);
  const q = text.trim().toLowerCase();
  const matches = (q ? names.filter((n) => n.toLowerCase().includes(q) && n.toLowerCase() !== q) : names)
    // Names that start with what's typed first.
    .sort((a, b) => Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q)))
    .slice(0, 3);
  const exact = names.some((n) => n.toLowerCase() === q);

  return (
    <View className="mt-3">
      <Text className="text-xs text-muted-foreground mb-1">{title}</Text>
      <View className="flex-row items-center rounded-lg border px-3" style={{ borderColor: theme.primary, minHeight: 44 }}>
        <Ionicons name="storefront-outline" size={16} color={theme.mutedForeground} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Swiggy, rent, Mom"
          placeholderTextColor={theme.mutedForeground}
          autoFocus
          maxLength={100}
          returnKeyType="done"
          onSubmitEditing={() => onSave(text)}
          className="flex-1 text-sm text-foreground py-2 ml-2"
          accessibilityLabel={title}
        />
        <Pressable onPress={onCancel} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel">
          <Ionicons name="close" size={18} color={theme.mutedForeground} />
        </Pressable>
        <Pressable onPress={() => onSave(text)} hitSlop={8} style={{ marginLeft: 10 }} accessibilityRole="button" accessibilityLabel="Save merchant">
          <Ionicons name="checkmark" size={20} color={theme.primary} />
        </Pressable>
      </View>
      {(matches.length > 0 || (q.length > 0 && !exact)) && (
        <View className="flex-row flex-wrap mt-2" style={{ gap: 6 }}>
          {matches.map((m) => (
            <Pressable
              key={m}
              onPress={() => onSave(m)}
              className="flex-row items-center rounded-full border border-border px-3 py-1.5"
              accessibilityRole="button"
              accessibilityLabel={`Use ${m}`}
            >
              <Ionicons name="time-outline" size={12} color={theme.mutedForeground} />
              <Text className="text-xs text-foreground ml-1" numberOfLines={1}>{m}</Text>
            </Pressable>
          ))}
          {q.length > 0 && !exact && (
            <Pressable onPress={() => onSave(text)} className="rounded-full px-3 py-1.5" accessibilityRole="button">
              <Text className="text-xs font-medium" style={{ color: theme.primary }}>Use "{text.trim()}"</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}
