import { SearchablePickerList } from "@/components/expense/ExpenseFormFields";
import { Button, ScreenContainer } from "@/components/ui";
import { CalendarModal } from "@/components/ui/CalendarModal";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useColorScheme } from "@/hooks/use-color-scheme";
import type { Category } from "@/services/category";
import type { FinancialAccount } from "@/services/financial-account";
import type { HisaabPersonWithBalance } from "@/services/hisaab";
import { getPersonsWithBalances } from "@/services/hisaab";
import { getDistinctMerchantNames } from "@/services/merchant-alias";
import type {
    EntryDirection,
    HisaabKind,
    SimulationEntry
} from "@/services/simulator";
import {
    createEntry,
    getScenarioOverview,
    updateEntry,
} from "@/services/simulator";
import { ac } from "@/utils/accent";
import { todayIso } from "@/utils/date";
import { formatAmount } from "@/utils/format";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    KeyboardAvoidingView,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View,
} from "react-native";

function prettyDate(ymd: string): string {
  if (!ymd) return "";
  const parts = ymd.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return ymd;
  const [y, m, d] = parts;
  const dt = new Date(y, m - 1, d);
  if (isNaN(dt.getTime())) return ymd;
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function SimulatorEntryForm() {
  const { id, entryId } = useLocalSearchParams<{ id: string; entryId?: string }>();
  const router = useRouter();
  const { colors, accent, colorScheme } = useColorScheme();

  type EntryFlavor = "out" | "in" | "collect" | "payback" | "transfer";
  const [flavor, setFlavor] = useState<EntryFlavor>("out");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [accountId, setAccountId] = useState<string | null>(null);
  const [toAccountId, setToAccountId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [merchant, setMerchant] = useState("");
  const [description, setDescription] = useState("");
  const [personId, setPersonId] = useState<string | null>(null);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [accountPickerVisible, setAccountPickerVisible] = useState(false);
  const [toAccountPickerVisible, setToAccountPickerVisible] = useState(false);
  const [categoryPickerVisible, setCategoryPickerVisible] = useState(false);
  const [personPickerVisible, setPersonPickerVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [persons, setPersons] = useState<HisaabPersonWithBalance[]>([]);
  const [merchantNames, setMerchantNames] = useState<string[]>([]);
  const [merchantFocused, setMerchantFocused] = useState(false);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [accountBalances, setAccountBalances] = useState<Record<string, number>>({});
  const [existingEntry, setExistingEntry] = useState<SimulationEntry | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
  }, []);

  useEffect(() => {
    async function loadData() {
      if (!id) return;
      try {
        const [overview, accts, cats, p, m] = await Promise.all([
          getScenarioOverview(id, DEFAULT_USER_ID),
          Promise.resolve([]), // accounts - will load separately
          Promise.resolve([]), // categories - will load separately
          getPersonsWithBalances(DEFAULT_USER_ID),
          getDistinctMerchantNames(DEFAULT_USER_ID),
        ]);
        
        setPersons(p);
        setMerchantNames(m);
        
        // Load accounts and categories
        const { getActiveAccounts } = require("@/services/financial-account");
        const { getCategories } = require("@/services/category");
        const [activeAccounts, allCategories] = await Promise.all([
          getActiveAccounts(DEFAULT_USER_ID),
          getCategories(DEFAULT_USER_ID),
        ]);
        
        setAccounts(activeAccounts);
        setCategories(allCategories);
        
        // Set account balances from baseline
        const balances: Record<string, number> = {};
        if (overview) {
          overview.baseline.forEach((a) => {
            balances[a.id] = a.balance;
          });
        }
        setAccountBalances(balances);
        
        // If editing, load existing entry
        if (entryId && overview) {
          const entry = overview.entries.upcoming.find((e) => e.id === entryId);
          if (entry) {
            setExistingEntry(entry);
            const inferredFlavor: EntryFlavor =
              entry.hisaab_kind === "collect"
                ? "collect"
                : entry.hisaab_kind === "payback"
                  ? "payback"
                  : entry.direction;
            setFlavor(inferredFlavor);
            setAmount(String(entry.amount));
            setDate(entry.date);
            setAccountId(entry.account_id);
            setCategoryId(entry.category_id);
            setMerchant(entry.merchant_name ?? "");
            setDescription(entry.description ?? "");
            setPersonId(entry.hisaab_person_id);
          }
        }
        
        setLoaded(true);
      } catch (e) {
        console.error("Failed to load data:", e);
      }
    }
    loadData();
  }, [id, entryId]);

  const parsedAmount = useMemo(() => {
    const n = parseFloat(amount.replace(/,/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [amount]);

  const isHisaab = flavor === "collect" || flavor === "payback";
  const direction: EntryDirection = (flavor === "in" || flavor === "collect") ? "in" : "out";
  const hisaabKind: HisaabKind | null =
    flavor === "collect" ? "collect" : flavor === "payback" ? "payback" : null;

  const canSave =
    parsedAmount != null
    && !!date
    && !!accountId
    && !saving
    && (!isHisaab || !!personId)
    && (flavor !== "transfer" || !!toAccountId);

  const selectedAccount = accounts.find((a) => a.id === accountId) ?? null;
  const selectedCategory = categories.find((c) => c.id === categoryId) ?? null;
  const selectedPerson = persons.find((p) => p.id === personId) ?? null;

  const merchantSuggestions = useMemo(() => {
    if (!merchantFocused) return [];
    const q = merchant.trim().toLowerCase();
    if (!q) return merchantNames.slice(0, 6);
    const prefix: string[] = [];
    const contains: string[] = [];
    for (const name of merchantNames) {
      const lc = name.toLowerCase();
      if (lc === q) continue;
      if (lc.startsWith(q)) prefix.push(name);
      else if (lc.includes(q)) contains.push(name);
    }
    return [...prefix, ...contains].slice(0, 6);
  }, [merchantNames, merchant, merchantFocused]);

  const handleSave = useCallback(async () => {
    if (!canSave || parsedAmount == null || !id) return;
    setSaving(true);
    try {
      const payloadCategoryId = isHisaab ? null : (direction === "out" ? categoryId : null);
      const payloadMerchant = isHisaab ? null : (merchant.trim() || null);
      
      if (existingEntry) {
        await updateEntry(existingEntry.id, {
          direction,
          amount: parsedAmount,
          date,
          account_id: accountId,
          from_account_id: flavor === "transfer" ? accountId : null,
          to_account_id: flavor === "transfer" ? toAccountId : null,
          category_id: payloadCategoryId,
          merchant_name: payloadMerchant,
          description: description.trim() || null,
          hisaab_person_id: isHisaab ? personId : null,
          hisaab_kind: hisaabKind,
        });
      } else {
        await createEntry(id, {
          direction,
          amount: parsedAmount,
          date,
          account_id: accountId,
          from_account_id: flavor === "transfer" ? accountId : null,
          to_account_id: flavor === "transfer" ? toAccountId : null,
          category_id: payloadCategoryId,
          merchant_name: payloadMerchant,
          description: description.trim() || null,
          source: "manual",
          hisaab_person_id: isHisaab ? personId : null,
          hisaab_kind: hisaabKind,
        });
      }
      router.back();
    } catch (e) {
      console.error("Failed to save entry:", e);
    } finally {
      setSaving(false);
    }
  }, [canSave, parsedAmount, existingEntry, id, direction, hisaabKind, isHisaab, personId, date, accountId, toAccountId, categoryId, merchant, description, flavor, router]);

  if (!loaded) {
    return (
      <ScreenContainer>
        <View className="flex-1 items-center justify-center">
          <Text style={{ color: colors.textSecondary }}>Loading...</Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1 }}
          className="flex-1"
        >
          <View className="px-4 pt-4 pb-8">
            <View className="mb-4">
              <Text className="text-sm" style={{ color: colors.textSecondary }}>
                {isHisaab
                  ? flavor === "collect"
                    ? "Plan money coming in from someone who owes you."
                    : "Plan money going out to settle a hisaab balance."
                  : "Nothing is written to your real ledger. This is a simulated cash-flow number."}
              </Text>
            </View>
          {/* Kind selector */}
          <View className="px-0 pb-3">
            <Text
              className="text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: colors.textSecondary }}
            >
              Kind
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {(
                [
                  { key: "out", label: "Outgoing", icon: "arrow-up-outline" as const },
                  { key: "in", label: "Incoming", icon: "arrow-down-outline" as const },
                  { key: "collect", label: "Collect from hisaab", icon: "people-outline" as const },
                  { key: "payback", label: "Pay back to hisaab", icon: "people-outline" as const },
                  { key: "transfer", label: "Transfer", icon: "swap-horizontal-outline" as const },
                ] as { key: EntryFlavor; label: string; icon: keyof typeof Ionicons.glyphMap }[]
              ).map((f) => {
                const active = flavor === f.key;
                return (
                  <Pressable
                    key={f.key}
                    onPress={() => {
                      setFlavor(f.key);
                      if (f.key !== "collect" && f.key !== "payback") {
                        setPersonId(null);
                      }
                    }}
                    style={{
                      minWidth: "48%",
                      flexGrow: 1,
                      backgroundColor: active
                        ? ac(accent, colorScheme, 500, 300) + "22"
                        : colors.surface,
                      borderWidth: active ? 2 : 1,
                      borderColor: active
                        ? ac(accent, colorScheme, 500, 300)
                        : colors.border,
                      borderRadius: 12,
                      paddingVertical: 10,
                      paddingHorizontal: 10,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons
                      name={f.icon}
                      size={14}
                      color={active ? ac(accent, colorScheme, 600, 200) : colors.textSecondary}
                    />
                    <Text
                      className="ml-1.5 text-xs font-semibold"
                      style={{ color: active ? colors.text : colors.textSecondary }}
                      numberOfLines={1}
                    >
                      {f.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Hisaab person */}
          {isHisaab && (
            <View className="px-0 pb-3">
              <Text
                className="text-xs font-semibold uppercase tracking-wider mb-2"
                style={{ color: colors.textSecondary }}
              >
                Hisaab person
              </Text>
              <Pressable
                onPress={() => setPersonPickerVisible(prev => !prev)}
                className="flex-row items-center justify-between border border-border-light dark:border-border-dark rounded-lg px-3 py-3"
                style={{ borderColor: colors.border }}
              >
                <Text className="text-sm flex-1" numberOfLines={1} style={{ color: selectedPerson ? colors.text : colors.textSecondary }}>
                  {selectedPerson ? selectedPerson.name : "Pick a person"}
                </Text>
                <Ionicons name={personPickerVisible ? "chevron-up" : "chevron-down"} size={16} color={colors.textSecondary} />
              </Pressable>
              {personPickerVisible && (
                <SearchablePickerList
                  items={persons.map((p) => ({
                    id: p.id,
                    label: p.name,
                    subtitle: p.balance !== 0 ? `Balance: ${formatAmount(p.balance)}` : undefined,
                  }))}
                  selectedId={personId}
                  onSelect={(id: string | null) => {
                    setPersonId(id);
                    setPersonPickerVisible(false);
                  }}
                  allowNone
                  searchPlaceholder="Search people..."
                />
              )}
              {!selectedPerson && (
                <Text className="text-[10px] mt-1" style={{ color: colors.textSecondary }}>
                  {flavor === "collect"
                    ? "Who's paying you back?"
                    : "Who are you paying back?"}
                </Text>
              )}
            </View>
          )}

          {/* Amount */}
          <View className="px-0 pb-3">
            <Text
              className="text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: colors.textSecondary }}
            >
              Amount
            </Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="0"
              placeholderTextColor={colors.textSecondary}
              keyboardType="numeric"
              className="border border-border-light dark:border-border-dark rounded-lg px-3 py-3 text-lg font-semibold"
              style={{ color: colors.text, borderColor: colors.border }}
            />
          </View>

          {/* Date */}
          <View className="px-0 pb-3">
            <Text
              className="text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: colors.textSecondary }}
            >
              Date
            </Text>
            <Pressable
              onPress={() => setDatePickerVisible(true)}
              className="flex-row items-center justify-between border border-border-light dark:border-border-dark rounded-lg px-3 py-3"
              style={{ borderColor: colors.border }}
            >
              <Text className="text-sm" style={{ color: colors.text }}>
                {prettyDate(date)}
              </Text>
              <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
            </Pressable>
          </View>

          {/* Account */}
          <View className="px-0 pb-3">
            <Text
              className="text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: colors.textSecondary }}
            >
              {flavor === "transfer" ? "From account" : "Account"}
            </Text>
            <Pressable
              onPress={() => setAccountPickerVisible(prev => !prev)}
              className="flex-row items-center justify-between border border-border-light dark:border-border-dark rounded-lg px-3 py-3"
              style={{ borderColor: colors.border }}
            >
              <Text className="text-sm flex-1" numberOfLines={1} style={{ color: selectedAccount ? colors.text : colors.textSecondary }}>
                {selectedAccount
                  ? selectedAccount.account_label ?? `${selectedAccount.bank_name} ••${selectedAccount.account_identifier}`
                  : "Pick an account"}
              </Text>
              {selectedAccount ? (
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    setAccountId(null);
                  }}
                  hitSlop={10}
                  className="p-1 ml-1"
                >
                  <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                </Pressable>
              ) : null}
              <Ionicons name={accountPickerVisible ? "chevron-up" : "chevron-down"} size={16} color={colors.textSecondary} />
            </Pressable>
            {accountPickerVisible && (
              <SearchablePickerList
                items={accounts.map((a) => ({
                  id: a.id,
                  label: a.account_label ?? `${a.bank_name} ••${a.account_identifier}`,
                  subtitle: `${a.account_type} · ${a.bank_name}`,
                }))}
                selectedId={accountId}
                onSelect={(id: string | null) => {
                  setAccountId(id);
                  setAccountPickerVisible(false);
                }}
                allowNone
                searchPlaceholder="Search accounts..."
              />
            )}
          </View>

          {/* To account */}
          {flavor === "transfer" && (
            <View className="px-0 pb-3">
              <Text
                className="text-xs font-semibold uppercase tracking-wider mb-2"
                style={{ color: colors.textSecondary }}
              >
                To account
              </Text>
              <Pressable
                onPress={() => setToAccountPickerVisible(prev => !prev)}
                className="flex-row items-center justify-between border border-border-light dark:border-border-dark rounded-lg px-3 py-3"
                style={{ borderColor: colors.border }}
              >
                <Text className="text-sm flex-1" numberOfLines={1} style={{ color: toAccountId ? colors.text : colors.textSecondary }}>
                  {toAccountId
                    ? (accounts.find((a) => a.id === toAccountId)?.account_label ?? accounts.find((a) => a.id === toAccountId)?.bank_name ?? "Selected account")
                    : "Pick destination account"}
                </Text>
                {toAccountId ? (
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      setToAccountId(null);
                    }}
                    hitSlop={10}
                    className="p-1 ml-1"
                  >
                    <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                  </Pressable>
                ) : null}
                <Ionicons name={toAccountPickerVisible ? "chevron-up" : "chevron-down"} size={16} color={colors.textSecondary} />
              </Pressable>
              {toAccountPickerVisible && (
                <SearchablePickerList
                  items={accounts
                    .filter((a) => a.id !== accountId)
                    .map((a) => ({
                      id: a.id,
                      label: a.account_label ?? `${a.bank_name} ••${a.account_identifier}`,
                      subtitle: `${a.account_type} · ${a.bank_name}`,
                    }))}
                  selectedId={toAccountId}
                  onSelect={(id: string | null) => {
                    setToAccountId(id);
                    setToAccountPickerVisible(false);
                  }}
                  searchPlaceholder="Search accounts..."
                />
              )}
            </View>
          )}

          {/* Category */}
          {direction === "out" && !isHisaab && (
            <View className="px-0 pb-3">
              <Text
                className="text-xs font-semibold uppercase tracking-wider mb-2"
                style={{ color: colors.textSecondary }}
              >
                Category (optional)
              </Text>
              <Pressable
                onPress={() => setCategoryPickerVisible(prev => !prev)}
                className="flex-row items-center justify-between border border-border-light dark:border-border-dark rounded-lg px-3 py-3"
                style={{ borderColor: colors.border }}
              >
                <Text className="text-sm flex-1" numberOfLines={1} style={{ color: selectedCategory ? colors.text : colors.textSecondary }}>
                  {selectedCategory ? selectedCategory.name : "No category"}
                </Text>
                {selectedCategory ? (
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      setCategoryId(null);
                    }}
                    hitSlop={10}
                    className="p-1 ml-1"
                  >
                    <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                  </Pressable>
                ) : null}
                <Ionicons name={categoryPickerVisible ? "chevron-up" : "chevron-down"} size={16} color={colors.textSecondary} />
              </Pressable>
              {categoryPickerVisible && (
                <SearchablePickerList
                  items={categories.map((c) => ({
                    id: c.id,
                    label: c.name,
                    icon: c.icon,
                    color: c.color,
                  }))}
                  selectedId={categoryId}
                  onSelect={(id: string | null) => {
                    setCategoryId(id);
                    setCategoryPickerVisible(false);
                  }}
                  allowNone
                  searchPlaceholder="Search categories..."
                />
              )}
            </View>
          )}

          {/* Merchant */}
          {!isHisaab && (
            <View className="px-0 pb-3">
              <Text
                className="text-xs font-semibold uppercase tracking-wider mb-2"
                style={{ color: colors.textSecondary }}
              >
                Merchant (optional)
              </Text>
              <TextInput
                value={merchant}
                onChangeText={setMerchant}
                onFocus={() => {
                  setMerchantFocused(true);
                  scrollToBottom();
                }}
                onBlur={() => {
                  setTimeout(() => setMerchantFocused(false), 150);
                }}
                placeholder={direction === "out" ? "e.g. Netflix" : "e.g. Bonus"}
                placeholderTextColor={colors.textSecondary}
                className="border border-border-light dark:border-border-dark rounded-lg px-3 py-2.5 text-sm"
                style={{ color: colors.text, borderColor: colors.border }}
              />
              {merchantSuggestions.length > 0 && (
                <View
                  className="mt-1 border rounded-lg overflow-hidden"
                  style={{ borderColor: colors.border, backgroundColor: colors.surface }}
                >
                  {merchantSuggestions.map((name, i) => (
                    <Pressable
                      key={name}
                      onPress={() => {
                        setMerchant(name);
                        setMerchantFocused(false);
                      }}
                      className="px-3 py-2"
                      style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}
                    >
                      <Text className="text-sm" style={{ color: colors.text }} numberOfLines={1}>
                        {name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Description */}
          <View className="px-0 pb-3">
            <Text
              className="text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: colors.textSecondary }}
            >
              Description (optional)
            </Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              onFocus={scrollToBottom}
              placeholder="Any note"
              placeholderTextColor={colors.textSecondary}
              className="border border-border-light dark:border-border-dark rounded-lg px-3 py-2.5 text-sm"
              style={{ color: colors.text, borderColor: colors.border, minHeight: 48 }}
              multiline
            />
          </View>

          <View className="flex-row px-0 pt-3 gap-3 pb-4">
            <Button
              title="Cancel"
              variant="outline"
              onPress={() => router.back()}
              className="flex-1"
            />
            <Button
              title={existingEntry ? "Save changes" : "Save entry"}
              onPress={handleSave}
              disabled={!canSave}
              loading={saving}
              className="flex-1"
            />
          </View>
        </View>
      </ScrollView>

      <CalendarModal
        visible={datePickerVisible}
        onClose={() => setDatePickerVisible(false)}
        value={date}
        onChange={(d) => {
          setDate(d);
          setDatePickerVisible(false);
        }}
        maximumDate={null}
      />
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
