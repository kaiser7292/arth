import { ScreenContainer } from "@/components/ui";
import { SimulatorPage } from "@/components/home/pages/SimulatorPage";

/**
 * Simulator route.
 *
 * The scenario list lives in SimulatorPage, which the Home swipe-pager also renders. Both were
 * near-copies, and they had drifted: only this one offered the choice between duplicating a
 * scenario's upcoming entries and its full setup. That implementation is now the shared one.
 */
export default function SimulatorListScreen() {
  return (
    <ScreenContainer padTop={false}>
      <SimulatorPage />
    </ScreenContainer>
  );
}
