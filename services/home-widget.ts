import { createElement } from "react";
import { Platform } from "react-native";
import { requestWidgetUpdate } from "react-native-android-widget";
import type { WidgetTaskHandlerProps } from "react-native-android-widget";
import { SummaryWidget } from "@/components/widget/SummaryWidget";
import type { SummaryWidgetData } from "@/components/widget/SummaryWidget";
import { DEFAULT_USER_ID } from "@/constants/app";
import { initDatabase } from "@/database";
import { getExpenseTotal, getPendingExpenseCount, getUncategorizedCount } from "@/services/expense";
import { getCurrentMonth } from "@/services/budget";
import { getMonthDateRange } from "@/utils/budget-helpers";
import { logger } from "@/utils/logger";

/**
 * Data + refresh for the Arth home-screen widget.
 *
 * "To catch up" here is pending review + uncategorized. Duplicates are left out: the duplicate
 * scan grows with history and the widget can be rendered headlessly on a timer, so it has to
 * stay cheap. Catch Up itself still shows duplicates.
 */

export const WIDGET_NAME = "ArthSummary";

export async function loadSummaryWidgetData(): Promise<SummaryWidgetData | null> {
  try {
    await initDatabase();
    const { startDate, endDate } = getMonthDateRange(getCurrentMonth());
    const [pending, uncategorized, spent] = await Promise.all([
      getPendingExpenseCount(DEFAULT_USER_ID),
      getUncategorizedCount(DEFAULT_USER_ID),
      getExpenseTotal(DEFAULT_USER_ID, startDate, endDate),
    ]);
    return { toCatchUp: pending + uncategorized, spentThisMonth: spent };
  } catch (e) {
    logger.warn("Widget data load failed", e);
    return null;
  }
}

function render(data: SummaryWidgetData | null) {
  return {
    light: createElement(SummaryWidget, { data, scheme: "light" }),
    dark: createElement(SummaryWidget, { data, scheme: "dark" }),
  };
}

/** Headless handler — Android calls this when the widget is added, resized, or on its timer. */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  switch (props.widgetAction) {
    case "WIDGET_ADDED":
    case "WIDGET_UPDATE":
    case "WIDGET_RESIZED":
      props.renderWidget(render(await loadSummaryWidgetData()));
      break;
    default:
      break;
  }
}

/** Push fresh numbers to any widget on the home screen. Cheap no-op when none is placed. */
export async function refreshHomeWidget(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    const data = await loadSummaryWidgetData();
    await requestWidgetUpdate({ widgetName: WIDGET_NAME, renderWidget: () => render(data) });
  } catch (e) {
    logger.warn("Widget refresh failed", e);
  }
}
