// Custom entry: expo-router's entry plus the home-screen widget's headless task handler, which
// Android runs without the app UI (when the widget is added, resized, or refreshed on its timer).
import "expo-router/entry";
import { registerWidgetTaskHandler } from "react-native-android-widget";
import { widgetTaskHandler } from "./services/home-widget";

registerWidgetTaskHandler(widgetTaskHandler);
