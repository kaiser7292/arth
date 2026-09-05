import { View, Pressable } from "react-native";
import { Text } from "@/components/ui";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface BulkActionBarProps {
  selectedCount: number;
  onChangeCategory: () => void;
  onChangePaymentMode: () => void;
  onChangeAccount: () => void;
  onChangeMerchant: () => void;
  onChangeDate: () => void;
  onCancel: () => void;
}

export function BulkActionBar({
  selectedCount,
  onChangeCategory,
  onChangePaymentMode,
  onChangeAccount,
  onChangeMerchant,
  onChangeDate,
  onCancel,
}: BulkActionBarProps) {
  const { colors, accent } = useColorScheme();
  const insets = useSafeAreaInsets();

  const actions = [
    { label: "Category", icon: "grid-outline" as const, onPress: onChangeCategory },
    { label: "Mode", icon: "card-outline" as const, onPress: onChangePaymentMode },
    { label: "Account", icon: "wallet-outline" as const, onPress: onChangeAccount },
    { label: "Merchant", icon: "storefront-outline" as const, onPress: onChangeMerchant },
    { label: "Date", icon: "calendar-outline" as const, onPress: onChangeDate },
  ];

  return (
    <View
      className="absolute left-0 right-0 bottom-0 border-t border-border"
      style={{ backgroundColor: colors.background, paddingBottom: Math.max(insets.bottom, 8) }}
    >
      {/* Header row */}
      <View className="flex-row items-center justify-between px-4 pt-3 pb-2">
        <Text className="text-xs font-semibold text-foreground">
          {selectedCount} selected
        </Text>
        <Pressable onPress={onCancel}>
          <Text className="text-xs font-medium" style={{ color: accent[500] }}>Cancel</Text>
        </Pressable>
      </View>

      {/* Action buttons */}
      <View className="flex-row justify-around px-2 pb-1">
        {actions.map((action) => (
          <Pressable
            key={action.label}
            onPress={action.onPress}
            className="items-center px-2 py-1.5"
          >
            <Ionicons name={action.icon} size={18} color={accent[500]} />
            <Text className="text-label mt-1 text-muted-foreground">
              {action.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
