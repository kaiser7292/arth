import type { WidgetTaskHandlerProps } from "react-native-android-widget";
import { WIDGET_APPROVE, WIDGET_REJECT } from "@/components/widget/ArthWidgets";
import { loadWidgetData, renderWidget } from "@/services/home-widget";
import { handleAlertAction } from "@/services/transaction-alerts";

/**
 * Headless handler: Android calls it when a widget is added, resized, on its timer, and for the
 * Approve / Reject buttons on the review widget. Those run without opening Arth, through the same
 * path as the notification buttons (re-checks the item is still waiting, refuses while the app
 * lock is on, clears the item's notification). Kept apart from services/home-widget.ts, which
 * transaction-alerts imports, to avoid an import cycle.
 */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  switch (props.widgetAction) {
    case "WIDGET_ADDED":
    case "WIDGET_UPDATE":
    case "WIDGET_RESIZED":
      props.renderWidget(renderWidget(props.widgetInfo, await loadWidgetData()));
      break;
    case "WIDGET_CLICK": {
      const action =
        props.clickAction === WIDGET_APPROVE ? "approve" : props.clickAction === WIDGET_REJECT ? "reject" : null;
      if (!action) break;
      // handleAlertAction refreshes every widget once it has acted; this one redraws now either way
      // (a refused tap, e.g. with the app lock on, still shows the current state).
      await handleAlertAction(action, props.clickActionData ?? null);
      props.renderWidget(renderWidget(props.widgetInfo, await loadWidgetData()));
      break;
    }
    default:
      break;
  }
}
