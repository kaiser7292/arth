import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { useTheme } from "@/hooks/use-theme";
import { HeaderBackHome } from "./HeaderBackHome";

/**
 * The shared Stack header configuration.
 *
 * This block was copy-pasted verbatim into eleven feature `_layout.tsx` files, each reading
 * `Colors[colorScheme]` directly. Having one source means the header cannot drift between feature
 * areas, and it is the last thing that kept the legacy Colors map alive.
 *
 * Type sizes come from the token scale rather than the hardcoded 18px the copies used - React
 * Navigation styles its header outside the NativeWind tree, so it needs real numbers.
 */
export function useStackScreenOptions(): NativeStackNavigationOptions {
  const theme = useTheme();

  return {
    headerStyle: { backgroundColor: theme.background },
    headerTitleStyle: {
      fontFamily: "Inter",
      fontWeight: "600",
      fontSize: 17,
      color: theme.foreground,
    },
    headerTintColor: theme.primary,
    headerShadowVisible: false,
    headerTitleAlign: "center",
    headerLeft: () => <HeaderBackHome />,
  };
}
