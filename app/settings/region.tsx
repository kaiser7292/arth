import { ScreenContainer } from "@/components/ui";
import {
    CURRENCIES,
    DATE_FORMATS,
    NUMBER_GROUPING_LABELS,
    type CurrencyCode,
    type DateFormat,
    type NumberGrouping,
} from "@/constants/currencies";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
    getCurrency,
    getDateFormat,
    getNumberGrouping,
    getTimezone,
    setCurrency,
    setDateFormat,
    setNumberGrouping,
    setTimezone,
} from "@/services/locale-preferences";
import { getFYStartMonth, setFYStartMonth } from "@/services/settings";
import { ac } from "@/utils/accent";
import { formatDateWith, todayIso } from "@/utils/date";
import { formatAmountPreview } from "@/utils/format";
import { formatDateTimeInTimezone } from "@/utils/timezone";
import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";

const FY_OPTIONS: Array<{ month: number; label: string; region: string }> = [
  { month: 1, label: "January", region: "Calendar year" },
  { month: 4, label: "April", region: "India, UK, Japan" },
  { month: 7, label: "July", region: "Australia" },
  { month: 10, label: "October", region: "USA (federal)" },
];

const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

/**
 * Settings → Region.
 *
 * Three locale preferences, cosmetic only:
 *   - Currency (30 options + None)
 *   - Number grouping (Indian / Western / None)
 *   - Date format (4 patterns)
 *
 * All three show live samples. Picking a currency resets the grouping to
 * that currency's default; the user can override it afterwards.
 */
