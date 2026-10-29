import { useEffect } from "react";
import { BackHandler } from "react-native";
import { useNavigation } from "expo-router";
import { HeaderBackHome } from "@/components/ui/HeaderBackHome";

/**
 * Intercepts hardware back + Stack header back when a sub-view is active.
 * Returns to the parent view instead of popping the screen.
 *
 * @param isSubView - true when the screen is showing a sub-view (not the main list)
 * @param goBack - callback to return to the main view (e.g. setViewMode("list"))
 */
export function useBackOverride(isSubView: boolean, goBack: () => void): void {
  const navigation = useNavigation();

  useEffect(() => {
    if (!isSubView) {
      // Back to the stack's own back + home. Not `undefined`: that drops to the platform default,
      // which is a bare arrow on Android and nothing at all on iPhone when the screen is the
      // first of its section (Hisaab ledger opened from Together or a transaction).
      navigation.setOptions({ headerLeft: () => <HeaderBackHome /> });
      return;
    }

    navigation.setOptions({
      headerLeft: (props: any) => {
        const HeaderBackButton =
          require("@react-navigation/elements").HeaderBackButton;
        return (
          <HeaderBackButton
            {...props}
            onPress={goBack}
          />
        );
      },
    });

    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      goBack();
      return true;
    });

    return () => sub.remove();
  }, [isSubView, goBack, navigation]);
}
