import { useEffect, useState } from "react";
import { View } from "react-native";
import { FilterChip, Input, Text } from "@/components/ui";
import { getUserBankNames } from "@/services/financial-account";
import { DEFAULT_USER_ID } from "@/constants/app";

interface BankPickerProps {
  value: string;
  onChange: (bankName: string) => void;
  className?: string;
}

/**
 * Bank for an FD: chips for the banks the user already has accounts with,
 * plus "Other" with a free-text name (docs/FD_IMPROVEMENTS_PROPOSAL.md point 5).
 * With no accounts yet it's just the text box.
 */
export function BankPicker({ value, onChange, className }: BankPickerProps) {
  const [banks, setBanks] = useState<string[] | null>(null);
  const [other, setOther] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getUserBankNames(DEFAULT_USER_ID)
      .then((list) => !cancelled && setBanks(list))
      .catch(() => !cancelled && setBanks([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const known = banks ?? [];
  const match = known.find((b) => b.toLowerCase() === value.trim().toLowerCase());
  // A name typed or preset that isn't one of the user's banks shows as "Other".
  const showOther = other || (value.trim().length > 0 && !match) || (banks != null && known.length === 0);

  return (
    <View className={className}>
      {known.length > 0 && (
        <>
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Bank</Text>
          <View className="flex-row flex-wrap mb-1">
            {known.map((b) => (
              <View key={b} className="mb-2">
                <FilterChip
                  label={b}
                  active={!showOther && match === b}
                  onPress={() => {
                    setOther(false);
                    onChange(b);
                  }}
                />
              </View>
            ))}
            <View className="mb-2">
              <FilterChip
                label="Other"
                active={showOther}
                onPress={() => {
                  setOther(true);
                  if (match) onChange("");
                }}
              />
            </View>
          </View>
        </>
      )}
      {showOther && (
        <Input
          label="Bank name"
          value={value}
          onChangeText={onChange}
          placeholder="e.g. HDFC Bank"
          maxLength={100}
        />
      )}
    </View>
  );
}
