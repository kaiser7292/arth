import { ScreenContainer, Text } from "@/components/ui";
import { bumpDataVersion } from "@/services/settings";
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
    getShortAmountStyle,
    getReportAmountStyle,
    setReportAmountStyle,
    type ReportAmountStyle,
    setShortAmountStyle,
    type ShortAmountStyle,
    setTimezone,
} from "@/services/locale-preferences";
import { getFYStartMonth, setFYStartMonth } from "@/services/settings";

import { formatDateWith, todayIso } from "@/utils/date";
import { formatAmount, formatAmountPreview, formatReportShort } from "@/utils/format";
import { formatDateTimeInTimezone } from "@/utils/timezone";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, TextInput, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";

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
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [currency, setCurrencyState] = useState<CurrencyCode>(getCurrency());
  const [grouping, setGroupingState] = useState<NumberGrouping>(getNumberGrouping());
  const [shortStyle, setShortStyleState] = useState<ShortAmountStyle>(getShortAmountStyle());
  const [reportStyle, setReportStyleState] = useState<ReportAmountStyle>(getReportAmountStyle());
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
        <Text className="text-meta text-muted-foreground px-4 pt-4 pb-2">
          These are display-only preferences. They don&apos;t convert any amounts or
          dates - they just change how numbers and dates look.
        </Text>

        {/* One card: each setting with a live sample and its choices as pills (board "Region") */}
        <View className="mx-4 rounded-card bg-card border border-border overflow-hidden">
          <RegionRow label="Currency" sample={formatAmountPreview(123456, currency, grouping)} first>
            <RegionPill label={`${selectedCurrencyDef.symbol || ""} ${selectedCurrencyDef.displayName} ▾`.trim()} on onPress={() => setCurrencyPickerOpen(true)} />
          </RegionRow>
          <RegionRow label="Number grouping" sample={formatAmountPreview(1234567, "NONE" as CurrencyCode, grouping)}>
            {(Object.keys(NUMBER_GROUPING_LABELS) as NumberGrouping[]).map((g) => (
              <RegionPill key={g} label={NUMBER_GROUPING_LABELS[g]} on={grouping === g} onPress={() => handleGroupingChange(g)} />
            ))}
          </RegionRow>
          <RegionRow label="Short amounts" sample={shortStyle === "lakh" ? "₹14.9K · ₹2.3L · ₹1.2Cr" : "₹14.9K · ₹2.3M · ₹1.2B"}>
            {(
              [
                { value: "lakh", label: "Lakh and crore" },
                { value: "million", label: "Million and billion" },
              ] as { value: ShortAmountStyle; label: string }[]
            ).map((o) => (
              <RegionPill
                key={o.value}
                label={o.label}
                on={shortStyle === o.value}
                onPress={() => {
                  setShortAmountStyle(o.value);
                  setShortStyleState(o.value);
                  bumpDataVersion();
                }}
              />
            ))}
          </RegionRow>
          <RegionRow
            label="Report numbers"
            sample={reportStyle === "short" ? formatReportShort(2492209.1) : formatAmount(2492209.1)}
          >
            {(
              [
                { value: "full", label: "Full" },
                { value: "short", label: "Short, tap for full" },
              ] as { value: ReportAmountStyle; label: string }[]
            ).map((o) => (
              <RegionPill
                key={o.value}
                label={o.label}
                on={reportStyle === o.value}
                onPress={() => {
                  setReportAmountStyle(o.value);
                  setReportStyleState(o.value);
                  bumpDataVersion();
                }}
              />
            ))}
          </RegionRow>
          <RegionRow label="Date format" sample={formatDateWith(sampleDate, dateFormat)}>
            {DATE_FORMATS.map((f) => (
              <RegionPill key={f} label={formatDateWith(sampleDate, f)} on={dateFormat === f} onPress={() => handleDateFormatChange(f)} />
            ))}
          </RegionRow>
          <RegionRow label="Financial year starts" sample={FY_OPTIONS.find((o) => o.month === fyStartMonth)?.region ?? ""}>
            {FY_OPTIONS.map((o) => (
              <RegionPill key={o.month} label={o.label} on={fyStartMonth === o.month} onPress={() => handleFyChange(o.month)} />
            ))}
          </RegionRow>
          <RegionRow label="Timezone" sample={`Now ${formatDateTimeInTimezone(sampleDateTime)}`}>
            <RegionPill label={`${timezoneState} ▾`} on onPress={() => setTimezonePickerOpen(true)} />
          </RegionRow>
        </View>
        <Text className="text-label text-muted-foreground px-5 mt-2">All budgets, reports and yearly comparisons follow the financial year.</Text>
      </ScrollView>

      {/* Currency picker overlay */}
      {currencyPickerOpen && (
        <View
          className="absolute inset-0 bg-background"
          style={{ backgroundColor: theme.background }}
        >
          <View
            className="flex-row items-center px-4 pt-12 pb-3 border-b border-border"
            style={{ backgroundColor: theme.background }}
          >
            <Pressable onPress={() => { setCurrencyPickerOpen(false); setCurrencySearch(""); }} className="p-2 -ml-2 mr-2">
              <Ionicons name="close" size={22} color={theme.mutedForeground} />
            </Pressable>
            <Text className="text-heading font-bold text-foreground">Choose currency</Text>
          </View>

          <View className="px-4 pt-3 pb-2">
            <View className="flex-row items-center rounded-control bg-card px-3 py-2">
              <Ionicons name="search" size={18} color={theme.mutedForeground} />
              <TextInput
                value={currencySearch}
                onChangeText={setCurrencySearch}
                placeholder="Search by name or code..."
                placeholderTextColor={theme.mutedForeground}
                className="flex-1 ml-2 text-body text-foreground"
                autoFocus={false}
              />
              {currencySearch !== "" && (
                <Pressable onPress={() => setCurrencySearch("")}>
                  <Ionicons name="close-circle" size={18} color={theme.mutedForeground} />
                </Pressable>
              )}
            </View>
          </View>

          <FlatList
            initialNumToRender={12}
            maxToRenderPerBatch={10}
            windowSize={7}
            data={filteredCurrencies}
            keyExtractor={(item) => item.code}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 32 }}
            renderItem={({ item }) => {
              const isSelected = currency === item.code;
              return (
                <Pressable
                  onPress={() => handleCurrencyChange(item.code)}
                  className="mx-4 my-1 rounded-card p-4 flex-row items-center"
                  style={{
                    backgroundColor: isSelected
                      ? theme.alpha("primary", 0.1)
                      : theme.alpha("primary", 0.1),
                    borderWidth: isSelected ? 1 : 0,
                    borderColor: theme.primary,
                  }}
                >
                  <Text className="text-body font-bold w-14 text-foreground">
                    {item.symbol || "-"}
                  </Text>
                  <View className="flex-1">
                    <Text className="text-body font-semibold text-foreground">
                      {item.displayName}
                    </Text>
                    <Text className="text-label text-muted-foreground mt-0.5">
                      {item.code === "NONE" ? "Plain numbers, no symbol" : item.code} · Sample: {formatAmountPreview(1234567.89, item.code, grouping)}
                    </Text>
                  </View>
                  {isSelected && <Ionicons name="checkmark" size={18} color={theme.primary} />}
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
          style={{ backgroundColor: theme.background }}
        >
          <View
            className="flex-row items-center px-4 pt-12 pb-3 border-b border-border"
            style={{ backgroundColor: theme.background }}
          >
            <Pressable onPress={() => setTimezonePickerOpen(false)} className="p-2 -ml-2 mr-2">
              <Ionicons name="close" size={22} color={theme.mutedForeground} />
            </Pressable>
            <Text className="text-heading font-bold text-foreground">Choose timezone</Text>
          </View>

          <FlatList
            initialNumToRender={12}
            maxToRenderPerBatch={10}
            windowSize={7}
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
                  className="mx-4 my-1 rounded-card p-4 flex-row items-center"
                  style={{
                    backgroundColor: isSelected
                      ? theme.alpha("primary", 0.1)
                      : theme.alpha("primary", 0.1),
                    borderWidth: isSelected ? 1 : 0,
                    borderColor: theme.primary,
                  }}
                >
                  <View className="flex-1">
                    <Text className="text-body font-semibold text-foreground">
                      {item}
                    </Text>
                    <Text className="text-label text-muted-foreground mt-0.5">
                      Sample: {formatDateTimeInTimezone(sampleDateTime, { timeZone: item })}
                    </Text>
                  </View>
                  {isSelected && <Ionicons name="checkmark" size={18} color={theme.primary} />}
                </Pressable>
              );
            }}
          />
        </View>
      )}
    </ScreenContainer>
  );
}

/** One setting in the Region card: its name and a live sample, then its choices. */
function RegionRow({ label, sample, first, children }: { label: string; sample: string; first?: boolean; children: React.ReactNode }) {
  return (
    <View className={`px-4 py-3 ${first ? "" : "border-t border-border"}`} style={{ gap: 8 }}>
      <View className="flex-row items-baseline justify-between" style={{ gap: 8 }}>
        <Text className="text-body font-semibold text-foreground">{label}</Text>
        <Text className="text-meta text-muted-foreground flex-shrink" numberOfLines={1}>
          {sample}
        </Text>
      </View>
      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        {children}
      </View>
    </View>
  );
}

function RegionPill({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      className="rounded-pill border px-3 justify-center"
      style={{ height: 34, borderColor: on ? theme.primary : theme.border, backgroundColor: on ? theme.alpha("primary", 0.1) : theme.card }}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
    >
      <Text className="text-meta font-semibold" style={{ color: on ? theme.primary : theme.foreground }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}
