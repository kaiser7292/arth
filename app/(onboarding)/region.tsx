import { useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput, FlatList } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Button, Card } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac } from "@/utils/accent";
import {
  setFYStartMonth,
  getFYStartMonth,
  setOnboardingCompletedVersion,
} from "@/services/settings";
import {
  getCurrency,
  getDateFormat,
  getNumberGrouping,
  setCurrency,
  setDateFormat,
  setNumberGrouping,
} from "@/services/locale-preferences";
import {
  CURRENCIES,
  DATE_FORMATS,
  type CurrencyCode,
  type DateFormat,
} from "@/constants/currencies";
import { formatAmountPreview } from "@/utils/format";
import { formatDateWith, todayIso } from "@/utils/date";
import { getCurrentAppVersion } from "@/services/onboarding";

const FY_OPTIONS: Array<{ month: number; label: string; region: string }> = [
  { month: 1, label: "January", region: "Calendar year" },
  { month: 4, label: "April", region: "India, UK, Japan" },
  { month: 7, label: "July", region: "Australia" },
  { month: 10, label: "October", region: "USA (federal)" },
];

export default function OnboardingRegion() {
  const router = useRouter();
  const { accent, colorScheme, colors } = useColorScheme();

  const [fyMonth, setFyMonth] = useState<number>(getFYStartMonth());
  const [currencyId, setCurrencyId] = useState<CurrencyCode>(getCurrency());
  const [dateFormatId, setDateFormatId] = useState<DateFormat>(getDateFormat());

  const [currencyPickerOpen, setCurrencyPickerOpen] = useState(false);
  const [currencySearch, setCurrencySearch] = useState("");

  const filteredCurrencies = useMemo(() => {
    const q = currencySearch.trim().toLowerCase();
    if (!q) return CURRENCIES;
    return CURRENCIES.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        c.displayName.toLowerCase().includes(q) ||
        c.symbol.toLowerCase().includes(q),
    );
  }, [currencySearch]);

  const selectedCurrencyDef = CURRENCIES.find((c) => c.code === currencyId) ?? CURRENCIES[0];

  const handleContinue = () => {
    setFYStartMonth(fyMonth);
    // setCurrency() also sets the grouping to that currency's default.
    setCurrency(currencyId);
    setDateFormat(dateFormatId);
    router.push("/(onboarding)/sms-consent" as never);
  };

  const handleSkip = () => {
    setOnboardingCompletedVersion(getCurrentAppVersion());
    router.replace("/(tabs)" as never);
  };

  return (
    <ScreenContainer safe padTop>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 32, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-2xl font-bold text-text-primary dark:text-text-dark-primary mb-2">
          Set your basics
        </Text>
        <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mb-6 leading-5">
          We use these for yearly reports and currency formatting. You can change them later in Settings.
        </Text>

        <Text className="text-xs font-semibold text-text-tertiary dark:text-text-dark-tertiary uppercase tracking-wider mb-3">
          Fiscal year starts in
        </Text>
        <Card className="p-0 mb-6">
          {FY_OPTIONS.map((opt, i) => {
            const selected = fyMonth === opt.month;
            return (
              <Pressable
                key={opt.month}
                onPress={() => setFyMonth(opt.month)}
                className={`flex-row items-center px-4 py-3 ${
                  i < FY_OPTIONS.length - 1
                    ? "border-b border-border-light dark:border-border-dark"
                    : ""
                }`}
              >
                <View className="flex-1">
                  <Text className="text-base font-medium text-text-primary dark:text-text-dark-primary">
                    {opt.label}
                  </Text>
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
                    {opt.region}
                  </Text>
                </View>
                {selected && (
                  <Ionicons
                    name="checkmark-circle"
                    size={22}
                    color={ac(accent, colorScheme, 500, 200)}
                  />
                )}
              </Pressable>
            );
          })}
        </Card>

        <Text className="text-xs font-semibold text-text-tertiary dark:text-text-dark-tertiary uppercase tracking-wider mb-3">
          Currency
        </Text>
        <Pressable
          onPress={() => setCurrencyPickerOpen(true)}
          className="flex-row items-center px-4 py-3 rounded-xl mb-6"
          style={{ backgroundColor: colors.surface }}
        >
          <Text className="text-base font-bold mr-3 text-text-primary dark:text-text-dark-primary w-14">
            {selectedCurrencyDef.symbol || "-"}
          </Text>
          <View className="flex-1">
            <Text className="text-base font-semibold text-text-primary dark:text-text-dark-primary">
              {selectedCurrencyDef.displayName}
            </Text>
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
              {selectedCurrencyDef.code === "NONE" ? "Plain numbers, no symbol" : selectedCurrencyDef.code}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </Pressable>

        <Text className="text-xs font-semibold text-text-tertiary dark:text-text-dark-tertiary uppercase tracking-wider mb-3">
          Date format
        </Text>
        <Card className="p-0 mb-6">
          {DATE_FORMATS.map((f, i) => {
            const selected = dateFormatId === f;
            return (
              <Pressable
                key={f}
                onPress={() => setDateFormatId(f)}
                className={`flex-row items-center px-4 py-3 ${
                  i < DATE_FORMATS.length - 1
                    ? "border-b border-border-light dark:border-border-dark"
                    : ""
                }`}
              >
                <View className="flex-1">
                  <Text className="text-base font-medium text-text-primary dark:text-text-dark-primary">
                    {f}
                  </Text>
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
                    {formatDateWith(todayIso(), f)}  ·  Sample amount: {formatAmountPreview(1234567.89, currencyId, getNumberGrouping())}
                  </Text>
                </View>
                {selected && (
                  <Ionicons
                    name="checkmark-circle"
                    size={22}
                    color={ac(accent, colorScheme, 500, 200)}
                  />
                )}
              </Pressable>
            );
          })}
        </Card>

      </ScrollView>

      <View className="px-6 pb-6 pt-2">
        <Button title="Continue" onPress={handleContinue} className="mb-3" />
        <Pressable onPress={handleSkip} className="py-3 items-center">
          <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">
            Skip setup
          </Text>
        </Pressable>
      </View>

      {/* Currency picker overlay — searchable dropdown. */}
      {currencyPickerOpen && (
        <View
          className="absolute inset-0 bg-surface-light dark:bg-surface-dark"
          style={{ backgroundColor: colors.background }}
        >
          <View
            className="flex-row items-center px-4 pt-12 pb-3 border-b border-border-light dark:border-border-dark"
            style={{ backgroundColor: colors.background }}
          >
            <Pressable onPress={() => { setCurrencyPickerOpen(false); setCurrencySearch(""); }} className="p-2 -ml-2 mr-2">
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
            <Text className="text-lg font-bold text-text-primary dark:text-text-dark-primary">Choose currency</Text>
          </View>

          <View className="px-4 pt-3 pb-2">
            <View className="flex-row items-center rounded-lg bg-surface-light-alt dark:bg-surface-dark-alt px-3 py-2">
              <Ionicons name="search" size={18} color={colors.textSecondary} />
              <TextInput
                value={currencySearch}
                onChangeText={setCurrencySearch}
                placeholder="Search by name or code..."
                placeholderTextColor={colors.tabIconDefault}
                className="flex-1 ml-2 text-base text-text-primary dark:text-text-dark-primary"
              />
              {currencySearch !== "" && (
                <Pressable onPress={() => setCurrencySearch("")}>
                  <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                </Pressable>
              )}
            </View>
          </View>

          <FlatList
            data={filteredCurrencies}
            keyExtractor={(item) => item.code}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 32 }}
            renderItem={({ item }) => {
              const isSelected = currencyId === item.code;
              return (
                <Pressable
                  onPress={() => {
                    setCurrencyId(item.code);
                    setCurrencyPickerOpen(false);
                    setCurrencySearch("");
                  }}
                  className="mx-4 my-1 rounded-xl p-4 flex-row items-center"
                  style={{
                    backgroundColor: isSelected
                      ? ac(accent, colorScheme, 100, 800)
                      : ac(accent, colorScheme, 50, 900),
                    borderWidth: isSelected ? 1 : 0,
                    borderColor: accent[500],
                  }}
                >
                  <Text className="text-base font-bold w-14 text-text-primary dark:text-text-dark-primary">
                    {item.symbol || "-"}
                  </Text>
                  <View className="flex-1">
                    <Text className="text-base font-semibold text-text-primary dark:text-text-dark-primary">
                      {item.displayName}
                    </Text>
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
                      {item.code === "NONE" ? "Plain numbers, no symbol" : item.code}
                    </Text>
                  </View>
                  {isSelected && <Ionicons name="checkmark" size={18} color={accent[500]} />}
                </Pressable>
              );
            }}
          />
        </View>
      )}
    </ScreenContainer>
  );
}
