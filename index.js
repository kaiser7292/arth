// Custom entry: expo-router's entry plus the home-screen widget's headless task handler, which
// Android runs without the app UI (when a widget is added, resized, refreshed on its timer, or a
// button on it is tapped).
import "expo-router/entry";
import { registerWidgetTaskHandler } from "react-native-android-widget";
import { widgetTaskHandler } from "./services/home-widget-task";

registerWidgetTaskHandler(widgetTaskHandler);
