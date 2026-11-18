import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { dismissOpeningBanner, isOpeningBannerDismissed } from "@/services/opening-balance-banner";
import { tint } from "@/constants/brand";

/** The "no opening balance" warning on an account. Once dismissed it never comes back for that account. */
export function OpeningBalanceBanner({ accountId, message }: { accountId: string; message: string }) {
  const theme = useTheme();
  const [, setDismissedHere] = useState(false);

  // Read on every render: it may have been dismissed on another screen showing this account.
  if (isOpeningBannerDismissed(accountId)) return null;

  return (
    <View
      className="flex-row items-center pl-3 pr-1 py-1 rounded-control mb-3"
      style={{ backgroundColor: tint(theme.warning, 0.08) }}
    >
      <Ionicons name="alert-circle" size={14} color={theme.warning} />
      <Text className="text-label font-medium ml-2 flex-1" style={{ color: theme.warning }}>
        {message}
      </Text>
      <Pressable
        onPress={() => {
          dismissOpeningBanner(accountId);
          setDismissedHere(true);
        }}
        className="p-1.5"
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Dismiss this warning"
      >
        <Ionicons name="close" size={16} color={theme.warning} />
      </Pressable>
    </View>
  );
}
