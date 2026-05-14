import { useEffect } from "react";
import { BackHandler } from "react-native";
import { useNavigation } from "expo-router";

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
      navigation.setOptions({ headerLeft: undefined });
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
