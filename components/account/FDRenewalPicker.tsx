import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";
import { RENEWAL_MODE_LABELS, type FDRenewalMode } from "@/services/investment-accounts";

const OPTIONS: { value: FDRenewalMode; hint: string }[] = [
  { value: "none", hint: "Principal and interest come back to your account, and the FD closes." },
  { value: "principal", hint: "The interest comes to your account; the principal is deposited again for the same term." },
  { value: "principal_interest", hint: "Nothing comes back; the whole maturity amount is deposited again for the same term." },
];

interface FDRenewalPickerProps {
  value: FDRenewalMode;
  onChange: (mode: FDRenewalMode) => void;
  className?: string;
}

/** What the FD does at maturity (docs/FD_IMPROVEMENTS_PROPOSAL.md point 4). */
export function FDRenewalPicker({ value, onChange, className }: FDRenewalPickerProps) {
  const { colors } = useColorScheme();
  const theme = useTheme();
  return (
    <View className={className}>
      <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-2">At maturity</Text>
      {OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            className="flex-row items-start py-2 px-2 rounded-control"
            style={{ backgroundColor: active ? theme.alpha("primary", 0.1) : "transparent" }}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
          >
            <Ionicons
              name={active ? "radio-button-on" : "radio-button-off"}
              size={18}
              color={active ? theme.primary : theme.mutedForeground}
              style={{ marginTop: 1 }}
            />
            <View className="flex-1 ml-2">
              <Text className="text-meta" style={{ color: theme.foreground, fontWeight: active ? "600" : "400" }}>
                {RENEWAL_MODE_LABELS[opt.value]}
              </Text>
              <Text className="text-label mt-0.5" style={{ color: theme.mutedForeground }}>
                {opt.hint}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
