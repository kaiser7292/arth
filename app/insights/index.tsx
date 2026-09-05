import { ScreenContainer } from "@/components/ui";
import { InsightsPage } from "@/components/home/pages/InsightsPage";

/**
 * Analytics route.
 *
 * The dashboard itself lives in InsightsPage, which the Home swipe-pager also renders. This file
 * was a near-copy that had already drifted: it never gained the pull-to-refresh the pager version
 * has. Sharing one implementation is how that stops happening.
 */
export default function AnalyticsDashboardScreen() {
  return (
    <ScreenContainer padTop={false}>
      <InsightsPage />
    </ScreenContainer>
  );
}
