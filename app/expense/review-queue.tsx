import { ScreenContainer } from "@/components/ui";
import { ReviewQueuePage } from "@/components/home/pages/ReviewQueuePage";

/**
 * Review queue route.
 *
 * The queue itself lives in ReviewQueuePage, which the Home swipe-pager also renders. Both were
 * ~1,050-line near-copies, and they had drifted: only this one read the `filter` URL param or
 * offered "Scan now". That implementation is now the shared one.
 *
 * ScreenContainer pads for the status bar here because this stack is headerless; the pager sits
 * under Home's header and renders the page without it.
 */
export default function ReviewQueueScreen() {
  return (
    <ScreenContainer>
      <ReviewQueuePage />
    </ScreenContainer>
  );
}