export default function RegionSettingsScreen() {
  const { colors, accent, colorScheme } = useColorScheme();
  const [currency, setCurrencyState] = useState<CurrencyCode>(getCurrency());
  const [grouping, setGroupingState] = useState<NumberGrouping>(getNumberGrouping());
  const [dateFormat, setDateFormatState] = useState<DateFormat>(getDateFormat());
  const [timezoneState, setTimezoneState] = useState<string>(getTimezone());

  const [fyStartMonth, setFyStartMonthState] = useState<number>(getFYStartMonth());

  const [currencyPickerOpen, setCurrencyPickerOpen] = useState(false);
  const [currencySearch, setCurrencySearch] = useState("");
  const [timezonePickerOpen, setTimezonePickerOpen] = useState(false);

  const handleFyChange = (month: number) => {
    setFYStartMonth(month);
    setFyStartMonthState(month);
  };

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

  const handleCurrencyChange = (code: CurrencyCode) => {
    setCurrency(code);
    setCurrencyState(code);
    // setCurrency() also resets grouping to that currency's default; mirror locally.
    setGroupingState(getNumberGrouping());
    setCurrencyPickerOpen(false);
    setCurrencySearch("");
  };

  const handleGroupingChange = (g: NumberGrouping) => {
    setNumberGrouping(g);
    setGroupingState(g);
  };

  const handleDateFormatChange = (f: DateFormat) => {
    setDateFormat(f);
    setDateFormatState(f);
  };

  const handleTimezoneChange = (tz: string) => {
    setTimezone(tz);
    setTimezoneState(tz);
  };

  const sampleDate = todayIso();
  const selectedCurrencyDef = CURRENCIES.find((c) => c.code === currency) ?? CURRENCIES[0];
  const sampleDateTime = new Date().toISOString();

  return (
    <ScreenContainer padTop={false}>
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <Text className="text-sm text-muted-foreground px-4 pt-4 pb-2">
          These are display-only preferences. They don&apos;t convert any amounts or
          dates - they just change how numbers and dates look.
        </Text>

        {/* Currency */}
        <Text className="text-xs font-semibold uppercase tracking-wider text-faint-foreground px-4 mt-4 mb-2">
          Currency
        </Text>
        <Pressable
          onPress={() => setCurrencyPickerOpen(true)}
          className="mx-4 rounded-xl p-4 flex-row items-center"
          style={{ backgroundColor: ac(accent, colorScheme, 50, 900) }}
        >
          <View className="flex-1">
            <Text className="text-base font-semibold text-foreground">
              {selectedCurrencyDef.displayName}
            </Text>
            <Text className="text-xs text-muted-foreground mt-0.5">
              Sample: {formatAmountPreview(1234567.89, currency, grouping)}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </Pressable>

        {/* Grouping */}
        <Text className="text-xs font-semibold uppercase tracking-wider text-faint-foreground px-4 mt-6 mb-2">
          Number format
        </Text>
        {(Object.keys(NUMBER_GROUPING_LABELS) as NumberGrouping[]).map((g) => {
          const isSelected = grouping === g;
          return (
            <Pressable
              key={g}
              onPress={() => handleGroupingChange(g)}
              className="mx-4 mt-2 rounded-xl p-4 flex-row items-center"
              style={{
                backgroundColor: isSelected
                  ? ac(accent, colorScheme, 100, 800)
                  : ac(accent, colorScheme, 50, 900),
                borderWidth: isSelected ? 1 : 0,
                borderColor: accent[500],
              }}
            >
              <View className="flex-1">
                <Text className="text-base font-semibold text-foreground">
                  {NUMBER_GROUPING_LABELS[g]}
                </Text>
                <Text className="text-xs text-muted-foreground mt-0.5">
                  Sample: {formatAmountPreview(1234567.89, currency, g)}
                </Text>
              </View>
              {isSelected && <Ionicons name="checkmark" size={18} color={accent[500]} />}
            </Pressable>
          );
        })}

        {/* Fiscal Year */}
        <Text className="text-xs font-semibold uppercase tracking-wider text-faint-foreground px-4 mt-6 mb-2">
          Fiscal year starts in
        </Text>
        <Text className="text-xs text-muted-foreground px-4 mb-2">
          All budgets, reports, and yearly comparisons follow this fiscal year.
        </Text>
        {FY_OPTIONS.map((opt) => {
          const isSelected = fyStartMonth === opt.month;
          return (
            <Pressable
              key={opt.month}
              onPress={() => handleFyChange(opt.month)}
              className="mx-4 mt-2 rounded-xl p-4 flex-row items-center"
              style={{
                backgroundColor: isSelected
                  ? ac(accent, colorScheme, 100, 800)
                  : ac(accent, colorScheme, 50, 900),
                borderWidth: isSelected ? 1 : 0,
                borderColor: accent[500],
              }}
            >
              <View className="flex-1">
                <Text className="text-base font-semibold text-foreground">
                  {opt.label}
                </Text>
                <Text className="text-xs text-muted-foreground mt-0.5">
                  {opt.region}
                </Text>
              </View>
              {isSelected && <Ionicons name="checkmark" size={18} color={accent[500]} />}
            </Pressable>
          );
        })}

        {/* Date format */}
        <Text className="text-xs font-semibold uppercase tracking-wider text-faint-foreground px-4 mt-6 mb-2">
          Date format
        </Text>
        {DATE_FORMATS.map((f) => {
          const isSelected = dateFormat === f;
          return (
            <Pressable
              key={f}
              onPress={() => handleDateFormatChange(f)}
              className="mx-4 mt-2 rounded-xl p-4 flex-row items-center"
              style={{
                backgroundColor: isSelected
                  ? ac(accent, colorScheme, 100, 800)
                  : ac(accent, colorScheme, 50, 900),
                borderWidth: isSelected ? 1 : 0,
                borderColor: accent[500],
              }}
            >
              <View className="flex-1">
                <Text className="text-base font-semibold text-foreground">
                  {f}
                </Text>
                <Text className="text-xs text-muted-foreground mt-0.5">
                  Sample: {formatDateWith(sampleDate, f)}
                </Text>
              </View>
              {isSelected && <Ionicons name="checkmark" size={18} color={accent[500]} />}
            </Pressable>
          );
        })}

        {/* Timezone */}
        <Text className="text-xs font-semibold uppercase tracking-wider text-faint-foreground px-4 mt-6 mb-2">
          Timezone
        </Text>
        <Pressable
          onPress={() => setTimezonePickerOpen(true)}
          className="mx-4 mt-2 rounded-xl p-4 flex-row items-center"
          style={{ backgroundColor: ac(accent, colorScheme, 50, 900) }}
        >
          <View className="flex-1">
            <Text className="text-base font-semibold text-foreground">
              {timezoneState}
            </Text>
            <Text className="text-xs text-muted-foreground mt-0.5">
              Sample: {formatDateTimeInTimezone(sampleDateTime)}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </Pressable>
      </ScrollView>

      {/* Currency picker overlay */}
      {currencyPickerOpen && (
        <View
          className="absolute inset-0 bg-background"
          style={{ backgroundColor: colors.background }}
        >
          <View
            className="flex-row items-center px-4 pt-12 pb-3 border-b border-border"
            style={{ backgroundColor: colors.background }}
          >
            <Pressable onPress={() => { setCurrencyPickerOpen(false); setCurrencySearch(""); }} className="p-2 -ml-2 mr-2">
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
            <Text className="text-lg font-bold text-foreground">Choose currency</Text>
          </View>

          <View className="px-4 pt-3 pb-2">
            <View className="flex-row items-center rounded-lg bg-card px-3 py-2">
              <Ionicons name="search" size={18} color={colors.textSecondary} />
              <TextInput
                value={currencySearch}
                onChangeText={setCurrencySearch}
                placeholder="Search by name or code..."
                placeholderTextColor={colors.tabIconDefault}
                className="flex-1 ml-2 text-base text-foreground"
                autoFocus={false}
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
              const isSelected = currency === item.code;
              return (
                <Pressable
                  onPress={() => handleCurrencyChange(item.code)}
                  className="mx-4 my-1 rounded-xl p-4 flex-row items-center"
                  style={{
                    backgroundColor: isSelected
                      ? ac(accent, colorScheme, 100, 800)
                      : ac(accent, colorScheme, 50, 900),
                    borderWidth: isSelected ? 1 : 0,
                    borderColor: accent[500],
                  }}
                >
                  <Text className="text-base font-bold w-14 text-foreground">
                    {item.symbol || "-"}
                  </Text>
                  <View className="flex-1">
                    <Text className="text-base font-semibold text-foreground">
                      {item.displayName}
                    </Text>
                    <Text className="text-xs text-muted-foreground mt-0.5">
                      {item.code === "NONE" ? "Plain numbers, no symbol" : item.code} · Sample: {formatAmountPreview(1234567.89, item.code, grouping)}
                    </Text>
                  </View>
                  {isSelected && <Ionicons name="checkmark" size={18} color={accent[500]} />}
                </Pressable>
              );
            }}
          />
        </View>
      )}

      {/* Timezone picker overlay */}
      {timezonePickerOpen && (
        <View
          className="absolute inset-0 bg-background"
          style={{ backgroundColor: colors.background }}
        >
          <View
            className="flex-row items-center px-4 pt-12 pb-3 border-b border-border"
            style={{ backgroundColor: colors.background }}
          >
            <Pressable onPress={() => setTimezonePickerOpen(false)} className="p-2 -ml-2 mr-2">
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
            <Text className="text-lg font-bold text-foreground">Choose timezone</Text>
          </View>

          <FlatList
            data={COMMON_TIMEZONES}
            keyExtractor={(item) => item}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 32 }}
            renderItem={({ item }) => {
              const isSelected = timezoneState === item;
              return (
                <Pressable
                  onPress={() => {
                    handleTimezoneChange(item);
                    setTimezonePickerOpen(false);
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
                  <View className="flex-1">
                    <Text className="text-base font-semibold text-foreground">
                      {item}
                    </Text>
                    <Text className="text-xs text-muted-foreground mt-0.5">
                      Sample: {formatDateTimeInTimezone(sampleDateTime, { timeZone: item })}
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
