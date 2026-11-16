import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { FilterChip, Input, Text } from "@/components/ui";
import { CalendarModal } from "@/components/ui/CalendarModal";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { addFDTerm, fdTermBetween, formatFDTerm } from "@/services/investment-engine";
import { formatDate } from "@/utils/date";

interface FDTermInputProps {
  startDate: string;
  /** Maturity date (YYYY-MM-DD), "" when not set. */
  value: string;
  onChange: (maturityDate: string) => void;
  className?: string;
}

const toInt = (s: string) => {
  const n = parseInt(s.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
};

/**
 * When an FD matures: pick a date, or type the term as years / months / days,
 * whichever the receipt shows (docs/FD_IMPROVEMENTS_PROPOSAL.md point 9). The
 * other one is worked out and shown underneath.
 */
export function FDTermInput({ startDate, value, onChange, className }: FDTermInputProps) {
  const { colors } = useColorScheme();
  const [mode, setMode] = useState<"date" | "term">("date");
  const [years, setYears] = useState("");
  const [months, setMonths] = useState("");
  const [days, setDays] = useState("");
  const [showPicker, setShowPicker] = useState(false);

  const applyTerm = (y: string, m: string, d: string) => {
    const term = { years: toInt(y), months: toInt(m), days: toInt(d) };
    onChange(term.years || term.months || term.days ? addFDTerm(startDate, term) : "");
  };

  // A different start date moves a typed term's maturity with it.
  const prevStart = useRef(startDate);
  useEffect(() => {
    if (prevStart.current === startDate) return;
    prevStart.current = startDate;
    if (mode === "term") applyTerm(years, months, days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate]);

  const switchTo = (next: "date" | "term") => {
    if (next === mode) return;
    if (next === "term" && value && value > startDate) {
      const t = fdTermBetween(startDate, value);
      setYears(t.years ? String(t.years) : "");
      setMonths(t.months ? String(t.months) : "");
      setDays(t.days ? String(t.days) : "");
    }
    setMode(next);
  };

  const valid = value !== "" && value > startDate;

  return (
    <View className={className}>
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Matures</Text>
        <View className="flex-row">
          <FilterChip label="Date" active={mode === "date"} onPress={() => switchTo("date")} spacing="sm" />
          <FilterChip label="Term" active={mode === "term"} onPress={() => switchTo("term")} spacing="sm" />
        </View>
      </View>

      {mode === "date" ? (
        <Pressable
          onPress={() => setShowPicker(true)}
          className="flex-row items-center justify-between border border-border rounded-lg px-3 py-3"
          accessibilityRole="button"
        >
          <Text className="text-sm" style={{ color: value ? colors.text : colors.textSecondary }}>
            {value ? formatDate(value) : "Select maturity date"}
          </Text>
          <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
        </Pressable>
      ) : (
        <View className="flex-row gap-2">
          <Input
            label="Years"
            value={years}
            onChangeText={(t) => {
              setYears(t);
              applyTerm(t, months, days);
            }}
            placeholder="0"
            keyboardType="number-pad"
            maxLength={2}
            containerClassName="flex-1"
          />
          <Input
            label="Months"
            value={months}
            onChangeText={(t) => {
              setMonths(t);
              applyTerm(years, t, days);
            }}
            placeholder="0"
            keyboardType="number-pad"
            maxLength={3}
            containerClassName="flex-1"
          />
          <Input
            label="Days"
            value={days}
            onChangeText={(t) => {
              setDays(t);
              applyTerm(years, months, t);
            }}
            placeholder="0"
            keyboardType="number-pad"
            maxLength={4}
            containerClassName="flex-1"
          />
        </View>
      )}

      {valid && (
        <Text className="text-xs text-faint-foreground mt-1.5">
          {mode === "date"
            ? `Term: ${formatFDTerm(fdTermBetween(startDate, value))}`
            : `Matures on ${formatDate(value)}`}
        </Text>
      )}

      <CalendarModal
        visible={showPicker}
        onClose={() => setShowPicker(false)}
        value={value || startDate}
        onChange={(d) => {
          onChange(d);
          setShowPicker(false);
        }}
        maximumDate={null}
      />
    </View>
  );
}
